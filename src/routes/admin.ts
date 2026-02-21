import { Hono } from "hono";

import { EpisodePatchRequestSchema } from "../../shared/schemas/admin-api.js";
import { getAllConfigs, getConfigBySlug } from "../config.js";
import {
  buildEpisodeMp3,
  downloadEpisodeTracks,
  forceUnlock,
  getEpisodeFileSize,
  isDownloadLocked,
  isMergeLocked,
  mergeEpisodeMp3,
} from "../services/audio.js";
import { discoverEpisodes, syncSingleEpisode, syncUnsyncedEpisodes } from "../services/bandcamp.js";
import { operationQueue } from "../services/operation-queue.js";
import * as storage from "../services/storage.js";

const app = new Hono();

// GET /api/admin/podcasts — list all configured podcasts with stats
app.get("/podcasts", async (c) => {
  const configs = getAllConfigs();
  const podcasts = [];

  for (const [slug, config] of Object.entries(configs)) {
    const index = await storage.readEpisodeIndex(slug);
    const episodeCount = index?.episodes.length ?? 0;
    const syncedCount = index?.episodes.filter((e) => e.synced).length ?? 0;
    const cachedCount = index?.episodes.filter((e) => e.merged).length ?? 0;
    const skippedCount = index?.episodes.filter((e) => e.skipped).length ?? 0;
    const lastUpdated = index?.lastUpdated ?? null;

    podcasts.push({
      author: config.author,
      bandcampUrl: config.bandcampUrl,
      cachedCount,
      episodeCount,
      lastUpdated,
      skippedCount,
      slug,
      syncedCount,
      title: config.title,
    });
  }

  return c.json({ podcasts });
});

// GET /api/admin/podcasts/:podcast — episode list for a podcast
app.get("/podcasts/:podcast", async (c) => {
  const slug = c.req.param("podcast");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const index = await storage.readEpisodeIndex(slug);
  if (!index) {
    return c.json({ episodes: [], podcast: { slug, title: config.title } });
  }

  const episodes = [];
  for (const entry of index.episodes) {
    const meta = await storage.readEpisodeMeta(slug, entry.id);
    const fileSize = entry.merged ? await getEpisodeFileSize(slug, entry.id) : null;

    // Check if all tracks have been downloaded (for synced, non-merged, non-skipped episodes)
    let allTracksDownloaded = false;
    if (entry.synced && !entry.merged && !entry.skipped && meta && meta.tracks.length > 0) {
      const sizes = await Promise.all(
        meta.tracks.map((t) => storage.getTrackFileSize(slug, entry.id, t.filename)),
      );
      allTracksDownloaded = sizes.every((s) => s !== null);
    }

    episodes.push({
      allTracksDownloaded,
      episodeNumber: entry.episodeNumber,
      episodePart: entry.episodePart,
      fileSize,
      id: entry.id,
      merged: entry.merged,
      minimumPrice: meta?.minimumPrice ?? null,
      priceCurrency: meta?.priceCurrency ?? null,
      releaseDate: entry.releaseDate,
      skipped: entry.skipped,
      synced: entry.synced,
      title: entry.title,
      trackCount: meta?.tracks.length ?? 0,
    });
  }

  return c.json({
    episodes,
    podcast: {
      author: config.author,
      lastUpdated: index.lastUpdated,
      slug,
      title: config.title,
    },
  });
});

// GET /api/admin/podcasts/:podcast/episodes/:id — episode detail
app.get("/podcasts/:podcast/episodes/:id", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const meta = await storage.readEpisodeMeta(slug, id);

  if (meta) {
    const fileSize = meta.merged ? await getEpisodeFileSize(slug, id) : null;
    const artworkExists = meta.artworkFilename
      ? await storage.hasTrackFile(slug, id, "../artwork.jpg").catch(() => false)
      : false;

    const tracksWithSize = await Promise.all(
      meta.tracks.map(async (track) => ({
        ...track,
        fileSize: await storage.getTrackFileSize(slug, id, track.filename),
      })),
    );

    return c.json({
      ...meta,
      artworkExists,
      artworkUrl: artworkExists ? `/api/admin/podcasts/${slug}/episodes/${id}/artwork` : null,
      fileSize,
      priceCurrency: meta.priceCurrency ?? null,
      tracks: tracksWithSize,
    });
  }

  // No meta.json yet — fall back to the index entry (unsynced episode)
  const index = await storage.readEpisodeIndex(slug);
  const entry = index?.episodes.find((e) => e.id === id);
  if (!entry) {
    return c.notFound();
  }

  return c.json({
    artworkExists: false,
    artworkUrl: null,
    bandcampUrl: entry.bandcampUrl,
    cleanTitle: entry.title,
    episodeNumber: entry.episodeNumber,
    episodeNumberManual: entry.episodeNumberManual,
    episodePart: entry.episodePart,
    fileSize: null,
    id: entry.id,
    merged: false,
    minimumPrice: null,
    priceCurrency: null,
    releaseDate: entry.releaseDate,
    skipped: entry.skipped,
    title: entry.title,
    tracks: [],
  });
});

// GET /api/admin/podcasts/:podcast/artwork — serve podcast-level artwork
app.get("/podcasts/:podcast/artwork", async (c) => {
  const slug = c.req.param("podcast");
  const artPath = storage.podcastArtworkPath(slug);

  try {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");

    const stats = await stat(artPath);
    const stream = createReadStream(artPath);
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(readable, {
      headers: {
        "Cache-Control": "public, max-age=86400",
        "Content-Length": stats.size.toString(),
        "Content-Type": "image/jpeg",
      },
    });
  } catch {
    return c.notFound();
  }
});

// GET /api/admin/podcasts/:podcast/episodes/:id/artwork — serve episode artwork
app.get("/podcasts/:podcast/episodes/:id/artwork", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const artPath = storage.artworkPath(slug, id);

  try {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");

    const stats = await stat(artPath);
    const stream = createReadStream(artPath);
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(readable, {
      headers: {
        "Cache-Control": "public, max-age=86400",
        "Content-Length": stats.size.toString(),
        "Content-Type": "image/jpeg",
      },
    });
  } catch {
    return c.notFound();
  }
});

// POST /api/admin/podcasts/:podcast/discover — submit discover task
app.post("/podcasts/:podcast/discover", (c) => {
  const slug = c.req.param("podcast");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const taskId = operationQueue.submit(
    "discover",
    { podcastSlug: slug, podcastTitle: config.title },
    async () => {
      await discoverEpisodes(slug, config);
    },
  );

  return c.json({ status: operationQueue.getTask(taskId)?.status ?? "queued", taskId });
});

// POST /api/admin/podcasts/:podcast/sync — submit sync task
app.post("/podcasts/:podcast/sync", (c) => {
  const slug = c.req.param("podcast");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const taskId = operationQueue.submit(
    "sync",
    { podcastSlug: slug, podcastTitle: config.title },
    async (onProgress) => {
      await syncUnsyncedEpisodes(slug, (progress) => {
        onProgress(Object.fromEntries(Object.entries(progress)));
      });
    },
  );

  return c.json({ status: operationQueue.getTask(taskId)?.status ?? "queued", taskId });
});

// POST /api/admin/podcasts/:podcast/episodes/:id/sync — submit single sync task
app.post("/podcasts/:podcast/episodes/:id/sync", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  // Look up episode title from the index
  const index = await storage.readEpisodeIndex(slug);
  const entry = index?.episodes.find((e) => e.id === id);

  const taskId = operationQueue.submit(
    "sync-single",
    { episodeId: id, episodeTitle: entry?.title, podcastSlug: slug, podcastTitle: config.title },
    async () => {
      await syncSingleEpisode(slug, id);
    },
  );

  return c.json({ status: operationQueue.getTask(taskId)?.status ?? "queued", taskId });
});

// PATCH /api/admin/podcasts/:podcast/episodes/:id — update episode metadata
app.patch("/podcasts/:podcast/episodes/:id", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const body: unknown = await c.req.json();
  const parsed = EpisodePatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ message: "Invalid request body" }, 400);
  }

  const { episodeNumber, episodePart, skipped } = parsed.data;

  // Update the index entry
  const index = await storage.readEpisodeIndex(slug);
  const indexEntry = index?.episodes.find((e) => e.id === id);
  if (!index || !indexEntry) {
    return c.notFound();
  }

  if (episodeNumber !== undefined || episodePart !== undefined) {
    indexEntry.episodeNumber = episodeNumber;
    indexEntry.episodePart = episodePart;
    indexEntry.episodeNumberManual = true;
  }

  if (skipped !== undefined) {
    indexEntry.skipped = skipped;
    indexEntry.skippedManual = true;
  }

  index.lastUpdated = new Date().toISOString();
  await storage.writeEpisodeIndex(slug, index);

  // Update meta.json if it exists
  const meta = await storage.readEpisodeMeta(slug, id);
  if (meta) {
    if (episodeNumber !== undefined || episodePart !== undefined) {
      meta.episodeNumber = episodeNumber;
      meta.episodePart = episodePart;
      meta.episodeNumberManual = true;
    }
    if (skipped !== undefined) {
      meta.skipped = skipped;
      meta.skippedManual = true;
    }
    await storage.writeEpisodeMeta(slug, id, meta);
  }

  return c.json({ message: "Episode updated" });
});

// DELETE /api/admin/podcasts/:podcast/episodes/:id/files — clear episode files
app.delete("/podcasts/:podcast/episodes/:id/files", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const target = c.req.query("target") ?? "all";
  if (target !== "tracks" && target !== "merged" && target !== "all") {
    return c.json({ message: "Invalid target — must be tracks, merged, or all" }, 400);
  }

  const force = c.req.query("force") === "true";

  if (force) {
    forceUnlock(slug, id);
  } else if (isMergeLocked(slug, id) || isDownloadLocked(slug, id)) {
    return c.json({ message: "Operation in progress for this episode" }, 409);
  }

  let tracksDeleted = 0;
  let mergedDeleted = false;

  if (target === "tracks" || target === "all") {
    tracksDeleted = await storage.clearTrackFiles(slug, id);
  }

  if (target === "merged" || target === "all") {
    mergedDeleted = await storage.clearMergedMp3(slug, id);
    if (mergedDeleted) {
      const meta = await storage.readEpisodeMeta(slug, id);
      if (meta) {
        meta.merged = false;
        await storage.writeEpisodeMeta(slug, id, meta);
      }
      const index = await storage.readEpisodeIndex(slug);
      if (index) {
        const entry = index.episodes.find((e) => e.id === id);
        if (entry) {
          entry.merged = false;
          index.lastUpdated = new Date().toISOString();
          await storage.writeEpisodeIndex(slug, index);
        }
      }
    }
  }

  return c.json({ mergedDeleted, message: "Files cleared", tracksDeleted });
});

// POST /api/admin/podcasts/:podcast/episodes/:id/download — submit download task
app.post("/podcasts/:podcast/episodes/:id/download", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const index = await storage.readEpisodeIndex(slug);
  const entry = index?.episodes.find((e) => e.id === id);

  const taskId = operationQueue.submit(
    "download",
    { episodeId: id, episodeTitle: entry?.title, podcastSlug: slug, podcastTitle: config.title },
    async (onProgress) => {
      await downloadEpisodeTracks(slug, id, (progress) => {
        onProgress(Object.fromEntries(Object.entries(progress)));
      });
    },
  );

  return c.json({ status: operationQueue.getTask(taskId)?.status ?? "queued", taskId });
});

// POST /api/admin/podcasts/:podcast/episodes/:id/merge — submit merge task
app.post("/podcasts/:podcast/episodes/:id/merge", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const index = await storage.readEpisodeIndex(slug);
  const entry = index?.episodes.find((e) => e.id === id);

  const taskId = operationQueue.submit(
    "merge",
    { episodeId: id, episodeTitle: entry?.title, podcastSlug: slug, podcastTitle: config.title },
    async (onProgress) => {
      await mergeEpisodeMp3(slug, id, config, (progress) => {
        onProgress(Object.fromEntries(Object.entries(progress)));
      });
    },
  );

  return c.json({ status: operationQueue.getTask(taskId)?.status ?? "queued", taskId });
});

// POST /api/admin/podcasts/:podcast/build — submit build tasks for all unmerged episodes
app.post("/podcasts/:podcast/build", async (c) => {
  const slug = c.req.param("podcast");
  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  const index = await storage.readEpisodeIndex(slug);
  if (!index) {
    return c.json({ message: "No episodes synced yet. Run sync first." }, 400);
  }

  const unmerged = index.episodes.filter((e) => e.synced && !e.merged && !e.skipped);
  const taskIds: string[] = [];

  for (const entry of unmerged) {
    // Submit each as a "merge" task that uses buildEpisodeMp3 (downloads + merges)
    const taskId = operationQueue.submit(
      "merge",
      {
        episodeId: entry.id,
        episodeTitle: entry.title,
        podcastSlug: slug,
        podcastTitle: config.title,
      },
      async (onProgress) => {
        await buildEpisodeMp3(slug, entry.id, config, (progress) => {
          onProgress(Object.fromEntries(Object.entries(progress)));
        });
      },
    );
    taskIds.push(taskId);
  }

  return c.json({ message: `Submitted ${taskIds.length} build tasks`, taskIds });
});

export { app as adminRoutes };

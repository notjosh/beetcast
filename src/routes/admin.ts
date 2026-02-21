import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import pino from "pino";

import { EpisodePatchRequestSchema } from "../../shared/schemas/admin-api.js";
import { getAllConfigs, getConfigBySlug } from "../config.js";
import {
  buildEpisodeMp3,
  downloadEpisodeTracks,
  getEpisodeFileSize,
  mergeEpisodeMp3,
} from "../services/audio.js";
import {
  discoverEpisodes,
  type SyncProgress,
  syncSingleEpisode,
  syncUnsyncedEpisodes,
} from "../services/bandcamp.js";
import * as storage from "../services/storage.js";

const log = pino({ name: "routes:admin" });

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
  if (!config) return c.notFound();

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
  if (!config) return c.notFound();

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
  if (!entry) return c.notFound();

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

// POST /api/admin/podcasts/:podcast/discover — fetch discography, update index
app.post("/podcasts/:podcast/discover", async (c) => {
  const slug = c.req.param("podcast");
  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

  log.info({ slug }, "Starting discovery via admin API");

  try {
    const result = await discoverEpisodes(slug, config);
    return c.json({
      discovered: result.discovered,
      message: "Discovery complete",
      totalFound: result.totalFound,
    });
  } catch (err) {
    log.error({ err, slug }, "Discovery failed");
    return c.json({ message: String(err) }, 500);
  }
});

// POST /api/admin/podcasts/:podcast/sync — sync unsynced episodes (SSE stream)
app.post("/podcasts/:podcast/sync", async (c) => {
  const slug = c.req.param("podcast");
  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

  log.info({ slug }, "Starting episode sync via admin API");

  return streamSSE(c, async (stream) => {
    const onProgress = async (progress: SyncProgress) => {
      await stream.writeSSE({ data: JSON.stringify(progress), event: "progress" });
    };

    try {
      const result = await syncUnsyncedEpisodes(slug, onProgress);
      await stream.writeSSE({
        data: JSON.stringify({
          discovered: 0,
          errored: result.errored,
          message: "Sync complete",
          skipped: result.skippedCount,
          synced: result.synced,
          totalFound: result.total,
        }),
        event: "complete",
      });
    } catch (err) {
      log.error({ err, slug }, "Sync failed");
      await stream.writeSSE({
        data: JSON.stringify({ message: String(err) }),
        event: "error",
      });
    }
  });
});

// POST /api/admin/podcasts/:podcast/episodes/:id/sync — sync a single episode
app.post("/podcasts/:podcast/episodes/:id/sync", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

  try {
    const meta = await syncSingleEpisode(slug, id);
    return c.json({ episode: meta, message: "Episode synced" });
  } catch (err) {
    log.error({ episodeId: id, err, slug }, "Failed to sync episode");
    return c.json({ message: String(err) }, 500);
  }
});

// PATCH /api/admin/podcasts/:podcast/episodes/:id — update episode metadata
app.patch("/podcasts/:podcast/episodes/:id", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

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

// POST /api/admin/podcasts/:podcast/episodes/:id/download — download missing tracks (SSE stream)
app.post("/podcasts/:podcast/episodes/:id/download", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

  log.info({ episodeId: id, slug }, "Starting track download via admin API");

  return streamSSE(c, async (stream) => {
    try {
      await downloadEpisodeTracks(slug, id, async (progress) => {
        await stream.writeSSE({ data: JSON.stringify(progress), event: "progress" });
      });
      await stream.writeSSE({
        data: JSON.stringify({ message: "Download complete" }),
        event: "complete",
      });
    } catch (err) {
      log.error({ episodeId: id, err, slug }, "Download failed");
      await stream.writeSSE({
        data: JSON.stringify({ message: String(err) }),
        event: "error",
      });
    }
  });
});

// POST /api/admin/podcasts/:podcast/episodes/:id/merge — merge tracks into episode MP3 (SSE stream)
app.post("/podcasts/:podcast/episodes/:id/merge", async (c) => {
  const slug = c.req.param("podcast");
  const id = c.req.param("id");
  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

  log.info({ episodeId: id, slug }, "Starting episode merge via admin API");

  return streamSSE(c, async (stream) => {
    try {
      await mergeEpisodeMp3(slug, id, config, async (progress) => {
        await stream.writeSSE({ data: JSON.stringify(progress), event: "progress" });
      });
      await stream.writeSSE({
        data: JSON.stringify({ message: "Merge complete" }),
        event: "complete",
      });
    } catch (err) {
      log.error({ episodeId: id, err, slug }, "Merge failed");
      await stream.writeSSE({
        data: JSON.stringify({ message: String(err) }),
        event: "error",
      });
    }
  });
});

// POST /api/admin/podcasts/:podcast/build — build all unmerged MP3s
app.post("/podcasts/:podcast/build", async (c) => {
  const slug = c.req.param("podcast");
  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

  const index = await storage.readEpisodeIndex(slug);
  if (!index) {
    return c.json({ message: "No episodes synced yet. Run sync first." }, 400);
  }

  const unmerged = index.episodes.filter((e) => e.synced && !e.merged && !e.skipped);
  let built = 0;
  let failed = 0;

  for (const entry of unmerged) {
    try {
      await buildEpisodeMp3(slug, entry.id, config);
      built++;
    } catch (err) {
      log.error({ episodeId: entry.id, err }, "Failed to build episode");
      failed++;
    }
  }

  return c.json({ built, failed, message: "Build complete" });
});

export { app as adminRoutes };

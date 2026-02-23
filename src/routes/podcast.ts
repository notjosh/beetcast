import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import pino from "pino";

import type { PodcastConfig } from "../schemas/config.js";

import { getConfigBySlug } from "../config.js";
import { buildEpisodeMp3, downloadEpisodeTracks, mergeEpisodeMp3 } from "../services/audio.js";
import { discoverEpisodes, syncUnsyncedEpisodes } from "../services/bandcamp.js";
import { buildChaptersJson, generateFeed } from "../services/feed.js";
import { operationQueue } from "../services/operation-queue.js";
import * as storage from "../services/storage.js";

const log = pino({ name: "routes:podcast" });

interface Env {
  Variables: {
    podcastConfig: PodcastConfig;
    podcastSlug: string;
  };
}

const app = new Hono<Env>();

// Middleware: resolve podcast slug to config
app.use("/*", async (c, next) => {
  const slug = c.req.param("podcast");
  if (!slug) {
    return c.notFound();
  }

  const config = getConfigBySlug(slug);
  if (!config) {
    return c.notFound();
  }

  c.set("podcastSlug", slug);
  c.set("podcastConfig", config);
  return next();
});

// Resolve episode ID: try number lookup first, fall back to slug
async function resolveEpisodeId(podcastSlug: string, idParam: string): Promise<null | string> {
  const num = parseInt(idParam, 10);
  if (!isNaN(num)) {
    const index = await storage.readEpisodeIndex(podcastSlug);
    if (index) {
      const entry = index.episodes.find((e) => e.episodeNumber === num);
      if (entry) {
        return entry.id;
      }
    }
  }
  // Fall back to using the param as a slug/id directly
  const meta = await storage.readEpisodeMeta(podcastSlug, idParam);
  if (meta) {
    return idParam;
  }
  return null;
}

/** Stream a file as a Response with the given content type */
function streamFile(
  filePath: string,
  stats: { size: number },
  contentType: string,
  extraHeaders?: Record<string, string>,
): Response {
  const stream = createReadStream(filePath);
  const readable = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Length": stats.size.toString(),
      "Content-Type": contentType,
      ...extraHeaders,
    },
  });
}

// GET|HEAD /feed.xml
app.on(["GET", "HEAD"], "/feed.xml", async (c) => {
  const slug = c.get("podcastSlug");
  const config = c.get("podcastConfig");
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

  // Use index file mtime for caching headers
  let lastModified: string | undefined;
  let etagValue: string | undefined;
  try {
    const indexStat = await stat(storage.episodeIndexPath(slug));
    lastModified = indexStat.mtime.toUTCString();
    etagValue = `"${indexStat.mtimeMs.toString(36)}"`;
  } catch {
    // No index file yet — skip caching headers
  }

  // Check conditional headers before generating the feed
  if (etagValue) {
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etagValue) {
      return c.body(null, 304);
    }
  }
  if (lastModified) {
    const ifModifiedSince = c.req.header("If-Modified-Since");
    if (ifModifiedSince) {
      const clientDate = new Date(ifModifiedSince).getTime();
      const serverDate = new Date(lastModified).getTime();
      if (!isNaN(clientDate) && clientDate >= serverDate) {
        return c.body(null, 304);
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/rss+xml; charset=utf-8",
  };
  if (etagValue) {
    headers.ETag = etagValue;
  }
  if (lastModified) {
    headers["Last-Modified"] = lastModified;
  }

  if (c.req.method === "HEAD") {
    return c.body(null, 200, headers);
  }

  const episodes = await storage.getAllEpisodeMetas(slug);
  const xml = await generateFeed(slug, config, episodes, baseUrl);

  const acceptEncoding = c.req.header("Accept-Encoding") ?? "";
  if (acceptEncoding.includes("gzip")) {
    const compressed = gzipSync(xml);
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = compressed.byteLength.toString();
    return c.body(compressed, 200, headers);
  }

  headers["Content-Length"] = Buffer.byteLength(xml, "utf-8").toString();
  return c.body(xml, 200, headers);
});

// GET|HEAD /artwork.jpg — podcast-level artwork
app.on(["GET", "HEAD"], "/artwork.jpg", async (c) => {
  const slug = c.get("podcastSlug");
  const artPath = storage.podcastArtworkPath(slug);

  try {
    const stats = await stat(artPath);
    if (c.req.method === "HEAD") {
      return c.body(null, 200, {
        "Cache-Control": "public, max-age=86400",
        "Content-Length": stats.size.toString(),
        "Content-Type": "image/jpeg",
      });
    }
    return streamFile(artPath, stats, "image/jpeg", { "Cache-Control": "public, max-age=86400" });
  } catch {
    return c.notFound();
  }
});

// GET|HEAD /episode/:id/artwork.jpg — episode artwork
app.on(["GET", "HEAD"], "/episode/:id/artwork.jpg", async (c) => {
  const slug = c.get("podcastSlug");
  const episodeId = await resolveEpisodeId(slug, c.req.param("id"));
  if (!episodeId) {
    return c.notFound();
  }

  const artPath = storage.artworkPath(slug, episodeId);
  try {
    const stats = await stat(artPath);
    if (c.req.method === "HEAD") {
      return c.body(null, 200, {
        "Cache-Control": "public, max-age=86400",
        "Content-Length": stats.size.toString(),
        "Content-Type": "image/jpeg",
      });
    }
    return streamFile(artPath, stats, "image/jpeg", { "Cache-Control": "public, max-age=86400" });
  } catch {
    return c.notFound();
  }
});

// GET /episode/:id/chapters.json — Podcasting 2.0 chapters
app.get("/episode/:id/chapters.json", async (c) => {
  const slug = c.get("podcastSlug");
  const episodeId = await resolveEpisodeId(slug, c.req.param("id"));
  if (!episodeId) {
    return c.notFound();
  }

  const meta = await storage.readEpisodeMeta(slug, episodeId);
  if (!meta) {
    return c.notFound();
  }

  return c.json(buildChaptersJson(meta.tracks));
});

// GET|HEAD /episode/:id
app.on(["GET", "HEAD"], "/episode/:id", async (c) => {
  const slug = c.get("podcastSlug");
  const idParam = c.req.param("id");

  // Handle .mp3 suffix
  if (idParam.endsWith(".mp3")) {
    const cleanId = idParam.slice(0, -4);
    const episodeId = await resolveEpisodeId(slug, cleanId);
    if (!episodeId) {
      return c.notFound();
    }

    const config = c.get("podcastConfig");

    // Download + merge if needed, each as a visible queued operation
    const exists = await storage.hasMergedMp3(slug, episodeId);
    if (!exists) {
      log.info({ episodeId }, "Building episode MP3 on demand via queue");
      const index = await storage.readEpisodeIndex(slug);
      const entry = index?.episodes.find((e) => e.id === episodeId);
      const taskCtx = {
        episodeId,
        episodeTitle: entry?.title,
        podcastSlug: slug,
        podcastTitle: config.title,
      };

      await operationQueue.submitAndWait("download", taskCtx, async (onProgress) => {
        try {
          await downloadEpisodeTracks(slug, episodeId, (progress) => {
            onProgress(Object.fromEntries(Object.entries(progress)));
          });
        } catch (err) {
          if (err instanceof Error && err.message === "All tracks already downloaded") {
            return; // no-op, proceed to merge
          }
          throw err;
        }
      });

      await operationQueue.submitAndWait("merge", taskCtx, async (onProgress) => {
        await mergeEpisodeMp3(slug, episodeId, config, (progress) => {
          onProgress(Object.fromEntries(Object.entries(progress)));
        });
      });
    }

    const mp3Path = storage.episodeMp3Path(slug, episodeId);
    const stats = await stat(mp3Path);
    const totalSize = stats.size;

    if (c.req.method === "HEAD") {
      return c.body(null, 200, {
        "Accept-Ranges": "bytes",
        "Content-Length": totalSize.toString(),
        "Content-Type": "audio/mpeg",
      });
    }

    const rangeHeader = c.req.header("Range");
    if (rangeHeader) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      if (!match) {
        return c.body(null, 416, {
          "Content-Range": `bytes */${totalSize}`,
        });
      }

      const start = parseInt(match[1] ?? "", 10);
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        return c.body(null, 416, {
          "Content-Range": `bytes */${totalSize}`,
        });
      }

      const chunkSize = end - start + 1;
      const stream = createReadStream(mp3Path, { end, start });
      const readable = new ReadableStream({
        start(controller) {
          stream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
          stream.on("end", () => controller.close());
          stream.on("error", (err) => controller.error(err));
        },
      });

      return new Response(readable, {
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Content-Type": "audio/mpeg",
        },
        status: 206,
      });
    }

    return streamFile(mp3Path, stats, "audio/mpeg", { "Accept-Ranges": "bytes" });
  }

  // JSON metadata
  const episodeId = await resolveEpisodeId(slug, idParam);
  if (!episodeId) {
    return c.notFound();
  }

  const meta = await storage.readEpisodeMeta(slug, episodeId);
  if (!meta) {
    return c.notFound();
  }

  return c.json(meta);
});

// POST /sync
app.post("/sync", async (c) => {
  const slug = c.get("podcastSlug");
  const config = c.get("podcastConfig");

  log.info({ slug }, "Starting manual sync");
  const discovery = await discoverEpisodes(slug, config);
  const sync = await syncUnsyncedEpisodes(slug);

  return c.json({
    discovered: discovery.discovered,
    message: "Sync complete",
    skipped: sync.skippedCount,
    synced: sync.synced,
    totalFound: discovery.totalFound,
  });
});

// POST /build
app.post("/build", async (c) => {
  const slug = c.get("podcastSlug");
  const config = c.get("podcastConfig");

  const index = await storage.readEpisodeIndex(slug);
  if (!index) {
    return c.json({ message: "No episodes synced yet. Run /sync first." }, 400);
  }

  const unmerged = index.episodes.filter((e) => !e.merged && !e.skipped);
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

  return c.json({
    built,
    failed,
    message: "Build complete",
    remaining: unmerged.length - built - failed,
  });
});

export { app as podcastRoutes };

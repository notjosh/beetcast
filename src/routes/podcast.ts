import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import pino from "pino";

import type { PodcastConfig } from "../schemas/config.js";

import { getConfigBySlug } from "../config.js";
import { buildEpisodeMp3 } from "../services/audio.js";
import { discoverEpisodes, syncUnsyncedEpisodes } from "../services/bandcamp.js";
import { generateFeed } from "../services/feed.js";
import * as storage from "../services/storage.js";

const log = pino({ name: "routes:podcast" });

type Env = {
  Variables: {
    podcastConfig: PodcastConfig;
    podcastSlug: string;
  };
};

const app = new Hono<Env>();

// Middleware: resolve podcast slug to config
app.use("/*", async (c, next) => {
  const slug = c.req.param("podcast");
  if (!slug) return c.notFound();

  const config = getConfigBySlug(slug);
  if (!config) return c.notFound();

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
      if (entry) return entry.id;
    }
  }
  // Fall back to using the param as a slug/id directly
  const meta = await storage.readEpisodeMeta(podcastSlug, idParam);
  if (meta) return idParam;
  return null;
}

// GET /feed.xml
app.get("/feed.xml", async (c) => {
  const slug = c.get("podcastSlug");
  const config = c.get("podcastConfig");
  const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";

  // Check if we need to refresh
  const index = await storage.readEpisodeIndex(slug);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const needsRefresh = !index || new Date(index.lastUpdated).getTime() < oneHourAgo;

  if (needsRefresh) {
    log.info({ slug }, "Refreshing discography for feed");
    try {
      await discoverEpisodes(slug, config);
      await syncUnsyncedEpisodes(slug);
    } catch (err) {
      log.error({ err, slug }, "Failed to refresh discography");
      // Continue with existing data if available
    }
  }

  const episodes = await storage.getAllEpisodeMetas(slug);
  const xml = await generateFeed(slug, config, episodes, baseUrl);

  return c.body(xml, 200, { "Content-Type": "application/rss+xml; charset=utf-8" });
});

// GET /artwork.jpg — podcast-level artwork
app.get("/artwork.jpg", async (c) => {
  const slug = c.get("podcastSlug");
  const artPath = storage.podcastArtworkPath(slug);

  try {
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

// GET /episode/:id/artwork.jpg — episode artwork
app.get("/episode/:id/artwork.jpg", async (c) => {
  const slug = c.get("podcastSlug");
  const episodeId = await resolveEpisodeId(slug, c.req.param("id"));
  if (!episodeId) return c.notFound();

  const artPath = storage.artworkPath(slug, episodeId);
  try {
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

// GET /episode/:id
app.get("/episode/:id", async (c) => {
  const slug = c.get("podcastSlug");
  const idParam = c.req.param("id");

  // Handle .mp3 suffix
  if (idParam.endsWith(".mp3")) {
    const cleanId = idParam.slice(0, -4);
    const episodeId = await resolveEpisodeId(slug, cleanId);
    if (!episodeId) return c.notFound();

    const config = c.get("podcastConfig");

    // Build if needed
    const exists = await storage.hasMergedMp3(slug, episodeId);
    if (!exists) {
      log.info({ episodeId }, "Building episode MP3 on demand");
      await buildEpisodeMp3(slug, episodeId, config);
    }

    const mp3Path = storage.episodeMp3Path(slug, episodeId);
    const stats = await stat(mp3Path);

    const stream = createReadStream(mp3Path);
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Length": stats.size.toString(),
        "Content-Type": "audio/mpeg",
      },
      status: 200,
    });
  }

  // JSON metadata
  const episodeId = await resolveEpisodeId(slug, idParam);
  if (!episodeId) return c.notFound();

  const meta = await storage.readEpisodeMeta(slug, episodeId);
  if (!meta) return c.notFound();

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

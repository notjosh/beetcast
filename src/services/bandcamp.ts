import bcfetch from "bandcamp-fetch";
import pino from "pino";

import type { PodcastConfig } from "../schemas/config.js";
import type { EpisodeIndexEntry, EpisodeMeta, TrackMeta } from "../schemas/episode.js";

import { downloadToFile } from "../lib/http.js";
import { parseEpisodeTitle } from "../lib/parse-episode-number.js";
import { bandcampLimiter } from "../lib/rate-limiter.js";
import { slugify } from "../lib/slug.js";
import {
  type BandcampAlbum,
  BandcampAlbumSchema,
  BandcampDiscographyItemSchema,
  BandcampRawDataSchema,
} from "../schemas/bandcamp.js";
import * as storage from "./storage.js";

const log = pino({ name: "bandcamp" });

import type { SyncProgress } from "../../shared/schemas/sync-events.js";
export type { SyncProgress } from "../../shared/schemas/sync-events.js";

export interface DiscoveryResult {
  discovered: number;
  totalFound: number;
}

export interface SyncEpisodesResult {
  errored: number;
  skippedCount: number;
  synced: number;
  total: number;
}

interface DiscographyItem {
  imageUrl?: string;
  name: string;
  type: string;
  url: string;
}

/**
 * Discovery: fetch discography from Bandcamp, add new albums to the index.
 * Deduplicates by Bandcamp URL (not by ID) to handle slug scheme changes.
 */
export async function discoverEpisodes(
  podcastSlug: string,
  config: PodcastConfig,
): Promise<DiscoveryResult> {
  log.info({ podcastSlug }, "Fetching discography");

  const discography = await fetchDiscography(config.bandcampUrl);
  const albums = discography.filter((item) => item.type === "album");
  log.info({ count: albums.length, podcastSlug }, "Found albums/tracks");

  const existingIndex = await storage.readEpisodeIndex(podcastSlug);
  const existingUrls = new Set(existingIndex?.episodes.map((e) => e.bandcampUrl) ?? []);

  const newEntries: EpisodeIndexEntry[] = [];
  for (const album of albums) {
    if (!existingUrls.has(album.url)) {
      newEntries.push(discographyItemToIndexEntry(album));
    }
  }

  const allEntries = [...(existingIndex?.episodes ?? []), ...newEntries];
  await storage.writeEpisodeIndex(podcastSlug, {
    episodes: allEntries,
    lastUpdated: new Date().toISOString(),
  });

  // Download podcast-level artwork from band profile
  try {
    const bandInfo = await bandcampLimiter.throttle(() =>
      bcfetch.band.getInfo({ bandUrl: config.bandcampUrl, imageFormat: 10 }),
    );
    if (bandInfo.imageUrl) {
      const artPath = storage.podcastArtworkPath(podcastSlug);
      await downloadToFile(bandInfo.imageUrl, artPath);
      log.info({ podcastSlug }, "Podcast artwork downloaded");
    }
  } catch (err) {
    log.warn({ err, podcastSlug }, "Failed to download podcast artwork");
  }

  log.info({ discovered: newEntries.length, podcastSlug }, "Discovery complete, index saved");

  return {
    discovered: newEntries.length,
    totalFound: albums.length,
  };
}

export async function fetchAlbumDetail(albumUrl: string): Promise<BandcampAlbum> {
  log.info({ albumUrl }, "Fetching album detail");
  const raw = await bcfetch.album.getInfo({ albumImageFormat: 10, albumUrl, includeRawData: true });
  return BandcampAlbumSchema.parse(raw);
}

export async function fetchDiscography(bandcampUrl: string): Promise<DiscographyItem[]> {
  log.info({ bandcampUrl }, "Fetching discography");
  const rawItems = await bcfetch.band.getDiscography({ bandUrl: bandcampUrl });
  const items: DiscographyItem[] = [];

  for (const raw of rawItems) {
    const parsed = BandcampDiscographyItemSchema.safeParse(raw);
    if (parsed.success && parsed.data.name && parsed.data.url && parsed.data.type) {
      items.push({
        imageUrl: parsed.data.imageUrl ?? undefined,
        name: parsed.data.name,
        type: parsed.data.type,
        url: fixBandcampUrl(parsed.data.url, bandcampUrl),
      });
    }
  }
  log.info({ count: items.length, sampleUrl: items[0]?.url }, "Discography fetched");
  return items;
}

export async function syncEpisode(
  podcastSlug: string,
  albumUrl: string,
  album: BandcampAlbum,
): Promise<EpisodeMeta> {
  const meta = albumToEpisodeMeta(album, albumUrl);

  await storage.ensureDirectories(podcastSlug, meta.id);

  if (album.imageUrl) {
    const artPath = storage.artworkPath(podcastSlug, meta.id);
    try {
      await downloadToFile(album.imageUrl, artPath);
    } catch (err) {
      log.warn({ episodeId: meta.id, err }, "Failed to download artwork");
    }
  }

  await storage.writeEpisodeMeta(podcastSlug, meta.id, meta);
  return meta;
}

/**
 * Sync (or re-sync) a single episode by its index entry.
 * Fetches fresh album detail from Bandcamp and downloads tracks/artwork.
 * Updates both the episode meta and the index entry.
 */
export async function syncSingleEpisode(
  podcastSlug: string,
  episodeId: string,
): Promise<EpisodeMeta> {
  const index = await storage.readEpisodeIndex(podcastSlug);
  const entry = index?.episodes.find((e) => e.id === episodeId);
  if (!entry) {
    throw new Error(`Episode ${episodeId} not found in index`);
  }

  const detail = await fetchAlbumDetail(entry.bandcampUrl);
  const meta = albumToEpisodeMeta(detail, entry.bandcampUrl);

  // Preserve manually assigned episode numbers
  if (entry.episodeNumberManual) {
    meta.episodeNumber = entry.episodeNumber;
    meta.episodePart = entry.episodePart;
    meta.episodeNumberManual = true;
  }

  // Preserve manually set skip status
  if (entry.skippedManual) {
    meta.skipped = entry.skipped;
    meta.skippedManual = true;
  }

  if (meta.skipped) {
    await storage.ensureDirectories(podcastSlug, meta.id);
    await storage.writeEpisodeMeta(podcastSlug, meta.id, meta);
  } else {
    await syncEpisode(podcastSlug, entry.bandcampUrl, detail);
  }

  // Update the index entry
  if (index) {
    const indexEntry = index.episodes.find((e) => e.id === entry.id);
    if (indexEntry) {
      indexEntry.synced = true;
      indexEntry.skipped = meta.skipped;
      indexEntry.releaseDate = meta.releaseDate;
      index.lastUpdated = new Date().toISOString();
      await storage.writeEpisodeIndex(podcastSlug, index);
    }
  }

  return meta;
}

/**
 * Sync all unsynced episodes: fetch album detail, download tracks/artwork.
 * Saves progress after each episode so it's resumable.
 */
export async function syncUnsyncedEpisodes(
  podcastSlug: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncEpisodesResult> {
  const currentIndex = await storage.readEpisodeIndex(podcastSlug);
  const unsyncedEntries = (currentIndex?.episodes ?? []).filter((e) => !e.synced);
  const totalToSync = unsyncedEntries.length;

  log.info({ podcastSlug, total: totalToSync }, "Starting episode sync");

  let syncedCount = 0;
  let skippedCount = 0;
  let erroredCount = 0;

  for (const [i, entry] of unsyncedEntries.entries()) {
    log.info(
      { bandcampUrl: entry.bandcampUrl, episodeId: entry.id, title: entry.title },
      "Syncing episode detail",
    );

    try {
      const detail = await bandcampLimiter.throttle(() => fetchAlbumDetail(entry.bandcampUrl));
      const meta = albumToEpisodeMeta(detail, entry.bandcampUrl);

      // Preserve manually assigned episode numbers
      if (entry.episodeNumberManual) {
        meta.episodeNumber = entry.episodeNumber;
        meta.episodePart = entry.episodePart;
        meta.episodeNumberManual = true;
      }

      // Preserve manually set skip status
      if (entry.skippedManual) {
        meta.skipped = entry.skipped;
        meta.skippedManual = true;
      }

      if (meta.skipped) {
        await storage.ensureDirectories(podcastSlug, meta.id);
        await storage.writeEpisodeMeta(podcastSlug, meta.id, meta);
        skippedCount++;
      } else {
        await bandcampLimiter.throttle(() => syncEpisode(podcastSlug, entry.bandcampUrl, detail));
        syncedCount++;
      }

      // Update index entry and save after each episode
      const idx = await storage.readEpisodeIndex(podcastSlug);
      if (idx) {
        const indexEntry = idx.episodes.find((e) => e.id === entry.id);
        if (indexEntry) {
          indexEntry.synced = true;
          indexEntry.skipped = meta.skipped;
          indexEntry.releaseDate = meta.releaseDate;
          idx.lastUpdated = new Date().toISOString();
          await storage.writeEpisodeIndex(podcastSlug, idx);
        }
      }

      onProgress?.({
        current: i + 1,
        episodeTitle: entry.title,
        phase: "syncing",
        skipped: meta.skipped,
        total: totalToSync,
      });
    } catch (err) {
      erroredCount++;
      log.warn(
        { episodeId: entry.id, err, title: entry.title },
        "Failed to sync episode, skipping",
      );
      onProgress?.({
        current: i + 1,
        episodeTitle: entry.title,
        errored: true,
        phase: "syncing",
        total: totalToSync,
      });
    }
  }

  onProgress?.({
    current: totalToSync,
    phase: "done",
    total: totalToSync,
  });

  return {
    errored: erroredCount,
    skippedCount,
    synced: syncedCount,
    total: totalToSync,
  };
}

function albumToEpisodeMeta(album: BandcampAlbum, albumUrl: string): EpisodeMeta {
  const albumName = album.name ?? "Untitled";
  const { cleanTitle, episodeNumber, episodePart } = parseEpisodeTitle(albumName);
  const id = extractBandcampSlug(albumUrl);

  const tracks: TrackMeta[] = (album.tracks ?? [])
    .filter((t) => t.name)
    .map((t, i) => ({
      durationMs: (t.duration ?? 0) * 1000,
      filename: `${String(t.position ?? i + 1).padStart(2, "0")}-${slugify(t.name ?? `track-${i + 1}`)}.mp3`,
      position: t.position ?? i + 1,
      slug: slugify(t.name ?? `track-${i + 1}`),
      title: t.name ?? `Track ${i + 1}`,
    }));

  let minimumPrice = 0;
  let priceCurrency: string | undefined;

  // Extract price from the ld+json structured data (albumRelease[0].offers).
  // bandcamp-fetch already JSON.parse()s the raw data despite its types claiming string.
  if (album.raw) {
    const rawParsed = BandcampRawDataSchema.safeParse(album.raw);
    if (rawParsed.success) {
      const offer = rawParsed.data.basic.albumRelease?.[0]?.offers;
      if (offer) {
        minimumPrice = offer.price;
        priceCurrency = offer.priceCurrency;
      }
    }
  }

  return {
    artworkFilename: album.imageUrl ? "artwork.jpg" : undefined,
    bandcampUrl: albumUrl,
    cleanTitle,
    description: album.description,
    episodeNumber,
    episodeNumberManual: false,
    episodePart,
    id,
    merged: false,
    minimumPrice,
    priceCurrency,
    releaseDate: album.releaseDate,
    skipped: minimumPrice > 0,
    skippedManual: false,
    title: albumName,
    tracks,
  };
}

function discographyItemToIndexEntry(item: DiscographyItem): EpisodeIndexEntry {
  const { episodeNumber, episodePart } = parseEpisodeTitle(item.name);
  const id = extractBandcampSlug(item.url);
  return {
    bandcampUrl: item.url,
    episodeNumber,
    episodeNumberManual: false,
    episodePart,
    id,
    merged: false,
    skipped: false,
    skippedManual: false,
    synced: false,
    title: item.name,
  };
}

/**
 * Extract the slug from a Bandcamp URL, e.g.
 * "https://omsbpodcast.bandcamp.com/album/podcast-177-sophie-woodhouse"
 * → "podcast-177-sophie-woodhouse"
 */
function extractBandcampSlug(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      return lastSegment;
    }
  } catch {
    // malformed URL — fall through
  }
  return slugify(url);
}

/**
 * bandcamp-fetch has a bug where items from the `data-client-items` HTML attribute
 * get resolved against `https://bandcamp.com` instead of the band's subdomain.
 * This fixes those URLs by replacing the hostname with the correct one.
 */
function fixBandcampUrl(itemUrl: string, bandcampUrl: string): string {
  try {
    const itemParsed = new URL(itemUrl);
    const bandParsed = new URL(bandcampUrl);
    if (itemParsed.hostname === "bandcamp.com" && bandParsed.hostname !== "bandcamp.com") {
      itemParsed.hostname = bandParsed.hostname;
      return itemParsed.toString();
    }
  } catch {
    // malformed URL — return as-is
  }
  return itemUrl;
}

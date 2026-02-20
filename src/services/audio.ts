import NodeID3 from "node-id3";
import { spawn } from "node:child_process";
import { readFile, rename, stat, unlink } from "node:fs/promises";
import pino from "pino";

import type { BuildProgress } from "../../shared/schemas/build-events.js";
import type { PodcastConfig } from "../schemas/config.js";
import type { EpisodeMeta, TrackMeta } from "../schemas/episode.js";

import { downloadToFileWithProgress } from "../lib/http.js";
import { bandcampLimiter } from "../lib/rate-limiter.js";
import { fetchAlbumDetail } from "./bandcamp.js";
import * as storage from "./storage.js";

const log = pino({ name: "audio" });

type ChapterTag = NonNullable<NodeID3.Tags["chapter"]>[number];

type TocTag = NonNullable<NodeID3.Tags["tableOfContents"]>[number];

export async function buildEpisodeMp3(
  podcastSlug: string,
  episodeId: string,
  config: PodcastConfig,
  onProgress?: (progress: BuildProgress) => void,
): Promise<void> {
  // Download missing tracks (ignore "all downloaded" error)
  try {
    await downloadEpisodeTracks(podcastSlug, episodeId, onProgress);
  } catch (err) {
    if (err instanceof Error && err.message === "All tracks already downloaded") {
      // fine — proceed to merge
    } else {
      throw err;
    }
  }

  await mergeEpisodeMp3(podcastSlug, episodeId, config, onProgress);
}
export async function downloadEpisodeTracks(
  podcastSlug: string,
  episodeId: string,
  onProgress?: (progress: BuildProgress) => void,
): Promise<void> {
  const meta = await storage.readEpisodeMeta(podcastSlug, episodeId);
  if (!meta) {
    throw new Error(`Episode meta not found: ${episodeId}`);
  }

  if (meta.skipped) {
    throw new Error(`Episode is skipped (non-free): ${episodeId}`);
  }

  // Check which tracks need downloading
  const missingTracks: typeof meta.tracks = [];
  for (const track of meta.tracks) {
    const exists = await storage.hasTrackFile(podcastSlug, episodeId, track.filename);
    if (!exists) missingTracks.push(track);
  }

  if (missingTracks.length === 0) {
    throw new Error("All tracks already downloaded");
  }

  log.info({ episodeId, missing: missingTracks.length }, "Downloading missing tracks");
  const album = await bandcampLimiter.throttle(() => fetchAlbumDetail(meta.bandcampUrl));
  const trackTotal = missingTracks.length;
  let trackNumber = 0;

  for (const track of missingTracks) {
    trackNumber++;
    const albumTrack = (album.tracks ?? []).find((t) => t.position === track.position);
    const streamUrl = albumTrack?.streamUrl ?? albumTrack?.streamUrlHQ;
    if (!streamUrl) {
      throw new Error(`No stream URL for track ${track.title}`);
    }

    const destPath = storage.trackPath(podcastSlug, episodeId, track.filename);
    const currentTrackNumber = trackNumber;
    await bandcampLimiter.throttle(() =>
      downloadToFileWithProgress(streamUrl, destPath, (transferred, total) => {
        onProgress?.({
          bytesDownloaded: transferred,
          bytesTotal: total,
          phase: "downloading",
          trackNumber: currentTrackNumber,
          trackTotal,
        });
      }),
    );
  }

  onProgress?.({ phase: "done" });
  log.info({ episodeId }, "Track downloads complete");
}

export async function getEpisodeFileSize(
  podcastSlug: string,
  episodeId: string,
): Promise<null | number> {
  try {
    const mp3Path = storage.episodeMp3Path(podcastSlug, episodeId);
    const stats = await stat(mp3Path);
    return stats.size;
  } catch {
    return null;
  }
}

export async function mergeEpisodeMp3(
  podcastSlug: string,
  episodeId: string,
  config: PodcastConfig,
  onProgress?: (progress: BuildProgress) => void,
): Promise<void> {
  const meta = await storage.readEpisodeMeta(podcastSlug, episodeId);
  if (!meta) {
    throw new Error(`Episode meta not found: ${episodeId}`);
  }

  if (meta.skipped) {
    throw new Error(`Episode is skipped (non-free): ${episodeId}`);
  }

  // Verify all track files exist
  for (const track of meta.tracks) {
    const exists = await storage.hasTrackFile(podcastSlug, episodeId, track.filename);
    if (!exists) {
      throw new Error(`Track file missing: ${track.filename} — download tracks first`);
    }
  }

  log.info({ episodeId, title: meta.title }, "Merging episode MP3");

  const sortedTracks = [...meta.tracks].sort((a, b) => a.position - b.position);
  const trackPaths = sortedTracks.map((t) => storage.trackPath(podcastSlug, episodeId, t.filename));
  const totalDurationSec = sortedTracks.reduce((sum, t) => sum + t.durationMs, 0) / 1000;

  const outputPath = storage.episodeMp3Path(podcastSlug, episodeId);
  const tmpPath = outputPath.replace(/\.mp3$/, ".tmp.mp3");

  try {
    onProgress?.({ percent: 0, phase: "merging" });
    await mergeTracksToEpisode(
      trackPaths,
      tmpPath,
      { bitrate: config.bitrate, channels: config.channels },
      (percent) => onProgress?.({ percent, phase: "merging" }),
      totalDurationSec,
    );

    onProgress?.({ phase: "chapters" });
    await writeId3Tags(tmpPath, meta, config, podcastSlug);

    await rename(tmpPath, outputPath);

    const updatedMeta = { ...meta, merged: true };
    await storage.writeEpisodeMeta(podcastSlug, episodeId, updatedMeta);

    const index = await storage.readEpisodeIndex(podcastSlug);
    if (index) {
      const entry = index.episodes.find((e) => e.id === episodeId);
      if (entry) {
        entry.merged = true;
        await storage.writeEpisodeIndex(podcastSlug, index);
      }
    }

    onProgress?.({ phase: "done" });
    log.info({ episodeId }, "Episode MP3 merged successfully");
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function buildChapterTags(tracks: TrackMeta[]): {
  chapter: ChapterTag[];
  tableOfContents: TocTag[];
} {
  let currentMs = 0;
  const chapters: ChapterTag[] = [];
  const elementIds: string[] = [];

  for (const track of tracks) {
    const elementID = `ch${String(track.position).padStart(2, "0")}`;
    elementIds.push(elementID);
    chapters.push({
      elementID,
      endTimeMs: currentMs + track.durationMs,
      startTimeMs: currentMs,
      tags: { title: track.title },
    });
    currentMs += track.durationMs;
  }

  return {
    chapter: chapters,
    tableOfContents: [
      {
        elementID: "toc1",
        elements: elementIds,
        isOrdered: true,
      },
    ],
  };
}

async function mergeTracksToEpisode(
  trackPaths: string[],
  outputPath: string,
  options: { bitrate: number; channels: number },
  onProgress?: (percent: number) => void,
  totalDurationSec?: number,
): Promise<void> {
  const args: string[] = ["-progress", "pipe:2"];
  for (const p of trackPaths) {
    args.push("-i", p);
  }

  const filterInputs = trackPaths.map((_, i) => `[${i}:a]`).join("");
  const filterComplex = `${filterInputs}concat=n=${trackPaths.length}:v=0:a=1[out]`;

  args.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    "-b:a",
    `${options.bitrate}k`,
    "-ac",
    String(options.channels),
    "-acodec",
    "libmp3lame",
    "-y",
    outputPath,
  );

  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (onProgress && totalDurationSec && totalDurationSec > 0) {
        const timeSec = parseFfmpegTime(chunk.toString());
        if (timeSec !== null) {
          const pct = Math.min(100, Math.round((timeSec / totalDurationSec) * 100));
          onProgress(pct);
        }
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", reject);
  });
}

function parseFfmpegTime(line: string): null | number {
  const match = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return null;
  const [, h, m, s, cs] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(cs) / 100;
}

async function writeId3Tags(
  mp3Path: string,
  meta: EpisodeMeta,
  config: PodcastConfig,
  podcastSlug: string,
): Promise<void> {
  const chapterTags = buildChapterTags(meta.tracks);

  let image: NodeID3.Tags["image"] = undefined;
  try {
    const artPath = storage.artworkPath(podcastSlug, meta.id);
    const imageBuffer = await readFile(artPath);
    image = {
      description: "Cover",
      imageBuffer,
      mime: "image/jpeg",
      type: { id: 3, name: "front cover" },
    };
  } catch {
    // no artwork available
  }

  const episodeLabel =
    meta.episodeNumber !== undefined
      ? `#${meta.episodeNumber}${meta.episodePart ?? ""}`
      : undefined;

  const tags: NodeID3.Tags = {
    ...chapterTags,
    album: config.title,
    artist: config.author,
    comment: meta.description ? { language: "eng", text: meta.description } : undefined,
    commercialUrl: [meta.bandcampUrl],
    date: meta.releaseDate,
    image,
    title: meta.cleanTitle,
    trackNumber: episodeLabel,
  };

  const result = NodeID3.update(tags, mp3Path);
  if (result instanceof Error) {
    throw result;
  }
}

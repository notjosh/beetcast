import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type EpisodeIndex,
  EpisodeIndexSchema,
  type EpisodeMeta,
  EpisodeMetaSchema,
} from "../schemas/episode.js";

const DATA_DIR = resolve(process.cwd(), "data");

export function artworkPath(podcastSlug: string, episodeId: string): string {
  return resolve(episodeDir(podcastSlug, episodeId), "artwork.jpg");
}

export function dataDir(): string {
  return DATA_DIR;
}

export async function ensureDirectories(podcastSlug: string, episodeId: string): Promise<void> {
  await mkdir(tracksDir(podcastSlug, episodeId), { recursive: true });
}

export function episodeDir(podcastSlug: string, episodeId: string): string {
  return resolve(DATA_DIR, podcastSlug, "episodes", episodeId);
}

export function episodeMp3Path(podcastSlug: string, episodeId: string): string {
  return resolve(episodeDir(podcastSlug, episodeId), "episode.mp3");
}

export async function getAllEpisodeMetas(podcastSlug: string): Promise<EpisodeMeta[]> {
  const index = await readEpisodeIndex(podcastSlug);
  if (!index) return [];

  const metas: EpisodeMeta[] = [];
  for (const entry of index.episodes) {
    const meta = await readEpisodeMeta(podcastSlug, entry.id);
    if (meta) metas.push(meta);
  }
  return metas;
}

export async function getTrackFileSize(
  podcastSlug: string,
  episodeId: string,
  filename: string,
): Promise<null | number> {
  try {
    const stats = await stat(trackPath(podcastSlug, episodeId, filename));
    return stats.size;
  } catch {
    return null;
  }
}

export async function hasMergedMp3(podcastSlug: string, episodeId: string): Promise<boolean> {
  try {
    await access(episodeMp3Path(podcastSlug, episodeId));
    return true;
  } catch {
    return false;
  }
}

export async function hasTrackFile(
  podcastSlug: string,
  episodeId: string,
  filename: string,
): Promise<boolean> {
  try {
    await access(trackPath(podcastSlug, episodeId, filename));
    return true;
  } catch {
    return false;
  }
}

export function podcastArtworkPath(podcastSlug: string): string {
  return resolve(podcastDir(podcastSlug), "artwork.jpg");
}

export function podcastDir(podcastSlug: string): string {
  return resolve(DATA_DIR, podcastSlug);
}

export async function readEpisodeIndex(podcastSlug: string): Promise<EpisodeIndex | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(episodeIndexPath(podcastSlug), "utf-8"));
    return EpisodeIndexSchema.parse(raw);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

export async function readEpisodeMeta(
  podcastSlug: string,
  episodeId: string,
): Promise<EpisodeMeta | null> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(episodeMetaPath(podcastSlug, episodeId), "utf-8"),
    );
    return EpisodeMetaSchema.parse(raw);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

export function trackPath(podcastSlug: string, episodeId: string, filename: string): string {
  return resolve(tracksDir(podcastSlug, episodeId), filename);
}

export function tracksDir(podcastSlug: string, episodeId: string): string {
  return resolve(DATA_DIR, podcastSlug, "episodes", episodeId, "tracks");
}

export async function writeEpisodeIndex(podcastSlug: string, index: EpisodeIndex): Promise<void> {
  await mkdir(podcastDir(podcastSlug), { recursive: true });
  await atomicWriteJson(episodeIndexPath(podcastSlug), index);
}

export async function writeEpisodeMeta(
  podcastSlug: string,
  episodeId: string,
  meta: EpisodeMeta,
): Promise<void> {
  await ensureDirectories(podcastSlug, episodeId);
  await atomicWriteJson(episodeMetaPath(podcastSlug, episodeId), meta);
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await rename(tmpPath, filePath);
}

function episodeIndexPath(podcastSlug: string): string {
  return resolve(podcastDir(podcastSlug), "episodes.json");
}

function episodeMetaPath(podcastSlug: string, episodeId: string): string {
  return resolve(episodeDir(podcastSlug, episodeId), "meta.json");
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

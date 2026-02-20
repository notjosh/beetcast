import { z } from "zod/v4";

export const TrackMetaSchema = z.object({
  durationMs: z.number(),
  filename: z.string(),
  position: z.number().int(),
  slug: z.string(),
  title: z.string(),
});

export type TrackMeta = z.infer<typeof TrackMetaSchema>;

export const EpisodeMetaSchema = z.object({
  artworkFilename: z.string().optional(),
  bandcampUrl: z.string(),
  cleanTitle: z.string(),
  credits: z.string().optional(),
  description: z.string().optional(),
  episodeNumber: z.number().int().optional(),
  episodeNumberManual: z.boolean().default(false),
  episodePart: z.string().optional(),
  id: z.string(),
  merged: z.boolean().default(false),
  minimumPrice: z.number().default(0),
  priceCurrency: z.string().optional(),
  releaseDate: z.string().optional(),
  skipped: z.boolean().default(false),
  skippedManual: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  title: z.string(),
  tracks: z.array(TrackMetaSchema),
});

export type EpisodeMeta = z.infer<typeof EpisodeMetaSchema>;

export const EpisodeIndexEntrySchema = z.object({
  bandcampUrl: z.string(),
  episodeNumber: z.number().int().optional(),
  episodeNumberManual: z.boolean().default(false),
  episodePart: z.string().optional(),
  id: z.string(),
  merged: z.boolean().default(false),
  releaseDate: z.string().optional(),
  skipped: z.boolean().default(false),
  skippedManual: z.boolean().default(false),
  synced: z.boolean().default(false),
  title: z.string(),
});

export type EpisodeIndexEntry = z.infer<typeof EpisodeIndexEntrySchema>;

export const EpisodeIndexSchema = z.object({
  episodes: z.array(EpisodeIndexEntrySchema),
  lastUpdated: z.string(),
});

export type EpisodeIndex = z.infer<typeof EpisodeIndexSchema>;

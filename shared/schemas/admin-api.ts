import { z } from "zod/v4";

// --- Dashboard ---

export const PodcastSummarySchema = z.object({
  author: z.string(),
  bandcampUrl: z.string(),
  cachedCount: z.number(),
  episodeCount: z.number(),
  lastUpdated: z.string().nullable(),
  skippedCount: z.number(),
  slug: z.string(),
  syncedCount: z.number(),
  title: z.string(),
});

export const PodcastsResponseSchema = z.object({
  podcasts: z.array(PodcastSummarySchema),
});

export type PodcastsResponse = z.infer<typeof PodcastsResponseSchema>;

// --- Episode list ---

export const EpisodeEntrySchema = z.object({
  episodeNumber: z.number().optional(),
  episodePart: z.string().optional(),
  fileSize: z.number().nullable(),
  id: z.string(),
  merged: z.boolean(),
  minimumPrice: z.number().nullable(),
  priceCurrency: z.string().nullable(),
  releaseDate: z.string().optional(),
  skipped: z.boolean(),
  synced: z.boolean(),
  title: z.string(),
  trackCount: z.number(),
});

export const PodcastInfoSchema = z.object({
  author: z.string(),
  lastUpdated: z.string(),
  slug: z.string(),
  title: z.string(),
});

export const PodcastDetailResponseSchema = z.object({
  episodes: z.array(EpisodeEntrySchema),
  podcast: PodcastInfoSchema,
});

export type PodcastDetailResponse = z.infer<typeof PodcastDetailResponseSchema>;

// --- Episode detail ---

export const TrackInfoSchema = z.object({
  durationMs: z.number(),
  filename: z.string(),
  fileSize: z.number().nullable(),
  position: z.number(),
  slug: z.string(),
  title: z.string(),
});

export const EpisodeDetailSchema = z.object({
  artworkExists: z.boolean(),
  artworkFilename: z.string().optional(),
  artworkUrl: z.string().nullable(),
  bandcampUrl: z.string(),
  cleanTitle: z.string(),
  credits: z.string().optional(),
  description: z.string().optional(),
  episodeNumber: z.number().optional(),
  episodeNumberManual: z.boolean(),
  episodePart: z.string().optional(),
  fileSize: z.number().nullable(),
  id: z.string(),
  merged: z.boolean(),
  minimumPrice: z.number().nullable(),
  priceCurrency: z.string().nullable(),
  releaseDate: z.string().optional(),
  skipped: z.boolean(),
  tags: z.array(z.string()).optional(),
  title: z.string(),
  tracks: z.array(TrackInfoSchema),
});

export type EpisodeDetail = z.infer<typeof EpisodeDetailSchema>;

// --- Mutations ---

export const DiscoverResponseSchema = z.object({
  discovered: z.number(),
  message: z.string(),
  totalFound: z.number(),
});

export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

export const EpisodeSyncResponseSchema = z.object({
  message: z.string(),
});

export type EpisodeSyncResponse = z.infer<typeof EpisodeSyncResponseSchema>;

export const EpisodePatchRequestSchema = z.object({
  episodeNumber: z.number().int().optional(),
  episodePart: z.string().optional(),
  skipped: z.boolean().optional(),
});

export type EpisodePatchRequest = z.infer<typeof EpisodePatchRequestSchema>;

export const EpisodePatchResponseSchema = z.object({
  message: z.string(),
});

export type EpisodePatchResponse = z.infer<typeof EpisodePatchResponseSchema>;

export const BuildResponseSchema = z.object({
  built: z.number(),
  failed: z.number(),
  message: z.string(),
});

export type BuildResponse = z.infer<typeof BuildResponseSchema>;

import { z } from "zod/v4";

import { DURATION_PATTERN } from "../lib/duration.js";

export const PodcastConfigSchema = z.object({
  author: z.string(),
  bandcampUrl: z.url(),
  bitrate: z.number().int().positive().default(96),
  category: z.string().optional(),
  channels: z.number().int().min(1).max(2).default(1),
  description: z.string().optional(),
  explicit: z.boolean().default(false),
  language: z.string().default("en"),
  refreshInterval: z
    .string()
    .regex(DURATION_PATTERN, 'Expected a duration like "30m", "12h", or "1d"')
    .default("24h"),
  subcategory: z.string().optional(),
  title: z.string(),
});

export type PodcastConfig = z.infer<typeof PodcastConfigSchema>;

export const AppConfigSchema = z.record(z.string(), PodcastConfigSchema);

export type AppConfig = z.infer<typeof AppConfigSchema>;

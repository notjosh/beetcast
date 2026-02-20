import { z } from "zod/v4";

export const BuildProgressSchema = z.object({
  bytesDownloaded: z.number().optional(),
  bytesTotal: z.number().optional(),
  percent: z.number().optional(),
  phase: z.enum(["downloading", "merging", "chapters", "done"]),
  trackNumber: z.number().optional(),
  trackTotal: z.number().optional(),
});

export type BuildProgress = z.infer<typeof BuildProgressSchema>;

export const BuildResultSchema = z.object({
  message: z.string(),
});

export type BuildResult = z.infer<typeof BuildResultSchema>;

export const BuildErrorSchema = z.object({
  message: z.string(),
});

export type BuildError = z.infer<typeof BuildErrorSchema>;

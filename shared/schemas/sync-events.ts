import { z } from "zod/v4";

export const SyncProgressSchema = z.object({
  current: z.number(),
  /** Number of new episodes discovered (discovery phase) */
  discovered: z.number().optional(),
  episodeTitle: z.string().optional(),
  /** Episode failed to sync */
  errored: z.boolean().optional(),
  /** Episode was already fully synced from a previous run */
  existing: z.boolean().optional(),
  phase: z.enum(["discovery", "syncing", "done"]),
  /** Episode is being skipped (non-free) */
  skipped: z.boolean().optional(),
  total: z.number(),
});

export type SyncProgress = z.infer<typeof SyncProgressSchema>;

export const SyncResultSchema = z.object({
  discovered: z.number(),
  errored: z.number(),
  message: z.string(),
  skipped: z.number(),
  synced: z.number(),
  totalFound: z.number(),
});

export type SyncResult = z.infer<typeof SyncResultSchema>;

export const SyncErrorSchema = z.object({
  message: z.string(),
});

export type SyncError = z.infer<typeof SyncErrorSchema>;

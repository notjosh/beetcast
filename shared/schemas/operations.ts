import { z } from "zod/v4";

export const TaskTypeSchema = z.enum(["discover", "sync", "sync-single", "download", "merge"]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskContextSchema = z.object({
  episodeId: z.string().optional(),
  episodeTitle: z.string().optional(),
  podcastSlug: z.string(),
  podcastTitle: z.string().optional(),
});
export type TaskContext = z.infer<typeof TaskContextSchema>;

export const TaskSnapshotSchema = z.object({
  completedAt: z.string().optional(),
  context: TaskContextSchema,
  createdAt: z.string(),
  error: z.string().nullable(),
  id: z.string(),
  progress: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string().optional(),
  status: TaskStatusSchema,
  type: TaskTypeSchema,
});
// SSE event names
export type TaskEventType =
  | "task-completed"
  | "task-failed"
  | "task-progress"
  | "task-queued"
  | "task-started";

export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;

// API responses
export const SubmitTaskResponseSchema = z.object({
  status: TaskStatusSchema,
  taskId: z.string(),
});
export type SubmitTaskResponse = z.infer<typeof SubmitTaskResponseSchema>;

export const OperationsListResponseSchema = z.object({
  operations: z.array(TaskSnapshotSchema),
});
export type OperationsListResponse = z.infer<typeof OperationsListResponseSchema>;

import type { TaskSnapshot, TaskType } from "@shared/schemas/operations";

import { useCallback, useMemo } from "react";

import { useOperations } from "./operations-context";

interface OperationHandle {
  /** Error message if the operation failed */
  error: null | string;
  /** Whether the operation is running or queued */
  isActive: boolean;
  /** Whether the operation just completed */
  isCompleted: boolean;
  /** Whether the operation just failed */
  isFailed: boolean;
  /** Whether the operation is currently queued */
  isQueued: boolean;
  /** Whether the operation is currently running */
  isRunning: boolean;
  /** The raw progress data (parse with BuildProgressSchema or SyncProgressSchema based on type) */
  progress: null | Record<string, unknown>;
  /** Submit this operation by POSTing to the given URL */
  submit: (url: string) => Promise<string>;
  /** The task snapshot, if one exists for this operation */
  task: TaskSnapshot | undefined;
}

/**
 * Convenience hook for interacting with a specific operation type for a podcast/episode.
 *
 * Usage:
 *   const download = useOperation("download", "my-podcast", "episode-123");
 *   download.isRunning // boolean
 *   download.submit("/api/admin/podcasts/my-podcast/episodes/episode-123/download")
 */
export function useOperation(
  type: TaskType,
  podcastSlug: string,
  episodeId?: string,
): OperationHandle {
  const { submitTask, tasks } = useOperations();

  const task = useMemo(() => {
    return Array.from(tasks.values()).find(
      (t) =>
        t.type === type &&
        t.context.podcastSlug === podcastSlug &&
        (episodeId === undefined || t.context.episodeId === episodeId),
    );
  }, [tasks, type, podcastSlug, episodeId]);

  const submit = useCallback((url: string) => submitTask(url), [submitTask]);

  return {
    error: task?.error ?? null,
    isActive: task?.status === "running" || task?.status === "queued",
    isCompleted: task?.status === "completed",
    isFailed: task?.status === "failed",
    isQueued: task?.status === "queued",
    isRunning: task?.status === "running",
    progress: task?.progress ?? null,
    submit,
    task,
  };
}

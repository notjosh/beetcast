import {
  SubmitTaskResponseSchema,
  type TaskSnapshot,
  TaskSnapshotSchema,
  type TaskType,
} from "@shared/schemas/operations";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod/v4";

interface OperationsContextValue {
  /** Get all tasks for a specific episode */
  getTasksForEpisode: (podcastSlug: string, episodeId: string) => TaskSnapshot[];
  /** Check if a task of a given type is running or queued */
  hasActiveTask: (type: TaskType, podcastSlug: string, episodeId?: string) => boolean;
  /** Whether the SSE connection is active */
  isConnected: boolean;
  /** POST to an endpoint to submit a task, returns taskId */
  submitTask: (url: string) => Promise<string>;
  /** All active tasks */
  tasks: Map<string, TaskSnapshot>;
}

const OperationsContext = createContext<null | OperationsContextValue>(null);

/** Time before completed/failed tasks are removed from state */
const FADE_DELAY_MS = 8_000;

export function OperationsProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Map<string, TaskSnapshot>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const fadeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const eventSource = new EventSource("/api/admin/operations/stream");

    eventSource.onopen = () => setIsConnected(true);
    eventSource.onerror = () => setIsConnected(false);

    const handleEvent = (e: MessageEvent) => {
      const snapshot = TaskSnapshotSchema.parse(JSON.parse(String(e.data)));
      setTasks((prev) => {
        const next = new Map(prev);
        next.set(snapshot.id, snapshot);
        return next;
      });

      // Schedule removal for completed/failed tasks
      if (snapshot.status === "completed" || snapshot.status === "failed") {
        // Clear any existing timer
        const existing = fadeTimers.current.get(snapshot.id);
        if (existing) {
          clearTimeout(existing);
        }

        const timer = setTimeout(() => {
          setTasks((prev) => {
            const next = new Map(prev);
            next.delete(snapshot.id);
            return next;
          });
          fadeTimers.current.delete(snapshot.id);
        }, FADE_DELAY_MS);

        fadeTimers.current.set(snapshot.id, timer);
      }
    };

    eventSource.addEventListener("task-queued", handleEvent);
    eventSource.addEventListener("task-started", handleEvent);
    eventSource.addEventListener("task-progress", handleEvent);
    eventSource.addEventListener("task-completed", handleEvent);
    eventSource.addEventListener("task-failed", handleEvent);

    return () => {
      eventSource.close();
      setIsConnected(false);
      for (const timer of fadeTimers.current.values()) {
        clearTimeout(timer);
      }
      fadeTimers.current.clear();
    };
  }, []);

  const getTasksForEpisode = useCallback(
    (podcastSlug: string, episodeId: string) => {
      return Array.from(tasks.values()).filter(
        (t) => t.context.podcastSlug === podcastSlug && t.context.episodeId === episodeId,
      );
    },
    [tasks],
  );

  const hasActiveTask = useCallback(
    (type: TaskType, podcastSlug: string, episodeId?: string) => {
      return Array.from(tasks.values()).some(
        (t) =>
          t.type === type &&
          t.context.podcastSlug === podcastSlug &&
          (episodeId === undefined || t.context.episodeId === episodeId) &&
          (t.status === "queued" || t.status === "running"),
      );
    },
    [tasks],
  );

  const submitTask = useCallback(async (url: string): Promise<string> => {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const parsed = z.object({ message: z.string() }).safeParse(body);
      const msg = parsed.success ? parsed.data.message : `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    const data = SubmitTaskResponseSchema.parse(await res.json());
    return data.taskId;
  }, []);

  return (
    <OperationsContext.Provider
      value={{ getTasksForEpisode, hasActiveTask, isConnected, submitTask, tasks }}
    >
      {children}
    </OperationsContext.Provider>
  );
}

export function useOperations(): OperationsContextValue {
  const ctx = useContext(OperationsContext);
  if (!ctx) {
    throw new Error("useOperations must be used within OperationsProvider");
  }
  return ctx;
}

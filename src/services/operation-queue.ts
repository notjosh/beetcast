import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import pino from "pino";

import type {
  TaskContext,
  TaskEventType,
  TaskSnapshot,
  TaskStatus,
  TaskType,
} from "../../shared/schemas/operations.js";

const log = pino({ name: "operation-queue" });

/** How many tasks of each type may run concurrently */
const CONCURRENCY_LIMITS: Record<TaskType, number> = {
  discover: 1,
  download: 3,
  merge: 1,
  sync: 1,
  "sync-single": 2,
};

/** Seconds after completion before a task is removed from the map */
const CLEANUP_DELAY_MS = 60_000;

export type ExecuteFn = (onProgress: (progress: Record<string, unknown>) => void) => Promise<void>;

interface InternalTask {
  completedAt?: string;
  context: TaskContext;
  createdAt: string;
  error: null | string;
  executeFn: ExecuteFn;
  id: string;
  progress: null | Record<string, unknown>;
  startedAt?: string;
  status: TaskStatus;
  type: TaskType;
}

export class OperationQueue {
  private emitter = new EventEmitter();
  private tasks = new Map<string, InternalTask>();

  constructor() {
    // Allow many SSE listeners
    this.emitter.setMaxListeners(100);
  }

  /** Cancel a queued (not running) task. Returns true if cancelled. */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task?.status !== "queued") {
      return false;
    }
    this.tasks.delete(taskId);
    return true;
  }

  /** Get all active tasks as snapshots */
  getAllTasks(): TaskSnapshot[] {
    return Array.from(this.tasks.values()).map(toSnapshot);
  }

  /** Get a single task snapshot */
  getTask(taskId: string): TaskSnapshot | undefined {
    const task = this.tasks.get(taskId);
    return task ? toSnapshot(task) : undefined;
  }

  /** Unsubscribe from task events */
  off(event: TaskEventType, listener: (snapshot: TaskSnapshot) => void): void {
    this.emitter.off(event, listener);
  }

  /** Subscribe to task events */
  on(event: TaskEventType, listener: (snapshot: TaskSnapshot) => void): void {
    this.emitter.on(event, listener);
  }

  /**
   * Submit a task to the queue.
   * Returns the taskId (may be an existing task if a duplicate is found).
   */
  submit(type: TaskType, context: TaskContext, executeFn: ExecuteFn): string {
    // Dedup check: same type + podcast + episode
    const dedupKey = `${type}:${context.podcastSlug}:${context.episodeId ?? "all"}`;
    for (const task of this.tasks.values()) {
      const existingKey = `${task.type}:${task.context.podcastSlug}:${task.context.episodeId ?? "all"}`;
      if (existingKey === dedupKey && (task.status === "queued" || task.status === "running")) {
        log.info({ dedupKey, existingId: task.id }, "Duplicate task — returning existing");
        return task.id;
      }
    }

    const id = randomUUID();
    const task: InternalTask = {
      context,
      createdAt: new Date().toISOString(),
      error: null,
      executeFn,
      id,
      progress: null,
      status: "queued",
      type,
    };

    this.tasks.set(id, task);
    this.emit("task-queued", task);
    log.info({ context, id, type }, "Task queued");

    this.drain(type);
    return id;
  }

  /**
   * Submit a task and wait for it to complete.
   * Rejects if the task fails.
   */
  submitAndWait(type: TaskType, context: TaskContext, executeFn: ExecuteFn): Promise<string> {
    const taskId = this.submit(type, context, executeFn);
    return new Promise((resolve, reject) => {
      const onCompleted = (snapshot: TaskSnapshot) => {
        if (snapshot.id !== taskId) {return;}
        this.off("task-completed", onCompleted);
        this.off("task-failed", onFailed);
        resolve(taskId);
      };
      const onFailed = (snapshot: TaskSnapshot) => {
        if (snapshot.id !== taskId) {return;}
        this.off("task-completed", onCompleted);
        this.off("task-failed", onFailed);
        reject(new Error(snapshot.error ?? "Task failed"));
      };

      // Check if already done (e.g. dedup returned a task that finished)
      const current = this.tasks.get(taskId);
      if (current?.status === "completed") {
        resolve(taskId);
        return;
      }
      if (current?.status === "failed") {
        reject(new Error(current.error ?? "Task failed"));
        return;
      }

      this.on("task-completed", onCompleted);
      this.on("task-failed", onFailed);
    });
  }

  private countByStatus(type: TaskType, status: TaskStatus): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.type === type && task.status === status) {
        count++;
      }
    }
    return count;
  }

  /** Try to start queued tasks for a given type, up to concurrency limit */
  private drain(type: TaskType): void {
    const limit = CONCURRENCY_LIMITS[type];
    const running = this.countByStatus(type, "running");
    const available = limit - running;
    if (available <= 0) {
      return;
    }

    const queued = Array.from(this.tasks.values()).filter(
      (t) => t.type === type && t.status === "queued",
    );

    for (const task of queued.slice(0, available)) {
      this.run(task);
    }
  }

  private emit(event: TaskEventType, task: InternalTask): void {
    this.emitter.emit(event, toSnapshot(task));
  }

  private run(task: InternalTask): void {
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.emit("task-started", task);
    log.info({ id: task.id, type: task.type }, "Task started");

    const onProgress = (progress: Record<string, unknown>) => {
      task.progress = progress;
      this.emit("task-progress", task);
    };

    task
      .executeFn(onProgress)
      .then(() => {
        task.status = "completed";
        task.completedAt = new Date().toISOString();
        this.emit("task-completed", task);
        log.info({ id: task.id, type: task.type }, "Task completed");
      })
      .catch((err: unknown) => {
        task.status = "failed";
        task.completedAt = new Date().toISOString();
        task.error = err instanceof Error ? err.message : String(err);
        this.emit("task-failed", task);
        log.error({ err, id: task.id, type: task.type }, "Task failed");
      })
      .finally(() => {
        this.scheduleCleanup(task.id);
        this.drain(task.type);
      });
  }

  private scheduleCleanup(taskId: string): void {
    setTimeout(() => {
      const task = this.tasks.get(taskId);
      if (task && (task.status === "completed" || task.status === "failed")) {
        this.tasks.delete(taskId);
      }
    }, CLEANUP_DELAY_MS);
  }
}

function toSnapshot(task: InternalTask): TaskSnapshot {
  return {
    completedAt: task.completedAt,
    context: task.context,
    createdAt: task.createdAt,
    error: task.error,
    id: task.id,
    progress: task.progress,
    startedAt: task.startedAt,
    status: task.status,
    type: task.type,
  };
}

/** Singleton instance */
export const operationQueue = new OperationQueue();

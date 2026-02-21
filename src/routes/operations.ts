import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { TaskEventType, TaskSnapshot } from "../../shared/schemas/operations.js";

import { operationQueue } from "../services/operation-queue.js";

const app = new Hono();

// GET /api/admin/operations — list all active operations
app.get("/", (c) => {
  return c.json({ operations: operationQueue.getAllTasks() });
});

// GET /api/admin/operations/stream — global SSE stream
app.get("/stream", (c) => {
  return streamSSE(c, async (stream) => {
    // Send current snapshot on connect
    const current = operationQueue.getAllTasks();
    for (const task of current) {
      const event = sseEventForStatus(task.status);
      await stream.writeSSE({ data: JSON.stringify(task), event });
    }

    // Stream future events
    const events: TaskEventType[] = [
      "task-queued",
      "task-started",
      "task-progress",
      "task-completed",
      "task-failed",
    ];

    const listener = (snapshot: TaskSnapshot) => {
      const event = sseEventForSnapshot(snapshot);
      void stream.writeSSE({ data: JSON.stringify(snapshot), event }).catch(() => {
        // Stream closed — will be cleaned up on abort
      });
    };

    for (const event of events) {
      operationQueue.on(event, listener);
    }

    // Keepalive every 15s
    const keepalive = setInterval(() => {
      void stream.writeSSE({ data: "", event: "keepalive" }).catch(() => {
        // Stream closed
      });
    }, 15_000);

    // Clean up when connection closes
    stream.onAbort(() => {
      clearInterval(keepalive);
      for (const event of events) {
        operationQueue.off(event, listener);
      }
    });

    // Keep the stream open until aborted
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});

// GET /api/admin/operations/:id — single task snapshot
app.get("/:id", (c) => {
  const task = operationQueue.getTask(c.req.param("id"));
  if (!task) {
    return c.notFound();
  }
  return c.json(task);
});

// DELETE /api/admin/operations/:id — cancel a queued task
app.delete("/:id", (c) => {
  const cancelled = operationQueue.cancel(c.req.param("id"));
  if (!cancelled) {
    return c.json(
      { message: "Task not found or not cancellable (only queued tasks can be cancelled)" },
      400,
    );
  }
  return c.json({ message: "Task cancelled" });
});

function sseEventForSnapshot(snapshot: TaskSnapshot): string {
  return sseEventForStatus(snapshot.status);
}

function sseEventForStatus(status: string): string {
  switch (status) {
    case "completed":
      return "task-completed";
    case "failed":
      return "task-failed";
    case "queued":
      return "task-queued";
    case "running":
      return "task-started";
    default:
      return "task-queued";
  }
}

export { app as operationsRoutes };

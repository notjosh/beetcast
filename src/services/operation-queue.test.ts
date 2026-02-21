import type { TaskSnapshot } from "../../shared/schemas/operations.js";

import { OperationQueue } from "./operation-queue.js";

vi.mock("pino", () => ({
  default: () => ({
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

describe("OperationQueue", () => {
  let queue: OperationQueue;

  beforeEach(() => {
    queue = new OperationQueue();
  });

  // --------------- submit + immediate start ---------------

  it("starts a single task immediately", () => {
    const id = queue.submit("download", { podcastSlug: "p" }, async () => {});
    expect(queue.getTask(id)?.status).toBe("running");
  });

  // --------------- task completion lifecycle ---------------

  it("emits queued, started, completed events in order", async () => {
    const events: string[] = [];
    const completed = new Promise<void>((resolve) => {
      queue.on("task-completed", () => {
        events.push("completed");
        resolve();
      });
    });
    queue.on("task-queued", () => events.push("queued"));
    queue.on("task-started", () => events.push("started"));

    queue.submit("download", { podcastSlug: "p" }, async () => {});

    await completed;
    expect(events).toEqual(["queued", "started", "completed"]);
  });

  // --------------- task failure lifecycle ---------------

  it("captures error on failure", async () => {
    const failed = new Promise<TaskSnapshot>((resolve) => {
      queue.on("task-failed", resolve);
    });

    queue.submit("download", { podcastSlug: "p" }, async () => {
      throw new Error("boom");
    });

    const snapshot = await failed;
    expect(snapshot.status).toBe("failed");
    expect(snapshot.error).toBe("boom");
  });

  // --------------- progress events ---------------

  it("emits task-progress with correct data", async () => {
    const progressData = new Promise<Record<string, unknown>>((resolve) => {
      queue.on("task-progress", (snapshot) => {
        resolve(snapshot.progress!);
      });
    });

    queue.submit("download", { podcastSlug: "p" }, async (onProgress) => {
      onProgress({ percent: 50 });
    });

    expect(await progressData).toEqual({ percent: 50 });
  });

  // --------------- dedup ---------------

  it("deduplicates same type+podcast+episode", () => {
    const neverResolve = async () => new Promise<void>(() => {});
    const id1 = queue.submit("download", { episodeId: "e1", podcastSlug: "p" }, neverResolve);
    const id2 = queue.submit("download", { episodeId: "e1", podcastSlug: "p" }, neverResolve);

    expect(id2).toBe(id1);
    expect(queue.getAllTasks()).toHaveLength(1);
  });

  it("creates separate tasks for different episodes", () => {
    const neverResolve = async () => new Promise<void>(() => {});
    const id1 = queue.submit("download", { episodeId: "e1", podcastSlug: "p" }, neverResolve);
    const id2 = queue.submit("download", { episodeId: "e2", podcastSlug: "p" }, neverResolve);

    expect(id2).not.toBe(id1);
    expect(queue.getAllTasks()).toHaveLength(2);
  });

  it("allows new submit after task completes", async () => {
    const completed = new Promise<void>((resolve) => {
      queue.on("task-completed", () => resolve());
    });

    const id1 = queue.submit("download", { episodeId: "e1", podcastSlug: "p" }, async () => {});
    await completed;

    const id2 = queue.submit(
      "download",
      { episodeId: "e1", podcastSlug: "p" },
      async () => new Promise<void>(() => {}),
    );
    expect(id2).not.toBe(id1);
  });

  // --------------- concurrency ---------------

  it("enforces merge concurrency limit of 1", () => {
    const neverResolve = async () => new Promise<void>(() => {});
    const id1 = queue.submit("merge", { episodeId: "e1", podcastSlug: "p" }, neverResolve);
    const id2 = queue.submit("merge", { episodeId: "e2", podcastSlug: "p" }, neverResolve);

    expect(queue.getTask(id1)?.status).toBe("running");
    expect(queue.getTask(id2)?.status).toBe("queued");
  });

  it("enforces download concurrency limit of 3", () => {
    const neverResolve = async () => new Promise<void>(() => {});
    const ids: string[] = [];
    for (let i = 1; i <= 4; i++) {
      ids.push(queue.submit("download", { episodeId: `e${i}`, podcastSlug: "p" }, neverResolve));
    }

    expect(queue.getTask(ids[0]!)?.status).toBe("running");
    expect(queue.getTask(ids[1]!)?.status).toBe("running");
    expect(queue.getTask(ids[2]!)?.status).toBe("running");
    expect(queue.getTask(ids[3]!)?.status).toBe("queued");
  });

  // --------------- drain on completion ---------------

  it("starts queued task when running task completes", async () => {
    let resolve1!: () => void;
    const started: string[] = [];
    queue.on("task-started", (s) => started.push(s.context.episodeId ?? ""));

    queue.submit(
      "merge",
      { episodeId: "e1", podcastSlug: "p" },
      async () =>
        new Promise<void>((r) => {
          resolve1 = r;
        }),
    );
    const id2 = queue.submit(
      "merge",
      { episodeId: "e2", podcastSlug: "p" },
      async () => new Promise<void>(() => {}),
    );

    expect(queue.getTask(id2)?.status).toBe("queued");

    const e2Started = new Promise<void>((resolve) => {
      queue.on("task-started", (s) => {
        if (s.context.episodeId === "e2") resolve();
      });
    });

    resolve1();
    await e2Started;

    expect(queue.getTask(id2)?.status).toBe("running");
  });

  // --------------- cancel ---------------

  it("cancels a queued task", () => {
    const neverResolve = async () => new Promise<void>(() => {});
    queue.submit("merge", { episodeId: "e1", podcastSlug: "p" }, neverResolve);
    const id2 = queue.submit("merge", { episodeId: "e2", podcastSlug: "p" }, neverResolve);

    expect(queue.getTask(id2)?.status).toBe("queued");
    expect(queue.cancel(id2)).toBe(true);
    expect(queue.getTask(id2)).toBeUndefined();
  });

  it("returns false when cancelling a running task", () => {
    const id = queue.submit(
      "download",
      { podcastSlug: "p" },
      async () => new Promise<void>(() => {}),
    );
    expect(queue.getTask(id)?.status).toBe("running");
    expect(queue.cancel(id)).toBe(false);
  });

  it("returns false for nonexistent task", () => {
    expect(queue.cancel("nonexistent")).toBe(false);
  });

  // --------------- cleanup after timeout ---------------

  it("cleans up completed task after CLEANUP_DELAY_MS", async () => {
    vi.useFakeTimers();

    const id = queue.submit("download", { podcastSlug: "p" }, async () => {});

    // Flush microtasks so the async executeFn completes
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.getTask(id)?.status).toBe("completed");

    // Advance just under the 60s cleanup delay
    await vi.advanceTimersByTimeAsync(59_999);
    expect(queue.getTask(id)).toBeDefined();

    // Advance past cleanup delay
    await vi.advanceTimersByTimeAsync(2);
    expect(queue.getTask(id)).toBeUndefined();

    vi.useRealTimers();
  });

  // --------------- getAllTasks / getTask ---------------

  it("returns all tasks as snapshots", () => {
    const neverResolve = async () => new Promise<void>(() => {});
    const id1 = queue.submit("download", { episodeId: "e1", podcastSlug: "p" }, neverResolve);
    const id2 = queue.submit("download", { episodeId: "e2", podcastSlug: "p" }, neverResolve);

    const all = queue.getAllTasks();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.id).sort()).toEqual([id1, id2].sort());
  });

  it("returns undefined for unknown task", () => {
    expect(queue.getTask("unknown")).toBeUndefined();
  });
});

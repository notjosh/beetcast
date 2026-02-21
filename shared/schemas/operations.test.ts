import { TaskSnapshotSchema, TaskTypeSchema } from "./operations.js";

describe("TaskSnapshotSchema", () => {
  it("accepts valid data", () => {
    const result = TaskSnapshotSchema.parse({
      context: { podcastSlug: "test" },
      createdAt: "2024-01-01T00:00:00Z",
      error: null,
      id: "abc-123",
      progress: null,
      status: "queued",
      type: "download",
    });
    expect(result.id).toBe("abc-123");
    expect(result.type).toBe("download");
    expect(result.status).toBe("queued");
  });

  it("rejects missing required fields", () => {
    expect(() => TaskSnapshotSchema.parse({})).toThrow();
  });

  it("accepts optional fields", () => {
    const result = TaskSnapshotSchema.parse({
      completedAt: "2024-01-01T01:00:00Z",
      context: { episodeId: "ep-1", podcastSlug: "test" },
      createdAt: "2024-01-01T00:00:00Z",
      error: "something failed",
      id: "abc",
      progress: { percent: 100 },
      startedAt: "2024-01-01T00:30:00Z",
      status: "failed",
      type: "merge",
    });
    expect(result.completedAt).toBe("2024-01-01T01:00:00Z");
    expect(result.error).toBe("something failed");
  });
});

describe("TaskTypeSchema", () => {
  it("accepts valid types", () => {
    for (const type of ["discover", "sync", "sync-single", "download", "merge"]) {
      expect(TaskTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects invalid types", () => {
    expect(() => TaskTypeSchema.parse("invalid")).toThrow();
  });
});

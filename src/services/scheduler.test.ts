import { resetScheduler, startScheduler, stopScheduler } from "./scheduler.js";

vi.mock("pino", () => ({
  default: () => ({
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

const mockSubmit = vi.fn();
vi.mock("./operation-queue.js", () => ({
  operationQueue: { submit: (...args: unknown[]) => mockSubmit(...args) },
}));

vi.mock("./bandcamp.js", () => ({
  discoverEpisodes: vi.fn(),
  syncUnsyncedEpisodes: vi.fn(),
}));

vi.mock("../config.js", () => ({
  getAllConfigs: () => ({
    "test-pod": {
      author: "Test",
      bandcampUrl: "https://test.bandcamp.com",
      refreshInterval: "2h",
      title: "Test Podcast",
    },
  }),
}));

describe("scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSubmit.mockReset();
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  it("runs refresh immediately on start", () => {
    startScheduler();

    expect(mockSubmit).toHaveBeenCalledWith(
      "discover",
      expect.objectContaining({ podcastSlug: "test-pod" }),
      expect.any(Function),
    );
    expect(mockSubmit).toHaveBeenCalledWith(
      "sync",
      expect.objectContaining({ podcastSlug: "test-pod" }),
      expect.any(Function),
    );
  });

  it("schedules next refresh after configured interval", async () => {
    startScheduler();
    mockSubmit.mockReset();

    // Advance by the 2-hour interval
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    expect(mockSubmit).toHaveBeenCalledWith(
      "discover",
      expect.objectContaining({ podcastSlug: "test-pod" }),
      expect.any(Function),
    );
    expect(mockSubmit).toHaveBeenCalledWith(
      "sync",
      expect.objectContaining({ podcastSlug: "test-pod" }),
      expect.any(Function),
    );
  });

  it("does not fire before the interval", async () => {
    startScheduler();
    mockSubmit.mockReset();

    // Advance to just under 2 hours
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - 1);

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("resetScheduler restarts the timer", async () => {
    startScheduler();
    mockSubmit.mockReset();

    // Advance 1.5 hours (not enough to trigger the 2h timer)
    await vi.advanceTimersByTimeAsync(1.5 * 60 * 60 * 1000);
    expect(mockSubmit).not.toHaveBeenCalled();

    // Reset the timer
    resetScheduler("test-pod");

    // Advance another 1.5 hours (3h total, but only 1.5h since reset — no fire)
    await vi.advanceTimersByTimeAsync(1.5 * 60 * 60 * 1000);
    expect(mockSubmit).not.toHaveBeenCalled();

    // Advance to 2h since reset (0.5h more)
    await vi.advanceTimersByTimeAsync(0.5 * 60 * 60 * 1000);
    expect(mockSubmit).toHaveBeenCalledWith(
      "discover",
      expect.objectContaining({ podcastSlug: "test-pod" }),
      expect.any(Function),
    );
  });

  it("stopScheduler clears all timers", async () => {
    startScheduler();
    mockSubmit.mockReset();

    stopScheduler();

    // Advance well past the interval
    await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);

    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

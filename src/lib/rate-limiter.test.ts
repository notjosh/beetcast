import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not delay calls spaced apart", async () => {
    const limiter = new RateLimiter(1000, 0);
    const fn = vi.fn().mockResolvedValue("ok");

    await limiter.throttle(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past the interval
    await vi.advanceTimersByTimeAsync(1500);

    await limiter.throttle(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throttles rapid calls", async () => {
    const limiter = new RateLimiter(1000, 0);
    const results: number[] = [];

    await limiter.throttle(async () => results.push(1));

    // Second call immediately — should be delayed
    const p2 = limiter.throttle(async () => results.push(2));
    expect(results).toEqual([1]);

    // Advance past the throttle interval
    await vi.advanceTimersByTimeAsync(1000);
    await p2;

    expect(results).toEqual([1, 2]);
  });
});

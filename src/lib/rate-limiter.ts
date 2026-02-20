export class RateLimiter {
  private lastRequestTime = 0;
  private readonly maxJitterMs: number;
  private readonly minIntervalMs: number;

  constructor(minIntervalMs = 1000, maxJitterMs = 200) {
    this.minIntervalMs = minIntervalMs;
    this.maxJitterMs = maxJitterMs;
  }

  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const jitter = Math.random() * this.maxJitterMs;
    const waitTime = Math.max(0, this.minIntervalMs - elapsed + jitter);

    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    return fn();
  }
}

export const bandcampLimiter = new RateLimiter(1000, 200);

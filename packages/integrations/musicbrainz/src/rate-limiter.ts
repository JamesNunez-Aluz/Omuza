/**
 * Serial rate limiter honoring MusicBrainz's published etiquette of one
 * request per second per client (spec §11.2). Callers queue; each acquired
 * slot is spaced `intervalMs` from the previous one.
 */
export class RateLimiter {
  private nextAvailableAt = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async acquire(now: () => number = Date.now): Promise<void> {
    const current = now();
    const scheduled = Math.max(current, this.nextAvailableAt);
    this.nextAvailableAt = scheduled + this.intervalMs;
    const waitMs = scheduled - current;
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
  }
}

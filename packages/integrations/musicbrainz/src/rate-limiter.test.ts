import { describe, expect, it } from "vitest";

import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  it("spaces sequential acquisitions by the interval", async () => {
    const waits: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(1000, async (ms) => {
      waits.push(ms);
      clock += ms;
    });
    const now = () => clock;

    await limiter.acquire(now); // immediate
    await limiter.acquire(now); // +1000
    await limiter.acquire(now); // +1000
    expect(waits).toEqual([1000, 1000]);
  });

  it("does not wait when calls are naturally spaced", async () => {
    const waits: number[] = [];
    let clock = 0;
    const limiter = new RateLimiter(1000, async (ms) => {
      waits.push(ms);
    });
    await limiter.acquire(() => clock);
    clock += 5000;
    await limiter.acquire(() => clock);
    expect(waits).toEqual([]);
  });
});

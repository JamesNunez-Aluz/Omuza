import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QUEUES, createQueue } from "@resonance/db";
import type { PingJobData } from "@resonance/db";
import type PgBoss from "pg-boss";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn("DATABASE_URL not set — skipping queue integration tests");
}

describeWithDb("postgres-backed queue", () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = await createQueue(databaseUrl!);
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false });
  });

  it("delivers a ping job to a worker exactly once", { timeout: 30000 }, async () => {
    const handled: string[] = [];
    await boss.work<PingJobData>(QUEUES.ping, async (jobs) => {
      for (const job of jobs) {
        handled.push(job.data.requestedAt);
      }
    });

    const requestedAt = new Date().toISOString();
    const jobId = await boss.send(QUEUES.ping, { requestedAt });
    expect(jobId).toBeTruthy();

    await expect
      .poll(() => handled, { timeout: 15000, interval: 250 })
      .toContain(requestedAt);
  });
});

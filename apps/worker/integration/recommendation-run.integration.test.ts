import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDatabase,
  createRecommendationRun,
  getRunById,
  insertSeeds,
  listRunItems,
  migrate,
  recommendationCandidates,
  recordRunExposuresOnce,
  exposures,
  seedLicenseRegistry,
  seedSyntheticCatalog,
  users,
} from "@resonance/db";
import { buildSyntheticSnapshot, artistUuid, recordingUuid } from "@resonance/testkit";
import { createLogger } from "@resonance/observability";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runRecommendationJob } from "../src/jobs/recommendation-generate.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);

describeWithDb("recommendation run job (spec §21 M2 acceptance)", () => {
  const logger = createLogger({ service: "worker", level: "fatal" });
  let db: ReturnType<typeof createDatabase>["db"];
  let pool: ReturnType<typeof createDatabase>["pool"];
  let userId: string;

  beforeAll(async () => {
    ({ db, pool } = createDatabase(databaseUrl!));
    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../packages/db/migrations",
    );
    await migrate(pool, migrationsDir);
    await seedLicenseRegistry(pool);
    await seedSyntheticCatalog(db, buildSyntheticSnapshot());

    const inserted = await db
      .insert(users)
      .values({ emailNormalized: `run-job-${RUN}@example.test` })
      .returning({ id: users.id });
    userId = inserted[0]!.id;

    await insertSeeds(db, userId, [
      { entityType: "artist", artistId: artistUuid(0), sentiment: "strong_positive", strength: 1 },
      { entityType: "artist", artistId: artistUuid(1), sentiment: "positive", strength: 0.8 },
      { entityType: "artist", artistId: artistUuid(2), sentiment: "positive", strength: 0.8 },
      { entityType: "recording", recordingId: recordingUuid(7, 0), sentiment: "positive", strength: 1 },
      { entityType: "artist", artistId: artistUuid(3), sentiment: "hard_block", strength: 1 },
      { entityType: "artist", artistId: artistUuid(6), sentiment: "fatigue", strength: 0.7 },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createRun(randomSeed: string) {
    return createRecommendationRun(db, {
      userId,
      contextId: null,
      requestedCount: 20,
      discoveryLevel: 50,
      randomSeed,
    });
  }

  it("completes a run with 20 items, full trace, first-view exposures, and no hard-block leaks", async () => {
    const run = await createRun(`seed-${RUN}-a`);
    await runRecommendationJob(db, logger, run.id);

    const finished = await getRunById(db, run.id);
    expect(finished!.status).toBe("completed");
    expect(finished!.rankerVersion).toMatch(/^ranker@/);
    expect(finished!.selectorVersion).toMatch(/^selector/);
    expect(finished!.profileSnapshotVersion).toMatch(/^profile@/);

    const items = await listRunItems(db, run.id);
    expect(items).toHaveLength(20);
    expect(new Set(items.map((item) => item.recording.id)).size).toBe(20);
    for (const item of items) {
      // Hard-blocked artist 3 must never appear.
      expect(item.recording.artists.map((artist) => artist.id)).not.toContain(artistUuid(3));
      expect(item.explanation).not.toBeNull();
      expect((item.explanation!.evidence as unknown[]).length).toBeGreaterThan(0);
      expect(["probably_new", "unknown", "known", "high_confidence_new"]).toContain(item.noveltyState);
    }

    const trace = await db
      .select()
      .from(recommendationCandidates)
      .where(eq(recommendationCandidates.runId, run.id));
    expect(trace.length).toBeGreaterThan(20);
    expect(trace.some((candidate) => candidate.eligibilityDecision === "rejected")).toBe(true);
    expect(trace.filter((candidate) => candidate.selected)).toHaveLength(20);

    // Exposures are recorded on first view, not at generation (spec §9.5),
    // and repeat views add nothing.
    let exposureRows = await db
      .select()
      .from(exposures)
      .where(eq(exposures.recommendationRunId, run.id));
    expect(exposureRows).toHaveLength(0);
    await recordRunExposuresOnce(db, run.id, userId);
    await recordRunExposuresOnce(db, run.id, userId);
    exposureRows = await db
      .select()
      .from(exposures)
      .where(eq(exposures.recommendationRunId, run.id));
    expect(exposureRows).toHaveLength(20);
  });

  it("is reproducible: same random seed and snapshot produce the identical playlist", async () => {
    const runA = await createRun(`seed-${RUN}-repro`);
    const runB = await createRun(`seed-${RUN}-repro`);
    await runRecommendationJob(db, logger, runA.id);
    await runRecommendationJob(db, logger, runB.id);

    const itemsA = await listRunItems(db, runA.id);
    const itemsB = await listRunItems(db, runB.id);
    expect(itemsB.map((item) => item.recording.id)).toEqual(itemsA.map((item) => item.recording.id));
  });

  it("marks the run degraded when an external provider fails but coverage is sufficient", async () => {
    const run = await createRun(`seed-${RUN}-degraded`);
    await runRecommendationJob(db, logger, run.id, [
      {
        providerId: "listenbrainz",
        strategy: "collaborative",
        fetch: async () => {
          throw new Error("provider 503");
        },
      },
    ]);
    const finished = await getRunById(db, run.id);
    expect(finished!.status).toBe("degraded");
    expect(finished!.degradedProviders).toContain("listenbrainz");
    expect(await listRunItems(db, run.id)).toHaveLength(20);
  });

  it("fails safely and actionably for a user with no positive seeds", async () => {
    const bare = await db
      .insert(users)
      .values({ emailNormalized: `run-job-bare-${RUN}@example.test` })
      .returning({ id: users.id });
    const run = await createRecommendationRun(db, {
      userId: bare[0]!.id,
      contextId: null,
      requestedCount: 20,
      discoveryLevel: 50,
      randomSeed: "bare",
    });
    await runRecommendationJob(db, logger, run.id);
    const finished = await getRunById(db, run.id);
    expect(finished!.status).toBe("failed");
    expect(finished!.failureCode).toBe("insufficient_profile");
    expect(finished!.failureDetailRedacted).not.toMatch(/error|stack|at /i);
  });
});

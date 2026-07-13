import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendConsentRecord,
  createDatabase,
  findUserById,
  getPrivacyRequest,
  createPrivacyRequest,
  insertSeeds,
  listActiveSeeds,
  listPreferences,
  migrate,
  seedLicenseRegistry,
  softDeleteSeed,
  upsertArtistByMbid,
  users,
} from "@resonance/db";
import { createLogger } from "@resonance/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processDeleteRequest, processExportRequest } from "../src/jobs/privacy.js";
import { recomputeTasteProfile } from "../src/jobs/taste-recompute.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

describeWithDb("worker jobs: taste recompute and privacy", () => {
  const logger = createLogger({ service: "worker", level: "fatal" });
  let db: ReturnType<typeof createDatabase>["db"];
  let pool: ReturnType<typeof createDatabase>["pool"];
  let userId: string;
  let artistAId: string;
  let artistBId: string;

  beforeAll(async () => {
    ({ db, pool } = createDatabase(databaseUrl!));
    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../packages/db/migrations",
    );
    await migrate(pool, migrationsDir);
    await seedLicenseRegistry(pool);

    const inserted = await db
      .insert(users)
      .values({ emailNormalized: "worker-jobs@example.test" })
      .onConflictDoNothing()
      .returning({ id: users.id });
    userId =
      inserted[0]?.id ??
      (
        await pool.query<{ id: string }>(
          "select id from users where email_normalized = 'worker-jobs@example.test'",
        )
      ).rows[0]!.id;

    artistAId = (
      await upsertArtistByMbid(db, {
        mbid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        name: "Tidal Arithmetic",
        licensePolicyId: "musicbrainz-core@1",
      })
    ).id;
    artistBId = (
      await upsertArtistByMbid(db, {
        mbid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: "Paper Lantern Choir",
        licensePolicyId: "musicbrainz-core@1",
      })
    ).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("recomputes derived preferences from active seeds, and removal drops them", async () => {
    const seeds = await insertSeeds(db, userId, [
      { entityType: "artist", artistId: artistAId, sentiment: "strong_positive", strength: 1 },
      { entityType: "artist", artistId: artistBId, sentiment: "hard_block", strength: 1 },
    ]);

    const written = await recomputeTasteProfile(db, logger, userId);
    expect(written).toBe(2);

    let preferences = await listPreferences(db, userId);
    const keys = preferences.map((pref) => pref.key);
    expect(keys).toContain(`artist:${artistAId}`);
    expect(keys).toContain(`artist:${artistBId}`);
    const blocked = preferences.find((pref) => pref.key === `artist:${artistBId}`);
    expect(Number(blocked!.preferenceValue)).toBe(-1);

    // Deleting a seed and recomputing removes its derived preference (M1 acceptance).
    await softDeleteSeed(db, userId, seeds[1]!.id);
    await recomputeTasteProfile(db, logger, userId);
    preferences = await listPreferences(db, userId);
    expect(preferences.map((pref) => pref.key)).not.toContain(`artist:${artistBId}`);
    expect(preferences.map((pref) => pref.key)).toContain(`artist:${artistAId}`);
  });

  it("export request produces a payload of first-party data only", async () => {
    await appendConsentRecord(db, {
      userId,
      purpose: "terms_privacy",
      policyVersion: "terms-privacy@2026-07-13",
      status: "granted",
    });
    const request = await createPrivacyRequest(db, userId, "export");
    await processExportRequest(db, logger, { userId, requestId: request.id });

    const completed = await getPrivacyRequest(db, userId, request.id);
    expect(completed!.status).toBe("completed");
    const payload = completed!.payload as {
      seeds: unknown[];
      consents: unknown[];
      generatedFor: { email: string };
    };
    expect(payload.seeds.length).toBeGreaterThan(0);
    expect(payload.consents.length).toBeGreaterThan(0);
    expect(payload.generatedFor.email).toBe("worker-jobs@example.test");
    expect(JSON.stringify(payload)).not.toMatch(/token|spotify/i);
  });

  it("delete request anonymizes the account and removes taste data", async () => {
    const request = await createPrivacyRequest(db, userId, "delete");
    await processDeleteRequest(db, logger, { userId, requestId: request.id });

    const user = await findUserById(db, userId);
    expect(user!.status).toBe("deleted");
    expect(user!.emailNormalized).toBe(`deleted:${userId}`);
    expect(user!.deletedAt).not.toBeNull();

    expect(await listActiveSeeds(db, userId)).toHaveLength(0);
    expect(await listPreferences(db, userId)).toHaveLength(0);

    const status = await getPrivacyRequest(db, userId, request.id);
    expect(status!.status).toBe("completed");
  });
});

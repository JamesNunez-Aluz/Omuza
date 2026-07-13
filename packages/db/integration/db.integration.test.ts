import path from "node:path";
import { fileURLToPath } from "node:url";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPool } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { seedLicenseRegistry } from "../src/seed-licenses.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn("DATABASE_URL not set — skipping db integration tests");
}

describeWithDb("database compliance constraints", () => {
  let pool: pg.Pool;
  let recordingId: string;

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../migrations",
    );
    await migrate(pool, migrationsDir);
    await seedLicenseRegistry(pool);

    const artist = await pool.query<{ id: string }>(
      `insert into artists (name, provenance_provider, license_policy_id)
       values ('Synthetic Artist A', 'synthetic', 'synthetic-fixtures@1')
       returning id`,
    );
    const recording = await pool.query<{ id: string }>(
      `insert into recordings (title, primary_artist_id, provenance_provider, license_policy_id)
       values ('Synthetic Recording A', $1, 'synthetic', 'synthetic-fixtures@1')
       returning id`,
      [artist.rows[0]!.id],
    );
    recordingId = recording.rows[0]!.id;
  });

  afterAll(async () => {
    await pool?.query("delete from recordings where title = 'Synthetic Recording A'");
    await pool?.query("delete from artists where name = 'Synthetic Artist A'");
    await pool?.end();
  });

  it("applies migrations idempotently", async () => {
    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../migrations",
    );
    const second = await migrate(pool, migrationsDir);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it("seeds the license registry idempotently", async () => {
    const count = await seedLicenseRegistry(pool);
    expect(count).toBeGreaterThan(0);
    const { rows } = await pool.query("select id from source_licenses where provider = 'spotify'");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("rejects a Spotify-sourced feature marked training-eligible at the database level", async () => {
    await expect(
      pool.query(
        `insert into recording_features
           (recording_id, feature, value, provenance_provider, provenance_dataset,
            license_policy_id, training_eligible)
         values ($1, 'energy', 0.9, 'spotify', 'export-resolution', 'spotify-export@1', true)`,
        [recordingId],
      ),
    ).rejects.toThrow(/spotify_never_training_eligible/);
  });

  it("rejects a Spotify-sourced feature marked recommendation-eligible at the database level", async () => {
    await expect(
      pool.query(
        `insert into recording_features
           (recording_id, feature, value, provenance_provider, provenance_dataset,
            license_policy_id, recommendation_eligible)
         values ($1, 'energy', 0.9, 'spotify', 'export-resolution', 'spotify-export@1', true)`,
        [recordingId],
      ),
    ).rejects.toThrow(/spotify_never_recommendation_eligible/);
  });

  it("accepts an eligible synthetic feature row and enforces the license FK", async () => {
    await pool.query(
      `insert into recording_features
         (recording_id, feature, value, provenance_provider, provenance_dataset,
          license_policy_id, recommendation_eligible)
       values ($1, 'tempo_bucket', 0.5, 'synthetic', 'fixtures', 'synthetic-fixtures@1', true)
       on conflict do nothing`,
      [recordingId],
    );

    await expect(
      pool.query(
        `insert into recording_features
           (recording_id, feature, value, provenance_provider, provenance_dataset, license_policy_id)
         values ($1, 'unlicensed', 0.1, 'synthetic', 'fixtures', 'no-such-policy@1')`,
        [recordingId],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

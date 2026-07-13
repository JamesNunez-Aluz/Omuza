import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPool } from "../packages/db/src/client.ts";
import { migrate } from "../packages/db/src/migrate.ts";
import { seedLicenseRegistry } from "../packages/db/src/seed-licenses.ts";
import { loadCatalogFixtures } from "../packages/testkit/src/fixtures.ts";

/**
 * Seed synthetic demo data (Milestone 0 deliverable). Idempotent; safe to
 * re-run. Everything inserted here is invented fixture content — no real
 * provider data.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to seed demo data");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pool = createPool(databaseUrl);

try {
  await migrate(pool, path.join(repoRoot, "packages/db/migrations"));
  const policies = await seedLicenseRegistry(pool);

  const catalog = loadCatalogFixtures();
  const artistIds = new Map<string, string>();

  for (const artist of catalog.artists) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into artists (name, provenance_provider, license_policy_id)
       select $1, $2, $3
       where not exists (select 1 from artists where name = $1)
       returning id`,
      [artist.name, artist.provenanceProvider, artist.licensePolicyId],
    );
    const id =
      rows[0]?.id ??
      (await pool.query<{ id: string }>("select id from artists where name = $1", [artist.name]))
        .rows[0]!.id;
    artistIds.set(artist.key, id);
  }

  let recordingCount = 0;
  for (const recording of catalog.recordings) {
    await pool.query(
      `insert into recordings (title, primary_artist_id, duration_ms, provenance_provider, license_policy_id)
       select $1, $2, $3, $4, $5
       where not exists (select 1 from recordings where title = $1)`,
      [
        recording.title,
        artistIds.get(recording.artistKey),
        recording.durationMs,
        recording.provenanceProvider,
        recording.licensePolicyId,
      ],
    );
    recordingCount += 1;
  }

  console.log(
    JSON.stringify({
      event: "seed_complete",
      licensePolicies: policies,
      artists: artistIds.size,
      recordings: recordingCount,
    }),
  );
} finally {
  await pool.end();
}

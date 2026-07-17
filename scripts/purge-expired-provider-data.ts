import { createDatabase } from "../packages/db/src/client.ts";
import { purgeExpiredDestinationData } from "../packages/db/src/repositories/exports.ts";

/**
 * Purge expired destination-zone data (spec §6.5, §12.5 step 4): temporary
 * export resolutions past their mandatory expiry and stale OAuth callback
 * transactions. Idempotent; intended for a scheduled job and safe to run
 * anytime. Never touches service-neutral catalog or taste data.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { db, pool } = createDatabase(databaseUrl);
try {
  const purged = await purgeExpiredDestinationData(db);
  console.log(JSON.stringify({ event: "provider_data_purged", ...purged }));
} finally {
  await pool.end();
}

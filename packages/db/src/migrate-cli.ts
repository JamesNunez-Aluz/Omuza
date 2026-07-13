import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPool } from "./client.js";
import { migrate } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations");
  process.exit(1);
}

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

const pool = createPool(databaseUrl);
try {
  const result = await migrate(pool, migrationsDir);
  console.log(
    JSON.stringify({ event: "migrations_complete", applied: result.applied, skipped: result.skipped.length }),
  );
} finally {
  await pool.end();
}

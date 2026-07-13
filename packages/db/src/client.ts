import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export function createDatabase(databaseUrl: string) {
  const pool = createPool(databaseUrl);
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Readiness probe: cheap round trip that fails when the database is down. */
export async function pingDatabase(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

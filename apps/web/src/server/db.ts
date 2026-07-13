import { loadConfig } from "@resonance/config";
import { createPool } from "@resonance/db";
import type pg from "pg";

/** Process-wide pool, created lazily so build-time code never needs env. */
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = createPool(loadConfig().databaseUrl);
  }
  return pool;
}

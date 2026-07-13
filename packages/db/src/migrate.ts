import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type pg from "pg";

/**
 * Minimal forward-only SQL migrator. Migrations are numbered .sql files in
 * packages/db/migrations, applied in lexicographic order, each in its own
 * transaction, recorded with a content hash so a changed historical file is
 * detected instead of silently ignored.
 */

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(pool: pg.Pool, migrationsDir: string): Promise<MigrationResult> {
  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      hash text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  const { rows: appliedRows } = await pool.query<{ name: string; hash: string }>(
    "select name, hash from schema_migrations",
  );
  const appliedByName = new Map(appliedRows.map((row) => [row.name, row.hash]));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const existing = appliedByName.get(file);

    if (existing !== undefined) {
      if (existing !== hash) {
        throw new Error(
          `Migration ${file} was modified after being applied. Write a new migration instead.`,
        );
      }
      result.skipped.push(file);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name, hash) values ($1, $2)", [
        file,
        hash,
      ]);
      await client.query("commit");
      result.applied.push(file);
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${String(error)}`);
    } finally {
      client.release();
    }
  }

  return result;
}

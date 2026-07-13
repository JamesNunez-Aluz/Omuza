import PgBoss from "pg-boss";

/**
 * Postgres-backed job queue (ADR 0008). pg-boss keeps its state in the same
 * PostgreSQL instance as the application — no Redis or broker without an ADR
 * and measured need.
 */

export const QUEUES = {
  ping: "system.ping",
} as const;

export interface PingJobData {
  requestedAt: string;
}

export async function createQueue(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue);
  }
  return boss;
}

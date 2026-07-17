import PgBoss from "pg-boss";

/**
 * Postgres-backed job queue (ADR 0008). Queue names and payload contracts
 * live here so web (producer) and worker (consumer) share one definition.
 * Payloads carry IDs only — never personal data or provider payloads.
 */

export const QUEUES = {
  ping: "system.ping",
  tasteRecompute: "taste.recompute",
  privacyExport: "privacy.export",
  privacyDelete: "privacy.delete",
  recommendationGenerate: "recommendation.generate",
  spotifyExport: "spotify.export",
} as const;

export interface RecommendationGenerateJob {
  runId: string;
}

export interface SpotifyExportJob {
  exportId: string;
}

export interface PingJobData {
  requestedAt: string;
}

export interface TasteRecomputeJob {
  userId: string;
  reason: "seed_added" | "seed_updated" | "seed_removed" | "onboarding_completed" | "feedback_received";
}

export interface PrivacyJob {
  userId: string;
  requestId: string;
}

export async function createQueue(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue);
  }
  return boss;
}

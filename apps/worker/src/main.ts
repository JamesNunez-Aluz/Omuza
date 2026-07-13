import { loadConfig } from "@resonance/config";
import { QUEUES, createDatabase, createQueue, pingDatabase } from "@resonance/db";
import type { PingJobData, PrivacyJob, TasteRecomputeJob } from "@resonance/db";
import { createLogger } from "@resonance/observability";

import { startHealthServer } from "./health.js";
import { processDeleteRequest, processExportRequest } from "./jobs/privacy.js";
import { recomputeTasteProfile } from "./jobs/taste-recompute.js";

const config = loadConfig();
const logger = createLogger({ service: "worker", level: config.logLevel });

const { db, pool } = createDatabase(config.databaseUrl);
const boss = await createQueue(config.databaseUrl);
let queueStarted = true;

boss.on("error", (error) => {
  logger.error({ err: error.message }, "queue error");
});

await boss.work<PingJobData>(QUEUES.ping, async (jobs) => {
  for (const job of jobs) {
    logger.info({ jobId: job.id, requestedAt: job.data.requestedAt }, "ping handled");
  }
});

await boss.work<TasteRecomputeJob>(QUEUES.tasteRecompute, async (jobs) => {
  for (const job of jobs) {
    await recomputeTasteProfile(db, logger, job.data.userId);
  }
});

await boss.work<PrivacyJob>(QUEUES.privacyExport, async (jobs) => {
  for (const job of jobs) {
    await processExportRequest(db, logger, job.data);
  }
});

await boss.work<PrivacyJob>(QUEUES.privacyDelete, async (jobs) => {
  for (const job of jobs) {
    await processDeleteRequest(db, logger, job.data);
  }
});

const healthServer = startHealthServer(config.workerHealthPort, {
  live: () => true,
  ready: async () => queueStarted && (await pingDatabase(pool)),
});

logger.info(
  { healthPort: config.workerHealthPort, featureSpotifyExport: config.featureSpotifyExport },
  "worker started",
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "worker shutting down");
  queueStarted = false;
  healthServer.close();
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

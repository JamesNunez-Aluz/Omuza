import { loadConfig } from "@resonance/config";
import { createPool, pingDatabase } from "@resonance/db";
import { createLogger } from "@resonance/observability";

import { startHealthServer } from "./health.js";
import { QUEUES, createQueue } from "./queue.js";
import type { PingJobData } from "./queue.js";

const config = loadConfig();
const logger = createLogger({ service: "worker", level: config.logLevel });

const pool = createPool(config.databaseUrl);
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

import { loadConfig } from "@resonance/config";
import type { AppConfig } from "@resonance/config";
import { createDatabase, createQueue } from "@resonance/db";
import type { Database } from "@resonance/db";
import { MusicBrainzClient } from "@resonance/musicbrainz";
import { createLogger } from "@resonance/observability";
import type { Logger } from "@resonance/observability";
import type PgBoss from "pg-boss";

/**
 * Process-wide server context: lazily constructed singletons so build-time
 * code paths never need environment variables. Tests replace this via
 * setServerContext with a test database and stub providers.
 */

export interface ServerContext {
  config: AppConfig;
  db: Database;
  logger: Logger;
  musicbrainz: MusicBrainzClient;
  enqueue: (queue: string, data: object) => Promise<void>;
}

let context: ServerContext | undefined;
let boss: PgBoss | undefined;

export function getServerContext(): ServerContext {
  if (!context) {
    const config = loadConfig();
    const { db } = createDatabase(config.databaseUrl);
    const logger = createLogger({ service: "web", level: config.logLevel });
    const musicbrainz = new MusicBrainzClient({
      userAgent: config.musicbrainzUserAgent,
      baseUrl: config.musicbrainzBaseUrl,
      enabled: config.featureMusicbrainzProvider,
    });
    context = {
      config,
      db,
      logger,
      musicbrainz,
      enqueue: async (queue, data) => {
        boss ??= await createQueue(config.databaseUrl);
        await boss.send(queue, data);
      },
    };
  }
  return context;
}

/** Test hook. Production code must never call this. */
export function setServerContext(next: ServerContext | undefined): void {
  context = next;
  boss = undefined;
}

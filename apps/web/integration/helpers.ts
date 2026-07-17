import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig } from "@resonance/config";
import {
  createAuthToken,
  createDatabase,
  migrate,
  seedLicenseRegistry,
} from "@resonance/db";
import type { Database } from "@resonance/db";
import { authTokenExpiry, generateToken } from "@resonance/domain";
import { MusicBrainzClient } from "@resonance/musicbrainz";
import { createLogger } from "@resonance/observability";

import { setServerContext } from "../src/server/context";
import type { ServerContext } from "../src/server/context";

export const APP_BASE_URL = "http://localhost:3000";

export interface TestHarness {
  db: Database;
  ctx: ServerContext;
  enqueued: { queue: string; data: object }[];
  /** Swap the MusicBrainz fetch behavior per test. */
  setMusicbrainzFetch: (fetchFn: typeof fetch) => void;
  /** Replace config fields (e.g. enable the Spotify pilot) for this harness. */
  overrideConfig: (patch: Partial<AppConfig>) => void;
  close: () => Promise<void>;
}

const testConfig: AppConfig = {
  nodeEnv: "test",
  logLevel: "fatal",
  appBaseUrl: APP_BASE_URL,
  databaseUrl: process.env.DATABASE_URL ?? "",
  webPort: 3000,
  workerHealthPort: 3001,
  featureSpotifyExport: false,
  featureMusicbrainzProvider: true,
  featureListenbrainzProvider: false,
  listenbrainzBaseUrl: "https://listenbrainz.example.test",
  musicbrainzBaseUrl: "https://musicbrainz.example.test/ws/2",
  musicbrainzUserAgent: "ResonanceTest/0.1 (test@example.test)",
  smtpHost: "localhost",
  smtpPort: 1025,
  emailFrom: "login@resonance.local",
  spotifyClientId: "",
  spotifyClientSecret: "",
  spotifyRedirectUri: "",
  spotifyAccountsBaseUrl: "https://accounts.spotify.example.test",
  spotifyApiBaseUrl: "https://api.spotify.example.test",
  spotifyPilotAllowlist: [],
  tokenEncryptionKeyB64: "",
  tokenEncryptionKeyVersion: "v1",
};

export async function createHarness(): Promise<TestHarness> {
  const { db, pool } = createDatabase(testConfig.databaseUrl);
  const migrationsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../packages/db/migrations",
  );
  await migrate(pool, migrationsDir);
  await seedLicenseRegistry(pool);

  const enqueued: { queue: string; data: object }[] = [];
  let currentFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ count: 0, artists: [], recordings: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const ctx: ServerContext = {
    config: testConfig,
    db,
    logger: createLogger({ service: "web", level: "fatal" }),
    musicbrainz: new MusicBrainzClient({
      userAgent: testConfig.musicbrainzUserAgent,
      baseUrl: testConfig.musicbrainzBaseUrl,
      fetchFn: (input, init) => currentFetch(input, init),
      sleep: () => Promise.resolve(),
    }),
    enqueue: async (queue, data) => {
      enqueued.push({ queue, data });
    },
  };
  setServerContext(ctx);

  return {
    db,
    ctx,
    enqueued,
    setMusicbrainzFetch: (fetchFn) => {
      currentFetch = fetchFn;
    },
    overrideConfig: (patch) => {
      ctx.config = { ...ctx.config, ...patch };
      setServerContext(ctx);
    },
    close: async () => {
      setServerContext(undefined);
      await pool.end();
    },
  };
}

export interface RequestOptions {
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  idempotencyKey?: string;
}

/** Build a Request the way a same-origin browser fetch would. */
export function makeRequest(method: string, requestPath: string, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = options.cookie;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  if (options.origin !== null) headers.origin = options.origin ?? APP_BASE_URL;
  return new Request(`${APP_BASE_URL}${requestPath}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : null,
  });
}

/** Create a user through the real passwordless flow; returns the session cookie. */
export async function signIn(db: Database, email: string): Promise<string> {
  const { token, tokenHash } = generateToken();
  await createAuthToken(db, { emailNormalized: email, tokenHash, expiresAt: authTokenExpiry() });
  const { POST } = await import("../app/api/v1/auth/verify/route.js");
  const response = await POST(makeRequest("POST", "/api/v1/auth/verify", { body: { token } }));
  if (response.status !== 200) {
    throw new Error(`sign-in failed with status ${response.status}`);
  }
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("no session cookie issued");
  return setCookie.split(";")[0]!;
}

export const mbArtistFixture = {
  count: 2,
  artists: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Nebula Cartographers",
      "sort-name": "Nebula Cartographers",
      disambiguation: "synthetic test artist",
      country: "US",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Nebula Cartography Club",
      disambiguation: "a different synthetic artist",
    },
  ],
};

export const mbRecordingFixture = {
  count: 1,
  recordings: [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Meridian Sketch",
      length: 214000,
      "first-release-date": "2021-03-01",
      "artist-credit": [
        {
          name: "Nebula Cartographers",
          artist: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Nebula Cartographers" },
        },
      ],
    },
  ],
};

export function musicbrainzFetchFixture(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.includes("/artist") ? mbArtistFixture : mbRecordingFixture;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

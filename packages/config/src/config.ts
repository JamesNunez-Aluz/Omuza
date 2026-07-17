import { z } from "zod";

/**
 * Zod-validated application configuration (trust boundary: process env).
 *
 * Fail fast and loud on invalid config, but never echo secret values back in
 * the error: only key names and issue messages are included.
 */

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// connection string",
    }),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  FEATURE_SPOTIFY_EXPORT: booleanFlag,
  FEATURE_MUSICBRAINZ_PROVIDER: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  FEATURE_LISTENBRAINZ_PROVIDER: booleanFlag,
  LISTENBRAINZ_BASE_URL: z.string().url().default("https://api.listenbrainz.org"),
  MUSICBRAINZ_BASE_URL: z.string().url().default("https://musicbrainz.org/ws/2"),
  MUSICBRAINZ_USER_AGENT: z.string().min(5).default("Resonance/0.1.0 (dev@resonance.local)"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  EMAIL_FROM: z.string().email().default("login@resonance.local"),
  // Spotify export pilot (Milestone 4) — all optional; the kill switch is
  // FEATURE_SPOTIFY_EXPORT and the pilot allowlist gates every surface.
  SPOTIFY_CLIENT_ID: z.string().default(""),
  SPOTIFY_CLIENT_SECRET: z.string().default(""),
  SPOTIFY_REDIRECT_URI: z.string().default(""),
  SPOTIFY_ACCOUNTS_BASE_URL: z.string().url().default("https://accounts.spotify.com"),
  SPOTIFY_API_BASE_URL: z.string().url().default("https://api.spotify.com"),
  /** Comma-separated pilot user emails (Development Mode allowlist, §12.2). */
  SPOTIFY_PILOT_ALLOWLIST: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),
  /** 32-byte base64 key for AES-256-GCM token envelope encryption (ADR 0012). */
  TOKEN_ENCRYPTION_KEY_B64: z.string().default(""),
  TOKEN_ENCRYPTION_KEY_VERSION: z.string().default("v1"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  appBaseUrl: string;
  databaseUrl: string;
  webPort: number;
  workerHealthPort: number;
  featureSpotifyExport: boolean;
  featureMusicbrainzProvider: boolean;
  featureListenbrainzProvider: boolean;
  listenbrainzBaseUrl: string;
  musicbrainzBaseUrl: string;
  musicbrainzUserAgent: string;
  smtpHost: string;
  smtpPort: number;
  emailFrom: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRedirectUri: string;
  spotifyAccountsBaseUrl: string;
  spotifyApiBaseUrl: string;
  spotifyPilotAllowlist: string[];
  tokenEncryptionKeyB64: string;
  tokenEncryptionKeyVersion: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration — ${issues}`);
  }
  const raw = parsed.data;
  return {
    nodeEnv: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    appBaseUrl: raw.APP_BASE_URL,
    databaseUrl: raw.DATABASE_URL,
    webPort: raw.WEB_PORT,
    workerHealthPort: raw.WORKER_HEALTH_PORT,
    featureSpotifyExport: raw.FEATURE_SPOTIFY_EXPORT,
    featureMusicbrainzProvider: raw.FEATURE_MUSICBRAINZ_PROVIDER,
    featureListenbrainzProvider: raw.FEATURE_LISTENBRAINZ_PROVIDER,
    listenbrainzBaseUrl: raw.LISTENBRAINZ_BASE_URL,
    musicbrainzBaseUrl: raw.MUSICBRAINZ_BASE_URL,
    musicbrainzUserAgent: raw.MUSICBRAINZ_USER_AGENT,
    smtpHost: raw.SMTP_HOST,
    smtpPort: raw.SMTP_PORT,
    emailFrom: raw.EMAIL_FROM,
    spotifyClientId: raw.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: raw.SPOTIFY_CLIENT_SECRET,
    spotifyRedirectUri: raw.SPOTIFY_REDIRECT_URI,
    spotifyAccountsBaseUrl: raw.SPOTIFY_ACCOUNTS_BASE_URL,
    spotifyApiBaseUrl: raw.SPOTIFY_API_BASE_URL,
    spotifyPilotAllowlist: raw.SPOTIFY_PILOT_ALLOWLIST,
    tokenEncryptionKeyB64: raw.TOKEN_ENCRYPTION_KEY_B64,
    tokenEncryptionKeyVersion: raw.TOKEN_ENCRYPTION_KEY_VERSION,
  };
}

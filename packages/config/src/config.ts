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
  MUSICBRAINZ_BASE_URL: z.string().url().default("https://musicbrainz.org/ws/2"),
  MUSICBRAINZ_USER_AGENT: z.string().min(5).default("Resonance/0.1.0 (dev@resonance.local)"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  EMAIL_FROM: z.string().email().default("login@resonance.local"),
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
  musicbrainzBaseUrl: string;
  musicbrainzUserAgent: string;
  smtpHost: string;
  smtpPort: number;
  emailFrom: string;
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
    musicbrainzBaseUrl: raw.MUSICBRAINZ_BASE_URL,
    musicbrainzUserAgent: raw.MUSICBRAINZ_USER_AGENT,
    smtpHost: raw.SMTP_HOST,
    smtpPort: raw.SMTP_PORT,
    emailFrom: raw.EMAIL_FROM,
  };
}

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
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// connection string",
    }),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  FEATURE_SPOTIFY_EXPORT: booleanFlag,
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  databaseUrl: string;
  webPort: number;
  workerHealthPort: number;
  featureSpotifyExport: boolean;
  smtpHost: string;
  smtpPort: number;
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
    databaseUrl: raw.DATABASE_URL,
    webPort: raw.WEB_PORT,
    workerHealthPort: raw.WORKER_HEALTH_PORT,
    featureSpotifyExport: raw.FEATURE_SPOTIFY_EXPORT,
    smtpHost: raw.SMTP_HOST,
    smtpPort: raw.SMTP_PORT,
  };
}

import { pino } from "pino";
import type { Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

/**
 * Structured, redacted logging (CLAUDE.md: no secrets, tokens, personal
 * email, raw free text, or provider payloads in logs).
 *
 * Redaction is defense in depth — code must not put these values in log
 * arguments in the first place. Paths cover common accidental shapes.
 */
export const REDACTED_PATHS: readonly string[] = [
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "password",
  "*.password",
  "secret",
  "*.secret",
  "email",
  "*.email",
  "freeText",
  "*.freeText",
  "providerPayload",
  "*.providerPayload",
];

export interface CreateLoggerOptions {
  service: "web" | "worker" | "scripts";
  level?: string;
  base?: Record<string, unknown>;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    level: options.level ?? "info",
    redact: { paths: [...REDACTED_PATHS], censor: "[REDACTED]" },
    base: { service: options.service, ...options.base },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

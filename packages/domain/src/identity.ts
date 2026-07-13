import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * First-party passwordless identity primitives (ADR 0004, spec §16.2).
 * Pure functions only — persistence lives in @resonance/db repositories.
 */

export const AUTH_TOKEN_TTL_MINUTES = 15;
export const SESSION_TTL_HOURS = 24 * 7;
/** Sessions older than half their TTL are rotated on next use (spec §16.2). */
export const SESSION_ROTATION_FRACTION = 0.5;
/** Max login links per email per hour (rate limit, spec §16.2). */
export const LOGIN_REQUESTS_PER_HOUR = 5;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  // Deliberately simple: real validation is the delivered magic link.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export interface GeneratedToken {
  /** URL-safe secret handed to the user exactly once. Never stored or logged. */
  token: string;
  /** SHA-256 hex digest — the only thing persisted. */
  tokenHash: string;
}

export function generateToken(): GeneratedToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for token hashes. */
export function tokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function authTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + AUTH_TOKEN_TTL_MINUTES * 60_000);
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_HOURS * 3_600_000);
}

export function sessionNeedsRotation(createdAt: Date, expiresAt: Date, now: Date = new Date()): boolean {
  const lifetime = expiresAt.getTime() - createdAt.getTime();
  return now.getTime() - createdAt.getTime() > lifetime * SESSION_ROTATION_FRACTION;
}

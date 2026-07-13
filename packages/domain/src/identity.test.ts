import { describe, expect, it } from "vitest";

import {
  authTokenExpiry,
  generateToken,
  hashToken,
  isValidEmail,
  normalizeEmail,
  sessionNeedsRotation,
  tokenHashEquals,
} from "./identity.js";

describe("identity primitives", () => {
  it("normalizes emails case- and whitespace-insensitively", () => {
    expect(normalizeEmail("  Person@Example.COM ")).toBe("person@example.com");
  });

  it("validates plausible emails and rejects junk", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail(`${"x".repeat(255)}@example.com`)).toBe(false);
  });

  it("generates unique url-safe tokens whose hash matches hashToken", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashToken(a.token)).toBe(a.tokenHash);
    expect(tokenHashEquals(hashToken(a.token), a.tokenHash)).toBe(true);
    expect(tokenHashEquals(a.tokenHash, b.tokenHash)).toBe(false);
  });

  it("expires auth tokens in the future", () => {
    const now = new Date("2026-07-13T12:00:00Z");
    expect(authTokenExpiry(now).getTime()).toBeGreaterThan(now.getTime());
  });

  it("rotates sessions past half life only", () => {
    const createdAt = new Date("2026-07-01T00:00:00Z");
    const expiresAt = new Date("2026-07-11T00:00:00Z");
    expect(sessionNeedsRotation(createdAt, expiresAt, new Date("2026-07-02T00:00:00Z"))).toBe(false);
    expect(sessionNeedsRotation(createdAt, expiresAt, new Date("2026-07-09T00:00:00Z"))).toBe(true);
  });
});

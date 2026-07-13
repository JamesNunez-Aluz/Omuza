import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./security-headers";

function headerMap(dev: boolean): Map<string, string> {
  return new Map(buildSecurityHeaders({ dev }).map((h) => [h.key, h.value]));
}

describe("security headers", () => {
  it("sets CSP, frame, sniff, referrer, and permissions headers in all modes", () => {
    for (const dev of [true, false]) {
      const headers = headerMap(dev);
      expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
      expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(headers.get("X-Frame-Options")).toBe("DENY");
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headers.has("Permissions-Policy")).toBe(true);
    }
  });

  it("only allows unsafe-eval in development and only sends HSTS in production", () => {
    expect(headerMap(true).get("Content-Security-Policy")).toContain("'unsafe-eval'");
    expect(headerMap(false).get("Content-Security-Policy")).not.toContain("'unsafe-eval'");
    expect(headerMap(true).has("Strict-Transport-Security")).toBe(false);
    expect(headerMap(false).get("Strict-Transport-Security")).toContain("max-age=");
  });
});

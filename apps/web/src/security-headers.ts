/**
 * Security headers applied to every response (Milestone 0 deliverable).
 * Kept in a plain module so they are unit-testable without booting Next.
 *
 * CSP notes: Next.js requires 'unsafe-inline' for its bootstrap script and
 * inline styles until nonce-based CSP is wired (tracked in the threat model
 * as TM-4); dev mode additionally needs 'unsafe-eval' for react-refresh.
 */
export function buildSecurityHeaders(options: { dev: boolean }): { key: string; value: string }[] {
  const scriptSrc = options.dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  if (!options.dev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }

  return headers;
}

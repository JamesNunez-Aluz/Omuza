/**
 * CSRF defense for state-changing browser requests (spec §16.2): session
 * cookies are SameSite=Lax, and mutating API routes additionally require the
 * request's Origin (or Referer host, for older agents) to match the app's
 * own host. Requests with neither header are rejected.
 */
export function isSameOrigin(request: Request, appBaseUrl: string): boolean {
  const expectedHost = new URL(appBaseUrl).host;
  const requestHost = request.headers.get("host");

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      return originHost === expectedHost || (requestHost !== null && originHost === requestHost);
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      return refererHost === expectedHost || (requestHost !== null && refererHost === requestHost);
    } catch {
      return false;
    }
  }
  return false;
}

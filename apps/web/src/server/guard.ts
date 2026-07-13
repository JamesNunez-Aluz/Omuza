import { getServerContext } from "./context";
import type { ServerContext } from "./context";
import { isSameOrigin } from "./csrf";
import { badOrigin, unauthorized } from "./http";
import { resolveSession, withSessionCookie } from "./session";
import type { ResolvedSession } from "./session";

/**
 * Composable route guard: authentication (+ CSRF origin check for mutating
 * methods), then hands the handler a resolved user and the server context.
 * Rotated session cookies are attached to whatever response the handler
 * returns. All /api/v1 routes go through this except the auth endpoints.
 */
export async function withAuth(
  request: Request,
  handler: (session: ResolvedSession, ctx: ServerContext) => Promise<Response>,
): Promise<Response> {
  const ctx = getServerContext();

  if (request.method !== "GET" && request.method !== "HEAD") {
    if (!isSameOrigin(request, ctx.config.appBaseUrl)) {
      return badOrigin();
    }
  }

  const resolved = await resolveSession(request, ctx.db, ctx.config.nodeEnv === "production");
  if (!resolved) return unauthorized();

  const response = await handler(resolved, ctx);
  return withSessionCookie(response, resolved);
}

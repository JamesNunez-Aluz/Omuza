import { generateToken, hashToken, sessionExpiry } from "@resonance/domain";
import { consumeAuthToken, createSession, findOrCreateUser, recordAuditEvent } from "@resonance/db";
import { verifyLoginSchema } from "@resonance/validation";

import { getServerContext } from "@/server/context";
import { isSameOrigin } from "@/server/csrf";
import { apiError, badOrigin, isResponse, parseJsonBody } from "@/server/http";
import { sessionCookieHeader } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Passwordless login, step 2: redeem the emailed token (single-use, expiring)
 * for a session cookie. The magic-link page posts the token here so the
 * secret never leaks via Referer headers.
 */
export async function POST(request: Request): Promise<Response> {
  const ctx = getServerContext();
  if (!isSameOrigin(request, ctx.config.appBaseUrl)) return badOrigin();

  const body = await parseJsonBody(request, verifyLoginSchema);
  if (isResponse(body)) return body;

  const email = await consumeAuthToken(ctx.db, hashToken(body.token));
  if (!email) {
    return apiError({
      status: 400,
      code: "INVALID_LOGIN_TOKEN",
      message: "This sign-in link is invalid or has expired. Request a new one.",
    });
  }

  const user = await findOrCreateUser(ctx.db, email);
  if (user.status !== "active") {
    return apiError({
      status: 403,
      code: "ACCOUNT_UNAVAILABLE",
      message: "This account is not available.",
    });
  }

  const session = generateToken();
  const expiresAt = sessionExpiry();
  await createSession(ctx.db, { userId: user.id, tokenHash: session.tokenHash, expiresAt });
  await recordAuditEvent(ctx.db, { userId: user.id, action: "login", entityType: "session" });

  return Response.json(
    {
      user: {
        id: user.id,
        displayName: user.displayName,
        onboardingCompleted: user.onboardingCompletedAt !== null,
      },
    },
    {
      status: 200,
      headers: {
        "set-cookie": sessionCookieHeader(session.token, expiresAt, ctx.config.nodeEnv === "production"),
      },
    },
  );
}

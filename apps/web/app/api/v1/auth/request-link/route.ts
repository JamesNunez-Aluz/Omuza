import {
  LOGIN_REQUESTS_PER_HOUR,
  authTokenExpiry,
  generateToken,
  isValidEmail,
  normalizeEmail,
} from "@resonance/domain";
import { countRecentAuthTokens, createAuthToken } from "@resonance/db";
import { requestLoginLinkSchema } from "@resonance/validation";

import { getServerContext } from "@/server/context";
import { isSameOrigin } from "@/server/csrf";
import { apiError, badOrigin, isResponse, parseJsonBody } from "@/server/http";
import { getMailer } from "@/server/mailer";

export const dynamic = "force-dynamic";

/**
 * Passwordless login, step 1 (spec §16.2). Always answers 202 for a
 * well-formed email — account enumeration resistance — and rate-limits link
 * issuance per email address.
 */
export async function POST(request: Request): Promise<Response> {
  const ctx = getServerContext();
  if (!isSameOrigin(request, ctx.config.appBaseUrl)) return badOrigin();

  const body = await parseJsonBody(request, requestLoginLinkSchema);
  if (isResponse(body)) return body;

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    // Same generic response as success: reveal nothing about validity.
    return Response.json({ status: "sent" }, { status: 202 });
  }

  const oneHourAgo = new Date(Date.now() - 3_600_000);
  const recent = await countRecentAuthTokens(ctx.db, email, oneHourAgo);
  if (recent >= LOGIN_REQUESTS_PER_HOUR) {
    return apiError({
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many sign-in links requested. Try again later.",
      retryable: true,
      headers: { "retry-after": "3600" },
    });
  }

  const { token, tokenHash } = generateToken();
  await createAuthToken(ctx.db, { emailNormalized: email, tokenHash, expiresAt: authTokenExpiry() });

  const loginUrl = `${ctx.config.appBaseUrl}/auth/verify?token=${token}`;
  try {
    await getMailer(ctx.config).sendLoginLink(email, loginUrl);
  } catch {
    // Do not leak delivery problems to the caller; log without the address.
    ctx.logger.error({ event: "login_email_failed" }, "failed to send login email");
  }

  return Response.json({ status: "sent" }, { status: 202 });
}

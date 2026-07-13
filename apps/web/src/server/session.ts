import {
  generateToken,
  hashToken,
  sessionExpiry,
  sessionNeedsRotation,
} from "@resonance/domain";
import { findLiveSession, rotateSession, touchSession } from "@resonance/db";
import type { AuthenticatedSession, Database, UserRow } from "@resonance/db";

export const SESSION_COOKIE = "rz_session";

export function sessionCookieHeader(token: string, expiresAt: Date, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function readSessionToken(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      if (value) return value;
    }
  }
  return undefined;
}

export interface ResolvedSession {
  user: UserRow;
  sessionId: string;
  /** Present when the session was rotated: attach as Set-Cookie. */
  setCookie?: string;
}

/**
 * Resolve the request's session cookie to an active user. Sessions past half
 * their lifetime are transparently rotated (spec §16.2): the old session is
 * revoked and the caller must forward the returned Set-Cookie.
 */
export async function resolveSession(
  request: Request,
  db: Database,
  secureCookies: boolean,
): Promise<ResolvedSession | undefined> {
  const token = readSessionToken(request);
  if (!token) return undefined;

  const live: AuthenticatedSession | undefined = await findLiveSession(db, hashToken(token));
  if (!live) return undefined;

  if (sessionNeedsRotation(live.session.createdAt, live.session.expiresAt)) {
    const next = generateToken();
    const expiresAt = sessionExpiry();
    const rotated = await rotateSession(db, live.session.id, {
      userId: live.user.id,
      tokenHash: next.tokenHash,
      expiresAt,
    });
    return {
      user: live.user,
      sessionId: rotated.id,
      setCookie: sessionCookieHeader(next.token, expiresAt, secureCookies),
    };
  }

  await touchSession(db, live.session.id);
  return { user: live.user, sessionId: live.session.id };
}

/** Merge an optional rotated-session cookie into a response. */
export function withSessionCookie(response: Response, resolved: ResolvedSession): Response {
  if (resolved.setCookie) {
    response.headers.append("set-cookie", resolved.setCookie);
  }
  return response;
}

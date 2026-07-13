import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { authTokens, sessions, users } from "../schema.js";
import type { UserRow } from "./users.js";

export async function createAuthToken(
  db: Database,
  input: { emailNormalized: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await db.insert(authTokens).values(input);
}

/** Rate-limit input: login links issued for this email since `since`. */
export async function countRecentAuthTokens(
  db: Database,
  emailNormalized: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authTokens)
    .where(and(eq(authTokens.emailNormalized, emailNormalized), gte(authTokens.createdAt, since)));
  return rows[0]?.count ?? 0;
}

/**
 * Atomically consume a login token: single UPDATE guarded on unconsumed and
 * unexpired, so a token can never be redeemed twice.
 */
export async function consumeAuthToken(db: Database, tokenHash: string): Promise<string | undefined> {
  const rows = await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, tokenHash),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ emailNormalized: authTokens.emailNormalized });
  return rows[0]?.emailNormalized;
}

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function createSession(
  db: Database,
  input: { userId: string; tokenHash: string; expiresAt: Date; rotatedFrom?: string },
): Promise<SessionRow> {
  const rows = await db
    .insert(sessions)
    .values(input)
    .returning({
      id: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    });
  return rows[0]!;
}

export interface AuthenticatedSession {
  session: SessionRow;
  user: UserRow;
}

/** Resolve a presented session token hash to a live session + active user. */
export async function findLiveSession(
  db: Database,
  tokenHash: string,
): Promise<AuthenticatedSession | undefined> {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return {
    session: {
      id: row.session.id,
      userId: row.session.userId,
      createdAt: row.session.createdAt,
      expiresAt: row.session.expiresAt,
    },
    user: row.user,
  };
}

export async function touchSession(db: Database, sessionId: string): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
}

/** Rotate: revoke the old session and issue a replacement bound to it. */
export async function rotateSession(
  db: Database,
  oldSessionId: string,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, oldSessionId));
    const rows = await tx
      .insert(sessions)
      .values({ ...input, rotatedFrom: oldSessionId })
      .returning({
        id: sessions.id,
        userId: sessions.userId,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
      });
    return rows[0]!;
  });
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(db: Database, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

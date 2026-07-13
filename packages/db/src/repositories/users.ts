import { eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { users } from "../schema.js";

export type UserRow = typeof users.$inferSelect;

export async function findUserByEmail(db: Database, emailNormalized: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.emailNormalized, emailNormalized)).limit(1);
  return rows[0];
}

export async function findUserById(db: Database, id: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

/** Find-or-create on first successful login (passwordless: the email is the proof). */
export async function findOrCreateUser(db: Database, emailNormalized: string): Promise<UserRow> {
  const existing = await findUserByEmail(db, emailNormalized);
  if (existing) return existing;
  const inserted = await db
    .insert(users)
    .values({ emailNormalized })
    .onConflictDoNothing({ target: users.emailNormalized })
    .returning();
  return inserted[0] ?? (await findUserByEmail(db, emailNormalized))!;
}

export interface UserProfilePatch {
  displayName?: string | null;
  locale?: string;
  timeZone?: string;
}

export async function updateUserProfile(
  db: Database,
  userId: string,
  patch: UserProfilePatch,
): Promise<UserRow | undefined> {
  const rows = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return rows[0];
}

export async function markOnboardingComplete(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function setUserStatus(
  db: Database,
  userId: string,
  status: "active" | "suspended" | "deletion_pending" | "deleted",
): Promise<void> {
  await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
}

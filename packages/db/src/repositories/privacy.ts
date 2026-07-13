import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  auditEvents,
  authTokens,
  contextProfiles,
  preferenceEvidence,
  privacyRequests,
  sessions,
  userPreferences,
  userSeedItems,
  users,
} from "../schema.js";
import { listConsentRecords } from "./consents.js";
import { listContextProfiles } from "./contexts.js";
import { listPreferences } from "./preferences.js";
import { listActiveSeeds } from "./seeds.js";

export interface PrivacyRequestRow {
  id: string;
  userId: string;
  kind: string;
  status: string;
  requestedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
}

const requestColumns = {
  id: privacyRequests.id,
  userId: privacyRequests.userId,
  kind: privacyRequests.kind,
  status: privacyRequests.status,
  requestedAt: privacyRequests.requestedAt,
  completedAt: privacyRequests.completedAt,
  failureReason: privacyRequests.failureReason,
};

export async function createPrivacyRequest(
  db: Database,
  userId: string,
  kind: "export" | "delete",
): Promise<PrivacyRequestRow> {
  const rows = await db.insert(privacyRequests).values({ userId, kind }).returning(requestColumns);
  return rows[0]!;
}

export async function getPrivacyRequest(
  db: Database,
  userId: string,
  requestId: string,
): Promise<(PrivacyRequestRow & { payload: unknown }) | undefined> {
  const rows = await db
    .select({ ...requestColumns, payload: privacyRequests.payload })
    .from(privacyRequests)
    .where(and(eq(privacyRequests.id, requestId), eq(privacyRequests.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function listPrivacyRequests(db: Database, userId: string): Promise<PrivacyRequestRow[]> {
  return db
    .select(requestColumns)
    .from(privacyRequests)
    .where(eq(privacyRequests.userId, userId))
    .orderBy(desc(privacyRequests.requestedAt));
}

export async function markPrivacyRequest(
  db: Database,
  requestId: string,
  patch: {
    status: "processing" | "completed" | "failed";
    payload?: unknown;
    failureReason?: string;
  },
): Promise<void> {
  await db
    .update(privacyRequests)
    .set({
      status: patch.status,
      payload: patch.payload ?? null,
      failureReason: patch.failureReason ?? null,
      completedAt: patch.status === "completed" || patch.status === "failed" ? new Date() : null,
    })
    .where(eq(privacyRequests.id, requestId));
}

/** Assemble the user's data export (first-party data only, no secrets). */
export async function buildUserExport(db: Database, userId: string): Promise<Record<string, unknown>> {
  const userRows = await db
    .select({
      email: users.emailNormalized,
      displayName: users.displayName,
      locale: users.locale,
      timeZone: users.timeZone,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  return {
    exportVersion: 1,
    generatedFor: userRows[0] ?? null,
    consents: await listConsentRecords(db, userId),
    seeds: await listActiveSeeds(db, userId),
    contexts: await listContextProfiles(db, userId),
    preferences: await listPreferences(db, userId),
  };
}

/**
 * Account deletion: remove personal taste/identity data, anonymize the user
 * row. Consent history and audit events are retained in anonymized form as
 * legal records (documented in the data dictionary).
 */
export async function performAccountDeletion(db: Database, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const emailRows = await tx
      .select({ email: users.emailNormalized })
      .from(users)
      .where(eq(users.id, userId));
    const email = emailRows[0]?.email;

    await tx
      .delete(preferenceEvidence)
      .where(
        inArray(
          preferenceEvidence.userPreferenceId,
          tx
            .select({ id: userPreferences.id })
            .from(userPreferences)
            .where(eq(userPreferences.userId, userId)),
        ),
      );
    await tx.delete(userPreferences).where(eq(userPreferences.userId, userId));
    await tx.delete(userSeedItems).where(eq(userSeedItems.userId, userId));
    await tx.delete(contextProfiles).where(eq(contextProfiles.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    if (email) {
      await tx.delete(authTokens).where(eq(authTokens.emailNormalized, email));
    }
    await tx
      .update(users)
      .set({
        emailNormalized: `deleted:${userId}`,
        displayName: null,
        status: "deleted",
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await tx.insert(auditEvents).values({
      userId,
      action: "account_deleted",
      entityType: "user",
      entityId: userId,
    });
  });
}

export async function recordAuditEvent(
  db: Database,
  input: { userId?: string; action: string; entityType?: string; entityId?: string },
): Promise<void> {
  await db.insert(auditEvents).values({
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
  });
}

import { and, eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { preferenceEvidence, userPreferences } from "../schema.js";

export interface DerivedPreferenceInput {
  contextId: string | null;
  namespace: string;
  key: string;
  preferenceValue: number;
  confidence: number;
  origin: "explicit" | "first_party_feedback" | "derived";
  modelVersion: string;
  evidence: { eventType: string; sourceEntityId: string | null; weight: number }[];
}

/**
 * Recompute-and-replace for one origin/namespace slice. Only the derived
 * slice is replaced — inferred/feedback preferences are untouched, so
 * explicit and inferred values never mix irreversibly (spec §9.4).
 */
export async function replaceDerivedPreferences(
  db: Database,
  userId: string,
  origin: string,
  namespace: string,
  derived: DerivedPreferenceInput[],
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx
      .delete(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, userId),
          eq(userPreferences.origin, origin),
          eq(userPreferences.namespace, namespace),
        ),
      );
    let count = 0;
    for (const pref of derived) {
      const rows = await tx
        .insert(userPreferences)
        .values({
          userId,
          contextId: pref.contextId,
          namespace: pref.namespace,
          key: pref.key,
          preferenceValue: pref.preferenceValue.toFixed(3),
          confidence: pref.confidence.toFixed(3),
          evidenceCount: pref.evidence.length,
          origin: pref.origin,
          modelVersion: pref.modelVersion,
        })
        .returning({ id: userPreferences.id });
      const prefId = rows[0]!.id;
      if (pref.evidence.length > 0) {
        await tx.insert(preferenceEvidence).values(
          pref.evidence.map((entry) => ({
            userPreferenceId: prefId,
            eventType: entry.eventType,
            sourceEntityId: entry.sourceEntityId,
            weight: entry.weight.toFixed(3),
          })),
        );
      }
      count += 1;
    }
    return count;
  });
}

export interface PreferenceRow {
  id: string;
  contextId: string | null;
  namespace: string;
  key: string;
  preferenceValue: string;
  confidence: string;
  evidenceCount: number;
  origin: string;
  modelVersion: string;
}

export async function listPreferences(db: Database, userId: string): Promise<PreferenceRow[]> {
  return db
    .select({
      id: userPreferences.id,
      contextId: userPreferences.contextId,
      namespace: userPreferences.namespace,
      key: userPreferences.key,
      preferenceValue: userPreferences.preferenceValue,
      confidence: userPreferences.confidence,
      evidenceCount: userPreferences.evidenceCount,
      origin: userPreferences.origin,
      modelVersion: userPreferences.modelVersion,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .orderBy(userPreferences.namespace, userPreferences.key);
}

import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  exposures,
  feedbackEvents,
  knownRecordings,
  recordingFeatures,
  recordings,
} from "../schema.js";

export type FeedbackEventRow = typeof feedbackEvents.$inferSelect;

export async function findFeedbackByClientEventId(
  db: Database,
  userId: string,
  clientEventId: string,
): Promise<FeedbackEventRow | undefined> {
  const rows = await db
    .select()
    .from(feedbackEvents)
    .where(and(eq(feedbackEvents.userId, userId), eq(feedbackEvents.clientEventId, clientEventId)))
    .limit(1);
  return rows[0];
}

export async function findOwnFeedbackEvent(
  db: Database,
  userId: string,
  eventId: string,
): Promise<FeedbackEventRow | undefined> {
  const rows = await db
    .select()
    .from(feedbackEvents)
    .where(and(eq(feedbackEvents.id, eventId), eq(feedbackEvents.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function appendFeedbackEvent(
  db: Database,
  input: {
    userId: string;
    recordingId: string;
    exposureId: string | null;
    recommendationRunId: string | null;
    primaryResponse: string;
    reasonCodes: string[];
    newnessResponse: string | null;
    contextId: string | null;
    supersedesEventId: string | null;
    clientEventId: string;
  },
): Promise<FeedbackEventRow> {
  const rows = await db.insert(feedbackEvents).values(input).returning();
  return rows[0]!;
}

/** Verify the recommendation item was actually exposed to this user (spec §13.8). */
export async function findUserExposureForItem(
  db: Database,
  userId: string,
  recommendationItemId: string,
): Promise<{ exposureId: string; recordingId: string; runId: string | null } | undefined> {
  const rows = await db
    .select({
      exposureId: exposures.id,
      recordingId: exposures.recordingId,
      runId: exposures.recommendationRunId,
    })
    .from(exposures)
    .where(
      and(eq(exposures.userId, userId), eq(exposures.recommendationItemId, recommendationItemId)),
    )
    .limit(1);
  return rows[0];
}

export async function listUserFeedbackEvents(db: Database, userId: string): Promise<FeedbackEventRow[]> {
  return db.select().from(feedbackEvents).where(eq(feedbackEvents.userId, userId));
}

export async function listRunFeedback(
  db: Database,
  userId: string,
  runId: string,
): Promise<FeedbackEventRow[]> {
  return db
    .select()
    .from(feedbackEvents)
    .where(and(eq(feedbackEvents.userId, userId), eq(feedbackEvents.recommendationRunId, runId)));
}

/** Upsert the user's knowledge state for a recording (spec §9.5). */
export async function upsertKnownRecording(
  db: Database,
  input: {
    userId: string;
    recordingId: string;
    knowledgeState: "confirmed_known" | "confirmed_new";
    confidence: number;
    source: string;
  },
): Promise<void> {
  await db
    .insert(knownRecordings)
    .values({ ...input, lastConfirmedAt: new Date() })
    .onConflictDoUpdate({
      target: [knownRecordings.userId, knownRecordings.recordingId],
      set: {
        knowledgeState: input.knowledgeState,
        confidence: input.confidence,
        source: input.source,
        lastConfirmedAt: new Date(),
      },
    });
}

/**
 * Load the user's raw feedback events enriched with each recording's primary
 * artist and eligible features — the input to the pure derivation.
 */
export interface EnrichedFeedbackEvent {
  id: string;
  recordingId: string;
  primaryArtistId: string | null;
  primaryResponse: string;
  reasonCodes: string[];
  contextId: string | null;
  occurredAt: string;
  supersedesEventId: string | null;
  recordingFeatures: { key: string; value: number }[];
}

export async function loadEnrichedFeedbackEvents(
  db: Database,
  userId: string,
): Promise<EnrichedFeedbackEvent[]> {
  const events = await listUserFeedbackEvents(db, userId);
  if (events.length === 0) return [];

  const recordingIds = [...new Set(events.map((event) => event.recordingId))];
  const recordingRows = await db
    .select({ id: recordings.id, primaryArtistId: recordings.primaryArtistId })
    .from(recordings)
    .where(inArray(recordings.id, recordingIds));
  const featureRows = await db
    .select({
      recordingId: recordingFeatures.recordingId,
      feature: recordingFeatures.feature,
      value: recordingFeatures.value,
      recommendationEligible: recordingFeatures.recommendationEligible,
    })
    .from(recordingFeatures)
    .where(inArray(recordingFeatures.recordingId, recordingIds));

  const artistByRecording = new Map(recordingRows.map((row) => [row.id, row.primaryArtistId]));
  const featuresByRecording = new Map<string, { key: string; value: number }[]>();
  for (const row of featureRows) {
    if (!row.recommendationEligible) continue;
    const list = featuresByRecording.get(row.recordingId) ?? [];
    list.push({ key: row.feature, value: row.value });
    featuresByRecording.set(row.recordingId, list);
  }

  return events.map((event) => ({
    id: event.id,
    recordingId: event.recordingId,
    primaryArtistId: artistByRecording.get(event.recordingId) ?? null,
    primaryResponse: event.primaryResponse,
    reasonCodes: event.reasonCodes,
    contextId: event.contextId,
    occurredAt: event.occurredAt.toISOString(),
    supersedesEventId: event.supersedesEventId,
    recordingFeatures: featuresByRecording.get(event.recordingId) ?? [],
  }));
}

import { z } from "zod";

import type { Database } from "../client.js";
import { analyticsEvents } from "../schema.js";

/**
 * Analytics events (spec §14.6, §15.1): semantic names with strictly-typed,
 * minimal properties. Free text, emails, tokens, and provider payloads are
 * structurally impossible — every event's properties must match its schema
 * exactly (unknown keys rejected), and the schemas contain no free-string
 * fields beyond controlled enums/ids/counters.
 */

const id = z.string().uuid();
const count = z.number().int().min(0).max(10000);

export const ANALYTICS_EVENT_SCHEMAS = {
  onboarding_started: z.object({}).strict(),
  onboarding_completed: z.object({ positives: count, negatives: count }).strict(),
  seed_added: z.object({ entityType: z.enum(["artist", "recording"]), sentiment: z.string().max(20) }).strict(),
  recommendation_run_requested: z.object({ discoveryLevel: z.number().int().min(0).max(100) }).strict(),
  recommendation_run_completed: z
    .object({ runId: id, status: z.enum(["completed", "degraded", "failed"]), itemCount: count })
    .strict(),
  feedback_submitted: z
    .object({
      runId: id.nullable(),
      primaryResponse: z.enum(["love", "like", "neutral", "dislike", "not_now", "already_knew"]),
      reasonCount: count,
      newnessAnswered: z.boolean(),
    })
    .strict(),
  playlist_saved: z.object({ playlistId: id, itemCount: count }).strict(),
  playlist_rebuilt: z.object({ playlistId: id, keptCount: count, addedCount: count }).strict(),
  file_export_completed: z.object({ playlistId: id, format: z.enum(["csv", "m3u"]), itemCount: count }).strict(),
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENT_SCHEMAS;

export async function recordAnalyticsEvent<N extends AnalyticsEventName>(
  db: Database,
  userId: string | null,
  eventName: N,
  properties: z.input<(typeof ANALYTICS_EVENT_SCHEMAS)[N]>,
): Promise<void> {
  const parsed = ANALYTICS_EVENT_SCHEMAS[eventName].parse(properties);
  await db.insert(analyticsEvents).values({ userId, eventName, properties: parsed });
}

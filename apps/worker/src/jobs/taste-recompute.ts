import { listActiveSeeds, loadEnrichedFeedbackEvents, replaceDerivedPreferences } from "@resonance/db";
import type { Database } from "@resonance/db";
import {
  FEEDBACK_DERIVATION_VERSION,
  SEED_DERIVATION_VERSION,
  deriveExplicitPreferences,
  deriveFeedbackPreferences,
  effectiveFeedbackEvents,
} from "@resonance/domain";
import type {
  ActiveSeed,
  PrimaryResponse,
  RawFeedbackEvent,
  SeedEntityType,
  SeedSentiment,
} from "@resonance/domain";
import type { Logger } from "@resonance/observability";

/**
 * Recompute the user's derived preference slices — explicit (seeds) and
 * first-party feedback — from append-only evidence. Idempotent: both
 * derivations are pure functions, so retries converge on the same state.
 */
export async function recomputeTasteProfile(
  db: Database,
  logger: Logger,
  userId: string,
): Promise<number> {
  const seeds = await listActiveSeeds(db, userId);
  const active: ActiveSeed[] = seeds.map((seed) => ({
    id: seed.id,
    entityType: seed.entityType as SeedEntityType,
    entityId: (seed.artistId ?? seed.recordingId)!,
    sentiment: seed.sentiment as SeedSentiment,
    strength: Number(seed.strength),
    contextId: seed.contextId,
  }));

  const derived = deriveExplicitPreferences(active);
  const written = await replaceDerivedPreferences(
    db,
    userId,
    "explicit",
    "seed_entity",
    derived.map((pref) => ({
      contextId: pref.contextId,
      namespace: pref.namespace,
      key: pref.key,
      preferenceValue: pref.preferenceValue,
      confidence: pref.confidence,
      origin: pref.origin,
      modelVersion: pref.modelVersion,
      evidence: pref.evidence.map((entry) => ({
        eventType: entry.eventType,
        sourceEntityId: entry.sourceEntityId,
        weight: entry.weight,
      })),
    })),
  );

  // Feedback slice: recompute entity + feature facts from effective events.
  const rawEvents = (await loadEnrichedFeedbackEvents(db, userId)).map((event) => ({
    ...event,
    primaryResponse: event.primaryResponse as PrimaryResponse,
  })) as RawFeedbackEvent[];
  const facts = deriveFeedbackPreferences(effectiveFeedbackEvents(rawEvents));
  let feedbackWritten = 0;
  for (const namespace of ["feedback_entity", "feedback_feature"] as const) {
    feedbackWritten += await replaceDerivedPreferences(
      db,
      userId,
      "first_party_feedback",
      namespace,
      facts
        .filter((fact) => fact.namespace === namespace)
        .map((fact) => ({
          contextId: fact.contextId,
          namespace: fact.namespace,
          key: fact.key,
          preferenceValue: fact.preferenceValue,
          confidence: fact.confidence,
          origin: fact.origin,
          modelVersion: fact.modelVersion,
          evidence: fact.evidence.map((entry) => ({
            eventType: entry.eventType,
            sourceEntityId: entry.sourceEntityId,
            weight: entry.weight,
          })),
        })),
    );
  }

  logger.info(
    {
      userId,
      seeds: active.length,
      preferences: written,
      feedbackFacts: feedbackWritten,
      modelVersions: [SEED_DERIVATION_VERSION, FEEDBACK_DERIVATION_VERSION],
    },
    "taste profile recomputed",
  );
  return written + feedbackWritten;
}

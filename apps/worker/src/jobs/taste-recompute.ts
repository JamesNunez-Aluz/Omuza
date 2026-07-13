import { listActiveSeeds, replaceDerivedPreferences } from "@resonance/db";
import type { Database } from "@resonance/db";
import { SEED_DERIVATION_VERSION, deriveExplicitPreferences } from "@resonance/domain";
import type { ActiveSeed, SeedEntityType, SeedSentiment } from "@resonance/domain";
import type { Logger } from "@resonance/observability";

/**
 * Recompute the explicit seed-derived preference slice for a user.
 * Idempotent: derivation is a pure function of the active seeds, so retries
 * and duplicate jobs converge on the same state.
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

  logger.info(
    { userId, seeds: active.length, preferences: written, modelVersion: SEED_DERIVATION_VERSION },
    "taste profile recomputed",
  );
  return written;
}

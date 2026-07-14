import { isRecommendationEligible } from "@resonance/domain";
import type { FeatureRow } from "@resonance/domain";

import type { CatalogSnapshot, ProfileSeed, SnapshotRecording } from "./types.js";

/**
 * Taste posterior from explicit evidence (spec §10.6). Seeds contribute
 * weighted positive/negative mass to every eligible feature of the seeded
 * entity's recordings; the posterior yields signed affinity and confidence.
 * Unknown features carry NO evidence — they are absent, not negative.
 */

const PRIOR_POSITIVE = 1;
const PRIOR_NEGATIVE = 1;
const EVIDENCE_SCALE = 2;

const SENTIMENT_MASS: Record<ProfileSeed["sentiment"], { positive: number; negative: number }> = {
  strong_positive: { positive: 3, negative: 0 },
  positive: { positive: 1.5, negative: 0 },
  negative: { positive: 0, negative: 2.5 },
  hard_block: { positive: 0, negative: 6 },
  fatigue: { positive: 0, negative: 1 },
};

export interface FeatureAffinity {
  affinity: number; // -1..1
  confidence: number; // 0..1
  positiveMass: number;
  negativeMass: number;
}

export interface ArtistAffinity {
  affinity: number;
  confidence: number;
  seedIds: string[];
}

export interface TastePosterior {
  features: Map<string, FeatureAffinity>;
  artists: Map<string, ArtistAffinity>;
  seedArtistIds: Set<string>;
  seedRecordingIds: Set<string>;
  hardBlockedArtistIds: Set<string>;
  hardBlockedRecordingIds: Set<string>;
  fatiguedArtistIds: Set<string>;
}

function eligibleFeatureKeys(recording: SnapshotRecording): { key: string; value: number }[] {
  return recording.features
    .filter((feature) =>
      isRecommendationEligible({
        canonicalRecordingId: recording.id,
        feature: feature.feature,
        value: feature.value,
        provenance: {
          provider: feature.provenanceProvider as FeatureRow["provenance"]["provider"],
          dataset: "snapshot",
          licensePolicyId: feature.licensePolicyId,
          ingestedAt: "1970-01-01T00:00:00.000Z",
        },
        trainingEligible: false,
        recommendationEligible: feature.recommendationEligible,
      }),
    )
    .map((feature) => ({ key: feature.feature, value: feature.value }));
}

export function computeTastePosterior(
  snapshot: CatalogSnapshot,
  seeds: readonly ProfileSeed[],
): TastePosterior {
  const byArtist = new Map<string, SnapshotRecording[]>();
  const byId = new Map<string, SnapshotRecording>();
  for (const recording of snapshot.recordings) {
    byId.set(recording.id, recording);
    const list = byArtist.get(recording.primaryArtistId) ?? [];
    list.push(recording);
    byArtist.set(recording.primaryArtistId, list);
  }

  const featureMass = new Map<string, { positive: number; negative: number }>();
  const artistMass = new Map<string, { positive: number; negative: number; seedIds: string[] }>();
  const posterior: TastePosterior = {
    features: new Map(),
    artists: new Map(),
    seedArtistIds: new Set(),
    seedRecordingIds: new Set(),
    hardBlockedArtistIds: new Set(),
    hardBlockedRecordingIds: new Set(),
    fatiguedArtistIds: new Set(),
  };

  for (const seed of seeds) {
    const mass = SENTIMENT_MASS[seed.sentiment];
    const weight = seed.strength;

    const seedRecordings: SnapshotRecording[] = [];
    let artistId: string | undefined;
    if (seed.entityType === "artist") {
      artistId = seed.entityId;
      seedRecordings.push(...(byArtist.get(seed.entityId) ?? []));
    } else {
      const recording = byId.get(seed.entityId);
      if (recording) {
        artistId = recording.primaryArtistId;
        seedRecordings.push(recording);
        posterior.seedRecordingIds.add(recording.id);
      }
      if (seed.sentiment === "hard_block") posterior.hardBlockedRecordingIds.add(seed.entityId);
    }

    if (artistId) {
      if (seed.sentiment === "hard_block" && seed.entityType === "artist") {
        posterior.hardBlockedArtistIds.add(artistId);
      }
      if (seed.sentiment === "fatigue") posterior.fatiguedArtistIds.add(artistId);
      if (seed.sentiment === "strong_positive" || seed.sentiment === "positive") {
        posterior.seedArtistIds.add(artistId);
      }
      const artistEntry = artistMass.get(artistId) ?? { positive: 0, negative: 0, seedIds: [] };
      artistEntry.positive += mass.positive * weight;
      artistEntry.negative += mass.negative * weight;
      artistEntry.seedIds.push(seed.id);
      artistMass.set(artistId, artistEntry);
    }

    // Feature evidence: spread the seed's mass over the seeded recordings'
    // eligible features, scaled by feature value. Cap per-seed contribution
    // so one declaration cannot dominate (spec §10.7).
    const perRecordingScale = seedRecordings.length > 0 ? 1 / seedRecordings.length : 0;
    for (const recording of seedRecordings) {
      for (const { key, value } of eligibleFeatureKeys(recording)) {
        const entry = featureMass.get(key) ?? { positive: 0, negative: 0 };
        entry.positive += Math.min(mass.positive * weight * value * perRecordingScale, 3);
        entry.negative += Math.min(mass.negative * weight * value * perRecordingScale, 3);
        featureMass.set(key, entry);
      }
    }
  }

  for (const [key, mass] of featureMass) {
    const pLike =
      (mass.positive + PRIOR_POSITIVE) /
      (mass.positive + mass.negative + PRIOR_POSITIVE + PRIOR_NEGATIVE);
    posterior.features.set(key, {
      affinity: 2 * pLike - 1,
      confidence: 1 - Math.exp(-(mass.positive + mass.negative) / EVIDENCE_SCALE),
      positiveMass: mass.positive,
      negativeMass: mass.negative,
    });
  }

  for (const [artistId, mass] of artistMass) {
    const pLike =
      (mass.positive + PRIOR_POSITIVE) /
      (mass.positive + mass.negative + PRIOR_POSITIVE + PRIOR_NEGATIVE);
    posterior.artists.set(artistId, {
      affinity: 2 * pLike - 1,
      confidence: 1 - Math.exp(-(mass.positive + mass.negative) / EVIDENCE_SCALE),
      seedIds: mass.seedIds,
    });
  }

  return posterior;
}

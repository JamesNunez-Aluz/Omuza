import { estimateNovelty } from "./novelty.js";
import { humanizeFeature } from "./providers.js";
import type { TastePosterior } from "./taste-posterior.js";
import type {
  Candidate,
  EngineRequest,
  EvidenceRecord,
  ScoredCandidate,
  SnapshotRecording,
  UserHistory,
} from "./types.js";

/**
 * Fit / serendipity / final scoring (spec §10.10–§10.12), implemented exactly
 * as specified with discovery-dependent weights that sum to 1. Missing
 * metadata lowers confidence and the uncertainty term — it never contributes
 * negative fit ("unknown is not disliked").
 */

const EXPECTED_FEATURE_COVERAGE = 3;

export function scoreCandidate(
  entry: { candidate: Candidate; recording: SnapshotRecording },
  posterior: TastePosterior,
  history: UserHistory,
  request: EngineRequest,
): ScoredCandidate {
  const { candidate, recording } = entry;
  const D = request.discoveryLevel / 100;
  const fitEvidence: EvidenceRecord[] = [...candidate.sourceEvidence];

  // --- Fit (spec §10.10) ---------------------------------------------------
  let contributionSum = 0;
  let importanceSum = 0;
  for (const feature of recording.features) {
    if (!feature.recommendationEligible) continue;
    const affinity = posterior.features.get(feature.feature);
    if (!affinity) continue; // unknown to the profile: no evidence, no penalty
    const sourceConfidence = 1; // first-party snapshot features
    const contribution = feature.value * affinity.affinity * affinity.confidence * sourceConfidence;
    // Explicit aversions penalize harder (spec: stronger negative penalties).
    contributionSum += contribution < 0 ? contribution * 1.5 : contribution;
    importanceSum += Math.abs(affinity.confidence);
    if (contribution > 0.15) {
      fitEvidence.push({
        type: "feature_match",
        label: `Matches ${humanizeFeature(feature.feature)} you like`,
        refId: feature.feature,
      });
    }
  }

  const artistAffinity = posterior.artists.get(recording.primaryArtistId);
  // Separate first-party artist term; seed-artist weight decays with discovery.
  const artistTerm = artistAffinity
    ? artistAffinity.affinity * artistAffinity.confidence * (artistAffinity.affinity > 0 ? 1 - 0.5 * D : 1)
    : 0;

  // Recording-level first-party feedback affinity (M3+).
  const recordingAffinity = posterior.recordings.get(recording.id);
  const recordingTerm = recordingAffinity ? recordingAffinity.affinity * recordingAffinity.confidence : 0;
  if (recordingAffinity && recordingTerm > 0.2) {
    fitEvidence.push({
      type: "explicit_preference",
      label: "You responded positively to this recording before",
      refId: `recording:${recording.id}`,
    });
  }

  const rawFeatureFit = importanceSum > 0 ? contributionSum / importanceSum : 0;
  const rawFit = 0.55 * rawFeatureFit + 0.3 * artistTerm + 0.15 * recordingTerm;
  const fitScore = clamp((rawFit + 1) / 2, 0, 1);

  const metadataConfidence = Math.min(recording.features.length / EXPECTED_FEATURE_COVERAGE, 1);

  // --- Novelty (spec §10.9) --------------------------------------------------
  const novelty = estimateNovelty(recording, posterior, history);

  // --- Serendipity (spec §10.11): surprising but connected -------------------
  let bridgeStrength = 0;
  for (const feature of recording.features) {
    const affinity = posterior.features.get(feature.feature);
    if (affinity && affinity.affinity > 0.2) {
      bridgeStrength = Math.max(bridgeStrength, affinity.affinity * feature.value);
    }
  }
  const artistFamiliarity = posterior.seedArtistIds.has(recording.primaryArtistId)
    ? 1
    : artistAffinity
      ? Math.abs(artistAffinity.affinity) * artistAffinity.confidence
      : 0;
  const serendipityScore = clamp(bridgeStrength * (1 - artistFamiliarity) * metadataConfidence, 0, 1);

  // --- Quality/freshness (spec §10.12; popularity alone is not quality) ------
  const qualityScore = clamp(0.5 * metadataConfidence + 0.5 * Math.min(candidate.providerScore, 1), 0, 1);
  const freshnessScore = 0.5; // no approved freshness source in v0: neutral

  // --- Penalties --------------------------------------------------------------
  const fatiguePenalty = posterior.fatiguedArtistIds.has(recording.primaryArtistId) ? 1 : 0;
  const artistAversion =
    artistAffinity && artistAffinity.affinity < 0
      ? Math.abs(artistAffinity.affinity) * artistAffinity.confidence
      : 0;
  const recordingAversion = recordingTerm < 0 ? Math.abs(recordingTerm) : 0;
  const aversionRisk = Math.min(Math.max(artistAversion, recordingAversion), 1);
  const metadataUncertainty = 1 - metadataConfidence;

  // --- Final score (spec §10.12) ----------------------------------------------
  const wFit = 0.7 - 0.3 * D;
  const wNovelty = 0.1 + 0.15 * D;
  const wSerendipity = 0.05 + 0.15 * D;
  const wQuality = 0.1;
  const wFreshness = 0.05;

  const positiveScore =
    wFit * fitScore +
    wNovelty * novelty.probability +
    wSerendipity * serendipityScore +
    wQuality * qualityScore +
    wFreshness * freshnessScore;

  const finalScore =
    positiveScore -
    0.35 * novelty.knownProbability -
    0.25 * fatiguePenalty -
    0.2 * aversionRisk -
    0.15 * metadataUncertainty;

  return {
    ...candidate,
    fitScore,
    noveltyProbability: round4(novelty.probability),
    noveltyState: novelty.state,
    noveltyConfidence: round4(novelty.confidence),
    serendipityScore: round4(serendipityScore),
    qualityScore: round4(qualityScore),
    freshnessScore,
    knownProbability: round4(novelty.knownProbability),
    fatiguePenalty,
    aversionRisk: round4(aversionRisk),
    metadataUncertainty: round4(metadataUncertainty),
    finalScore: round4(finalScore),
    fitEvidence,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

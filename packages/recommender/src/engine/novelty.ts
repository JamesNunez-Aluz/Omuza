import type { TastePosterior } from "./taste-posterior.js";
import type { SnapshotRecording, UserHistory } from "./types.js";

/**
 * Novelty estimation (spec §10.9). Components that are unavailable in v0
 * (exposure bands, provider novelty confidence, independent ledgers) are
 * dropped and the remaining weights renormalized, with overall confidence
 * reduced accordingly — honesty over precision. `confirmed_new` is never
 * produced here; only an explicit user answer can set it.
 */

export interface NoveltyEstimate {
  probability: number;
  state: "high_confidence_new" | "probably_new" | "unknown" | "known";
  confidence: number;
  knownProbability: number;
  evidenceLabels: string[];
}

const WEIGHTS = {
  noPriorRecordingEvidence: 0.35,
  noPriorArtistEvidence: 0.2,
  notInSeedNeighborhood: 0.15,
  // low_exposure_band (0.15) and provider_novelty_confidence (0.15) are
  // unavailable in v0 — renormalized away, reducing max confidence.
};

export function estimateNovelty(
  recording: SnapshotRecording,
  posterior: TastePosterior,
  history: UserHistory,
): NoveltyEstimate {
  const known = history.knownRecordings.find((entry) => entry.recordingId === recording.id);
  if (known && (known.knowledgeState === "confirmed_known" || known.knowledgeState === "ledger_known")) {
    return {
      probability: 0,
      state: "known",
      confidence: known.confidence,
      knownProbability: known.confidence,
      evidenceLabels: ["You told us you already know this"],
    };
  }

  const exposed = new Set(history.exposedRecordingIds);
  const evidenceLabels: string[] = [];

  const priorRecordingEvidence =
    exposed.has(recording.id) || posterior.seedRecordingIds.has(recording.id);
  const inSeedNeighborhood = posterior.seedArtistIds.has(recording.primaryArtistId);

  // Artist evidence is graded, not binary: a seeded artist is fully familiar,
  // while one feedback event on one recording implies only partial knowledge
  // of the artist's catalog (honesty over precision, ADR 0010).
  const artistAffinity = posterior.artists.get(recording.primaryArtistId);
  const artistFamiliarity = inSeedNeighborhood
    ? 1
    : artistAffinity
      ? Math.min(Math.abs(artistAffinity.affinity) * artistAffinity.confidence * 2, 1)
      : 0;

  const availableWeight =
    WEIGHTS.noPriorRecordingEvidence + WEIGHTS.noPriorArtistEvidence + WEIGHTS.notInSeedNeighborhood;

  const rawScore =
    WEIGHTS.noPriorRecordingEvidence * (priorRecordingEvidence ? 0 : 1) +
    WEIGHTS.noPriorArtistEvidence * (1 - artistFamiliarity) +
    WEIGHTS.notInSeedNeighborhood * (inSeedNeighborhood ? 0 : 1);
  const priorArtistEvidence = artistFamiliarity > 0.5;

  const probability = rawScore / availableWeight;
  // Confidence is capped by component availability (0.70 of the full model).
  const confidence = availableWeight * 0.9;

  if (!priorRecordingEvidence && !priorArtistEvidence) {
    evidenceLabels.push("Neither this recording nor this artist appears in your Resonance history");
  } else if (priorArtistEvidence) {
    evidenceLabels.push("You have history with this artist");
  }
  if (exposed.has(recording.id)) {
    evidenceLabels.push("Resonance has shown you this recording before");
  }

  const knownProbability = priorRecordingEvidence ? 0.6 : inSeedNeighborhood ? 0.2 : 0;

  let state: NoveltyEstimate["state"];
  if (probability >= 0.85 && confidence >= 0.85) {
    state = "high_confidence_new"; // unreachable in v0 by design (confidence cap)
  } else if (probability >= 0.6) {
    state = "probably_new";
  } else {
    state = "unknown";
  }

  return { probability, state, confidence, knownProbability, evidenceLabels };
}

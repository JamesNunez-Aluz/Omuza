import type { EvidenceRecord, ScoredCandidate, SnapshotRecording } from "./types.js";
import { EXPLAINER_VERSION } from "./types.js";

/**
 * Deterministic explanation templates (spec §10.15, ADR 0011). Every sentence
 * is backed by an evidence record referencing stored first-party data; there
 * is nothing here an LLM could contradict. Items with no evidence at all are
 * omitted by the pipeline, never explained speculatively.
 */

export interface RenderedExplanation {
  templateKey: string;
  renderedText: string;
  evidence: EvidenceRecord[];
  generatorVersion: string;
}

export function explainItem(
  candidate: ScoredCandidate,
  recording: SnapshotRecording,
): RenderedExplanation | undefined {
  const evidence = dedupeEvidence(candidate.fitEvidence);
  if (evidence.length === 0) return undefined;

  const seedEvidence = evidence.find((entry) => entry.type === "explicit_seed");
  const featureEvidence = evidence.find((entry) => entry.type === "feature_match");
  const explorationEvidence = evidence.find((entry) => entry.type === "diversity_rationale");

  let templateKey: string;
  let sentence: string;

  if (seedEvidence) {
    templateKey = "seed_artist_adjacent";
    sentence = featureEvidence
      ? `By ${recording.primaryArtistName}, an artist you seeded — and it ${lowerFirst(featureEvidence.label)}.`
      : `By ${recording.primaryArtistName}, an artist you told us you love.`;
  } else if (featureEvidence) {
    templateKey = "feature_bridge";
    sentence = `${featureEvidence.label}, from an artist outside your seed set.`;
  } else if (explorationEvidence) {
    templateKey = "controlled_exploration";
    sentence =
      "A deliberate exploration pick from a different corner of the catalog, kept within your declared limits.";
  } else {
    templateKey = "generic_evidence";
    sentence = `${evidence[0]!.label}.`;
  }

  const noveltySentence = renderNoveltySentence(candidate);
  if (noveltySentence.text) {
    evidence.push({
      type: "novelty_rationale",
      label: noveltySentence.label,
      refId: `novelty:${candidate.noveltyState}`,
    });
  }

  return {
    templateKey,
    renderedText: noveltySentence.text ? `${sentence} ${noveltySentence.text}` : sentence,
    evidence,
    generatorVersion: EXPLAINER_VERSION,
  };
}

/** Honest novelty copy (spec §5.3): never claim certainty without user confirmation. */
function renderNoveltySentence(candidate: ScoredCandidate): { text: string | null; label: string } {
  switch (candidate.noveltyState) {
    case "probably_new":
      return {
        text: "Probably new to you — it doesn't appear in your Resonance history.",
        label: "No prior evidence in your Resonance history",
      };
    case "known":
      return {
        text: "You know this one; it's here because it fits especially well.",
        label: "Prior knowledge recorded",
      };
    case "high_confidence_new":
      return {
        text: "Very likely new to you, based on strong independent evidence.",
        label: "Strong novelty evidence",
      };
    case "unknown":
    default:
      return { text: null, label: "Insufficient novelty evidence" };
  }
}

function dedupeEvidence(evidence: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  const result: EvidenceRecord[] = [];
  for (const entry of evidence) {
    const key = `${entry.type}:${entry.refId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

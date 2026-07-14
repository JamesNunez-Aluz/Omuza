import { isUseAllowed } from "@resonance/domain";

import type { TastePosterior } from "./taste-posterior.js";
import type {
  Candidate,
  CatalogSnapshot,
  EngineRequest,
  RejectedCandidate,
  SnapshotRecording,
} from "./types.js";

/**
 * Hard filters (spec §10.5), applied before scoring. Every rejection carries
 * machine-readable reasons for the decision trace. Unknown metadata is never
 * treated as satisfying — or violating — a restriction except where the
 * spec's safety rule requires exclusion under a strict policy.
 */

export interface FilterResult {
  eligible: { candidate: Candidate; recording: SnapshotRecording }[];
  rejected: RejectedCandidate[];
}

export function applyHardFilters(
  candidates: Candidate[],
  snapshot: CatalogSnapshot,
  posterior: TastePosterior,
  request: EngineRequest,
): FilterResult {
  const byId = new Map(snapshot.recordings.map((recording) => [recording.id, recording]));
  const exclude = new Set(request.excludeRecordingIds);
  const preserved = new Set(request.preserveRecordingIds);
  const seenRecordingIds = new Set<string>();

  const result: FilterResult = { eligible: [], rejected: [] };

  for (const candidate of candidates) {
    const reasons: string[] = [];
    const recording = byId.get(candidate.recordingId);

    if (!recording) {
      reasons.push("not_in_canonical_catalog");
    } else {
      if (posterior.hardBlockedRecordingIds.has(recording.id)) reasons.push("hard_blocked_recording");
      if (posterior.hardBlockedArtistIds.has(recording.primaryArtistId)) {
        reasons.push("hard_blocked_artist");
      }
      if (exclude.has(recording.id)) reasons.push("explicitly_excluded");
      if (preserved.has(recording.id)) reasons.push("already_preserved_in_playlist");
      if (seenRecordingIds.has(recording.id)) reasons.push("duplicate");

      // Explicit content: only enforce when explicitness is reliably known;
      // under a strict "blocked" policy, unknowns are also excluded (§10.5).
      const policy = request.context?.explicitContentPolicy ?? "allowed";
      if (policy === "blocked") {
        if (recording.isExplicit === true) reasons.push("explicit_content_blocked");
        if (recording.isExplicit === null) reasons.push("explicitness_unknown_strict_policy");
      }

      // Language blocklist only when language is reliably known.
      const blocklist = request.context?.languageBlocklist ?? [];
      if (recording.languageCode && blocklist.includes(recording.languageCode)) {
        reasons.push("language_blocklisted");
      }

      if (!recording.provenanceProvider || !recording.licensePolicyId) {
        reasons.push("provenance_missing");
      } else if (!isUseAllowed(recording.licensePolicyId, "recommendation_feature")) {
        reasons.push("license_prohibits_recommendation");
      }
      if (recording.provenanceProvider === "spotify") {
        reasons.push("spotify_provenance_prohibited");
      }
    }

    if (reasons.length > 0) {
      result.rejected.push({ ...candidate, rejectionReasons: reasons });
    } else {
      seenRecordingIds.add(candidate.recordingId);
      result.eligible.push({ candidate, recording: byId.get(candidate.recordingId)! });
    }
  }

  return result;
}

import type { CatalogSnapshot, EngineResult } from "../engine/types.js";

/**
 * Offline evaluation harness (spec §21 M2 deliverable). Computes the metrics
 * the milestone's acceptance criteria are stated in, over any EngineResult
 * produced from a synthetic fixture snapshot.
 */

export interface EvaluationMetrics {
  itemCount: number;
  /** Share of items whose primary artist is one of the user's positive seed artists. */
  seedArtistShare: number;
  distinctArtists: number;
  maxTracksPerArtist: number;
  duplicateRecordings: number;
  hardBlockLeaks: number;
  itemsWithoutEvidence: number;
  strategyDistribution: Record<string, number>;
}

export function evaluateResult(
  result: EngineResult,
  snapshot: CatalogSnapshot,
  seedArtistIds: Set<string>,
  hardBlockedArtistIds: Set<string>,
  hardBlockedRecordingIds: Set<string>,
): EvaluationMetrics {
  const byId = new Map(snapshot.recordings.map((recording) => [recording.id, recording]));
  const artistCounts = new Map<string, number>();
  const strategyDistribution: Record<string, number> = {};
  const seenRecordings = new Set<string>();

  let seedArtistItems = 0;
  let duplicates = 0;
  let hardBlockLeaks = 0;
  let itemsWithoutEvidence = 0;

  for (const item of result.items) {
    const recording = byId.get(item.candidate.recordingId)!;
    if (seenRecordings.has(recording.id)) duplicates += 1;
    seenRecordings.add(recording.id);

    artistCounts.set(recording.primaryArtistId, (artistCounts.get(recording.primaryArtistId) ?? 0) + 1);
    if (seedArtistIds.has(recording.primaryArtistId)) seedArtistItems += 1;
    if (
      hardBlockedArtistIds.has(recording.primaryArtistId) ||
      hardBlockedRecordingIds.has(recording.id)
    ) {
      hardBlockLeaks += 1;
    }
    if (item.explanation.evidence.length === 0) itemsWithoutEvidence += 1;
    strategyDistribution[item.candidate.providerStrategy] =
      (strategyDistribution[item.candidate.providerStrategy] ?? 0) + 1;
  }

  return {
    itemCount: result.items.length,
    seedArtistShare: result.items.length > 0 ? seedArtistItems / result.items.length : 0,
    distinctArtists: artistCounts.size,
    maxTracksPerArtist: Math.max(0, ...artistCounts.values()),
    duplicateRecordings: duplicates,
    hardBlockLeaks,
    itemsWithoutEvidence,
    strategyDistribution,
  };
}

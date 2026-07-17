import type { SpotifyTrackSearchResult } from "./types.js";

/**
 * Track resolution scoring (spec §12.5). Pure functions: given a canonical
 * recording's display data and provider search results, produce a scored
 * decision. The chosen thresholds map to auto-resolve / needs-confirmation /
 * unresolved; store only method + confidence, never the full response.
 */

export interface CanonicalTrackInput {
  title: string;
  primaryArtist: string;
  durationMs: number | null;
  isrc: string | null;
  releaseYear: number | null;
}

export interface ResolutionCandidate {
  uri: string;
  id: string;
  displayTitle: string;
  displayArtist: string;
  confidence: number;
  matchMethod: "isrc" | "artist_title";
}

export type ResolutionDecision =
  | { status: "auto_resolved"; candidate: ResolutionCandidate }
  | { status: "needs_confirmation"; candidate: ResolutionCandidate }
  | { status: "unresolved" };

export const AUTO_RESOLVE_THRESHOLD = 0.95;
export const CONFIRMATION_THRESHOLD = 0.8;

export function scoreCandidate(
  canonical: CanonicalTrackInput,
  result: SpotifyTrackSearchResult,
  viaIsrcSearch: boolean,
): ResolutionCandidate {
  const titleSimilarity = stringSimilarity(canonical.title, result.name);
  const artistSimilarity = Math.max(
    ...result.artistNames.map((name) => stringSimilarity(canonical.primaryArtist, name)),
    0,
  );
  const durationSimilarity = durationScore(canonical.durationMs, result.durationMs);
  const releaseSimilarity = releaseScore(canonical.releaseYear, result.releaseDate ?? null);
  const isrcExact =
    canonical.isrc !== null &&
    result.isrc !== undefined &&
    normalizeIsrc(canonical.isrc) === normalizeIsrc(result.isrc);

  let confidence =
    0.45 * titleSimilarity +
    0.3 * artistSimilarity +
    0.15 * durationSimilarity +
    0.1 * releaseSimilarity +
    (isrcExact ? 0.35 : 0);

  // An exact ISRC dominates but gross contradictions still cap it (§12.5).
  if (isrcExact && (titleSimilarity < 0.2 || artistSimilarity < 0.2)) {
    confidence = Math.min(confidence, 0.9);
  }

  return {
    uri: result.uri,
    id: result.id,
    displayTitle: result.name,
    displayArtist: result.artistNames.join(", "),
    confidence: Math.min(Math.round(confidence * 1000) / 1000, 1),
    matchMethod: viaIsrcSearch && isrcExact ? "isrc" : "artist_title",
  };
}

export function decideResolution(
  canonical: CanonicalTrackInput,
  results: SpotifyTrackSearchResult[],
  viaIsrcSearch: boolean,
): ResolutionDecision {
  const scored = results
    .map((result) => scoreCandidate(canonical, result, viaIsrcSearch))
    .sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];
  if (!best || best.confidence < CONFIRMATION_THRESHOLD) return { status: "unresolved" };
  if (best.confidence >= AUTO_RESOLVE_THRESHOLD) return { status: "auto_resolved", candidate: best };
  return { status: "needs_confirmation", candidate: best };
}

/** Normalized token-overlap similarity (Dice) — robust to punctuation/case. */
export function stringSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return (2 * overlap) / (tokensA.size + tokensB.size);
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFKD")
      .replaceAll(/[̀-ͯ]/g, "")
      .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((token) => token.length > 0),
  );
}

function durationScore(canonicalMs: number | null, resultMs: number): number {
  if (canonicalMs === null) return 0.5; // unknown is neutral, not negative
  const delta = Math.abs(canonicalMs - resultMs);
  if (delta <= 2000) return 1;
  if (delta >= 15000) return 0;
  return 1 - (delta - 2000) / 13000;
}

function releaseScore(canonicalYear: number | null, releaseDate: string | null): number {
  if (canonicalYear === null || !releaseDate) return 0.5;
  const resultYear = Number.parseInt(releaseDate.slice(0, 4), 10);
  if (!Number.isFinite(resultYear)) return 0.5;
  const delta = Math.abs(canonicalYear - resultYear);
  return delta === 0 ? 1 : delta === 1 ? 0.8 : delta <= 3 ? 0.5 : 0.2;
}

function normalizeIsrc(isrc: string): string {
  return isrc.replaceAll("-", "").toUpperCase();
}

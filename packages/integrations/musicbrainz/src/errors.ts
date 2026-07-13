export type ProviderErrorKind =
  | "disabled"
  | "rate_limited"
  | "timeout"
  | "malformed_response"
  | "unavailable";

/**
 * Typed provider failure. Never carries the raw provider payload — only a
 * short, log-safe detail string (spec: no provider payloads in logs).
 */
export class MusicBrainzError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    detail: string,
    readonly retryable: boolean,
  ) {
    super(`musicbrainz ${kind}: ${detail}`);
    this.name = "MusicBrainzError";
  }
}

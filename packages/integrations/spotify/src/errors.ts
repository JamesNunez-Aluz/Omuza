/**
 * Typed Spotify failures. Messages are log-safe: short codes only, never raw
 * provider payloads or tokens.
 */

export type SpotifyAuthErrorKind = "invalid_grant" | "network" | "provider_error" | "malformed";

export class SpotifyAuthError extends Error {
  constructor(
    readonly kind: SpotifyAuthErrorKind,
    detail: string,
  ) {
    super(`spotify auth ${kind}: ${detail}`);
    this.name = "SpotifyAuthError";
  }
}

export type SpotifyApiErrorKind =
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "malformed";

export class SpotifyApiError extends Error {
  constructor(
    readonly kind: SpotifyApiErrorKind,
    detail: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`spotify api ${kind}: ${detail}`);
    this.name = "SpotifyApiError";
  }
}

/**
 * A timeout AFTER the request may have been transmitted. The operation's
 * outcome is unknown; callers must never blindly replay a mutating request
 * (spec §12.8 rule 5).
 */
export class SpotifyAmbiguousError extends Error {
  constructor(operation: string) {
    super(`spotify ambiguous outcome: ${operation}`);
    this.name = "SpotifyAmbiguousError";
  }
}

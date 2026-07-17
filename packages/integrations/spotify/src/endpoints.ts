/**
 * The complete allowlist of Spotify surfaces this codebase may touch
 * (spec §12.1, §18.3). `pnpm policy:check` verifies that no other Spotify
 * endpoint or scope string exists anywhere in the repository. Additions
 * require an ADR and a platform-policy review.
 */

/** The only scope the strict MVP may request (spec §12.3). */
export const SPOTIFY_ALLOWED_SCOPES = ["playlist-modify-private"] as const;

export const SPOTIFY_ALLOWED_API_PATHS = [
  "/v1/search",
  "/v1/me/playlists",
  "/v1/playlists/", // + {id}/tracks for item insertion
] as const;

export const SPOTIFY_ALLOWED_ACCOUNT_PATHS = ["/authorize", "/api/token"] as const;

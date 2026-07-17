import {
  SpotifyAuth,
  TokenCipher,
  buildAuthorizeUrl,
  generateOauthState,
  generatePkcePair,
  hashOauthState,
} from "@resonance/spotify";
import type { AppConfig } from "@resonance/config";
import type { UserRow } from "@resonance/db";

import { apiError, notFound } from "./http";

/**
 * The ONLY web-side module allowed to touch @resonance/spotify (policy
 * allowlist, ADR 0002/0012). Everything here is behind the kill switch and
 * the Development Mode pilot allowlist; plaintext tokens never leave the
 * server process and never enter responses or logs.
 */

export { buildAuthorizeUrl, generateOauthState, generatePkcePair, hashOauthState };

/** Feature gate: kill switch off → the surface does not exist (404). */
export function spotifyPilotGuard(config: AppConfig, user: UserRow): Response | null {
  if (!config.featureSpotifyExport) return notFound();
  if (!config.spotifyPilotAllowlist.includes(user.emailNormalized.toLowerCase())) {
    return apiError({
      status: 403,
      code: "SPOTIFY_PILOT_ONLY",
      message: "Spotify export is limited to the authorized pilot group.",
    });
  }
  if (!config.spotifyClientId || !config.spotifyRedirectUri || !config.tokenEncryptionKeyB64) {
    return apiError({
      status: 503,
      code: "SPOTIFY_NOT_CONFIGURED",
      message: "Spotify export is not configured on this deployment.",
      retryable: true,
    });
  }
  return null;
}

export function isPilotUser(config: AppConfig, user: UserRow): boolean {
  return (
    config.featureSpotifyExport &&
    config.spotifyPilotAllowlist.includes(user.emailNormalized.toLowerCase())
  );
}

export function getTokenCipher(config: AppConfig): TokenCipher {
  return new TokenCipher(config.tokenEncryptionKeyB64, config.tokenEncryptionKeyVersion);
}

export function getSpotifyAuth(config: AppConfig, fetchFn?: typeof fetch): SpotifyAuth {
  return new SpotifyAuth({
    accountsBaseUrl: config.spotifyAccountsBaseUrl,
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
    redirectUri: config.spotifyRedirectUri,
    ...(fetchFn ? { fetchFn } : {}),
  });
}

/** Test hook: routes use this indirection so tests can stub token exchange. */
let authOverride: SpotifyAuth | undefined;
export function setSpotifyAuthOverride(auth: SpotifyAuth | undefined): void {
  authOverride = auth;
}
export function resolveSpotifyAuth(config: AppConfig): SpotifyAuth {
  return authOverride ?? getSpotifyAuth(config);
}

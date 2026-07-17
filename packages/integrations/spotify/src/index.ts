export {
  SpotifyDestinationAdapter,
  SpotifyExportDisabledError,
} from "./adapter.js";
export type { SpotifyAdapterOptions } from "./adapter.js";
export type { ExportResolution } from "./types.js";
export { TokenCipher } from "./crypto.js";
export type { EncryptedSecret } from "./crypto.js";
export {
  SpotifyAuth,
  buildAuthorizeUrl,
  generateOauthState,
  generatePkcePair,
  hashOauthState,
} from "./auth.js";
export type { TokenResult, SpotifyAuthOptions } from "./auth.js";
export { SpotifyClient } from "./client.js";
export type { SpotifyClientOptions } from "./client.js";
export {
  AUTO_RESOLVE_THRESHOLD,
  CONFIRMATION_THRESHOLD,
  decideResolution,
  scoreCandidate,
  stringSimilarity,
} from "./resolution.js";
export type {
  CanonicalTrackInput,
  ResolutionCandidate,
  ResolutionDecision,
} from "./resolution.js";
export {
  SPOTIFY_ALLOWED_SCOPES,
  SPOTIFY_ALLOWED_API_PATHS,
  SPOTIFY_ALLOWED_ACCOUNT_PATHS,
} from "./endpoints.js";
export {
  SpotifyAmbiguousError,
  SpotifyApiError,
  SpotifyAuthError,
} from "./errors.js";

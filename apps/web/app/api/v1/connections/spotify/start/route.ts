import { createOauthTransaction } from "@resonance/db";

import { withAuth } from "@/server/guard";
import {
  buildAuthorizeUrl,
  generateOauthState,
  generatePkcePair,
  getTokenCipher,
  spotifyPilotGuard,
} from "@/server/spotify";

export const dynamic = "force-dynamic";

/**
 * Begin the Spotify OAuth connection (spec §12.3, §13.11): PKCE + one-time
 * state with a short-lived server-side transaction. The client receives only
 * the authorize URL.
 */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const guardResponse = spotifyPilotGuard(ctx.config, user);
    if (guardResponse) return guardResponse;

    const pkce = generatePkcePair();
    const { state, stateHash } = generateOauthState();
    const cipher = getTokenCipher(ctx.config);
    await createOauthTransaction(ctx.db, {
      userId: user.id,
      service: "spotify",
      stateHash,
      encryptedVerifier: cipher.encrypt(pkce.verifier),
    });

    const authorizeUrl = buildAuthorizeUrl({
      accountsBaseUrl: ctx.config.spotifyAccountsBaseUrl,
      clientId: ctx.config.spotifyClientId,
      redirectUri: ctx.config.spotifyRedirectUri,
      state,
      codeChallenge: pkce.challenge,
    });
    return Response.json({ authorizeUrl });
  });
}

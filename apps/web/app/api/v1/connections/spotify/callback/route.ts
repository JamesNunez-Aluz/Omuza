import {
  activateConnection,
  consumeOauthTransaction,
  recordAuditEvent,
} from "@resonance/db";

import { withAuth } from "@/server/guard";
import {
  getTokenCipher,
  hashOauthState,
  resolveSpotifyAuth,
  spotifyPilotGuard,
} from "@/server/spotify";

export const dynamic = "force-dynamic";

/**
 * OAuth callback (spec §12.3): one-time state consumption bound to the
 * signed-in user, server-side code exchange, encrypted token storage. Raw
 * provider errors are never rendered — the user gets a safe redirect code.
 */
export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const guardResponse = spotifyPilotGuard(ctx.config, user);
    if (guardResponse) return guardResponse;

    const url = new URL(request.url);
    const redirect = (code: string) =>
      Response.redirect(`${ctx.config.appBaseUrl}/settings?spotify=${code}`, 303);

    if (url.searchParams.get("error")) {
      // e.g. the user denied access — never echo provider error text.
      return redirect("denied");
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return redirect("invalid_callback");

    // One-time, expiring, user-bound state (replay and mismatch fail safely).
    const transaction = await consumeOauthTransaction(ctx.db, hashOauthState(state));
    if (!transaction || transaction.userId !== user.id || transaction.service !== "spotify") {
      return redirect("state_mismatch");
    }

    const cipher = getTokenCipher(ctx.config);
    let tokens;
    try {
      tokens = await resolveSpotifyAuth(ctx.config).exchangeCode(
        code,
        cipher.decrypt(transaction.encryptedVerifier),
      );
    } catch {
      return redirect("exchange_failed");
    }

    await activateConnection(ctx.db, {
      userId: user.id,
      service: "spotify",
      scopeSet: tokens.scope ? tokens.scope.split(" ") : [],
      accessToken: cipher.encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? cipher.encrypt(tokens.refreshToken) : null,
      accessTokenExpiresAt: tokens.expiresAt,
      // Reauthorization reminder well before typical refresh-token lifetime.
      reauthorizationDueAt: new Date(Date.now() + 150 * 24 * 3_600_000),
    });
    await recordAuditEvent(ctx.db, {
      userId: user.id,
      action: "spotify_connected",
      entityType: "service_connection",
    });

    return redirect("connected");
  });
}

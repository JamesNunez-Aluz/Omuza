import { createHash, randomBytes } from "node:crypto";

import { SPOTIFY_ALLOWED_SCOPES } from "./endpoints.js";
import { SpotifyAuthError } from "./errors.js";

/**
 * Authorization Code + PKCE (spec §12.3). All exchanges happen server-side;
 * raw provider responses never leave this module — only typed token results.
 */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateOauthState(): { state: string; stateHash: string } {
  const state = randomBytes(24).toString("base64url");
  return { state, stateHash: hashOauthState(state) };
}

export function hashOauthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export interface AuthorizeUrlInput {
  accountsBaseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    scope: SPOTIFY_ALLOWED_SCOPES.join(" "),
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge_method: "S256",
    code_challenge: input.codeChallenge,
  });
  return `${input.accountsBaseUrl.replace(/\/$/, "")}/authorize?${params}`;
}

export interface TokenResult {
  accessToken: string;
  /** Absent when the provider did not rotate the refresh token. */
  refreshToken?: string;
  expiresAt: Date;
  scope: string;
}

export interface SpotifyAuthOptions {
  accountsBaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class SpotifyAuth {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: SpotifyAuthOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<TokenResult> {
    return this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.options.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  /**
   * Refresh an access token. `invalid_grant` is surfaced as a typed
   * reauthorization signal and must never be retried in a loop (§12.4).
   */
  async refresh(refreshToken: string): Promise<TokenResult> {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResult> {
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString(
      "base64",
    );
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.options.accountsBaseUrl.replace(/\/$/, "")}/api/token`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${basic}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ ...body, client_id: this.options.clientId }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new SpotifyAuthError("network", "token endpoint unreachable");
    }

    if (!response.ok) {
      // Parse only the error code; never propagate raw provider bodies.
      let errorCode = `status_${response.status}`;
      try {
        const parsed = (await response.json()) as { error?: string };
        if (typeof parsed.error === "string") errorCode = parsed.error;
      } catch {
        // keep the status-based code
      }
      if (errorCode === "invalid_grant") {
        throw new SpotifyAuthError("invalid_grant", "authorization no longer valid");
      }
      throw new SpotifyAuthError("provider_error", errorCode);
    }

    const parsed = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!parsed.access_token || typeof parsed.expires_in !== "number") {
      throw new SpotifyAuthError("malformed", "token response missing fields");
    }
    return {
      accessToken: parsed.access_token,
      ...(parsed.refresh_token ? { refreshToken: parsed.refresh_token } : {}),
      expiresAt: new Date(Date.now() + parsed.expires_in * 1000),
      scope: parsed.scope ?? "",
    };
  }
}

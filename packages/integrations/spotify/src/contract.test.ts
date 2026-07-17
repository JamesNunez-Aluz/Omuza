import { describe, expect, it, vi } from "vitest";

import { SpotifyAuth, buildAuthorizeUrl, generateOauthState, generatePkcePair, hashOauthState } from "./auth.js";
import { SpotifyClient } from "./client.js";
import { TokenCipher } from "./crypto.js";
import { SpotifyAmbiguousError } from "./errors.js";
import type { SpotifyApiError, SpotifyAuthError } from "./errors.js";
import { decideResolution, scoreCandidate } from "./resolution.js";
import type { CanonicalTrackInput } from "./resolution.js";

/**
 * Mock contract suite (spec §12.11). No network, no real credentials, no
 * destructive calls — every provider behavior is an injected fetch.
 */

const noSleep = () => Promise.resolve();
const KEY = Buffer.alloc(32, 7).toString("base64");

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("TokenCipher (ADR 0012)", () => {
  it("round-trips secrets with per-record nonces and enforces key version", () => {
    const cipher = new TokenCipher(KEY, "v1");
    const a = cipher.encrypt("synthetic-access-token");
    const b = cipher.encrypt("synthetic-access-token");
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.toString("utf8")).not.toContain("synthetic");
    expect(cipher.decrypt(a)).toBe("synthetic-access-token");
    expect(() => cipher.decrypt({ ...a, keyVersion: "v0" })).toThrow(/key version/);
    expect(() => new TokenCipher(Buffer.alloc(16).toString("base64"), "v1")).toThrow(/32 bytes/);
  });
});

describe("OAuth + PKCE (spec §12.3)", () => {
  it("builds an authorize URL with S256 challenge, state, and the single allowed scope", () => {
    const pkce = generatePkcePair();
    const { state } = generateOauthState();
    const url = new URL(
      buildAuthorizeUrl({
        accountsBaseUrl: "https://accounts.spotify.example.test",
        clientId: "client-id",
        redirectUri: "http://127.0.0.1:3000/api/v1/connections/spotify/callback",
        state,
        codeChallenge: pkce.challenge,
      }),
    );
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("scope")).toBe("playlist-modify-private");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toContain("127.0.0.1");
    expect(hashOauthState(state)).toHaveLength(64);
  });

  it("exchanges a code and refreshes tokens; refresh rotation is honored", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "playlist-modify-private" }),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: "at-2", expires_in: 3600 }));
    const auth = new SpotifyAuth({
      accountsBaseUrl: "https://accounts.spotify.example.test",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://127.0.0.1:3000/cb",
      fetchFn: fetchFn as typeof fetch,
    });

    const exchanged = await auth.exchangeCode("auth-code", "verifier");
    expect(exchanged.accessToken).toBe("at-1");
    expect(exchanged.refreshToken).toBe("rt-1");

    const refreshed = await auth.refresh("rt-1");
    expect(refreshed.accessToken).toBe("at-2");
    expect(refreshed.refreshToken).toBeUndefined(); // provider kept the old one

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("code_verifier=verifier");
    expect(new Headers(init.headers).get("authorization")).toMatch(/^Basic /);
  });

  it("invalid_grant surfaces as a typed reauthorization signal without retry", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, { status: 400 }));
    const auth = new SpotifyAuth({
      accountsBaseUrl: "https://accounts.spotify.example.test",
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "http://127.0.0.1/cb",
      fetchFn: fetchFn as typeof fetch,
    });
    await expect(auth.refresh("stale")).rejects.toMatchObject({ kind: "invalid_grant" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    try {
      await auth.refresh("stale");
    } catch (error) {
      expect((error as SpotifyAuthError).message).not.toContain("stale");
    }
  });
});

function client(fetchFn: typeof fetch, overrides: Partial<ConstructorParameters<typeof SpotifyClient>[0]> = {}) {
  return new SpotifyClient({
    apiBaseUrl: "https://api.spotify.example.test",
    getAccessToken: async () => "test-access-token",
    fetchFn,
    sleep: noSleep,
    ...overrides,
  });
}

const searchPayload = {
  tracks: {
    items: [
      {
        uri: "spotify:track:aaa",
        id: "aaa",
        name: "Meridian Sketch",
        duration_ms: 214000,
        artists: [{ name: "Nebula Cartographers" }],
        external_ids: { isrc: "QZTST2600001" },
        album: { release_date: "2021-03-01" },
      },
    ],
  },
};

describe("SpotifyClient (spec §12.7–12.9)", () => {
  it("searches by ISRC and normalizes results", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(searchPayload));
    const results = await client(fetchFn as typeof fetch).searchByIsrc("QZTST2600001");
    expect(results[0]).toMatchObject({ isrc: "QZTST2600001", durationMs: 214000 });
    const url = String((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(url).toContain("/v1/search");
    expect(url).toContain("isrc%3AQZTST2600001");
  });

  it("honors 429 Retry-After and counts rate limits", async () => {
    const waits: number[] = [];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(jsonResponse(searchPayload));
    const spotify = client(fetchFn as typeof fetch, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const results = await spotify.searchByIsrc("QZTST2600001");
    expect(results).toHaveLength(1);
    expect(waits).toEqual([3000]);
    expect(spotify.metrics.rateLimited).toBe(1);
  });

  it("maps 401 to unauthorized and 403 to a scope/policy error without retries", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [403, "forbidden"],
    ] as const) {
      const fetchFn = vi.fn(async () => new Response("no", { status }));
      await expect(client(fetchFn as typeof fetch).searchByIsrc("X")).rejects.toMatchObject({ kind });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("retries 5xx with bounded backoff and eventually fails typed", async () => {
    const fetchFn = vi.fn(async () => new Response("boom", { status: 503 }));
    const spotify = client(fetchFn as typeof fetch, { maxRetries: 2 });
    await expect(spotify.searchByIsrc("X")).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("creates a PRIVATE playlist and returns the destination link", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ id: "pl-1", external_urls: { spotify: "https://open.spotify.example/pl-1" } }),
    );
    const result = await client(fetchFn as typeof fetch).createPrivatePlaylist(
      "Resonance — Late Night Discovery",
      "Created from a service-neutral Resonance discovery playlist.",
    );
    expect(result).toEqual({ id: "pl-1", url: "https://open.spotify.example/pl-1" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/me/playlists");
    expect(JSON.parse(String(init.body))).toMatchObject({ public: false });
  });

  it("inserts items in one batch, enforcing the endpoint maximum", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ snapshot_id: "s" }, { status: 201 }));
    const spotify = client(fetchFn as typeof fetch);
    await spotify.addPlaylistItems("pl-1", ["spotify:track:a", "spotify:track:b"]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/playlists/pl-1/tracks");
    expect(JSON.parse(String(init.body)).uris).toHaveLength(2);
    await expect(
      spotify.addPlaylistItems("pl-1", Array.from({ length: 101 }, (_, i) => `spotify:track:${i}`)),
    ).rejects.toMatchObject({ kind: "malformed" });
  });

  it("a mutation timeout is AMBIGUOUS — never blindly replayed (spec §12.8.5)", async () => {
    const timeoutFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        }),
    );
    const spotify = client(timeoutFetch as unknown as typeof fetch, { timeoutMs: 25 });
    await expect(spotify.addPlaylistItems("pl-1", ["spotify:track:a"])).rejects.toBeInstanceOf(
      SpotifyAmbiguousError,
    );
    expect(timeoutFetch).toHaveBeenCalledTimes(1); // no replay

    // The same timeout on an idempotent read IS retried.
    const readSpotify = client(timeoutFetch as unknown as typeof fetch, { timeoutMs: 25, maxRetries: 1 });
    await expect(readSpotify.searchByIsrc("X")).rejects.toMatchObject({ kind: "unavailable" });
    expect(timeoutFetch.mock.calls.length).toBeGreaterThan(2);
  });

  it("never leaks tokens into error messages", async () => {
    const fetchFn = vi.fn(async () => new Response("err", { status: 500 }));
    try {
      await client(fetchFn as typeof fetch, { maxRetries: 0 }).searchByIsrc("X");
    } catch (error) {
      expect((error as SpotifyApiError).message).not.toContain("test-access-token");
    }
  });
});

describe("resolution scoring (spec §12.5)", () => {
  const canonical: CanonicalTrackInput = {
    title: "Meridian Sketch",
    primaryArtist: "Nebula Cartographers",
    durationMs: 214000,
    isrc: "QZTST2600001",
    releaseYear: 2021,
  };
  const exact = {
    uri: "spotify:track:aaa",
    id: "aaa",
    name: "Meridian Sketch",
    durationMs: 214500,
    artistNames: ["Nebula Cartographers"],
    isrc: "QZTST2600001",
    releaseDate: "2021-03-01",
  };

  it("exact ISRC + matching metadata auto-resolves", () => {
    const decision = decideResolution(canonical, [exact], true);
    expect(decision.status).toBe("auto_resolved");
    if (decision.status === "auto_resolved") {
      expect(decision.candidate.matchMethod).toBe("isrc");
      expect(decision.candidate.confidence).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("an ISRC hit with grossly contradictory metadata is capped below auto-resolve", () => {
    const contradictory = {
      ...exact,
      name: "Completely Different Song",
      artistNames: ["Someone Else Entirely"],
    };
    const scored = scoreCandidate(canonical, contradictory, true);
    expect(scored.confidence).toBeLessThan(0.95);
  });

  it("mid-confidence artist/title matches need confirmation; weak ones stay unresolved", () => {
    const similar = {
      uri: "spotify:track:bbb",
      id: "bbb",
      name: "Meridian Sketch (Live)",
      durationMs: 220000,
      artistNames: ["Nebula Cartographers"],
      releaseDate: "2021-05-01",
    };
    const decision = decideResolution({ ...canonical, isrc: null }, [similar], false);
    expect(decision.status).toBe("needs_confirmation");

    const weak = {
      uri: "spotify:track:ccc",
      id: "ccc",
      name: "Unrelated Anthem",
      durationMs: 190000,
      artistNames: ["Different Band"],
    };
    expect(decideResolution({ ...canonical, isrc: null }, [weak], false).status).toBe("unresolved");
    expect(decideResolution(canonical, [], true).status).toBe("unresolved");
  });

  it("unknown duration/release data is neutral, never negative", () => {
    const sparseCanonical: CanonicalTrackInput = {
      title: "Meridian Sketch",
      primaryArtist: "Nebula Cartographers",
      durationMs: null,
      isrc: null,
      releaseYear: null,
    };
    const { isrc: _omitted, ...candidateWithoutIsrc } = exact;
    const scored = scoreCandidate(sparseCanonical, candidateWithoutIsrc, false);
    expect(scored.confidence).toBeGreaterThanOrEqual(0.8); // title+artist exact
  });
});

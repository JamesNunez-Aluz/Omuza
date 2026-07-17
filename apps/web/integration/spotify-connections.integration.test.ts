import { encryptedOauthCredentials, serviceConnections, users } from "@resonance/db";
import type { SpotifyAuth } from "@resonance/spotify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setSpotifyAuthOverride } from "../src/server/spotify";
import { createHarness, makeRequest, signIn } from "./helpers";
import type { TestHarness } from "./helpers";

const RUN = Date.now().toString(36);
const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;
const KEY = Buffer.alloc(32, 5).toString("base64");

describeWithDb("spotify connection routes (spec §12.3, §13.11, M4 acceptance)", () => {
  let harness: TestHarness;
  let pilotCookie: string;
  let outsiderCookie: string;
  const pilotEmail = `pilot-${RUN}@example.test`;

  beforeAll(async () => {
    harness = await createHarness();
    pilotCookie = await signIn(harness.db, pilotEmail);
    outsiderCookie = await signIn(harness.db, `outsider-${RUN}@example.test`);
    // Stub token exchange: no real provider is ever contacted.
    setSpotifyAuthOverride({
      exchangeCode: async () => ({
        accessToken: "synthetic-access-token",
        refreshToken: "synthetic-refresh-token",
        expiresAt: new Date(Date.now() + 3600_000),
        scope: "playlist-modify-private",
      }),
      refresh: async () => {
        throw new Error("not used");
      },
    } as unknown as SpotifyAuth);
  });

  afterAll(async () => {
    setSpotifyAuthOverride(undefined);
    await harness.close();
  });

  function enablePilot() {
    harness.overrideConfig({
      featureSpotifyExport: true,
      spotifyPilotAllowlist: [pilotEmail],
      spotifyClientId: "test-client",
      spotifyClientSecret: "test-secret",
      spotifyRedirectUri: "http://127.0.0.1:3000/api/v1/connections/spotify/callback",
      spotifyAccountsBaseUrl: "https://accounts.spotify.example.test",
      spotifyApiBaseUrl: "https://api.spotify.example.test",
      tokenEncryptionKeyB64: KEY,
      tokenEncryptionKeyVersion: "v1",
    });
  }

  it("the surface does not exist while the kill switch is off (default)", async () => {
    harness.overrideConfig({ featureSpotifyExport: false });
    const { POST } = await import("../app/api/v1/connections/spotify/start/route.js");
    const response = await POST(
      makeRequest("POST", "/api/v1/connections/spotify/start", { cookie: pilotCookie, body: {} }),
    );
    expect(response.status).toBe(404);
  });

  it("non-pilot users are excluded even with the flag on", async () => {
    enablePilot();
    const { POST } = await import("../app/api/v1/connections/spotify/start/route.js");
    const response = await POST(
      makeRequest("POST", "/api/v1/connections/spotify/start", { cookie: outsiderCookie, body: {} }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "SPOTIFY_PILOT_ONLY",
    );
  });

  it("full OAuth round trip: PKCE authorize URL, state mismatch fails safely, replay fails, tokens encrypted at rest", async () => {
    enablePilot();
    const { POST: start } = await import("../app/api/v1/connections/spotify/start/route.js");
    const { GET: callback } = await import("../app/api/v1/connections/spotify/callback/route.js");

    const started = await start(
      makeRequest("POST", "/api/v1/connections/spotify/start", { cookie: pilotCookie, body: {} }),
    );
    expect(started.status).toBe(200);
    const { authorizeUrl } = (await started.json()) as { authorizeUrl: string };
    const authorize = new URL(authorizeUrl);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("scope")).toBe("playlist-modify-private");
    const state = authorize.searchParams.get("state")!;

    // Wrong state → safe redirect, no connection.
    const mismatch = await callback(
      makeRequest(
        "GET",
        `/api/v1/connections/spotify/callback?code=auth-code&state=WRONG`,
        { cookie: pilotCookie },
      ),
    );
    expect(mismatch.status).toBe(303);
    expect(mismatch.headers.get("location")).toContain("spotify=state_mismatch");

    // Correct state → connection active.
    const success = await callback(
      makeRequest(
        "GET",
        `/api/v1/connections/spotify/callback?code=auth-code&state=${encodeURIComponent(state)}`,
        { cookie: pilotCookie },
      ),
    );
    expect(success.status).toBe(303);
    expect(success.headers.get("location")).toContain("spotify=connected");

    // Replaying the same state fails safely (one-time consumption).
    const replay = await callback(
      makeRequest(
        "GET",
        `/api/v1/connections/spotify/callback?code=auth-code&state=${encodeURIComponent(state)}`,
        { cookie: pilotCookie },
      ),
    );
    expect(replay.headers.get("location")).toContain("spotify=state_mismatch");

    // Tokens are ciphertext at rest and absent from the API surface.
    const userRow = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalized, pilotEmail));
    const connections = await harness.db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userRow[0]!.id));
    const active = connections.find((connection) => connection.status === "active")!;
    const credentials = await harness.db
      .select()
      .from(encryptedOauthCredentials)
      .where(eq(encryptedOauthCredentials.connectionId, active.id));
    expect(credentials).toHaveLength(1);
    expect(credentials[0]!.encryptedAccessToken.toString("utf8")).not.toContain(
      "synthetic-access-token",
    );

    const { GET: list } = await import("../app/api/v1/connections/route.js");
    const listed = await list(makeRequest("GET", "/api/v1/connections", { cookie: pilotCookie }));
    const body = await listed.text();
    expect(body).not.toContain("synthetic-access-token");
    expect(body).not.toContain("synthetic-refresh-token");
    expect(JSON.parse(body).items.some((item: { status: string }) => item.status === "active")).toBe(
      true,
    );
  });

  it("disconnect revokes the connection, deletes credentials, and notes Spotify-side playlists remain", async () => {
    enablePilot();
    const { GET: list } = await import("../app/api/v1/connections/route.js");
    const listed = await list(makeRequest("GET", "/api/v1/connections", { cookie: pilotCookie }));
    const active = ((await listed.json()) as { items: { id: string; status: string }[] }).items.find(
      (item) => item.status === "active",
    )!;

    const route = await import("../app/api/v1/connections/[connectionId]/route.js");

    // IDOR: another user cannot disconnect it.
    const foreign = await route.DELETE(
      makeRequest("DELETE", `/api/v1/connections/${active.id}`, { cookie: outsiderCookie, body: {} }),
      { params: Promise.resolve({ connectionId: active.id }) },
    );
    expect(foreign.status).toBe(404);

    const removed = await route.DELETE(
      makeRequest("DELETE", `/api/v1/connections/${active.id}`, { cookie: pilotCookie, body: {} }),
      { params: Promise.resolve({ connectionId: active.id }) },
    );
    expect(removed.status).toBe(200);
    const body = (await removed.json()) as { note: string };
    expect(body.note).toContain("remain in your Spotify account");

    const credentials = await harness.db
      .select()
      .from(encryptedOauthCredentials)
      .where(eq(encryptedOauthCredentials.connectionId, active.id));
    expect(credentials).toHaveLength(0);
  });
});

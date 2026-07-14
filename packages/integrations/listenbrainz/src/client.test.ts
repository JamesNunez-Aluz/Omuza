import { describe, expect, it, vi } from "vitest";

import { ListenBrainzClient, ListenBrainzDisabledError } from "./client.js";

describe("ListenBrainzClient (disabled-by-default Strategy B skeleton)", () => {
  it("fails fast when the feature flag is off, with no network call", async () => {
    const fetchFn = vi.fn();
    const client = new ListenBrainzClient({ enabled: false, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.recordingRecommendations("someone", 10)).rejects.toThrow(
      ListenBrainzDisabledError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await client.healthCheck()).status).toBe("disabled");
  });

  it("parses and re-ranks recommendations when enabled (test-only)", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            payload: {
              mbids: [
                { recording_mbid: "11111111-1111-4111-8111-111111111111", score: 0.9 },
                { recording_mbid: "22222222-2222-4222-8222-222222222222" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const client = new ListenBrainzClient({
      enabled: true,
      baseUrl: "https://listenbrainz.example.test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const recommendations = await client.recordingRecommendations("someone", 10);
    expect(recommendations).toEqual([
      { recordingMbid: "11111111-1111-4111-8111-111111111111", providerScore: 0.9, providerRank: 1 },
      { recordingMbid: "22222222-2222-4222-8222-222222222222", providerScore: 0, providerRank: 2 },
    ]);
  });

  it("rejects malformed payloads before any field is used", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ payload: { mbids: [{ recording_mbid: "not-a-uuid" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new ListenBrainzClient({
      enabled: true,
      baseUrl: "https://listenbrainz.example.test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(client.recordingRecommendations("someone", 5)).rejects.toThrow(/malformed/);
  });
});

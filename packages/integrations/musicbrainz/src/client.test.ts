import { describe, expect, it, vi } from "vitest";

import { MusicBrainzClient, escapeLucene } from "./client.js";
import { MusicBrainzError } from "./errors.js";

/**
 * Contract tests with an injected fetch — no network, ever (spec §21 M1:
 * provider 429/timeout/malformed responses are tested).
 */

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const artistPayload = {
  count: 2,
  artists: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Beach House",
      "sort-name": "Beach House",
      disambiguation: "Baltimore dream pop",
      country: "US",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Beachhouse",
      disambiguation: "UK grime",
    },
  ],
};

function client(fetchFn: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new MusicBrainzClient({
    userAgent: "ResonanceTest/0.1 (test@example.test)",
    baseUrl: "https://musicbrainz.example.test/ws/2",
    fetchFn,
    sleep: noSleep,
    ...overrides,
  });
}

describe("MusicBrainzClient", () => {
  it("parses artist search results and preserves disambiguation", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(artistPayload));
    const artists = await client(fetchFn as typeof fetch).searchArtists("beach house", 10);
    expect(artists).toHaveLength(2);
    expect(artists[0]).toMatchObject({
      mbid: "11111111-1111-4111-8111-111111111111",
      name: "Beach House",
      disambiguation: "Baltimore dream pop",
      countryCode: "US",
    });
  });

  it("sends the mandatory user agent and never requests supplementary datasets", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(artistPayload));
    await client(fetchFn as typeof fetch).searchArtists("beach house", 5);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("user-agent")).toContain("ResonanceTest");
    expect(url).not.toMatch(/tags|ratings|genres/);
    expect(url).toContain("fmt=json");
  });

  it("retries 429 responses honoring Retry-After, then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }),
      )
      .mockResolvedValueOnce(jsonResponse(artistPayload));
    const artists = await client(fetchFn as typeof fetch).searchArtists("beach house", 5);
    expect(artists).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("surfaces a typed rate-limit error when retries are exhausted", async () => {
    const fetchFn = vi.fn(async () => new Response("rate limited", { status: 429 }));
    await expect(client(fetchFn as typeof fetch, { maxRetries: 1 }).searchArtists("x y", 5)).rejects.toMatchObject(
      { kind: "rate_limited", retryable: true },
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("times out and reports a retryable timeout error", async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        }),
    );
    await expect(
      client(fetchFn as unknown as typeof fetch, { timeoutMs: 25, maxRetries: 0 }).searchArtists("slow", 5),
    ).rejects.toMatchObject({ kind: "timeout", retryable: true });
  });

  it("rejects malformed JSON, wrong content types, and schema violations without retry", async () => {
    const invalidJson = vi.fn(async () => new Response("<html>err</html>", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(client(invalidJson as typeof fetch).searchArtists("q1", 5)).rejects.toMatchObject({
      kind: "malformed_response",
    });
    expect(invalidJson).toHaveBeenCalledTimes(1);

    const htmlContent = vi.fn(async () => new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    await expect(client(htmlContent as typeof fetch).searchArtists("q2", 5)).rejects.toMatchObject({
      kind: "malformed_response",
    });

    const schemaViolation = vi.fn(async () => jsonResponse({ count: 1, artists: [{ name: 42 }] }));
    await expect(client(schemaViolation as typeof fetch).searchArtists("q3", 5)).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });

  it("fails fast with the kill switch off and no network call", async () => {
    const fetchFn = vi.fn();
    await expect(
      client(fetchFn as unknown as typeof fetch, { enabled: false }).searchArtists("q", 5),
    ).rejects.toMatchObject({ kind: "disabled" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("escapes Lucene operators in user queries", () => {
    expect(escapeLucene('AC/DC +live "bootleg"')).toBe('AC\\/DC \\+live \\"bootleg\\"');
    expect(escapeLucene("beach house")).toBe("beach house");
  });

  it("parses recording results with artist credits", async () => {
    const payload = {
      count: 1,
      recordings: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Myth",
          length: 258000,
          "first-release-date": "2012-05-15",
          "artist-credit": [
            {
              name: "Beach House",
              artist: { id: "11111111-1111-4111-8111-111111111111", name: "Beach House" },
            },
          ],
        },
      ],
    };
    const fetchFn = vi.fn(async () => jsonResponse(payload));
    const recordings = await client(fetchFn as typeof fetch).searchRecordings("myth", 5);
    expect(recordings[0]).toMatchObject({
      mbid: "33333333-3333-4333-8333-333333333333",
      title: "Myth",
      durationMs: 258000,
      credits: [{ artistMbid: "11111111-1111-4111-8111-111111111111", creditName: "Beach House" }],
    });
  });
});

describe("MusicBrainzError", () => {
  it("never embeds provider payloads in the message", () => {
    const error = new MusicBrainzError("unavailable", "status 500", true);
    expect(error.message).toBe("musicbrainz unavailable: status 500");
  });
});

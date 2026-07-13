import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QUEUES } from "@resonance/db";

import { createHarness, makeRequest, musicbrainzFetchFixture, signIn } from "./helpers";
import type { TestHarness } from "./helpers";

const RUN = Date.now().toString(36);
const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

interface SearchItem {
  entityType: string;
  id: string;
  title: string;
  disambiguation: string | null;
  sourceAttribution: string[];
}

describeWithDb("catalog search, seeds, contexts — ownership and acceptance criteria", () => {
  let harness: TestHarness;
  let cookieA: string;
  let cookieB: string;
  let artistIds: string[] = [];
  let recordingId: string;

  beforeAll(async () => {
    harness = await createHarness();
    cookieA = await signIn(harness.db, `user-a-${RUN}@example.test`);
    cookieB = await signIn(harness.db, `user-b-${RUN}@example.test`);

    harness.setMusicbrainzFetch(musicbrainzFetchFixture());
    const { GET: search } = await import("../app/api/v1/catalog/search/route.js");
    const artistResponse = await search(
      makeRequest("GET", "/api/v1/catalog/search?q=nebula&type=artist&limit=5", { cookie: cookieA }),
    );
    const artistBody = (await artistResponse.json()) as { items: SearchItem[] };
    artistIds = artistBody.items.map((item) => item.id);

    const recordingResponse = await search(
      makeRequest("GET", "/api/v1/catalog/search?q=meridian&type=recording&limit=5", {
        cookie: cookieA,
      }),
    );
    const recordingBody = (await recordingResponse.json()) as { items: SearchItem[] };
    recordingId = recordingBody.items[0]!.id;
  });

  afterAll(async () => {
    await harness.close();
  });

  it("search returns canonical disambiguation and source attribution for every item", async () => {
    harness.setMusicbrainzFetch(musicbrainzFetchFixture());
    const { GET: search } = await import("../app/api/v1/catalog/search/route.js");
    const response = await search(
      makeRequest("GET", "/api/v1/catalog/search?q=nebula%20cartographers&type=artist", {
        cookie: cookieA,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: SearchItem[]; degraded: boolean };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(body.items[0]!.disambiguation).toBe("synthetic test artist");
    for (const item of body.items) {
      expect(item.sourceAttribution).toContain("MusicBrainz");
    }
    expect(body.degraded).toBe(false);
  });

  it("search degrades honestly when the provider fails", async () => {
    harness.setMusicbrainzFetch((async () => new Response("oops", { status: 500 })) as typeof fetch);
    const { GET: search } = await import("../app/api/v1/catalog/search/route.js");
    const response = await search(
      makeRequest("GET", "/api/v1/catalog/search?q=zzz-unseen-query&type=artist", { cookie: cookieA }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { degraded: boolean };
    expect(body.degraded).toBe(true);
  });

  it("records ≥5 positive and ≥3 negative seeds with all sentiment distinctions persisting", async () => {
    const { POST, GET } = await import("../app/api/v1/taste/seeds/route.js");
    const [artist1, artist2] = artistIds;
    const items = [
      { entityType: "artist", entityId: artist1, sentiment: "strong_positive", strength: 1, contextId: null },
      { entityType: "artist", entityId: artist2, sentiment: "positive", strength: 0.8, contextId: null },
      { entityType: "recording", entityId: recordingId, sentiment: "positive", strength: 0.5, contextId: null },
      { entityType: "artist", entityId: artist1, sentiment: "positive", strength: 0.3, contextId: null },
      { entityType: "recording", entityId: recordingId, sentiment: "strong_positive", strength: 1, contextId: null },
      { entityType: "artist", entityId: artist2, sentiment: "hard_block", strength: 1, contextId: null },
      { entityType: "artist", entityId: artist1, sentiment: "fatigue", strength: 0.7, contextId: null },
      { entityType: "recording", entityId: recordingId, sentiment: "negative", strength: 0.8, contextId: null },
    ];
    const created = await POST(
      makeRequest("POST", "/api/v1/taste/seeds", { cookie: cookieA, body: { items } }),
    );
    expect(created.status).toBe(201);

    const listed = await GET(makeRequest("GET", "/api/v1/taste/seeds", { cookie: cookieA }));
    const body = (await listed.json()) as { items: { sentiment: string }[] };
    const sentiments = body.items.map((item) => item.sentiment);
    for (const expected of ["strong_positive", "positive", "hard_block", "fatigue", "negative"]) {
      expect(sentiments).toContain(expected);
    }
    expect(harness.enqueued.some((job) => job.queue === QUEUES.tasteRecompute)).toBe(true);
  });

  it("supports context-specific seeds bound to an owned context profile", async () => {
    const { POST: createContext } = await import("../app/api/v1/contexts/route.js");
    const contextResponse = await createContext(
      makeRequest("POST", "/api/v1/contexts", {
        cookie: cookieA,
        body: { name: "Late night", discoveryLevel: 30 },
      }),
    );
    expect(contextResponse.status).toBe(201);
    const context = (await contextResponse.json()) as { id: string };

    const { POST: createSeeds } = await import("../app/api/v1/taste/seeds/route.js");
    const seeded = await createSeeds(
      makeRequest("POST", "/api/v1/taste/seeds", {
        cookie: cookieA,
        body: {
          items: [
            {
              entityType: "artist",
              entityId: artistIds[0],
              sentiment: "negative",
              strength: 0.5,
              contextId: context.id,
            },
          ],
        },
      }),
    );
    expect(seeded.status).toBe(201);
    const body = (await seeded.json()) as { items: { contextId: string }[] };
    expect(body.items[0]!.contextId).toBe(context.id);

    // Another user's context id is a 404, not a grant (IDOR).
    const stolen = await createSeeds(
      makeRequest("POST", "/api/v1/taste/seeds", {
        cookie: cookieB,
        body: {
          items: [
            {
              entityType: "artist",
              entityId: artistIds[0],
              sentiment: "positive",
              strength: 1,
              contextId: context.id,
            },
          ],
        },
      }),
    );
    expect(stolen.status).toBe(404);
  });

  it("blocks horizontal access to seeds, contexts, and privacy requests (IDOR)", async () => {
    const { POST: createSeeds } = await import("../app/api/v1/taste/seeds/route.js");
    const seeded = await createSeeds(
      makeRequest("POST", "/api/v1/taste/seeds", {
        cookie: cookieA,
        body: {
          items: [
            { entityType: "artist", entityId: artistIds[0], sentiment: "positive", strength: 1, contextId: null },
          ],
        },
      }),
    );
    const seedId = ((await seeded.json()) as { items: { id: string }[] }).items[0]!.id;

    const seedRoutes = await import("../app/api/v1/taste/seeds/[seedId]/route.js");
    const params = { params: Promise.resolve({ seedId }) };

    const foreignPatch = await seedRoutes.PATCH(
      makeRequest("PATCH", `/api/v1/taste/seeds/${seedId}`, { cookie: cookieB, body: { strength: 0.1 } }),
      params,
    );
    expect(foreignPatch.status).toBe(404);

    const foreignDelete = await seedRoutes.DELETE(
      makeRequest("DELETE", `/api/v1/taste/seeds/${seedId}`, { cookie: cookieB, body: {} }),
      params,
    );
    expect(foreignDelete.status).toBe(404);

    const ownPatch = await seedRoutes.PATCH(
      makeRequest("PATCH", `/api/v1/taste/seeds/${seedId}`, { cookie: cookieA, body: { strength: 0.2 } }),
      params,
    );
    expect(ownPatch.status).toBe(200);

    // Privacy requests are user-scoped too.
    const { POST: requestExport } = await import("../app/api/v1/privacy/export/route.js");
    const exported = await requestExport(
      makeRequest("POST", "/api/v1/privacy/export", { cookie: cookieA, body: {} }),
    );
    const requestId = ((await exported.json()) as { id: string }).id;
    const requestRoute = await import("../app/api/v1/privacy/requests/[requestId]/route.js");
    const foreignRequest = await requestRoute.GET(
      makeRequest("GET", `/api/v1/privacy/requests/${requestId}`, { cookie: cookieB }),
      { params: Promise.resolve({ requestId }) },
    );
    expect(foreignRequest.status).toBe(404);
    const ownRequest = await requestRoute.GET(
      makeRequest("GET", `/api/v1/privacy/requests/${requestId}`, { cookie: cookieA }),
      { params: Promise.resolve({ requestId }) },
    );
    expect(ownRequest.status).toBe(200);
  });

  it("deleting a seed soft-deletes and enqueues profile recomputation", async () => {
    const { POST: createSeeds, GET: listSeeds } = await import("../app/api/v1/taste/seeds/route.js");
    const seeded = await createSeeds(
      makeRequest("POST", "/api/v1/taste/seeds", {
        cookie: cookieA,
        body: {
          items: [
            { entityType: "recording", entityId: recordingId, sentiment: "positive", strength: 1, contextId: null },
          ],
        },
      }),
    );
    const seedId = ((await seeded.json()) as { items: { id: string }[] }).items[0]!.id;

    harness.enqueued.length = 0;
    const seedRoutes = await import("../app/api/v1/taste/seeds/[seedId]/route.js");
    const removed = await seedRoutes.DELETE(
      makeRequest("DELETE", `/api/v1/taste/seeds/${seedId}`, { cookie: cookieA, body: {} }),
      { params: Promise.resolve({ seedId }) },
    );
    expect(removed.status).toBe(200);
    expect(harness.enqueued).toContainEqual({
      queue: QUEUES.tasteRecompute,
      data: { userId: expect.any(String), reason: "seed_removed" },
    });

    const listed = await listSeeds(makeRequest("GET", "/api/v1/taste/seeds", { cookie: cookieA }));
    const ids = ((await listed.json()) as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).not.toContain(seedId);
  });

  it("replays idempotent seed creation and rejects key reuse with a new body", async () => {
    const { POST } = await import("../app/api/v1/taste/seeds/route.js");
    const key = crypto.randomUUID();
    const body = {
      items: [
        { entityType: "artist", entityId: artistIds[0], sentiment: "positive", strength: 0.9, contextId: null },
      ],
    };
    const first = await POST(
      makeRequest("POST", "/api/v1/taste/seeds", { cookie: cookieA, body, idempotencyKey: key }),
    );
    const second = await POST(
      makeRequest("POST", "/api/v1/taste/seeds", { cookie: cookieA, body, idempotencyKey: key }),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());

    const conflicting = await POST(
      makeRequest("POST", "/api/v1/taste/seeds", {
        cookie: cookieA,
        body: {
          items: [
            { entityType: "artist", entityId: artistIds[1], sentiment: "positive", strength: 0.9, contextId: null },
          ],
        },
        idempotencyKey: key,
      }),
    );
    expect(conflicting.status).toBe(409);
  });
});

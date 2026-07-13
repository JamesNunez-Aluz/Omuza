import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consentRecords } from "@resonance/db";

import { createHarness, makeRequest, musicbrainzFetchFixture, signIn } from "./helpers";
import type { TestHarness } from "./helpers";

const RUN = Date.now().toString(36);
const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

describeWithDb("consent history and onboarding completion", () => {
  let harness: TestHarness;
  let cookie: string;

  beforeAll(async () => {
    harness = await createHarness();
    cookie = await signIn(harness.db, `onboarder-${RUN}@example.test`);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("consent withdrawal appends a record instead of mutating history", async () => {
    const { POST, GET } = await import("../app/api/v1/privacy/consents/route.js");
    await POST(
      makeRequest("POST", "/api/v1/privacy/consents", {
        cookie,
        body: { purpose: "model_improvement", status: "granted" },
      }),
    );
    await POST(
      makeRequest("POST", "/api/v1/privacy/consents", {
        cookie,
        body: { purpose: "model_improvement", status: "withdrawn" },
      }),
    );
    const listed = await GET(makeRequest("GET", "/api/v1/privacy/consents", { cookie }));
    const body = (await listed.json()) as { items: { purpose: string; status: string }[] };
    const history = body.items.filter((record) => record.purpose === "model_improvement");
    expect(history.length).toBe(2);
    expect(history.map((record) => record.status).sort()).toEqual(["granted", "withdrawn"]);
  });

  it("the database rejects any UPDATE or DELETE of consent records", async () => {
    const messageChain = (error: unknown): string => {
      let text = "";
      let current: unknown = error;
      while (current instanceof Error) {
        text += current.message;
        current = current.cause;
      }
      return text;
    };

    const updateError = await harness.db
      .update(consentRecords)
      .set({ status: "granted" })
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(messageChain(updateError)).toMatch(/append-only/);

    const deleteError = await harness.db
      .delete(consentRecords)
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(messageChain(deleteError)).toMatch(/append-only/);
  });

  it("onboarding cannot complete without required consents, then succeeds with seeds", async () => {
    const { POST: complete } = await import("../app/api/v1/onboarding/complete/route.js");
    const { POST: postConsent } = await import("../app/api/v1/privacy/consents/route.js");

    const missingConsent = await complete(
      makeRequest("POST", "/api/v1/onboarding/complete", { cookie, body: {} }),
    );
    expect(missingConsent.status).toBe(409);
    expect(((await missingConsent.json()) as { error: { code: string } }).error.code).toBe(
      "CONSENT_REQUIRED",
    );

    for (const purpose of ["terms_privacy", "core_personalization"]) {
      await postConsent(
        makeRequest("POST", "/api/v1/privacy/consents", { cookie, body: { purpose, status: "granted" } }),
      );
    }

    const missingSeeds = await complete(
      makeRequest("POST", "/api/v1/onboarding/complete", { cookie, body: {} }),
    );
    expect(missingSeeds.status).toBe(409);
    expect(((await missingSeeds.json()) as { error: { code: string } }).error.code).toBe(
      "INSUFFICIENT_SEEDS",
    );

    // Ingest catalog entities and declare 5 positive + 3 negative.
    harness.setMusicbrainzFetch(musicbrainzFetchFixture());
    const { GET: search } = await import("../app/api/v1/catalog/search/route.js");
    const artistResponse = await search(
      makeRequest("GET", "/api/v1/catalog/search?q=nebula&type=artist", { cookie }),
    );
    const artists = ((await artistResponse.json()) as { items: { id: string }[] }).items;
    const recordingResponse = await search(
      makeRequest("GET", "/api/v1/catalog/search?q=meridian&type=recording", { cookie }),
    );
    const recordings = ((await recordingResponse.json()) as { items: { id: string }[] }).items;

    const { POST: createSeeds } = await import("../app/api/v1/taste/seeds/route.js");
    const positive = [
      { entityType: "artist", entityId: artists[0]!.id, sentiment: "strong_positive", strength: 1 },
      { entityType: "artist", entityId: artists[1]!.id, sentiment: "positive", strength: 0.8 },
      { entityType: "recording", entityId: recordings[0]!.id, sentiment: "positive", strength: 0.5 },
      { entityType: "artist", entityId: artists[0]!.id, sentiment: "positive", strength: 0.3 },
      { entityType: "recording", entityId: recordings[0]!.id, sentiment: "strong_positive", strength: 1 },
    ];
    const negative = [
      { entityType: "artist", entityId: artists[1]!.id, sentiment: "hard_block", strength: 1 },
      { entityType: "artist", entityId: artists[0]!.id, sentiment: "fatigue", strength: 0.7 },
      { entityType: "recording", entityId: recordings[0]!.id, sentiment: "negative", strength: 0.8 },
    ];
    const seeded = await createSeeds(
      makeRequest("POST", "/api/v1/taste/seeds", {
        cookie,
        body: { items: [...positive, ...negative].map((item) => ({ ...item, contextId: null })) },
      }),
    );
    expect(seeded.status).toBe(201);

    const done = await complete(makeRequest("POST", "/api/v1/onboarding/complete", { cookie, body: {} }));
    expect(done.status).toBe(200);
    const body = (await done.json()) as { status: string; summary: { positives: number; negatives: number } };
    expect(body.status).toBe("completed");
    expect(body.summary.positives).toBeGreaterThanOrEqual(5);
    expect(body.summary.negatives).toBeGreaterThanOrEqual(3);
  });
});

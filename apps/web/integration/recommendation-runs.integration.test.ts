import { QUEUES, insertSeeds, seedSyntheticCatalog, users } from "@resonance/db";
import { buildSyntheticSnapshot, artistUuid } from "@resonance/testkit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHarness, makeRequest, signIn } from "./helpers";
import type { TestHarness } from "./helpers";

const RUN = Date.now().toString(36);
const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

describeWithDb("recommendation run API (spec §13.6–§13.7)", () => {
  let harness: TestHarness;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    harness = await createHarness();
    await seedSyntheticCatalog(harness.db, buildSyntheticSnapshot());
    cookieA = await signIn(harness.db, `runs-a-${RUN}@example.test`);
    cookieB = await signIn(harness.db, `runs-b-${RUN}@example.test`);

    const userRows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalized, `runs-a-${RUN}@example.test`));
    await insertSeeds(harness.db, userRows[0]!.id, [
      { entityType: "artist", artistId: artistUuid(0), sentiment: "strong_positive", strength: 1 },
      { entityType: "artist", artistId: artistUuid(1), sentiment: "positive", strength: 0.8 },
    ]);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("creates a queued run, enqueues the job, and honors idempotency", async () => {
    const { POST } = await import("../app/api/v1/recommendation-runs/route.js");
    const key = crypto.randomUUID();
    const first = await POST(
      makeRequest("POST", "/api/v1/recommendation-runs", {
        cookie: cookieA,
        body: { requestedCount: 20 },
        idempotencyKey: key,
      }),
    );
    expect(first.status).toBe(202);
    const body = (await first.json()) as { runId: string; status: string; statusUrl: string };
    expect(body.status).toBe("queued");
    expect(body.statusUrl).toBe(`/api/v1/recommendation-runs/${body.runId}`);
    expect(harness.enqueued).toContainEqual({
      queue: QUEUES.recommendationGenerate,
      data: { runId: body.runId },
    });

    const replay = await POST(
      makeRequest("POST", "/api/v1/recommendation-runs", {
        cookie: cookieA,
        body: { requestedCount: 20 },
        idempotencyKey: key,
      }),
    );
    expect(((await replay.json()) as { runId: string }).runId).toBe(body.runId);
  });

  it("run status is user-scoped: another user's run id answers 404", async () => {
    const { POST } = await import("../app/api/v1/recommendation-runs/route.js");
    const created = await POST(
      makeRequest("POST", "/api/v1/recommendation-runs", { cookie: cookieA, body: {} }),
    );
    const { runId } = (await created.json()) as { runId: string };

    const statusRoute = await import("../app/api/v1/recommendation-runs/[runId]/route.js");
    const params = { params: Promise.resolve({ runId }) };

    const foreign = await statusRoute.GET(
      makeRequest("GET", `/api/v1/recommendation-runs/${runId}`, { cookie: cookieB }),
      params,
    );
    expect(foreign.status).toBe(404);

    const own = await statusRoute.GET(
      makeRequest("GET", `/api/v1/recommendation-runs/${runId}`, { cookie: cookieA }),
      params,
    );
    expect(own.status).toBe(200);
    expect(((await own.json()) as { status: string }).status).toBe("queued");
  });

  it("rejects a foreign contextId (IDOR) and invalid counts", async () => {
    const { POST } = await import("../app/api/v1/recommendation-runs/route.js");
    const { POST: createContext } = await import("../app/api/v1/contexts/route.js");
    const contextResponse = await createContext(
      makeRequest("POST", "/api/v1/contexts", {
        cookie: cookieB,
        body: { name: `B context ${RUN}` },
      }),
    );
    const context = (await contextResponse.json()) as { id: string };

    const stolen = await POST(
      makeRequest("POST", "/api/v1/recommendation-runs", {
        cookie: cookieA,
        body: { contextId: context.id },
      }),
    );
    expect(stolen.status).toBe(404);

    const badCount = await POST(
      makeRequest("POST", "/api/v1/recommendation-runs", {
        cookie: cookieA,
        body: { requestedCount: 5 },
      }),
    );
    expect(badCount.status).toBe(400);
  });
});

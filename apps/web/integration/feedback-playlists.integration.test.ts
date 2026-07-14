import {
  analyticsEvents,
  completeRunWithTrace,
  createRecommendationRun,
  knownRecordings,
  seedSyntheticCatalog,
  users,
} from "@resonance/db";
import { buildSyntheticSnapshot, recordingUuid } from "@resonance/testkit";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHarness, makeRequest, signIn } from "./helpers";
import type { TestHarness } from "./helpers";

const RUN = Date.now().toString(36);
const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

describeWithDb("feedback + playlists + file export (spec §21 M3)", () => {
  let harness: TestHarness;
  let cookieA: string;
  let cookieB: string;
  let userAId: string;
  let runId: string;
  /** recommendationItemId per recording position from the fabricated run. */
  let runItems: { recommendationItemId: string; recordingId: string }[] = [];

  async function fabricateCompletedRun(recordingIds: string[]): Promise<string> {
    const run = await createRecommendationRun(harness.db, {
      userId: userAId,
      contextId: null,
      requestedCount: Math.max(recordingIds.length, 10),
      discoveryLevel: 50,
      randomSeed: `fab-${RUN}-${Math.abs(recordingIds.length)}-${recordingIds[0]}`,
    });
    await completeRunWithTrace(harness.db, {
      runId: run.id,
      userId: userAId,
      status: "completed",
      rankerVersion: "ranker@test",
      selectorVersion: "selector@test",
      profileSnapshotVersion: "profile@test",
      degradedProviders: [],
      constraintRelaxations: [],
      candidates: [],
      items: recordingIds.map((recordingId, index) => ({
        recordingId,
        position: index + 1,
        score: 0.5,
        noveltyProbability: 0.8,
        noveltyState: "probably_new",
        noveltyConfidence: 0.6,
        selectionReason: "top_score",
        explanation: {
          templateKey: "feature_bridge",
          renderedText: "Shares a tag you like.",
          evidence: [{ type: "feature_match", label: "tag", refId: "tag:test" }],
          generatorVersion: "explainer@test",
        },
      })),
    });
    // First owner view records exposures (required for feedback).
    const statusRoute = await import("../app/api/v1/recommendation-runs/[runId]/route.js");
    const viewed = await statusRoute.GET(
      makeRequest("GET", `/api/v1/recommendation-runs/${run.id}`, { cookie: cookieA }),
      { params: Promise.resolve({ runId: run.id }) },
    );
    const body = (await viewed.json()) as {
      items: { recommendationItemId: string; recording: { id: string } }[];
    };
    runItems = body.items.map((item) => ({
      recommendationItemId: item.recommendationItemId,
      recordingId: item.recording.id,
    }));
    return run.id;
  }

  beforeAll(async () => {
    harness = await createHarness();
    await seedSyntheticCatalog(harness.db, buildSyntheticSnapshot());
    cookieA = await signIn(harness.db, `fb-a-${RUN}@example.test`);
    cookieB = await signIn(harness.db, `fb-b-${RUN}@example.test`);
    const rows = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalized, `fb-a-${RUN}@example.test`));
    userAId = rows[0]!.id;

    runId = await fabricateCompletedRun([
      recordingUuid(0, 0),
      recordingUuid(1, 0),
      recordingUuid(2, 0),
      recordingUuid(4, 0),
    ]);
  });

  afterAll(async () => {
    await harness.close();
  });

  it("accepts feedback only for items exposed to this user", async () => {
    const { POST } = await import("../app/api/v1/feedback/route.js");
    const foreign = await POST(
      makeRequest("POST", "/api/v1/feedback", {
        cookie: cookieB,
        body: {
          clientEventId: crypto.randomUUID(),
          recommendationItemId: runItems[0]!.recommendationItemId,
          primaryResponse: "love",
        },
      }),
    );
    expect(foreign.status).toBe(422);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe("NOT_EXPOSED");
  });

  it("duplicate clientEventId is idempotent and returns the original event", async () => {
    const { POST } = await import("../app/api/v1/feedback/route.js");
    const clientEventId = crypto.randomUUID();
    const body = {
      clientEventId,
      recommendationItemId: runItems[0]!.recommendationItemId,
      primaryResponse: "love",
      reasonCodes: ["mood"],
    };
    const first = await POST(makeRequest("POST", "/api/v1/feedback", { cookie: cookieA, body }));
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };
    const replay = await POST(makeRequest("POST", "/api/v1/feedback", { cookie: cookieA, body }));
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { id: string }).id).toBe(firstBody.id);
  });

  it("revisions supersede; newness answers update the known ledger, not taste", async () => {
    const { POST, GET } = await import("../app/api/v1/feedback/route.js");
    const item = runItems[1]!;
    const first = await POST(
      makeRequest("POST", "/api/v1/feedback", {
        cookie: cookieA,
        body: {
          clientEventId: crypto.randomUUID(),
          recommendationItemId: item.recommendationItemId,
          primaryResponse: "like",
        },
      }),
    );
    const firstEvent = (await first.json()) as { id: string };

    const revision = await POST(
      makeRequest("POST", "/api/v1/feedback", {
        cookie: cookieA,
        body: {
          clientEventId: crypto.randomUUID(),
          recommendationItemId: item.recommendationItemId,
          primaryResponse: "dislike",
          newnessResponse: "already_knew",
          supersedesEventId: firstEvent.id,
        },
      }),
    );
    expect(revision.status).toBe(201);

    const listed = await GET(makeRequest("GET", `/api/v1/feedback?runId=${runId}`, { cookie: cookieA }));
    const events = ((await listed.json()) as { items: { id: string; supersedesEventId: string | null }[] })
      .items;
    expect(events.some((event) => event.supersedesEventId === firstEvent.id)).toBe(true);

    const known = await harness.db
      .select()
      .from(knownRecordings)
      .where(
        and(eq(knownRecordings.userId, userAId), eq(knownRecordings.recordingId, item.recordingId)),
      );
    expect(known[0]!.knowledgeState).toBe("confirmed_known");
    expect(known[0]!.source).toBe("user_feedback");
  });

  it("saves a run as a playlist, enforces ownership and optimistic concurrency", async () => {
    const { POST: createPlaylist } = await import("../app/api/v1/playlists/route.js");
    const created = await createPlaylist(
      makeRequest("POST", "/api/v1/playlists", {
        cookie: cookieA,
        body: { name: `M3 list ${RUN}`, sourceRunId: runId },
      }),
    );
    expect(created.status).toBe(201);
    const playlist = (await created.json()) as { id: string; version: number; items: unknown[] };
    expect(playlist.items).toHaveLength(4);

    const playlistRoute = await import("../app/api/v1/playlists/[playlistId]/route.js");
    const params = { params: Promise.resolve({ playlistId: playlist.id }) };

    const foreign = await playlistRoute.GET(
      makeRequest("GET", `/api/v1/playlists/${playlist.id}`, { cookie: cookieB }),
      params,
    );
    expect(foreign.status).toBe(404);

    const staleUpdate = await playlistRoute.PATCH(
      makeRequest("PATCH", `/api/v1/playlists/${playlist.id}`, {
        cookie: cookieA,
        body: { version: 999, name: "New name" },
      }),
      params,
    );
    expect(staleUpdate.status).toBe(409);

    const freshUpdate = await playlistRoute.PATCH(
      makeRequest("PATCH", `/api/v1/playlists/${playlist.id}`, {
        cookie: cookieA,
        body: { version: playlist.version, name: "Renamed" },
      }),
      params,
    );
    expect(freshUpdate.status).toBe(200);
  });

  it("rebuild preserves loved tracks and replaces the rest with lineage to the new run", async () => {
    const { POST: createPlaylist } = await import("../app/api/v1/playlists/route.js");
    const created = await createPlaylist(
      makeRequest("POST", "/api/v1/playlists", {
        cookie: cookieA,
        body: { name: `Rebuild ${RUN}`, sourceRunId: runId },
      }),
    );
    const playlist = (await created.json()) as { id: string };
    // Snapshot the ORIGINAL run's items before fabricating the replacement
    // run (the helper repopulates runItems).
    const originalItems = [...runItems];
    const loved = originalItems[0]!.recordingId;

    const replacementRunId = await fabricateCompletedRun([recordingUuid(10, 0), recordingUuid(11, 0)]);

    const rebuildRoute = await import("../app/api/v1/playlists/[playlistId]/rebuild/route.js");
    const rebuilt = await rebuildRoute.POST(
      makeRequest("POST", `/api/v1/playlists/${playlist.id}/rebuild`, {
        cookie: cookieA,
        body: { runId: replacementRunId, preserveRecordingIds: [loved] },
      }),
      { params: Promise.resolve({ playlistId: playlist.id }) },
    );
    expect(rebuilt.status).toBe(200);
    const body = (await rebuilt.json()) as {
      items: { recording: { id: string }; position: number }[];
    };
    const ids = body.items.map((item) => item.recording.id);
    expect(ids[0]).toBe(loved); // loved track preserved, first
    expect(ids).toContain(recordingUuid(10, 0));
    expect(ids).toContain(recordingUuid(11, 0));
    expect(ids).not.toContain(originalItems[1]!.recordingId); // disliked/unloved replaced
    expect(body.items).toHaveLength(3);
  });

  it("exports CSV and M3U with no destination connection", async () => {
    const { POST: createPlaylist } = await import("../app/api/v1/playlists/route.js");
    const created = await createPlaylist(
      makeRequest("POST", "/api/v1/playlists", {
        cookie: cookieA,
        body: { name: `Export ${RUN}`, sourceRunId: runId },
      }),
    );
    const playlist = (await created.json()) as { id: string };

    const exportRoute = await import("../app/api/v1/playlists/[playlistId]/exports/file/route.js");
    const params = { params: Promise.resolve({ playlistId: playlist.id }) };

    const csv = await exportRoute.POST(
      makeRequest("POST", `/api/v1/playlists/${playlist.id}/exports/file`, {
        cookie: cookieA,
        body: { format: "csv" },
      }),
      params,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const csvText = await csv.text();
    expect(csvText.split("\r\n")[0]).toBe(
      "position,title,artist,recording_mbid,isrc,release_year,novelty_state,explanation",
    );
    expect(csvText).toContain("probably_new");
    expect(csvText).toContain("Synthetic");

    const m3u = await exportRoute.POST(
      makeRequest("POST", `/api/v1/playlists/${playlist.id}/exports/file`, {
        cookie: cookieA,
        body: { format: "m3u" },
      }),
      params,
    );
    expect(m3u.status).toBe(200);
    expect(await m3u.text()).toContain("#EXTM3U");

    const foreign = await exportRoute.POST(
      makeRequest("POST", `/api/v1/playlists/${playlist.id}/exports/file`, {
        cookie: cookieB,
        body: { format: "csv" },
      }),
      params,
    );
    expect(foreign.status).toBe(404);
  });

  it("analytics events exist for the funnel and contain no raw text, email, or payloads", async () => {
    const rows = await harness.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.userId, userAId));
    const names = new Set(rows.map((row) => row.eventName));
    expect(names).toContain("feedback_submitted");
    expect(names).toContain("playlist_saved");
    expect(names).toContain("file_export_completed");
    for (const row of rows) {
      const serialized = JSON.stringify(row.properties);
      expect(serialized).not.toMatch(/@example\.test|@gmail|email/i);
      expect(serialized).not.toMatch(/Synthetic /); // no titles/free text
      expect(serialized.length).toBeLessThan(500);
    }
  });
});

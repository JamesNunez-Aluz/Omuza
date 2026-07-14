import {
  QUEUES,
  appendFeedbackEvent,
  findFeedbackByClientEventId,
  findOwnFeedbackEvent,
  findUserExposureForItem,
  getContextProfile,
  listRunFeedback,
  recordAnalyticsEvent,
  upsertKnownRecording,
} from "@resonance/db";
import { knowledgeUpdateFor } from "@resonance/domain";
import type { NewnessResponse, PrimaryResponse } from "@resonance/domain";
import { postFeedbackSchema } from "@resonance/validation";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/feedback (spec §13.8). Append-only: revisions supersede.
 * The item must have been exposed to this user; duplicates by clientEventId
 * return the original event.
 */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const body = await parseJsonBody(request, postFeedbackSchema);
    if (isResponse(body)) return body;

    const existing = await findFeedbackByClientEventId(ctx.db, user.id, body.clientEventId);
    if (existing) {
      return Response.json(serialize(existing), { status: 200 });
    }

    // Exposure verification: only items actually shown to this user (§13.8).
    const exposure = await findUserExposureForItem(ctx.db, user.id, body.recommendationItemId);
    if (!exposure) {
      return apiError({
        status: 422,
        code: "NOT_EXPOSED",
        message: "Feedback is only accepted for recommendations that were shown to you.",
      });
    }

    if (body.contextId) {
      const context = await getContextProfile(ctx.db, user.id, body.contextId);
      if (!context) return notFound();
    }
    if (body.supersedesEventId) {
      const superseded = await findOwnFeedbackEvent(ctx.db, user.id, body.supersedesEventId);
      if (!superseded) return notFound();
      if (superseded.recordingId !== exposure.recordingId) {
        return apiError({
          status: 409,
          code: "SUPERSEDE_MISMATCH",
          message: "A revision must supersede feedback for the same recording.",
        });
      }
    }

    const event = await appendFeedbackEvent(ctx.db, {
      userId: user.id,
      recordingId: exposure.recordingId,
      exposureId: exposure.exposureId,
      recommendationRunId: exposure.runId,
      primaryResponse: body.primaryResponse,
      reasonCodes: body.reasonCodes,
      newnessResponse: body.newnessResponse,
      contextId: body.contextId,
      supersedesEventId: body.supersedesEventId,
      clientEventId: body.clientEventId,
    });

    // Novelty truth updates (spec §10.9): user answers dominate; taste untouched.
    const knowledge = knowledgeUpdateFor(
      body.primaryResponse as PrimaryResponse,
      body.newnessResponse as NewnessResponse | null,
    );
    if (knowledge) {
      await upsertKnownRecording(ctx.db, {
        userId: user.id,
        recordingId: exposure.recordingId,
        knowledgeState: knowledge.knowledgeState,
        confidence: knowledge.confidence,
        source: "user_feedback",
      });
    }

    await ctx.enqueue(QUEUES.tasteRecompute, { userId: user.id, reason: "feedback_received" });
    await recordAnalyticsEvent(ctx.db, user.id, "feedback_submitted", {
      runId: exposure.runId,
      primaryResponse: body.primaryResponse,
      reasonCount: body.reasonCodes.length,
      newnessAnswered: body.newnessResponse !== null,
    });

    return Response.json(serialize(event), { status: 201 });
  });
}

/** GET /api/v1/feedback?runId= — the user's feedback for a run (UI state). */
export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const runId = new URL(request.url).searchParams.get("runId");
    if (!runId || !z.string().uuid().safeParse(runId).success) {
      return apiError({ status: 400, code: "VALIDATION_FAILED", message: "runId is required." });
    }
    const events = await listRunFeedback(ctx.db, user.id, runId);
    return Response.json({ items: events.map(serialize) });
  });
}

function serialize(event: {
  id: string;
  recordingId: string;
  primaryResponse: string;
  reasonCodes: string[];
  newnessResponse: string | null;
  contextId: string | null;
  supersedesEventId: string | null;
  clientEventId: string;
  occurredAt: Date;
}) {
  return {
    id: event.id,
    recordingId: event.recordingId,
    primaryResponse: event.primaryResponse,
    reasonCodes: event.reasonCodes,
    newnessResponse: event.newnessResponse,
    contextId: event.contextId,
    supersedesEventId: event.supersedesEventId,
    clientEventId: event.clientEventId,
    occurredAt: event.occurredAt,
  };
}

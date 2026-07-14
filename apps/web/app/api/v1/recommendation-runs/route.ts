import { randomBytes } from "node:crypto";

import {
  QUEUES,
  createRecommendationRun,
  findIdempotentResponse,
  getContextProfile,
  hashRequestBody,
  storeIdempotentResponse,
} from "@resonance/db";
import { createRecommendationRunSchema } from "@resonance/validation";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/recommendation-runs (spec §13.6): queue an async generation. */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const idempotencyKey = request.headers.get("idempotency-key");
    const body = await parseJsonBody(request, createRecommendationRunSchema);
    if (isResponse(body)) return body;

    const route = "POST /api/v1/recommendation-runs";
    const requestHash = hashRequestBody(body);
    if (idempotencyKey) {
      const stored = await findIdempotentResponse(ctx.db, idempotencyKey, user.id, route);
      if (stored) {
        if (stored.requestHash !== requestHash) {
          return apiError({
            status: 409,
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "This Idempotency-Key was already used with a different request body.",
          });
        }
        return Response.json(stored.response, { status: stored.status });
      }
    }

    let discoveryLevel = body.discoveryLevel ?? 50;
    let intentSnapshot: unknown = null;
    if (body.contextId) {
      const context = await getContextProfile(ctx.db, user.id, body.contextId);
      if (!context) return notFound();
      discoveryLevel = body.discoveryLevel ?? context.discoveryLevel;
      intentSnapshot = context.structuredIntent;
    }

    const run = await createRecommendationRun(ctx.db, {
      userId: user.id,
      contextId: body.contextId,
      requestedCount: body.requestedCount,
      discoveryLevel,
      structuredIntentSnapshot: intentSnapshot,
      randomSeed: randomBytes(16).toString("hex"),
    });
    await ctx.enqueue(QUEUES.recommendationGenerate, { runId: run.id });

    const responseBody = {
      runId: run.id,
      status: run.status,
      statusUrl: `/api/v1/recommendation-runs/${run.id}`,
    };
    if (idempotencyKey) {
      await storeIdempotentResponse(ctx.db, {
        key: idempotencyKey,
        userId: user.id,
        route,
        requestHash,
        status: 202,
        response: responseBody,
      });
    }
    return Response.json(responseBody, { status: 202 });
  });
}

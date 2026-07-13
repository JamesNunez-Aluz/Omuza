import {
  QUEUES,
  artistExists,
  findIdempotentResponse,
  getContextProfile,
  hashRequestBody,
  insertSeeds,
  listActiveSeeds,
  recordingExists,
  storeIdempotentResponse,
} from "@resonance/db";
import { createSeedsSchema } from "@resonance/validation";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const seeds = await listActiveSeeds(ctx.db, user.id);
    return Response.json({ items: seeds });
  });
}

/** POST /api/v1/taste/seeds (spec §13.4) — bulk declare, idempotent. */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const idempotencyKey = request.headers.get("idempotency-key");
    const body = await parseJsonBody(request, createSeedsSchema);
    if (isResponse(body)) return body;

    const route = "POST /api/v1/taste/seeds";
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

    // Validate entity references (unknown ids are client errors, not FK 500s)
    // and context ownership (a foreign contextId is an IDOR attempt → 404).
    for (const item of body.items) {
      const exists =
        item.entityType === "artist"
          ? await artistExists(ctx.db, item.entityId)
          : await recordingExists(ctx.db, item.entityId);
      if (!exists) {
        return apiError({
          status: 422,
          code: "UNKNOWN_ENTITY",
          message: "One or more referenced catalog entities do not exist.",
          details: { entityId: item.entityId },
        });
      }
      if (item.contextId) {
        const context = await getContextProfile(ctx.db, user.id, item.contextId);
        if (!context) {
          return apiError({
            status: 404,
            code: "NOT_FOUND",
            message: "The requested resource does not exist.",
          });
        }
      }
    }

    const inserted = await insertSeeds(
      ctx.db,
      user.id,
      body.items.map((item) => ({
        entityType: item.entityType,
        ...(item.entityType === "artist"
          ? { artistId: item.entityId }
          : { recordingId: item.entityId }),
        sentiment: item.sentiment,
        strength: item.strength,
        contextId: item.contextId,
      })),
    );
    await ctx.enqueue(QUEUES.tasteRecompute, { userId: user.id, reason: "seed_added" });

    const responseBody = { items: inserted };
    if (idempotencyKey) {
      await storeIdempotentResponse(ctx.db, {
        key: idempotencyKey,
        userId: user.id,
        route,
        requestHash,
        status: 201,
        response: responseBody,
      });
    }
    return Response.json(responseBody, { status: 201 });
  });
}

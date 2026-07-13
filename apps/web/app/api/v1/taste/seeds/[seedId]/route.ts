import { QUEUES, getContextProfile, softDeleteSeed, updateSeed } from "@resonance/db";
import { patchSeedSchema } from "@resonance/validation";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

const seedIdSchema = z.string().uuid();

type RouteParams = { params: Promise<{ seedId: string }> };

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { seedId } = await params;
    if (!seedIdSchema.safeParse(seedId).success) return notFound();

    const body = await parseJsonBody(request, patchSeedSchema);
    if (isResponse(body)) return body;

    if (body.contextId) {
      const context = await getContextProfile(ctx.db, user.id, body.contextId);
      if (!context) return notFound();
    }

    const updated = await updateSeed(ctx.db, user.id, seedId, body);
    if (!updated) return notFound();

    await ctx.enqueue(QUEUES.tasteRecompute, { userId: user.id, reason: "seed_updated" });
    return Response.json(updated);
  });
}

/** Soft delete; recomputation removes the seed's derived preferences. */
export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { seedId } = await params;
    if (!seedIdSchema.safeParse(seedId).success) return notFound();

    const removed = await softDeleteSeed(ctx.db, user.id, seedId);
    if (!removed) return notFound();

    await ctx.enqueue(QUEUES.tasteRecompute, { userId: user.id, reason: "seed_removed" });
    return Response.json({ status: "removed" });
  });
}

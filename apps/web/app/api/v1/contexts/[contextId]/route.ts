import {
  getContextProfile,
  softDeleteContextProfile,
  updateContextProfile,
} from "@resonance/db";
import { patchContextProfileSchema } from "@resonance/validation";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

const contextIdSchema = z.string().uuid();

type RouteParams = { params: Promise<{ contextId: string }> };

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { contextId } = await params;
    if (!contextIdSchema.safeParse(contextId).success) return notFound();
    const context = await getContextProfile(ctx.db, user.id, contextId);
    if (!context) return notFound();
    return Response.json(context);
  });
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { contextId } = await params;
    if (!contextIdSchema.safeParse(contextId).success) return notFound();
    const body = await parseJsonBody(request, patchContextProfileSchema);
    if (isResponse(body)) return body;
    const updated = await updateContextProfile(ctx.db, user.id, contextId, body);
    if (!updated) return notFound();
    return Response.json(updated);
  });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { contextId } = await params;
    if (!contextIdSchema.safeParse(contextId).success) return notFound();
    const removed = await softDeleteContextProfile(ctx.db, user.id, contextId);
    if (!removed) return notFound();
    return Response.json({ status: "removed" });
  });
}

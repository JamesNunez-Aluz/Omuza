import { getPrivacyRequest } from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { notFound } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ requestId: string }> };

/** User-scoped lookup: someone else's request id is indistinguishable from absent. */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { requestId } = await params;
    if (!z.string().uuid().safeParse(requestId).success) return notFound();
    const found = await getPrivacyRequest(ctx.db, user.id, requestId);
    if (!found) return notFound();
    return Response.json(found);
  });
}

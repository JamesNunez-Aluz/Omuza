import { reorderPlaylistItems } from "@resonance/db";
import { reorderPlaylistSchema } from "@resonance/validation";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ playlistId: string }> };

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId } = await params;
    if (!z.string().uuid().safeParse(playlistId).success) return notFound();
    const body = await parseJsonBody(request, reorderPlaylistSchema);
    if (isResponse(body)) return body;
    const ok = await reorderPlaylistItems(ctx.db, user.id, playlistId, body.orderedItemIds);
    if (!ok) {
      return apiError({
        status: 409,
        code: "REORDER_MISMATCH",
        message: "The item list does not match the playlist's current items.",
      });
    }
    return Response.json({ status: "reordered" });
  });
}

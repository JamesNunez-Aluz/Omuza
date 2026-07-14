import { removePlaylistItem } from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { notFound } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ playlistId: string; itemId: string }> };

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId, itemId } = await params;
    const idSchema = z.string().uuid();
    if (!idSchema.safeParse(playlistId).success || !idSchema.safeParse(itemId).success) {
      return notFound();
    }
    const removed = await removePlaylistItem(ctx.db, user.id, playlistId, itemId);
    if (!removed) return notFound();
    return Response.json({ status: "removed" });
  });
}

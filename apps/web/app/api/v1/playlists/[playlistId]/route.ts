import {
  getPlaylist,
  listPlaylistItems,
  softDeletePlaylist,
  updatePlaylist,
} from "@resonance/db";
import { patchPlaylistSchema } from "@resonance/validation";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ playlistId: string }> };

const idSchema = z.string().uuid();

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId } = await params;
    if (!idSchema.safeParse(playlistId).success) return notFound();
    const playlist = await getPlaylist(ctx.db, user.id, playlistId);
    if (!playlist) return notFound();
    const items = await listPlaylistItems(ctx.db, playlist.id);
    return Response.json({ ...playlist, items });
  });
}

/** PATCH with optimistic concurrency: the body carries the expected version. */
export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId } = await params;
    if (!idSchema.safeParse(playlistId).success) return notFound();
    const body = await parseJsonBody(request, patchPlaylistSchema);
    if (isResponse(body)) return body;
    const { version, ...patch } = body;
    const result = await updatePlaylist(ctx.db, user.id, playlistId, version, patch);
    if (result === undefined) return notFound();
    if (result === "conflict") {
      return apiError({
        status: 409,
        code: "VERSION_CONFLICT",
        message: "The playlist changed since you loaded it. Reload and retry.",
        retryable: true,
      });
    }
    return Response.json(result);
  });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId } = await params;
    if (!idSchema.safeParse(playlistId).success) return notFound();
    const removed = await softDeletePlaylist(ctx.db, user.id, playlistId);
    if (!removed) return notFound();
    return Response.json({ status: "deleted" });
  });
}

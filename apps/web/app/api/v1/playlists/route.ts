import {
  createPlaylistFromRun,
  getContextProfile,
  getRecommendationRun,
  listPlaylistItems,
  listPlaylists,
  recordAnalyticsEvent,
} from "@resonance/db";
import { createPlaylistSchema } from "@resonance/validation";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const items = await listPlaylists(ctx.db, user.id);
    return Response.json({ items });
  });
}

/** POST /api/v1/playlists — save a completed run as a durable playlist. */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const body = await parseJsonBody(request, createPlaylistSchema);
    if (isResponse(body)) return body;

    const run = await getRecommendationRun(ctx.db, user.id, body.sourceRunId);
    if (!run) return notFound();
    if (run.status !== "completed" && run.status !== "degraded") {
      return apiError({
        status: 409,
        code: "RUN_NOT_FINISHED",
        message: "Only a finished run can be saved as a playlist.",
      });
    }
    if (body.contextId) {
      const context = await getContextProfile(ctx.db, user.id, body.contextId);
      if (!context) return notFound();
    }

    const playlist = await createPlaylistFromRun(ctx.db, {
      userId: user.id,
      name: body.name,
      description: body.description,
      contextId: body.contextId,
      sourceRunId: body.sourceRunId,
    });
    const items = await listPlaylistItems(ctx.db, playlist.id);
    await recordAnalyticsEvent(ctx.db, user.id, "playlist_saved", {
      playlistId: playlist.id,
      itemCount: items.length,
    });
    return Response.json({ ...playlist, items }, { status: 201 });
  });
}

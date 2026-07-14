import {
  getPlaylist,
  getRecommendationRun,
  listPlaylistItems,
  rebuildPlaylistFromRun,
  recordAnalyticsEvent,
} from "@resonance/db";
import { rebuildPlaylistSchema } from "@resonance/validation";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ playlistId: string }> };

/**
 * Rebuild a playlist from a finished run while preserving kept recordings
 * (spec §5.5 "preserve loved tracks and rebuild around them"). The client
 * first creates a run with preserveRecordingIds/excludeRecordingIds, then
 * applies it here; lineage to the new run's items is retained per item.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId } = await params;
    if (!z.string().uuid().safeParse(playlistId).success) return notFound();
    const body = await parseJsonBody(request, rebuildPlaylistSchema);
    if (isResponse(body)) return body;

    const playlist = await getPlaylist(ctx.db, user.id, playlistId);
    if (!playlist) return notFound();
    const run = await getRecommendationRun(ctx.db, user.id, body.runId);
    if (!run) return notFound();
    if (run.status !== "completed" && run.status !== "degraded") {
      return apiError({
        status: 409,
        code: "RUN_NOT_FINISHED",
        message: "Only a finished run can be applied to a playlist.",
      });
    }

    const ok = await rebuildPlaylistFromRun(ctx.db, user.id, playlistId, body.runId, body.preserveRecordingIds);
    if (!ok) return notFound();

    const items = await listPlaylistItems(ctx.db, playlistId);
    await recordAnalyticsEvent(ctx.db, user.id, "playlist_rebuilt", {
      playlistId,
      keptCount: body.preserveRecordingIds.length,
      addedCount: Math.max(items.length - body.preserveRecordingIds.length, 0),
    });
    return Response.json({ status: "rebuilt", items });
  });
}

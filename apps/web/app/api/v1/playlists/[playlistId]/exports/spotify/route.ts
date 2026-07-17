import { randomUUID } from "node:crypto";

import {
  QUEUES,
  createOrGetExport,
  getActiveConnection,
  getPlaylist,
  listPlaylistItems,
} from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, notFound } from "@/server/http";
import { spotifyPilotGuard } from "@/server/spotify";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ playlistId: string }> };

/**
 * POST /api/v1/playlists/{id}/exports/spotify (spec §13.12): queue an export.
 * Idempotency-Key deduplicates repeated clicks — replays return the same
 * export instead of creating another destination playlist.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId } = await params;
    if (!z.string().uuid().safeParse(playlistId).success) return notFound();
    const guardResponse = spotifyPilotGuard(ctx.config, user);
    if (guardResponse) return guardResponse;

    const playlist = await getPlaylist(ctx.db, user.id, playlistId);
    if (!playlist) return notFound();

    const connection = await getActiveConnection(ctx.db, user.id, "spotify");
    if (!connection) {
      return apiError({
        status: 409,
        code: "SPOTIFY_NOT_CONNECTED",
        message: "Connect Spotify in Settings before exporting.",
      });
    }

    const items = await listPlaylistItems(ctx.db, playlistId);
    if (items.length === 0) {
      return apiError({
        status: 409,
        code: "EMPTY_PLAYLIST",
        message: "This playlist has no tracks to export.",
      });
    }

    const idempotencyKey = request.headers.get("idempotency-key") ?? randomUUID();
    const { export: exportRow, created } = await createOrGetExport(ctx.db, {
      userId: user.id,
      playlistId,
      destination: "spotify",
      connectionId: connection.id,
      idempotencyKey,
      itemCount: items.length,
    });
    if (created) {
      await ctx.enqueue(QUEUES.spotifyExport, { exportId: exportRow.id });
    }

    return Response.json(
      {
        exportId: exportRow.id,
        status: exportRow.status,
        statusUrl: `/api/v1/exports/${exportRow.id}`,
      },
      { status: created ? 202 : 200 },
    );
  });
}

import {
  getPlaylist,
  listPlaylistItems,
  loadItemLineage,
  recordAnalyticsEvent,
} from "@resonance/db";
import { fileExportSchema } from "@resonance/validation";
import { z } from "zod";

import { buildCsv, buildM3u } from "@/server/file-export";
import type { ExportItem } from "@/server/file-export";
import { withAuth } from "@/server/guard";
import { isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ playlistId: string }> };

/**
 * POST /api/v1/playlists/{id}/exports/file (spec §13.10). Service-neutral
 * CSV/M3U downloads that work with no destination connection at all.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { playlistId } = await params;
    if (!z.string().uuid().safeParse(playlistId).success) return notFound();
    const body = await parseJsonBody(request, fileExportSchema);
    if (isResponse(body)) return body;

    const playlist = await getPlaylist(ctx.db, user.id, playlistId);
    if (!playlist) return notFound();
    const items = await listPlaylistItems(ctx.db, playlistId);
    const lineage = await loadItemLineage(
      ctx.db,
      items.flatMap((item) => (item.sourceRecommendationItemId ? [item.sourceRecommendationItemId] : [])),
    );

    const exportItems: ExportItem[] = items.map((item) => {
      const itemLineage = item.sourceRecommendationItemId
        ? lineage.get(item.sourceRecommendationItemId)
        : undefined;
      return {
        position: item.position,
        title: item.recording.title,
        artists: item.recording.artists.map((artist) => artist.name),
        recordingMbid: item.recording.canonicalMbid,
        isrc: item.recording.isrc,
        releaseYear: item.recording.firstReleaseDate?.slice(0, 4) ?? null,
        noveltyState: itemLineage?.noveltyState ?? null,
        explanation: itemLineage?.explanation ?? null,
        durationMs: item.recording.durationMs,
      };
    });

    const filenameBase = playlist.name.replaceAll(/[^\p{L}\p{N} _-]/gu, "").trim() || "playlist";
    const content = body.format === "csv" ? buildCsv(exportItems) : buildM3u(playlist.name, exportItems);
    const contentType = body.format === "csv" ? "text/csv; charset=utf-8" : "audio/x-mpegurl";
    const extension = body.format === "csv" ? "csv" : "m3u8";

    await recordAnalyticsEvent(ctx.db, user.id, "file_export_completed", {
      playlistId,
      format: body.format,
      itemCount: exportItems.length,
    });

    return new Response(content, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${filenameBase}.${extension}"`,
        "cache-control": "no-store",
      },
    });
  });
}

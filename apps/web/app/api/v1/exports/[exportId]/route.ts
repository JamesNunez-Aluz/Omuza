import { getExport, listItemResolutions } from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { notFound } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ exportId: string }> };

/**
 * Export status/review (spec §13.12). Exposes only counts, states, and the
 * temporary display fields needed for match review — never tokens or raw
 * provider payloads.
 */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { exportId } = await params;
    if (!z.string().uuid().safeParse(exportId).success) return notFound();
    const exportRow = await getExport(ctx.db, user.id, exportId);
    if (!exportRow) return notFound();

    const resolutions = await listItemResolutions(ctx.db, exportId);
    return Response.json({
      id: exportRow.id,
      status: exportRow.status,
      playlistId: exportRow.playlistId,
      destinationUrl: exportRow.destinationUrl,
      itemCount: exportRow.itemCount,
      resolved: exportRow.resolvedCount,
      inserted: exportRow.insertedCount,
      unresolved: resolutions.filter((row) => row.status === "unresolved").length,
      needsConfirmation: resolutions.filter((row) => row.status === "needs_confirmation").length,
      errorCode: exportRow.errorCode,
      items: resolutions.map((row) => ({
        recordingId: row.recordingId,
        status: row.status,
        matchMethod: row.matchMethod,
        confidence: row.confidence,
        candidate:
          row.temporaryDisplayTitle !== null
            ? {
                displayTitle: row.temporaryDisplayTitle,
                displayArtist: row.temporaryDisplayArtist,
              }
            : null,
      })),
    });
  });
}

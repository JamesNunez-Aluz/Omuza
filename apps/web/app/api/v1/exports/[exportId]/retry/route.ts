import { randomUUID } from "node:crypto";

import {
  QUEUES,
  createOrGetExport,
  getExport,
  updateExport,
} from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ exportId: string }> };

const retrySchema = z.object({
  /**
   * resume       — continue a rate-limited/interrupted export (safe: the
   *                destination playlist id is persisted, never recreated).
   * keep         — accept a possibly-completed ambiguous export as-is.
   * clean_retry  — new export + new destination playlist; the prior export is
   *                marked superseded. Nothing is deleted from Spotify (§12.8.7).
   */
  mode: z.enum(["resume", "keep", "clean_retry"]),
});

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { exportId } = await params;
    if (!z.string().uuid().safeParse(exportId).success) return notFound();
    const exportRow = await getExport(ctx.db, user.id, exportId);
    if (!exportRow) return notFound();

    const body = await parseJsonBody(request, retrySchema);
    if (isResponse(body)) return body;

    if (body.mode === "resume") {
      if (!["rate_limited", "authorization_required", "requested"].includes(exportRow.status)) {
        return apiError({
          status: 409,
          code: "NOT_RESUMABLE",
          message: "This export cannot be resumed in its current state.",
        });
      }
      await updateExport(ctx.db, exportId, { status: "requested", errorCode: null });
      await ctx.enqueue(QUEUES.spotifyExport, { exportId });
      return Response.json({ status: "resumed", exportId });
    }

    if (exportRow.status !== "ambiguous") {
      return apiError({
        status: 409,
        code: "NOT_AMBIGUOUS",
        message: "This option applies only to exports with an unknown outcome.",
      });
    }

    if (body.mode === "keep") {
      await updateExport(ctx.db, exportId, {
        status: "completed",
        errorCode: "ambiguous_completion_unverified",
        completedAt: new Date(),
      });
      return Response.json({ status: "kept", exportId, destinationUrl: exportRow.destinationUrl });
    }

    // clean_retry: a NEW export creating a NEW playlist; prior marked superseded.
    if (!exportRow.connectionId) {
      return apiError({
        status: 409,
        code: "SPOTIFY_NOT_CONNECTED",
        message: "Reconnect Spotify before retrying this export.",
      });
    }
    const { export: fresh } = await createOrGetExport(ctx.db, {
      userId: user.id,
      playlistId: exportRow.playlistId,
      destination: "spotify",
      connectionId: exportRow.connectionId,
      idempotencyKey: randomUUID(),
      itemCount: exportRow.itemCount,
    });
    await updateExport(ctx.db, exportId, {
      status: "superseded",
      supersededByExportId: fresh.id,
    });
    await ctx.enqueue(QUEUES.spotifyExport, { exportId: fresh.id });
    return Response.json({ status: "clean_retry", exportId: fresh.id }, { status: 202 });
  });
}

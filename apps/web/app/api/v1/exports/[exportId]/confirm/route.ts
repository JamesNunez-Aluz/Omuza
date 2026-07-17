import {
  QUEUES,
  getExport,
  listItemResolutions,
  setResolutionStatus,
  updateExport,
} from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ exportId: string }> };

const confirmSchema = z.object({
  confirmations: z
    .array(z.object({ recordingId: z.string().uuid(), accept: z.boolean() }))
    .min(1)
    .max(100),
});

/**
 * Match review (spec §12.5 step 3, §13.12): user confirms or rejects
 * ambiguous candidates. Scoped strictly to export resolution — this never
 * touches taste data. When nothing is left to review, the export resumes.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { exportId } = await params;
    if (!z.string().uuid().safeParse(exportId).success) return notFound();
    const exportRow = await getExport(ctx.db, user.id, exportId);
    if (!exportRow) return notFound();
    if (exportRow.status !== "needs_review") {
      return apiError({
        status: 409,
        code: "NOT_IN_REVIEW",
        message: "This export is not waiting for match review.",
      });
    }

    const body = await parseJsonBody(request, confirmSchema);
    if (isResponse(body)) return body;

    for (const confirmation of body.confirmations) {
      await setResolutionStatus(
        ctx.db,
        exportId,
        confirmation.recordingId,
        confirmation.accept ? "confirmed" : "rejected",
      );
    }

    const remaining = (await listItemResolutions(ctx.db, exportId)).filter(
      (row) => row.status === "needs_confirmation",
    );
    if (remaining.length === 0) {
      await updateExport(ctx.db, exportId, { status: "requested" });
      await ctx.enqueue(QUEUES.spotifyExport, { exportId });
    }
    return Response.json({ status: remaining.length === 0 ? "resumed" : "needs_review", remaining: remaining.length });
  });
}

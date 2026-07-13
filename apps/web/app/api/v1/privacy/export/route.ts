import { QUEUES, createPrivacyRequest, recordAuditEvent } from "@resonance/db";

import { withAuth } from "@/server/guard";

export const dynamic = "force-dynamic";

/** Queue a data export (spec §13.13); the worker assembles the payload. */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const created = await createPrivacyRequest(ctx.db, user.id, "export");
    await recordAuditEvent(ctx.db, {
      userId: user.id,
      action: "privacy_export_requested",
      entityType: "privacy_request",
      entityId: created.id,
    });
    await ctx.enqueue(QUEUES.privacyExport, { userId: user.id, requestId: created.id });
    return Response.json(created, { status: 202 });
  });
}

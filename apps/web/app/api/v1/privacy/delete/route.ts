import { QUEUES, createPrivacyRequest, recordAuditEvent, setUserStatus } from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Account deletion (spec §13.13): asynchronous, auditable, user-visible
 * status. Step-up authentication: the user must retype a confirmation phrase
 * (full re-auth lands with the admin surface in Milestone 5+; documented in
 * the threat model as TM-11).
 */
const deleteConfirmationSchema = z.object({
  confirm: z.literal("delete my account"),
});

export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const body = await parseJsonBody(request, deleteConfirmationSchema);
    if (isResponse(body)) {
      return apiError({
        status: 400,
        code: "CONFIRMATION_REQUIRED",
        message: 'Deletion requires the confirmation phrase "delete my account".',
      });
    }

    const created = await createPrivacyRequest(ctx.db, user.id, "delete");
    await setUserStatus(ctx.db, user.id, "deletion_pending");
    await recordAuditEvent(ctx.db, {
      userId: user.id,
      action: "privacy_delete_requested",
      entityType: "privacy_request",
      entityId: created.id,
    });
    await ctx.enqueue(QUEUES.privacyDelete, { userId: user.id, requestId: created.id });
    return Response.json(created, { status: 202 });
  });
}

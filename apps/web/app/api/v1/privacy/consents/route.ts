import { appendConsentRecord, listConsentRecords } from "@resonance/db";
import { CURRENT_POLICY_VERSIONS } from "@resonance/domain";
import { postConsentSchema } from "@resonance/validation";

import { withAuth } from "@/server/guard";
import { isResponse, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const records = await listConsentRecords(ctx.db, user.id);
    return Response.json({ items: records });
  });
}

/**
 * Consent changes append a new record (never mutate history — the database
 * trigger enforces it). Withdrawal is therefore always reversible evidence.
 */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const body = await parseJsonBody(request, postConsentSchema);
    if (isResponse(body)) return body;
    const record = await appendConsentRecord(ctx.db, {
      userId: user.id,
      purpose: body.purpose,
      policyVersion: CURRENT_POLICY_VERSIONS[body.purpose],
      status: body.status,
    });
    return Response.json(record, { status: 201 });
  });
}

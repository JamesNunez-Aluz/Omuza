import { updateUserProfile } from "@resonance/db";
import { patchSettingsSchema } from "@resonance/validation";

import { withAuth } from "@/server/guard";
import { isResponse, notFound, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }) => {
    return Response.json({
      displayName: user.displayName,
      locale: user.locale,
      timeZone: user.timeZone,
    });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const body = await parseJsonBody(request, patchSettingsSchema);
    if (isResponse(body)) return body;
    const updated = await updateUserProfile(ctx.db, user.id, body);
    if (!updated) return notFound();
    return Response.json({
      displayName: updated.displayName,
      locale: updated.locale,
      timeZone: updated.timeZone,
    });
  });
}

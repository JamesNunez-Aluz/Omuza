import { createContextProfile, listContextProfiles } from "@resonance/db";
import { contextProfileInputSchema } from "@resonance/validation";

import { withAuth } from "@/server/guard";
import { apiError, isResponse, parseJsonBody } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const contexts = await listContextProfiles(ctx.db, user.id);
    return Response.json({ items: contexts });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const body = await parseJsonBody(request, contextProfileInputSchema);
    if (isResponse(body)) return body;
    if (
      body.eraStartYear != null &&
      body.eraEndYear != null &&
      body.eraStartYear > body.eraEndYear
    ) {
      return apiError({
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Era range start must not be after its end.",
      });
    }
    try {
      const context = await createContextProfile(ctx.db, user.id, body);
      return Response.json(context, { status: 201 });
    } catch (error) {
      if (String(error).includes("context_profiles_user_id_name_key")) {
        return apiError({
          status: 409,
          code: "DUPLICATE_CONTEXT_NAME",
          message: "A context with this name already exists.",
        });
      }
      throw error;
    }
  });
}

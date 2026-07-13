import { revokeSession } from "@resonance/db";

import { withAuth } from "@/server/guard";
import { clearSessionCookieHeader } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async (session, ctx) => {
    await revokeSession(ctx.db, session.sessionId);
    return Response.json(
      { status: "signed_out" },
      { headers: { "set-cookie": clearSessionCookieHeader(ctx.config.nodeEnv === "production") } },
    );
  });
}

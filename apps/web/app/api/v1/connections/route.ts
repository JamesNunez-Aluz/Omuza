import { listConnections } from "@resonance/db";

import { withAuth } from "@/server/guard";

export const dynamic = "force-dynamic";

/** List destination connections — status metadata only, never credentials. */
export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const connections = await listConnections(ctx.db, user.id);
    return Response.json({
      items: connections.map((connection) => ({
        id: connection.id,
        service: connection.service,
        status: connection.status,
        scopeSet: connection.scopeSet,
        authorizedAt: connection.authorizedAt,
        reauthorizationDueAt: connection.reauthorizationDueAt,
        disconnectedAt: connection.disconnectedAt,
      })),
    });
  });
}

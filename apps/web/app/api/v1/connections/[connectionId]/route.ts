import { disconnectAndPurge, recordAuditEvent } from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { notFound } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ connectionId: string }> };

/**
 * Disconnect (spec §12.10): revoke, delete tokens, expire destination
 * mappings, stop queued exports. Service-neutral playlists are preserved,
 * and playlists already created in Spotify remain in the user's Spotify
 * account unless removed there.
 */
export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { connectionId } = await params;
    if (!z.string().uuid().safeParse(connectionId).success) return notFound();
    const removed = await disconnectAndPurge(ctx.db, user.id, connectionId);
    if (!removed) return notFound();
    await recordAuditEvent(ctx.db, {
      userId: user.id,
      action: "spotify_disconnected",
      entityType: "service_connection",
      entityId: connectionId,
    });
    return Response.json({
      status: "disconnected",
      note: "Playlists already created in Spotify remain in your Spotify account unless you remove them there.",
    });
  });
}

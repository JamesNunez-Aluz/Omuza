import { findSeedEntities, listActiveSeeds, listPreferences } from "@resonance/db";

import { withAuth } from "@/server/guard";

export const dynamic = "force-dynamic";

/** Review-screen data: active seeds with display names, plus derived preferences. */
export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const seeds = await listActiveSeeds(ctx.db, user.id);
    const entities = await findSeedEntities(
      ctx.db,
      seeds.flatMap((seed) => (seed.artistId ? [seed.artistId] : [])),
      seeds.flatMap((seed) => (seed.recordingId ? [seed.recordingId] : [])),
    );
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    return Response.json({
      seeds: seeds.map((seed) => ({
        ...seed,
        entity: entityById.get(seed.artistId ?? seed.recordingId ?? "") ?? null,
      })),
      preferences: await listPreferences(ctx.db, user.id),
    });
  });
}

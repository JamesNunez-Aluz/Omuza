import { catalogSearchQuerySchema } from "@resonance/validation";

import { searchCatalog } from "@/server/catalog-service";
import { withAuth } from "@/server/guard";
import { apiError } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/catalog/search?q=&type=artist,recording&limit= (spec §13.3). */
export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async (_session, ctx) => {
    const url = new URL(request.url);
    const parsed = catalogSearchQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? "",
      type: url.searchParams.get("type") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return apiError({
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Invalid search query.",
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }

    const result = await searchCatalog(ctx.db, ctx.musicbrainz, ctx.logger, {
      query: parsed.data.q,
      types: parsed.data.type,
      limit: parsed.data.limit,
    });
    return Response.json(result);
  });
}

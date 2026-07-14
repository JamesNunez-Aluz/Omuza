import { getRecommendationRun, listRunItems, recordRunExposuresOnce } from "@resonance/db";
import { z } from "zod";

import { withAuth } from "@/server/guard";
import { notFound } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ runId: string }> };

/**
 * GET /api/v1/recommendation-runs/{runId} (spec §13.7). User-scoped; never
 * exposes internal affinity values — only display data, novelty, and
 * evidence-backed explanation output.
 */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const { runId } = await params;
    if (!z.string().uuid().safeParse(runId).success) return notFound();

    const run = await getRecommendationRun(ctx.db, user.id, runId);
    if (!run) return notFound();

    const base = {
      id: run.id,
      status: run.status,
      contextId: run.contextId,
      requestedCount: run.requestedCount,
      discoveryLevel: run.discoveryLevel,
      degradedProviders: run.degradedProviders,
      constraintRelaxations: run.constraintRelaxations,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    };

    if (run.status === "failed") {
      return Response.json({
        ...base,
        failure: {
          code: run.failureCode,
          message: run.failureDetailRedacted ?? "Generation failed. Try again.",
        },
      });
    }

    if (run.status !== "completed" && run.status !== "degraded") {
      return Response.json(base);
    }

    const items = await listRunItems(ctx.db, run.id);
    // The first fetch by the owner is the "shown" moment (spec §9.5).
    await recordRunExposuresOnce(ctx.db, run.id, user.id);
    return Response.json({
      ...base,
      items: items.map((item) => ({
        recommendationItemId: item.id,
        position: item.position,
        recording: item.recording,
        novelty: {
          state: item.noveltyState,
          probability: item.noveltyProbability,
          confidence: item.noveltyConfidence,
        },
        explanation: item.explanation
          ? { text: item.explanation.text, evidence: item.explanation.evidence }
          : null,
      })),
    });
  });
}

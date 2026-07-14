import {
  QUEUES,
  findSeedEntities,
  listActiveSeeds,
  listConsentRecords,
  markOnboardingComplete,
  recordAnalyticsEvent,
  recordAuditEvent,
} from "@resonance/db";
import {
  MIN_NEGATIVE_SEEDS,
  MIN_POSITIVE_SEEDS,
  NEGATIVE_SENTIMENTS,
  POSITIVE_SENTIMENTS,
  REQUIRED_ONBOARDING_PURPOSES,
  hasGranted,
} from "@resonance/domain";
import type { ConsentState, SeedSentiment } from "@resonance/domain";

import { withAuth } from "@/server/guard";
import { apiError } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Finalize onboarding: verifies required consents and seed minimums
 * (spec §21 M1: ≥5 positive, ≥3 negative), then triggers profile computation.
 */
export async function POST(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const consents = (await listConsentRecords(ctx.db, user.id)).map((record) => ({
      purpose: record.purpose,
      status: record.status,
      policyVersion: record.policyVersion,
      occurredAt: record.occurredAt.toISOString(),
    })) as ConsentState[];

    for (const purpose of REQUIRED_ONBOARDING_PURPOSES) {
      if (!hasGranted(consents, purpose)) {
        return apiError({
          status: 409,
          code: "CONSENT_REQUIRED",
          message: "Required consents have not been granted.",
          details: { purpose },
        });
      }
    }

    const seeds = await listActiveSeeds(ctx.db, user.id);
    const positives = seeds.filter((seed) =>
      POSITIVE_SENTIMENTS.includes(seed.sentiment as SeedSentiment),
    ).length;
    const negatives = seeds.filter((seed) =>
      NEGATIVE_SENTIMENTS.includes(seed.sentiment as SeedSentiment),
    ).length;
    if (positives < MIN_POSITIVE_SEEDS || negatives < MIN_NEGATIVE_SEEDS) {
      return apiError({
        status: 409,
        code: "INSUFFICIENT_SEEDS",
        message: `Onboarding needs at least ${MIN_POSITIVE_SEEDS} positive and ${MIN_NEGATIVE_SEEDS} negative declarations.`,
        details: { positives, negatives },
      });
    }

    await markOnboardingComplete(ctx.db, user.id);
    await recordAuditEvent(ctx.db, { userId: user.id, action: "onboarding_completed" });
    await recordAnalyticsEvent(ctx.db, user.id, "onboarding_completed", { positives, negatives });
    await ctx.enqueue(QUEUES.tasteRecompute, { userId: user.id, reason: "onboarding_completed" });

    // Plain-language review payload (spec §5.2 step 5).
    const entities = await findSeedEntities(
      ctx.db,
      seeds.flatMap((seed) => (seed.artistId ? [seed.artistId] : [])),
      seeds.flatMap((seed) => (seed.recordingId ? [seed.recordingId] : [])),
    );
    return Response.json({
      status: "completed",
      summary: { positives, negatives, entities: entities.length },
    });
  });
}

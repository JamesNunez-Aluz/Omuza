import { listConsentRecords } from "@resonance/db";
import { effectiveConsent } from "@resonance/domain";
import type { ConsentState } from "@resonance/domain";

import { withAuth } from "@/server/guard";
import { isPilotUser } from "@/server/spotify";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAuth(request, async ({ user }, ctx) => {
    const consents = await listConsentRecords(ctx.db, user.id);
    const effective = effectiveConsent(
      consents.map((record) => ({
        purpose: record.purpose,
        status: record.status,
        policyVersion: record.policyVersion,
        occurredAt: record.occurredAt.toISOString(),
      })) as ConsentState[],
    );
    return Response.json({
      user: {
        id: user.id,
        displayName: user.displayName,
        locale: user.locale,
        timeZone: user.timeZone,
        onboardingCompleted: user.onboardingCompletedAt !== null,
      },
      consents: [...effective.values()],
      features: {
        // True only for pilot users with the kill switch on (spec §12.2).
        spotifyExport: isPilotUser(ctx.config, user),
      },
    });
  });
}

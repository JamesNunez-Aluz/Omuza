import { createHash } from "node:crypto";

import {
  completeRunWithTrace,
  getContextProfile,
  getRunById,
  listActiveSeeds,
  listPreferences,
  loadCatalogSnapshotRecordings,
  loadEnrichedFeedbackEvents,
  loadUserHistory,
  markRunFailed,
  markRunGenerating,
  recordAnalyticsEvent,
} from "@resonance/db";
import {
  activeDislikedRecordingIds,
  effectiveFeedbackEvents,
} from "@resonance/domain";
import type { PrimaryResponse, RawFeedbackEvent } from "@resonance/domain";
import type { Database, PersistedCandidate, PersistedItem } from "@resonance/db";
import { generateRecommendations, RANKER_VERSION, SELECTOR_VERSION } from "@resonance/recommender";
import type {
  EngineRequest,
  ProfileSeed,
  ProviderBatchResult,
  TasteProfileSnapshot,
} from "@resonance/recommender";
import type { Logger } from "@resonance/observability";

/**
 * Asynchronous run lifecycle (spec §7.5, §10). Loads first-party inputs,
 * runs the pure engine, persists the full decision trace, and sets the final
 * run status. Failures are safe and actionable: the user-facing detail never
 * contains raw errors or provider payloads.
 */

export interface ExternalCandidateSource {
  providerId: string;
  strategy: string;
  fetch: () => Promise<ProviderBatchResult>;
}

export async function runRecommendationJob(
  db: Database,
  logger: Logger,
  runId: string,
  externalSources: ExternalCandidateSource[] = [],
): Promise<void> {
  const run = await getRunById(db, runId);
  if (!run || run.status === "cancelled") return;

  await markRunGenerating(db, runId);

  try {
    const seeds = await listActiveSeeds(db, run.userId);
    const profileSeeds: ProfileSeed[] = seeds.map((seed) => ({
      id: seed.id,
      entityType: seed.entityType as ProfileSeed["entityType"],
      entityId: (seed.artistId ?? seed.recordingId)!,
      sentiment: seed.sentiment as ProfileSeed["sentiment"],
      strength: Number(seed.strength),
      contextId: seed.contextId,
    }));

    const hasPositive = profileSeeds.some(
      (seed) => seed.sentiment === "strong_positive" || seed.sentiment === "positive",
    );
    if (!hasPositive) {
      await markRunFailed(
        db,
        runId,
        "insufficient_profile",
        "Add a few favorite artists or songs before generating a playlist.",
      );
      return;
    }

    const context = run.contextId ? await getContextProfile(db, run.userId, run.contextId) : undefined;
    const snapshotRecordings = await loadCatalogSnapshotRecordings(db);
    const history = await loadUserHistory(db, run.userId);

    // Feedback-derived facts (recomputed by taste.recompute) + active dislikes.
    const feedbackFacts = (await listPreferences(db, run.userId))
      .filter((preference) => preference.origin === "first_party_feedback")
      .map((preference) => ({
        contextId: preference.contextId,
        key: preference.key,
        value: Number(preference.preferenceValue),
        confidence: Number(preference.confidence),
      }));
    const rawEvents = (await loadEnrichedFeedbackEvents(db, run.userId)).map((event) => ({
      ...event,
      primaryResponse: event.primaryResponse as PrimaryResponse,
    })) as RawFeedbackEvent[];
    const dislikedRecordingIds = activeDislikedRecordingIds(effectiveFeedbackEvents(rawEvents));

    const profile: TasteProfileSnapshot = {
      version: `profile@${createHash("sha256")
        .update(JSON.stringify({ profileSeeds, feedbackFacts, dislikedRecordingIds }))
        .digest("hex")
        .slice(0, 12)}`,
      seeds: profileSeeds,
      feedbackFacts,
      dislikedRecordingIds,
    };

    // Strategy-B external providers: failures degrade the run, never fail it.
    const externalBatches: ProviderBatchResult[] = [];
    const degradedProviders: string[] = [];
    for (const source of externalSources) {
      try {
        externalBatches.push(await source.fetch());
      } catch (error) {
        degradedProviders.push(source.providerId);
        logger.warn(
          { provider: source.providerId, strategy: source.strategy, err: String(error).slice(0, 120) },
          "candidate provider degraded",
        );
      }
    }

    const request: EngineRequest = {
      requestedCount: run.requestedCount,
      discoveryLevel: run.discoveryLevel,
      randomSeed: run.randomSeed,
      context: context
        ? {
            explicitContentPolicy: context.explicitContentPolicy as
              | "allowed"
              | "blocked"
              | "context_specific",
            languageBlocklist: context.languageBlocklist,
            eraStartYear: context.eraStartYear,
            eraEndYear: context.eraEndYear,
          }
        : null,
      excludeRecordingIds: [],
      preserveRecordingIds: [],
    };

    const result = generateRecommendations(
      { recordings: snapshotRecordings },
      profile,
      history,
      request,
      externalBatches,
      degradedProviders,
    );

    if (result.items.length === 0) {
      await markRunFailed(
        db,
        runId,
        "no_eligible_candidates",
        "No eligible tracks matched your profile and filters. Try loosening restrictions or adding seeds.",
      );
      return;
    }

    const selectedIds = new Set(result.items.map((item) => item.candidate.recordingId));
    const candidates: PersistedCandidate[] = [
      ...result.eligible.map((candidate) => ({
        recordingId: candidate.recordingId,
        provider: candidate.provider,
        providerStrategy: candidate.providerStrategy,
        providerRank: candidate.providerRank,
        providerScore: candidate.providerScore,
        featureSnapshot: {
          fitScore: candidate.fitScore,
          noveltyProbability: candidate.noveltyProbability,
          serendipityScore: candidate.serendipityScore,
          qualityScore: candidate.qualityScore,
          knownProbability: candidate.knownProbability,
          fatiguePenalty: candidate.fatiguePenalty,
          aversionRisk: candidate.aversionRisk,
          metadataUncertainty: candidate.metadataUncertainty,
          evidence: candidate.fitEvidence,
        },
        eligibilityDecision: "eligible" as const,
        rejectionReasons: [],
        baseScore: candidate.fitScore,
        finalScore: candidate.finalScore,
        selected: selectedIds.has(candidate.recordingId),
      })),
      ...result.rejected.map((candidate) => ({
        recordingId: candidate.recordingId,
        provider: candidate.provider,
        providerStrategy: candidate.providerStrategy,
        providerRank: candidate.providerRank,
        providerScore: candidate.providerScore,
        featureSnapshot: {},
        eligibilityDecision: "rejected" as const,
        rejectionReasons: candidate.rejectionReasons,
        baseScore: null,
        finalScore: null,
        selected: false,
      })),
    ];

    const items: PersistedItem[] = result.items.map((item) => ({
      recordingId: item.candidate.recordingId,
      position: item.position,
      score: item.candidate.finalScore,
      noveltyProbability: item.candidate.noveltyProbability,
      noveltyState: item.candidate.noveltyState,
      noveltyConfidence: item.candidate.noveltyConfidence,
      selectionReason: item.selectionReason,
      explanation: {
        templateKey: item.explanation.templateKey,
        renderedText: item.explanation.renderedText,
        evidence: item.explanation.evidence,
        generatorVersion: item.explanation.generatorVersion,
      },
    }));

    const shortfall = result.items.length < run.requestedCount;
    const status = degradedProviders.length > 0 || shortfall ? "degraded" : "completed";
    const relaxations = shortfall
      ? [...result.constraintRelaxations, "insufficient_candidates"]
      : result.constraintRelaxations;

    await completeRunWithTrace(db, {
      runId,
      userId: run.userId,
      status,
      rankerVersion: RANKER_VERSION,
      selectorVersion: SELECTOR_VERSION,
      profileSnapshotVersion: profile.version,
      degradedProviders,
      constraintRelaxations: relaxations,
      candidates,
      items,
    });

    await recordAnalyticsEvent(db, run.userId, "recommendation_run_completed", {
      runId,
      status,
      itemCount: items.length,
    });

    logger.info(
      {
        runId,
        status,
        items: items.length,
        candidates: candidates.length,
        degradedProviders,
        relaxations,
      },
      "recommendation run finished",
    );
  } catch (error) {
    logger.error({ runId, err: String(error) }, "recommendation run failed");
    await markRunFailed(
      db,
      runId,
      "internal_error",
      "Something went wrong while generating. Your profile is unaffected — try again.",
    );
    await recordAnalyticsEvent(db, run.userId, "recommendation_run_completed", {
      runId,
      status: "failed",
      itemCount: 0,
    }).catch(() => undefined);
  }
}

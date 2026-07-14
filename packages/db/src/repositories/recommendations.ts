import { and, asc, eq, inArray } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  artists,
  exposures,
  knownRecordings,
  recommendationCandidates,
  recommendationExplanations,
  recommendationItems,
  recommendationRuns,
  recordingArtists,
  recordingFeatures,
  recordings,
} from "../schema.js";

export type RecommendationRunRow = typeof recommendationRuns.$inferSelect;

export async function createRecommendationRun(
  db: Database,
  input: {
    userId: string;
    contextId: string | null;
    requestedCount: number;
    discoveryLevel: number;
    structuredIntentSnapshot?: unknown;
    randomSeed: string;
  },
): Promise<RecommendationRunRow> {
  const rows = await db.insert(recommendationRuns).values(input).returning();
  return rows[0]!;
}

export async function getRecommendationRun(
  db: Database,
  userId: string,
  runId: string,
): Promise<RecommendationRunRow | undefined> {
  const rows = await db
    .select()
    .from(recommendationRuns)
    .where(and(eq(recommendationRuns.id, runId), eq(recommendationRuns.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function getRunById(db: Database, runId: string): Promise<RecommendationRunRow | undefined> {
  const rows = await db.select().from(recommendationRuns).where(eq(recommendationRuns.id, runId)).limit(1);
  return rows[0];
}

export async function markRunGenerating(db: Database, runId: string): Promise<void> {
  await db
    .update(recommendationRuns)
    .set({ status: "generating", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(recommendationRuns.id, runId));
}

export async function markRunFailed(
  db: Database,
  runId: string,
  failureCode: string,
  redactedDetail: string,
): Promise<void> {
  await db
    .update(recommendationRuns)
    .set({
      status: "failed",
      failureCode,
      failureDetailRedacted: redactedDetail,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(recommendationRuns.id, runId));
}

export interface PersistedCandidate {
  recordingId: string;
  provider: string;
  providerStrategy: string;
  providerRank: number | null;
  providerScore: number | null;
  featureSnapshot: unknown;
  eligibilityDecision: "eligible" | "rejected";
  rejectionReasons: string[];
  baseScore: number | null;
  finalScore: number | null;
  selected: boolean;
}

export interface PersistedItem {
  recordingId: string;
  position: number;
  score: number;
  noveltyProbability: number;
  noveltyState: string;
  noveltyConfidence: number;
  selectionReason: string;
  explanation: {
    templateKey: string;
    renderedText: string;
    evidence: unknown;
    generatorVersion: string;
  };
}

/**
 * Persist the full decision trace and final list atomically, record
 * exposures for the shown items, and mark the run completed/degraded.
 */
export async function completeRunWithTrace(
  db: Database,
  input: {
    runId: string;
    userId: string;
    status: "completed" | "degraded";
    rankerVersion: string;
    selectorVersion: string;
    profileSnapshotVersion: string;
    degradedProviders: string[];
    constraintRelaxations: string[];
    candidates: PersistedCandidate[];
    items: PersistedItem[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (input.candidates.length > 0) {
      await tx.insert(recommendationCandidates).values(
        input.candidates.map((candidate) => ({
          runId: input.runId,
          recordingId: candidate.recordingId,
          provider: candidate.provider,
          providerStrategy: candidate.providerStrategy,
          providerRank: candidate.providerRank,
          providerScore: candidate.providerScore,
          featureSnapshot: candidate.featureSnapshot,
          eligibilityDecision: candidate.eligibilityDecision,
          rejectionReasons: candidate.rejectionReasons,
          baseScore: candidate.baseScore,
          finalScore: candidate.finalScore,
          selected: candidate.selected,
        })),
      );
    }

    for (const item of input.items) {
      const itemRows = await tx
        .insert(recommendationItems)
        .values({
          runId: input.runId,
          recordingId: item.recordingId,
          position: item.position,
          score: item.score,
          noveltyProbability: item.noveltyProbability,
          noveltyState: item.noveltyState,
          noveltyConfidence: item.noveltyConfidence,
          selectionReason: item.selectionReason,
        })
        .returning({ id: recommendationItems.id });
      const itemId = itemRows[0]!.id;

      await tx.insert(recommendationExplanations).values({
        itemId,
        templateKey: item.explanation.templateKey,
        renderedText: item.explanation.renderedText,
        evidence: item.explanation.evidence,
        generatorVersion: item.explanation.generatorVersion,
      });
    }

    await tx
      .update(recommendationRuns)
      .set({
        status: input.status,
        rankerVersion: input.rankerVersion,
        selectorVersion: input.selectorVersion,
        profileSnapshotVersion: input.profileSnapshotVersion,
        degradedProviders: input.degradedProviders,
        constraintRelaxations: input.constraintRelaxations,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(recommendationRuns.id, input.runId));
  });
}

/**
 * Record exposures the first time a completed run's items are shown to their
 * owner (spec §9.5: exposures are *shown* recommendations, so generation
 * alone does not create them — this also keeps back-to-back identical runs
 * reproducible). Idempotent per run: repeat fetches add nothing.
 */
export async function recordRunExposuresOnce(db: Database, runId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: exposures.id })
      .from(exposures)
      .where(eq(exposures.recommendationRunId, runId))
      .limit(1);
    if (existing.length > 0) return;

    const items = await tx
      .select({
        id: recommendationItems.id,
        recordingId: recommendationItems.recordingId,
        position: recommendationItems.position,
        noveltyState: recommendationItems.noveltyState,
        noveltyProbability: recommendationItems.noveltyProbability,
      })
      .from(recommendationItems)
      .where(eq(recommendationItems.runId, runId));
    if (items.length === 0) return;

    await tx.insert(exposures).values(
      items.map((item) => ({
        userId,
        recordingId: item.recordingId,
        recommendationRunId: runId,
        recommendationItemId: item.id,
        surface: "run_result",
        position: item.position,
        noveltyStateAtExposure: item.noveltyState,
        noveltyProbabilityAtExposure: item.noveltyProbability,
      })),
    );
  });
}

export interface RunItemView {
  id: string;
  position: number;
  noveltyProbability: number;
  noveltyState: string;
  noveltyConfidence: number;
  recording: {
    id: string;
    title: string;
    artists: { id: string; name: string }[];
    durationMs: number | null;
  };
  explanation: {
    text: string;
    templateKey: string;
    evidence: unknown;
  } | null;
}

/** Items with recording display data and explanations, ordered by position. */
export async function listRunItems(db: Database, runId: string): Promise<RunItemView[]> {
  const items = await db
    .select({
      id: recommendationItems.id,
      position: recommendationItems.position,
      noveltyProbability: recommendationItems.noveltyProbability,
      noveltyState: recommendationItems.noveltyState,
      noveltyConfidence: recommendationItems.noveltyConfidence,
      recordingId: recommendationItems.recordingId,
      title: recordings.title,
      durationMs: recordings.durationMs,
    })
    .from(recommendationItems)
    .innerJoin(recordings, eq(recommendationItems.recordingId, recordings.id))
    .where(eq(recommendationItems.runId, runId))
    .orderBy(asc(recommendationItems.position));

  if (items.length === 0) return [];

  const recordingIds = items.map((item) => item.recordingId);
  const credits = await db
    .select({
      recordingId: recordingArtists.recordingId,
      artistId: recordingArtists.artistId,
      creditName: recordingArtists.creditName,
      position: recordingArtists.position,
    })
    .from(recordingArtists)
    .where(inArray(recordingArtists.recordingId, recordingIds))
    .orderBy(asc(recordingArtists.position));

  const explanations = await db
    .select({
      itemId: recommendationExplanations.itemId,
      renderedText: recommendationExplanations.renderedText,
      templateKey: recommendationExplanations.templateKey,
      evidence: recommendationExplanations.evidence,
    })
    .from(recommendationExplanations)
    .where(
      inArray(
        recommendationExplanations.itemId,
        items.map((item) => item.id),
      ),
    );

  const creditsByRecording = new Map<string, { id: string; name: string }[]>();
  for (const credit of credits) {
    const list = creditsByRecording.get(credit.recordingId) ?? [];
    list.push({ id: credit.artistId, name: credit.creditName });
    creditsByRecording.set(credit.recordingId, list);
  }
  const explanationByItem = new Map(explanations.map((explanation) => [explanation.itemId, explanation]));

  return items.map((item) => {
    const explanation = explanationByItem.get(item.id);
    return {
      id: item.id,
      position: item.position,
      noveltyProbability: item.noveltyProbability,
      noveltyState: item.noveltyState,
      noveltyConfidence: item.noveltyConfidence,
      recording: {
        id: item.recordingId,
        title: item.title,
        artists: creditsByRecording.get(item.recordingId) ?? [],
        durationMs: item.durationMs,
      },
      explanation: explanation
        ? {
            text: explanation.renderedText,
            templateKey: explanation.templateKey,
            evidence: explanation.evidence,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Snapshot loaders for the worker (inputs to the pure recommender pipeline)
// ---------------------------------------------------------------------------

export interface SnapshotRecording {
  id: string;
  title: string;
  primaryArtistId: string;
  primaryArtistName: string;
  isExplicit: boolean | null;
  languageCode: string | null;
  firstReleaseDate: string | null;
  licensePolicyId: string;
  provenanceProvider: string;
  features: {
    feature: string;
    value: number;
    licensePolicyId: string;
    provenanceProvider: string;
    recommendationEligible: boolean;
  }[];
}

/** Load the entire eligible catalog as a snapshot (v0: catalog is small). */
export async function loadCatalogSnapshotRecordings(db: Database): Promise<SnapshotRecording[]> {
  const recordingRows = await db
    .select({
      id: recordings.id,
      title: recordings.title,
      primaryArtistId: recordings.primaryArtistId,
      primaryArtistName: artists.name,
      isExplicit: recordings.isExplicit,
      languageCode: recordings.languageCode,
      firstReleaseDate: recordings.firstReleaseDate,
      licensePolicyId: recordings.licensePolicyId,
      provenanceProvider: recordings.provenanceProvider,
    })
    .from(recordings)
    .innerJoin(artists, eq(recordings.primaryArtistId, artists.id))
    .where(eq(recordings.status, "active"));

  const featureRows = await db
    .select({
      recordingId: recordingFeatures.recordingId,
      feature: recordingFeatures.feature,
      value: recordingFeatures.value,
      licensePolicyId: recordingFeatures.licensePolicyId,
      provenanceProvider: recordingFeatures.provenanceProvider,
      recommendationEligible: recordingFeatures.recommendationEligible,
    })
    .from(recordingFeatures);

  const featuresByRecording = new Map<string, SnapshotRecording["features"]>();
  for (const row of featureRows) {
    const list = featuresByRecording.get(row.recordingId) ?? [];
    list.push({
      feature: row.feature,
      value: row.value,
      licensePolicyId: row.licensePolicyId,
      provenanceProvider: row.provenanceProvider,
      recommendationEligible: row.recommendationEligible,
    });
    featuresByRecording.set(row.recordingId, list);
  }

  return recordingRows.map((row) => ({
    ...row,
    features: featuresByRecording.get(row.id) ?? [],
  }));
}

export interface UserHistorySnapshot {
  exposedRecordingIds: string[];
  knownRecordings: { recordingId: string; knowledgeState: string; confidence: number }[];
}

export async function loadUserHistory(db: Database, userId: string): Promise<UserHistorySnapshot> {
  const exposureRows = await db
    .select({ recordingId: exposures.recordingId })
    .from(exposures)
    .where(eq(exposures.userId, userId));
  const knownRows = await db
    .select({
      recordingId: knownRecordings.recordingId,
      knowledgeState: knownRecordings.knowledgeState,
      confidence: knownRecordings.confidence,
    })
    .from(knownRecordings)
    .where(eq(knownRecordings.userId, userId));
  return {
    exposedRecordingIds: [...new Set(exposureRows.map((row) => row.recordingId))],
    knownRecordings: knownRows,
  };
}

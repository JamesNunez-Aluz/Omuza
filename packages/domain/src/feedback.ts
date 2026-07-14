/**
 * First-party feedback (spec §5.4, §9.5, §10.7; ADR 0009).
 *
 * Events are append-only; a revision appends a new event superseding the old
 * one. Preference facts are always *recomputed* from the effective event set
 * (never incrementally mutated), so revisions cannot double-count and
 * deletion fully removes influence.
 */

export const PRIMARY_RESPONSES = [
  "love",
  "like",
  "neutral",
  "dislike",
  "not_now",
  "already_knew",
] as const;
export type PrimaryResponse = (typeof PRIMARY_RESPONSES)[number];

export const NEWNESS_RESPONSES = ["new_to_me", "already_knew"] as const;
export type NewnessResponse = (typeof NEWNESS_RESPONSES)[number];

export const POSITIVE_REASON_CODES = [
  "vocals",
  "lyrics",
  "rhythm_beat",
  "melody",
  "energy",
  "mood",
  "instrumentation",
  "production",
  "unexpected_but_works",
  "fits_context",
] as const;

export const NEGATIVE_REASON_CODES = [
  "vocals",
  "lyrics",
  "too_slow",
  "too_intense",
  "too_repetitive",
  "production",
  "wrong_mood",
  "too_familiar",
  "too_experimental",
  "does_not_fit_context",
] as const;

export const ALL_REASON_CODES = [
  ...new Set([...POSITIVE_REASON_CODES, ...NEGATIVE_REASON_CODES]),
] as readonly string[];

/** Event weights (spec §10.7). Global vs context scope, plus novelty effects. */
export const FEEDBACK_WEIGHTS: Record<
  PrimaryResponse,
  { global: number; context: number; noveltyEffect: "none" | "mark_known" }
> = {
  love: { global: 3.0, context: 3.5, noveltyEffect: "none" },
  like: { global: 1.5, context: 2.0, noveltyEffect: "none" },
  neutral: { global: 0, context: 0, noveltyEffect: "none" },
  dislike: { global: -2.5, context: -3.0, noveltyEffect: "none" },
  not_now: { global: 0, context: -1.0, noveltyEffect: "none" },
  already_knew: { global: 0, context: 0, noveltyEffect: "mark_known" },
};

export const FEEDBACK_DERIVATION_VERSION = "feedback-derivation@1";

/**
 * Reason codes update only features that actually exist (and are eligible)
 * on the recording (spec §5.4) — mapping a reason to feature keys never
 * fabricates a descriptor.
 */
export function reasonCodeFeatureKeys(
  reason: string,
  recordingFeatureKeys: readonly string[],
): string[] {
  switch (reason) {
    case "energy":
    case "too_intense":
      return recordingFeatureKeys.filter((key) => key === "energy_estimate");
    case "rhythm_beat":
    case "too_slow":
      return recordingFeatureKeys.filter((key) => key === "tempo_bucket");
    case "mood":
    case "wrong_mood":
      return recordingFeatureKeys.filter((key) => key.startsWith("tag:"));
    default:
      // vocals, lyrics, melody, instrumentation, production, … have no
      // supported eligible feature yet: update a general tendency nowhere —
      // never invent a descriptor.
      return [];
  }
}

export interface EffectiveFeedbackEvent {
  id: string;
  recordingId: string;
  primaryArtistId: string | null;
  primaryResponse: PrimaryResponse;
  reasonCodes: string[];
  contextId: string | null;
  occurredAt: string;
  /** Eligible feature keys present on the recording, with values. */
  recordingFeatures: { key: string; value: number }[];
}

export interface RawFeedbackEvent extends EffectiveFeedbackEvent {
  supersedesEventId: string | null;
}

/** Resolve supersede chains: an event superseded by any other is inert. */
export function effectiveFeedbackEvents(events: readonly RawFeedbackEvent[]): EffectiveFeedbackEvent[] {
  const superseded = new Set(
    events.flatMap((event) => (event.supersedesEventId ? [event.supersedesEventId] : [])),
  );
  return events.filter((event) => !superseded.has(event.id));
}

export interface FeedbackDerivedFact {
  contextId: string | null;
  namespace: "feedback_entity" | "feedback_feature";
  key: string;
  preferenceValue: number;
  confidence: number;
  origin: "first_party_feedback";
  modelVersion: string;
  evidence: { eventType: string; sourceEntityId: string; weight: number }[];
}

const PRIOR = 1;
const EVIDENCE_SCALE = 4;
/** Cap the mass one recording's feedback can contribute to a single feature. */
const PER_EVENT_FEATURE_CAP = 1.5;

interface MassEntry {
  positive: number;
  negative: number;
  evidence: { eventType: string; sourceEntityId: string; weight: number }[];
}

/**
 * Pure recompute of feedback-derived preference facts from the effective
 * event set. "Already knew" and newness answers carry no taste weight;
 * "Not now" affects only the event's context, never the global profile.
 */
export function deriveFeedbackPreferences(
  events: readonly EffectiveFeedbackEvent[],
): FeedbackDerivedFact[] {
  const masses = new Map<string, MassEntry>();

  const add = (
    scope: string | null,
    namespace: "feedback_entity" | "feedback_feature",
    key: string,
    weight: number,
    event: EffectiveFeedbackEvent,
  ) => {
    if (weight === 0) return;
    const mapKey = `${scope ?? "global"}|${namespace}|${key}`;
    const entry = masses.get(mapKey) ?? { positive: 0, negative: 0, evidence: [] };
    if (weight > 0) entry.positive += weight;
    else entry.negative += Math.abs(weight);
    entry.evidence.push({
      eventType: `feedback_${event.primaryResponse}`,
      sourceEntityId: event.id,
      weight: round3(weight),
    });
    masses.set(mapKey, entry);
  };

  for (const event of events) {
    const weights = FEEDBACK_WEIGHTS[event.primaryResponse];

    for (const [scope, weight] of [
      [null, weights.global],
      [event.contextId, event.contextId ? weights.context : 0],
    ] as const) {
      if (weight === 0) continue;
      add(scope, "feedback_entity", `recording:${event.recordingId}`, weight, event);
      if (event.primaryArtistId) {
        // Artist inherits a damped share of the recording's signal.
        add(scope, "feedback_entity", `artist:${event.primaryArtistId}`, weight * 0.5, event);
      }

      // Reason codes distribute bounded extra weight to matching eligible features.
      const featureKeys = event.recordingFeatures.map((feature) => feature.key);
      let featureBudget = PER_EVENT_FEATURE_CAP;
      for (const reason of event.reasonCodes) {
        for (const key of reasonCodeFeatureKeys(reason, featureKeys)) {
          const contribution = Math.sign(weight) * Math.min(0.5, featureBudget);
          if (contribution === 0 || featureBudget <= 0) continue;
          featureBudget -= Math.abs(contribution);
          add(scope, "feedback_feature", key, contribution, event);
        }
      }
    }
  }

  const facts: FeedbackDerivedFact[] = [];
  for (const [mapKey, entry] of masses) {
    const [scope, namespace, ...keyParts] = mapKey.split("|");
    const pLike =
      (entry.positive + PRIOR) / (entry.positive + entry.negative + PRIOR + PRIOR);
    facts.push({
      contextId: scope === "global" ? null : scope!,
      namespace: namespace as FeedbackDerivedFact["namespace"],
      key: keyParts.join("|"),
      preferenceValue: round3(2 * pLike - 1),
      confidence: round3(1 - Math.exp(-(entry.positive + entry.negative) / EVIDENCE_SCALE)),
      origin: "first_party_feedback",
      modelVersion: FEEDBACK_DERIVATION_VERSION,
      evidence: entry.evidence,
    });
  }

  return facts.sort((a, b) => `${a.contextId}${a.key}`.localeCompare(`${b.contextId}${b.key}`));
}

/** Effective active dislikes: hard filter input (spec §10.5 #6). */
export function activeDislikedRecordingIds(events: readonly EffectiveFeedbackEvent[]): string[] {
  return [
    ...new Set(
      events.filter((event) => event.primaryResponse === "dislike").map((event) => event.recordingId),
    ),
  ].sort();
}

export interface KnowledgeUpdate {
  knowledgeState: "confirmed_known" | "confirmed_new";
  confidence: number;
}

/** Novelty truth updates (spec §10.9 hierarchy): user answers dominate. */
export function knowledgeUpdateFor(
  primaryResponse: PrimaryResponse,
  newnessResponse: NewnessResponse | null,
): KnowledgeUpdate | null {
  if (primaryResponse === "already_knew" || newnessResponse === "already_knew") {
    return { knowledgeState: "confirmed_known", confidence: 0.95 };
  }
  if (newnessResponse === "new_to_me") {
    return { knowledgeState: "confirmed_new", confidence: 0.95 };
  }
  return null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import { z } from "zod";

/**
 * Shared request/response schemas for /api/v1 (spec §13). Route handlers
 * parse every input with these; tests reuse them to validate outputs.
 */

// --- Auth ------------------------------------------------------------------

export const requestLoginLinkSchema = z.object({
  email: z.string().email().max(254),
});

export const verifyLoginSchema = z.object({
  token: z.string().min(20).max(128),
});

// --- Catalog search (spec §13.3) --------------------------------------------

export const catalogSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  type: z
    .string()
    .default("artist,recording")
    .transform((value) => value.split(",").map((entry) => entry.trim()))
    .pipe(z.array(z.enum(["artist", "recording"])).min(1)),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const catalogSearchItemSchema = z.object({
  entityType: z.enum(["artist", "recording"]),
  id: z.string().uuid(),
  title: z.string(),
  artists: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string() })),
  disambiguation: z.string().nullable(),
  externalIdentity: z.object({ musicbrainzMbid: z.string().nullable() }),
  sourceAttribution: z.array(z.string()),
});

export const catalogSearchResponseSchema = z.object({
  items: z.array(catalogSearchItemSchema),
  nextCursor: z.string().nullable(),
  degraded: z.boolean(),
});

// --- Seeds (spec §13.4) ------------------------------------------------------

export const seedSentimentSchema = z.enum([
  "strong_positive",
  "positive",
  "negative",
  "hard_block",
  "fatigue",
]);

export const seedItemInputSchema = z.object({
  entityType: z.enum(["artist", "recording"]),
  entityId: z.string().uuid(),
  sentiment: seedSentimentSchema,
  strength: z.number().min(0).max(1).default(1),
  contextId: z.string().uuid().nullable().default(null),
});

export const createSeedsSchema = z.object({
  items: z.array(seedItemInputSchema).min(1).max(50),
});

export const patchSeedSchema = z
  .object({
    sentiment: seedSentimentSchema.optional(),
    strength: z.number().min(0).max(1).optional(),
    contextId: z.string().uuid().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "empty patch" });

// --- Context profiles (spec §13.5) -------------------------------------------

export const contextProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  systemKey: z.enum(["general", "focus", "drive", "workout", "wind_down", "social"]).nullable().optional(),
  discoveryLevel: z.number().int().min(0).max(100).default(50),
  explicitContentPolicy: z.enum(["allowed", "blocked", "context_specific"]).default("allowed"),
  familiarityPreference: z.enum(["mostly_adjacent", "balanced", "farther_afield"]).default("balanced"),
  popularityPreference: z.enum(["any", "avoid_hits", "deep_cuts"]).default("any"),
  vocalPreference: z.enum(["any", "mostly_vocal", "mostly_instrumental"]).default("any"),
  languageAllowlist: z.array(z.string().min(2).max(12)).max(24).default([]),
  languageBlocklist: z.array(z.string().min(2).max(12)).max(24).default([]),
  eraStartYear: z.number().int().min(1900).max(2100).nullable().optional(),
  eraEndYear: z.number().int().min(1900).max(2100).nullable().optional(),
  /** Free text is parsed later (LLM intent is M2+); stored as declared text. */
  structuredIntent: z.object({ freeText: z.string().max(500) }).nullable().optional(),
});

export const patchContextProfileSchema = contextProfileInputSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: "empty patch" },
);

// --- Recommendation runs (spec §13.6) -------------------------------------------

export const createRecommendationRunSchema = z.object({
  contextId: z.string().uuid().nullable().default(null),
  requestedCount: z.number().int().min(10).max(50).default(20),
  /** Defaults to the context's discovery level (or 50) when omitted. */
  discoveryLevel: z.number().int().min(0).max(100).optional(),
  preserveRecordingIds: z.array(z.string().uuid()).max(50).default([]),
  excludeRecordingIds: z.array(z.string().uuid()).max(200).default([]),
});

// --- Consents (spec §13.13) ---------------------------------------------------

export const consentPurposeSchema = z.enum([
  "terms_privacy",
  "core_personalization",
  "analytics",
  "model_improvement",
  "research",
  "marketing",
]);

export const postConsentSchema = z.object({
  purpose: consentPurposeSchema,
  status: z.enum(["granted", "withdrawn"]),
});

// --- Settings -----------------------------------------------------------------

export const patchSettingsSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    locale: z.string().min(2).max(35).optional(),
    timeZone: z.string().min(1).max(64).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "empty patch" });

// --- Error envelope (spec §13.1) ------------------------------------------------

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean(),
    details: z.record(z.unknown()).default({}),
  }),
});

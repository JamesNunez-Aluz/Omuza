import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Typed mirror of packages/db/migrations. Migrations are hand-written SQL and
 * are the source of truth for the database shape (including the CHECK
 * constraints that Drizzle does not model); keep this file in sync.
 */

export const sourceLicenses = pgTable("source_licenses", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  dataset: text("dataset").notNull(),
  licenseId: text("license_id").notNull(),
  licenseUrl: text("license_url").notNull(),
  reviewedAt: date("reviewed_at").notNull(),
  permittedUses: text("permitted_uses").array().notNull(),
  prohibitedUses: text("prohibited_uses").array().notNull(),
  attributionTemplate: text("attribution_template"),
  retentionDays: integer("retention_days"),
  notes: text("notes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artists = pgTable("artists", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalMbid: text("canonical_mbid").unique(),
  name: text("name").notNull(),
  sortName: text("sort_name"),
  disambiguation: text("disambiguation"),
  countryCode: text("country_code"),
  beginDate: text("begin_date"),
  endDate: text("end_date"),
  provenanceProvider: text("provenance_provider").notNull(),
  licensePolicyId: text("license_policy_id")
    .notNull()
    .references(() => sourceLicenses.id),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalMbid: text("canonical_mbid").unique(),
  title: text("title").notNull(),
  primaryArtistId: uuid("primary_artist_id")
    .notNull()
    .references(() => artists.id),
  durationMs: integer("duration_ms"),
  languageCode: text("language_code"),
  isExplicit: boolean("is_explicit"),
  firstReleaseDate: text("first_release_date"),
  disambiguation: text("disambiguation"),
  status: text("status").notNull().default("active"),
  provenanceProvider: text("provenance_provider").notNull(),
  licensePolicyId: text("license_policy_id")
    .notNull()
    .references(() => sourceLicenses.id),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recordingArtists = pgTable(
  "recording_artists",
  {
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id),
    creditName: text("credit_name").notNull(),
    position: integer("position").notNull(),
    joinPhrase: text("join_phrase"),
  },
  (table) => [primaryKey({ columns: [table.recordingId, table.artistId, table.position] })],
);

export const recordingExternalIds = pgTable("recording_external_ids", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordingId: uuid("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  idType: text("id_type").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  provenanceProvider: text("provenance_provider").notNull(),
  licensePolicyId: text("license_policy_id")
    .notNull()
    .references(() => sourceLicenses.id),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  validTo: timestamp("valid_to", { withTimezone: true }),
});

export const catalogSourceRecords = pgTable("catalog_source_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  entityType: text("entity_type").notNull(),
  externalId: text("external_id").notNull(),
  contentHash: text("content_hash").notNull(),
  licensePolicyId: text("license_policy_id")
    .notNull()
    .references(() => sourceLicenses.id),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const catalogSearchCache = pgTable("catalog_search_cache", {
  queryHash: text("query_hash").primaryKey(),
  query: text("query").notNull(),
  response: jsonb("response").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailNormalized: text("email_normalized").notNull().unique(),
  displayName: text("display_name"),
  status: text("status").notNull().default("active"),
  locale: text("locale").notNull().default("en"),
  timeZone: text("time_zone").notNull().default("UTC"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailNormalized: text("email_normalized").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").notNull().default("login"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  rotatedFrom: uuid("rotated_from"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const consentRecords = pgTable("consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull().default("web"),
  metadata: jsonb("metadata").notNull().default({}),
});

export const contextProfiles = pgTable("context_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  systemKey: text("system_key"),
  discoveryLevel: integer("discovery_level").notNull().default(50),
  explicitContentPolicy: text("explicit_content_policy").notNull().default("allowed"),
  familiarityPreference: text("familiarity_preference").notNull().default("balanced"),
  popularityPreference: text("popularity_preference").notNull().default("any"),
  vocalPreference: text("vocal_preference").notNull().default("any"),
  languageAllowlist: text("language_allowlist").array().notNull().default([]),
  languageBlocklist: text("language_blocklist").array().notNull().default([]),
  eraStartYear: integer("era_start_year"),
  eraEndYear: integer("era_end_year"),
  structuredIntent: jsonb("structured_intent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const userSeedItems = pgTable("user_seed_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  artistId: uuid("artist_id").references(() => artists.id),
  recordingId: uuid("recording_id").references(() => recordings.id),
  sentiment: text("sentiment").notNull(),
  strength: numeric("strength", { precision: 3, scale: 2 }).notNull().default("1.0"),
  contextId: uuid("context_id").references(() => contextProfiles.id),
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
});

export const userPreferences = pgTable("user_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  contextId: uuid("context_id").references(() => contextProfiles.id),
  namespace: text("namespace").notNull(),
  key: text("key").notNull(),
  preferenceValue: numeric("preference_value", { precision: 4, scale: 3 }).notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  evidenceCount: integer("evidence_count").notNull().default(1),
  origin: text("origin").notNull(),
  lastEvidenceAt: timestamp("last_evidence_at", { withTimezone: true }).notNull().defaultNow(),
  modelVersion: text("model_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const preferenceEvidence = pgTable("preference_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  userPreferenceId: uuid("user_preference_id")
    .notNull()
    .references(() => userPreferences.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  sourceEntityId: uuid("source_entity_id"),
  weight: numeric("weight", { precision: 4, scale: 3 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  reversalOfId: uuid("reversal_of_id"),
});

export const privacyRequests = pgTable("privacy_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  payload: jsonb("payload"),
  failureReason: text("failure_reason"),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    status: integer("status").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.key, table.userId, table.route] })],
);

export const recommendationRuns = pgTable("recommendation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  contextId: uuid("context_id").references(() => contextProfiles.id),
  status: text("status").notNull().default("queued"),
  requestedCount: integer("requested_count").notNull().default(20),
  discoveryLevel: integer("discovery_level").notNull(),
  structuredIntentSnapshot: jsonb("structured_intent_snapshot"),
  profileSnapshotVersion: text("profile_snapshot_version"),
  rankerVersion: text("ranker_version"),
  selectorVersion: text("selector_version"),
  randomSeed: text("random_seed").notNull(),
  degradedProviders: text("degraded_providers").array().notNull().default([]),
  constraintRelaxations: text("constraint_relaxations").array().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failureCode: text("failure_code"),
  failureDetailRedacted: text("failure_detail_redacted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendationCandidates = pgTable("recommendation_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => recommendationRuns.id, { onDelete: "cascade" }),
  recordingId: uuid("recording_id")
    .notNull()
    .references(() => recordings.id),
  provider: text("provider").notNull(),
  providerStrategy: text("provider_strategy").notNull(),
  providerRank: integer("provider_rank"),
  providerScore: doublePrecision("provider_score"),
  featureSnapshot: jsonb("feature_snapshot").notNull().default({}),
  eligibilityDecision: text("eligibility_decision").notNull(),
  rejectionReasons: text("rejection_reasons").array().notNull().default([]),
  baseScore: doublePrecision("base_score"),
  finalScore: doublePrecision("final_score"),
  selected: boolean("selected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendationItems = pgTable("recommendation_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => recommendationRuns.id, { onDelete: "cascade" }),
  recordingId: uuid("recording_id")
    .notNull()
    .references(() => recordings.id),
  position: integer("position").notNull(),
  score: doublePrecision("score").notNull(),
  noveltyProbability: doublePrecision("novelty_probability").notNull(),
  noveltyState: text("novelty_state").notNull(),
  noveltyConfidence: doublePrecision("novelty_confidence").notNull(),
  selectionReason: text("selection_reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendationExplanations = pgTable("recommendation_explanations", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => recommendationItems.id, { onDelete: "cascade" }),
  templateKey: text("template_key").notNull(),
  renderedText: text("rendered_text").notNull(),
  evidence: jsonb("evidence").notNull().default([]),
  generator: text("generator").notNull().default("template"),
  generatorVersion: text("generator_version").notNull(),
  validated: boolean("validated").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exposures = pgTable("exposures", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  recordingId: uuid("recording_id")
    .notNull()
    .references(() => recordings.id),
  recommendationRunId: uuid("recommendation_run_id"),
  recommendationItemId: uuid("recommendation_item_id"),
  surface: text("surface").notNull(),
  position: integer("position"),
  shownAt: timestamp("shown_at", { withTimezone: true }).notNull().defaultNow(),
  openedDestinationAt: timestamp("opened_destination_at", { withTimezone: true }),
  noveltyStateAtExposure: text("novelty_state_at_exposure"),
  noveltyProbabilityAtExposure: doublePrecision("novelty_probability_at_exposure"),
});

export const knownRecordings = pgTable(
  "known_recordings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id),
    knowledgeState: text("knowledge_state").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    source: text("source").notNull(),
    firstKnownAt: timestamp("first_known_at", { withTimezone: true }).notNull().defaultNow(),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.recordingId] })],
);

export const recordingFeatures = pgTable("recording_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordingId: uuid("recording_id")
    .notNull()
    .references(() => recordings.id, { onDelete: "cascade" }),
  feature: text("feature").notNull(),
  value: doublePrecision("value").notNull(),
  provenanceProvider: text("provenance_provider").notNull(),
  provenanceDataset: text("provenance_dataset").notNull(),
  licensePolicyId: text("license_policy_id")
    .notNull()
    .references(() => sourceLicenses.id),
  trainingEligible: boolean("training_eligible").notNull().default(false),
  recommendationEligible: boolean("recommendation_eligible").notNull().default(false),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

import {
  boolean,
  date,
  doublePrecision,
  integer,
  pgTable,
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
  provenanceProvider: text("provenance_provider").notNull(),
  licensePolicyId: text("license_policy_id")
    .notNull()
    .references(() => sourceLicenses.id),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalMbid: text("canonical_mbid").unique(),
  title: text("title").notNull(),
  primaryArtistId: uuid("primary_artist_id")
    .notNull()
    .references(() => artists.id),
  durationMs: integer("duration_ms"),
  provenanceProvider: text("provenance_provider").notNull(),
  licensePolicyId: text("license_policy_id")
    .notNull()
    .references(() => sourceLicenses.id),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

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

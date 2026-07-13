import type { FeatureRow, LicensePolicy, Provenance } from "@resonance/domain";
import { z } from "zod";

/**
 * Zod schemas mirroring the domain provenance types, for validating data at
 * trust boundaries (fixtures, seeds, provider adapters, API payloads).
 */

export const dataProviderSchema = z.enum([
  "musicbrainz",
  "listenbrainz",
  "spotify",
  "user",
  "resonance",
  "synthetic",
]);

export const dataUseSchema = z.enum([
  "display",
  "temporary_cache",
  "recommendation_feature",
  "model_training",
  "commercial_use",
  "redistribution",
]);

export const provenanceSchema: z.ZodType<Provenance> = z.object({
  provider: dataProviderSchema,
  dataset: z.string().min(1),
  licensePolicyId: z.string().min(1),
  ingestedAt: z.string().datetime(),
});

export const featureRowSchema: z.ZodType<FeatureRow> = z.object({
  canonicalRecordingId: z.string().min(1),
  feature: z.string().min(1),
  value: z.number().finite(),
  provenance: provenanceSchema,
  trainingEligible: z.boolean(),
  recommendationEligible: z.boolean(),
});

export const licensePolicySchema: z.ZodType<LicensePolicy> = z.object({
  id: z.string().regex(/^[a-z0-9-]+@\d+$/, "policy ids are versioned, e.g. provider-dataset@1"),
  provider: z.string().min(1),
  dataset: z.string().min(1),
  licenseId: z.string().min(1),
  licenseUrl: z.string().min(1),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  permittedUses: z.array(dataUseSchema).readonly(),
  prohibitedUses: z.array(dataUseSchema).readonly(),
  attributionTemplate: z.string().optional(),
  retentionDays: z.number().int().positive().optional(),
  notes: z.string().min(1),
}) as z.ZodType<LicensePolicy>;

import { LICENSE_REGISTRY } from "@resonance/domain";
import type pg from "pg";

/**
 * Sync the code-owned license registry (source of truth) into the
 * `source_licenses` table so database constraints and runtime queries can
 * reference policy versions. Idempotent upsert keyed by policy id.
 */
export async function seedLicenseRegistry(pool: pg.Pool): Promise<number> {
  for (const policy of LICENSE_REGISTRY) {
    await pool.query(
      `insert into source_licenses
        (id, provider, dataset, license_id, license_url, reviewed_at,
         permitted_uses, prohibited_uses, attribution_template, retention_days, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         provider = excluded.provider,
         dataset = excluded.dataset,
         license_id = excluded.license_id,
         license_url = excluded.license_url,
         reviewed_at = excluded.reviewed_at,
         permitted_uses = excluded.permitted_uses,
         prohibited_uses = excluded.prohibited_uses,
         attribution_template = excluded.attribution_template,
         retention_days = excluded.retention_days,
         notes = excluded.notes`,
      [
        policy.id,
        policy.provider,
        policy.dataset,
        policy.licenseId,
        policy.licenseUrl,
        policy.reviewedAt,
        [...policy.permittedUses],
        [...policy.prohibitedUses],
        policy.attributionTemplate ?? null,
        policy.retentionDays ?? null,
        policy.notes,
      ],
    );
  }
  return LICENSE_REGISTRY.length;
}

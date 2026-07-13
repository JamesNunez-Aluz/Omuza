import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FeatureRow } from "@resonance/domain";
import { featureRowSchema } from "@resonance/validation";
import { z } from "zod";

/**
 * Loader for the synthetic fixtures in packages/testkit/fixtures. Everything
 * is schema-validated on load so a malformed or policy-violating fixture
 * fails loudly in whichever test consumes it.
 */

// Resolves to fixtures/ next to either src/ (tests) or dist/ (built output).
export const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  import.meta.url.includes("/dist/") ? "./fixtures" : "../fixtures",
);

const catalogSchema = z.object({
  artists: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      provenanceProvider: z.string(),
      licensePolicyId: z.string(),
    }),
  ),
  recordings: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      artistKey: z.string(),
      durationMs: z.number().int().positive(),
      provenanceProvider: z.string(),
      licensePolicyId: z.string(),
    }),
  ),
});

export type CatalogFixtures = z.infer<typeof catalogSchema>;

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8"));
}

export function loadCatalogFixtures(): CatalogFixtures {
  return catalogSchema.parse(readJson("catalog.json"));
}

export function loadFeatureRowFixtures(): FeatureRow[] {
  const parsed = z.object({ rows: z.array(featureRowSchema) }).parse(readJson("feature-rows.json"));
  return parsed.rows;
}

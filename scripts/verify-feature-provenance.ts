import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_DATA_USES,
  LICENSE_REGISTRY,
  getLicensePolicy,
  isUseAllowed,
} from "../packages/domain/src/index.ts";

/**
 * Blocking policy gate #2 (spec §6.2 controls 7–9, §6.3): license-registry
 * and fixture provenance checks.
 *
 *  P1. Every Spotify registry entry prohibits recommendation_feature and
 *      model_training, and never permits them.
 *  P2. Unknown policies default to prohibited for every use.
 *  P3. Every feature-row fixture references a registered license policy.
 *  P4. No Spotify-provenance fixture row is training- or recommendation-
 *      eligible (a deliberately model-eligible Spotify fixture fails here
 *      and in the testkit policy tests).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];

// P1 — Spotify entries can never feed recommendations or training.
const spotifyPolicies = LICENSE_REGISTRY.filter((policy) => policy.provider === "spotify");
if (spotifyPolicies.length === 0) {
  failures.push("registry contains no Spotify policy — the export boundary must be declared");
}
for (const policy of spotifyPolicies) {
  for (const use of ["recommendation_feature", "model_training"] as const) {
    if (isUseAllowed(policy.id, use) || !policy.prohibitedUses.includes(use)) {
      failures.push(`P1: ${policy.id} must prohibit ${use}`);
    }
  }
}

// P2 — deny by default.
for (const use of ALL_DATA_USES) {
  if (isUseAllowed("unregistered-provider@1", use)) {
    failures.push(`P2: unknown policy id allowed use "${use}" — registry must deny by default`);
  }
}

// P3/P4 — fixture provenance.
interface FixtureRow {
  feature: string;
  provenance: { provider: string; licensePolicyId: string };
  trainingEligible: boolean;
  recommendationEligible: boolean;
}

const fixturePath = path.join(repoRoot, "packages/testkit/fixtures/feature-rows.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { rows: FixtureRow[] };

for (const row of fixture.rows) {
  if (!getLicensePolicy(row.provenance.licensePolicyId)) {
    failures.push(
      `P3: fixture "${row.feature}" references unregistered policy ${row.provenance.licensePolicyId}`,
    );
  }
  if (row.provenance.provider === "spotify") {
    if (row.trainingEligible) {
      failures.push(`P4: Spotify fixture "${row.feature}" is marked training-eligible`);
    }
    if (row.recommendationEligible) {
      failures.push(`P4: Spotify fixture "${row.feature}" is marked recommendation-eligible`);
    }
  }
  if (
    row.trainingEligible &&
    !isUseAllowed(row.provenance.licensePolicyId, "model_training")
  ) {
    failures.push(
      `P4: fixture "${row.feature}" claims training eligibility its license (${row.provenance.licensePolicyId}) does not grant`,
    );
  }
}

if (failures.length > 0) {
  console.error(`policy:check FAILED — ${failures.length} provenance/license violation(s):\n`);
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(
  `policy:check provenance OK — ${LICENSE_REGISTRY.length} policies, ${fixture.rows.length} fixture rows verified`,
);

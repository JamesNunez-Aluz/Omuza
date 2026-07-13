import { LICENSE_REGISTRY } from "@resonance/domain";
import { describe, expect, it } from "vitest";

import { featureRowSchema, licensePolicySchema } from "./provenance.js";

describe("license registry shape", () => {
  it("every registry entry passes schema validation", () => {
    for (const policy of LICENSE_REGISTRY) {
      const result = licensePolicySchema.safeParse(policy);
      expect(result.success, `policy ${policy.id} failed validation`).toBe(true);
    }
  });
});

describe("featureRowSchema", () => {
  it("rejects rows without provenance or eligibility flags", () => {
    const result = featureRowSchema.safeParse({
      canonicalRecordingId: "rec-1",
      feature: "energy",
      value: 0.4,
    });
    expect(result.success).toBe(false);
  });
});

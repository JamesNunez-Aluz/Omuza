import { describe, expect, it } from "vitest";

import { tokensToCss } from "./css.js";
import { feedback, motion, novelty, radius, typography } from "./tokens.js";

describe("design tokens (spec §14.5)", () => {
  it("covers all five novelty states and all six feedback responses", () => {
    expect(Object.keys(novelty)).toEqual([
      "confirmedNew",
      "highConfidenceNew",
      "probablyNew",
      "unknown",
      "known",
    ]);
    expect(Object.keys(feedback)).toEqual([
      "love",
      "like",
      "neutral",
      "dislike",
      "notNow",
      "alreadyKnew",
    ]);
  });

  it("limits the type scale to 5 steps and the radii to 2", () => {
    expect(Object.keys(typography.scale)).toHaveLength(5);
    expect(Object.keys(radius)).toHaveLength(2);
  });

  it("keeps motion durations within 120–240ms", () => {
    for (const key of ["durationFast", "durationBase", "durationSlow"] as const) {
      const ms = Number.parseInt(motion[key], 10);
      expect(ms).toBeGreaterThanOrEqual(120);
      expect(ms).toBeLessThanOrEqual(240);
    }
  });

  it("emits every token as a CSS custom property", () => {
    const css = tokensToCss();
    expect(css).toContain("--rz-neutral-900:");
    expect(css).toContain("--rz-novelty-probably-new:");
    expect(css).toContain("--rz-feedback-not-now:");
    expect(css).toContain("--rz-typography-scale-md:");
    expect(css).toContain("--rz-motion-duration-fast: 120ms;");
  });
});

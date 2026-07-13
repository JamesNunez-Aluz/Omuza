import { describe, expect, it } from "vitest";

import { effectiveConsent, hasGranted } from "./consent.js";
import type { ConsentState } from "./consent.js";

const granted: ConsentState = {
  purpose: "model_improvement",
  status: "granted",
  policyVersion: "model-improvement@2026-07-13",
  occurredAt: "2026-07-13T10:00:00.000Z",
};

describe("consent evaluation", () => {
  it("treats absence of a record as not granted", () => {
    expect(hasGranted([], "model_improvement")).toBe(false);
  });

  it("latest record wins: withdrawal supersedes an earlier grant", () => {
    const withdrawn: ConsentState = {
      ...granted,
      status: "withdrawn",
      occurredAt: "2026-07-13T11:00:00.000Z",
    };
    expect(hasGranted([granted, withdrawn], "model_improvement")).toBe(false);
    expect(hasGranted([withdrawn, granted], "model_improvement")).toBe(false);
    expect(effectiveConsent([granted, withdrawn]).get("model_improvement")?.status).toBe("withdrawn");
  });

  it("re-grant after withdrawal is effective again (history preserved)", () => {
    const withdrawn: ConsentState = { ...granted, status: "withdrawn", occurredAt: "2026-07-13T11:00:00.000Z" };
    const regranted: ConsentState = { ...granted, occurredAt: "2026-07-13T12:00:00.000Z" };
    expect(hasGranted([granted, withdrawn, regranted], "model_improvement")).toBe(true);
  });
});

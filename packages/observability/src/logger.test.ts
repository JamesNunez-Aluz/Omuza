import { Writable } from "node:stream";

import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { REDACTED_PATHS } from "./logger.js";

function captureLog(fields: Record<string, unknown>): string {
  let output = "";
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });
  const logger = pino(
    { redact: { paths: [...REDACTED_PATHS], censor: "[REDACTED]" } },
    sink,
  );
  logger.info(fields, "test event");
  return output;
}

describe("log redaction", () => {
  it("redacts tokens, secrets, emails, and provider payloads", () => {
    const line = captureLog({
      accessToken: "synthetic-access-token-value",
      connection: { refreshToken: "synthetic-refresh-token-value" },
      email: "someone@example.com",
      providerPayload: { raw: "provider-body" },
      spotify: { authorization: "Bearer synthetic" },
    });
    expect(line).not.toContain("synthetic-access-token-value");
    expect(line).not.toContain("synthetic-refresh-token-value");
    expect(line).not.toContain("someone@example.com");
    expect(line).not.toContain("provider-body");
    expect(line).not.toContain("Bearer synthetic");
    expect(line).toContain("[REDACTED]");
  });

  it("keeps non-sensitive structured fields intact", () => {
    const line = captureLog({ runId: "run-123", status: "completed" });
    expect(line).toContain("run-123");
    expect(line).toContain("completed");
  });
});

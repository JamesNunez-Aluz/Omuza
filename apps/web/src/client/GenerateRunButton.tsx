"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, api } from "./api";

interface CreateRunResponse {
  runId: string;
}

export function GenerateRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const run = await api<CreateRunResponse>("/api/v1/recommendation-runs", {
        body: {},
        idempotencyKey: crypto.randomUUID(),
      });
      router.push(`/runs/${run.runId}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not start generating.");
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button type="button" onClick={generate} disabled={busy}>
        {busy ? "Starting…" : "Generate my playlist"}
      </button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

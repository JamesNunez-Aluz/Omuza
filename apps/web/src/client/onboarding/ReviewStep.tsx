"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "../api";

interface SummarySeed {
  id: string;
  sentiment: string;
  entity: { name: string; entityType: string; disambiguation: string | null } | null;
}

interface SummaryResponse {
  seeds: SummarySeed[];
}

const SENTIMENT_LABEL: Record<string, string> = {
  strong_positive: "essential",
  positive: "like",
  negative: "avoid",
  hard_block: "never recommend",
  fatigue: "overplayed",
};

/** Step 5 (spec §5.2): plain-language, editable review before completion. */
export function ReviewStep({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SummaryResponse>("/api/v1/taste/summary")
      .then(setSummary)
      .catch(() => setError("Could not load your summary."));
  }, []);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/onboarding/complete", { body: {} });
      onComplete();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not finish onboarding.");
      setBusy(false);
    }
  }

  async function removeSeed(seedId: string) {
    try {
      await api(`/api/v1/taste/seeds/${seedId}`, { method: "DELETE", body: undefined });
      setSummary((current) =>
        current ? { seeds: current.seeds.filter((seed) => seed.id !== seedId) } : current,
      );
    } catch {
      setError("Could not remove that declaration.");
    }
  }

  const positives = summary?.seeds.filter((seed) =>
    ["strong_positive", "positive"].includes(seed.sentiment),
  );
  const negatives = summary?.seeds.filter(
    (seed) => !["strong_positive", "positive"].includes(seed.sentiment),
  );

  return (
    <div className="stack">
      <h2>Review your profile</h2>
      {!summary && !error ? <p role="status">Loading your declarations…</p> : null}

      {summary ? (
        <>
          <p>
            Resonance will look for music adjacent to {positives?.length ?? 0} things you love,
            while avoiding {negatives?.length ?? 0} things you have asked it to. You can change any
            of this later in Settings.
          </p>
          <h3>You love</h3>
          <ul className="seed-list">
            {positives?.map((seed) => (
              <li key={seed.id}>
                <span>
                  {seed.entity?.name ?? "Unknown"}{" "}
                  <span className="result-meta">({SENTIMENT_LABEL[seed.sentiment]})</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeSeed(seed.id)}
                  aria-label={`Remove ${seed.entity?.name ?? "declaration"}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <h3>You avoid</h3>
          <ul className="seed-list">
            {negatives?.map((seed) => (
              <li key={seed.id}>
                <span>
                  {seed.entity?.name ?? "Unknown"}{" "}
                  <span className="result-meta">({SENTIMENT_LABEL[seed.sentiment]})</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeSeed(seed.id)}
                  aria-label={`Remove ${seed.entity?.name ?? "declaration"}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" onClick={onBack} className="secondary">
          Back
        </button>
        <button type="button" onClick={complete} disabled={busy || !summary}>
          {busy ? "Finishing…" : "Finish setup"}
        </button>
      </div>
    </div>
  );
}

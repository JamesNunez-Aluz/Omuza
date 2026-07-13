"use client";

import { useState } from "react";

import { ApiError, api } from "../api";

/**
 * Step 1 (spec §5.2): the product promise, required Terms/Privacy consent,
 * and genuinely optional research/model-improvement consent — unchecked by
 * default, no dark patterns.
 */
export function ConsentStep({ onDone }: { onDone: () => void }) {
  const [required, setRequired] = useState(false);
  const [modelImprovement, setModelImprovement] = useState(false);
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/privacy/consents", { body: { purpose: "terms_privacy", status: "granted" } });
      await api("/api/v1/privacy/consents", {
        body: { purpose: "core_personalization", status: "granted" },
      });
      await api("/api/v1/privacy/consents", {
        body: { purpose: "model_improvement", status: modelImprovement ? "granted" : "withdrawn" },
      });
      await api("/api/v1/privacy/consents", {
        body: { purpose: "research", status: research ? "granted" : "withdrawn" },
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your consent.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <h2>How Resonance works</h2>
      <ul>
        <li>Recommendations come from what you tell us and how you respond inside Resonance.</li>
        <li>Connecting a streaming service is optional, and only ever used to export playlists.</li>
        <li>“New to you” is an estimate until you confirm it.</li>
        <li>Catalog metadata comes from licensed and open sources such as MusicBrainz.</li>
        <li>You can export or delete your data at any time from Settings.</li>
      </ul>

      <div className="field-group">
        <label>
          <input
            type="checkbox"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
            required
          />{" "}
          I accept the Terms of Service and Privacy Policy (required)
        </label>
        <label>
          <input
            type="checkbox"
            checked={modelImprovement}
            onChange={(event) => setModelImprovement(event.target.checked)}
          />{" "}
          Optional: my feedback may be used to improve recommendations for everyone
        </label>
        <label>
          <input
            type="checkbox"
            checked={research}
            onChange={(event) => setResearch(event.target.checked)}
          />{" "}
          Optional: my anonymized usage may be included in research analytics
        </label>
      </div>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" disabled={!required || busy}>
          {busy ? "Saving…" : "Agree and continue"}
        </button>
      </div>
    </form>
  );
}

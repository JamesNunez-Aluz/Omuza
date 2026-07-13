"use client";

import { useState } from "react";

import { ApiError, api } from "../api";

/**
 * Step 4 (spec §5.2): discovery controls, stored as the user's "General"
 * context profile. The slider has a synchronized numeric input (WCAG:
 * accessible slider alternative, spec §14.3).
 */
export function ControlsStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [discoveryLevel, setDiscoveryLevel] = useState(50);
  const [familiarity, setFamiliarity] = useState("balanced");
  const [popularity, setPopularity] = useState("any");
  const [explicitPolicy, setExplicitPolicy] = useState("allowed");
  const [vocals, setVocals] = useState("any");
  const [eraStart, setEraStart] = useState<string>("");
  const [eraEnd, setEraEnd] = useState<string>("");
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/contexts", {
        body: {
          name: "General",
          systemKey: "general",
          discoveryLevel,
          familiarityPreference: familiarity,
          popularityPreference: popularity,
          explicitContentPolicy: explicitPolicy,
          vocalPreference: vocals,
          eraStartYear: eraStart ? Number(eraStart) : null,
          eraEndYear: eraEnd ? Number(eraEnd) : null,
          structuredIntent: freeText.trim() ? { freeText: freeText.trim() } : null,
        },
      });
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "DUPLICATE_CONTEXT_NAME") {
        onDone(); // already created on a previous attempt
        return;
      }
      setError(cause instanceof ApiError ? cause.message : "Could not save your controls.");
      setBusy(false);
    }
  }

  const clampLevel = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

  return (
    <form onSubmit={submit} className="stack">
      <h2>Discovery controls</h2>

      <fieldset className="field-group">
        <legend>Discovery level — how adventurous should recommendations be?</legend>
        <div className="slider-row">
          <label htmlFor="discovery-slider" className="visually-hidden">
            Discovery level slider
          </label>
          <input
            id="discovery-slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={discoveryLevel}
            onChange={(event) => setDiscoveryLevel(clampLevel(Number(event.target.value)))}
          />
          <label htmlFor="discovery-number" className="visually-hidden">
            Discovery level, exact value
          </label>
          <input
            id="discovery-number"
            type="number"
            min={0}
            max={100}
            value={discoveryLevel}
            onChange={(event) => setDiscoveryLevel(clampLevel(Number(event.target.value)))}
          />
        </div>
        <p className="status">0 stays close to your seeds; 100 explores far afield.</p>
      </fieldset>

      <div className="field-group">
        <label htmlFor="familiarity">Familiarity</label>
        <select id="familiarity" value={familiarity} onChange={(e) => setFamiliarity(e.target.value)}>
          <option value="mostly_adjacent">Mostly adjacent</option>
          <option value="balanced">Balanced</option>
          <option value="farther_afield">Farther afield</option>
        </select>

        <label htmlFor="popularity">Popularity</label>
        <select id="popularity" value={popularity} onChange={(e) => setPopularity(e.target.value)}>
          <option value="any">Any</option>
          <option value="avoid_hits">Avoid obvious hits</option>
          <option value="deep_cuts">Deep cuts / long tail</option>
        </select>

        <label htmlFor="explicit">Explicit content</label>
        <select id="explicit" value={explicitPolicy} onChange={(e) => setExplicitPolicy(e.target.value)}>
          <option value="allowed">Allowed</option>
          <option value="blocked">Blocked</option>
          <option value="context_specific">Depends on context</option>
        </select>

        <label htmlFor="vocals">Vocals</label>
        <select id="vocals" value={vocals} onChange={(e) => setVocals(e.target.value)}>
          <option value="any">Any</option>
          <option value="mostly_vocal">Mostly vocal</option>
          <option value="mostly_instrumental">Mostly instrumental</option>
        </select>
      </div>

      <fieldset className="field-group">
        <legend>Era range (optional)</legend>
        <label htmlFor="era-start">From year</label>
        <input
          id="era-start"
          type="number"
          min={1900}
          max={2100}
          value={eraStart}
          onChange={(e) => setEraStart(e.target.value)}
        />
        <label htmlFor="era-end">To year</label>
        <input
          id="era-end"
          type="number"
          min={1900}
          max={2100}
          value={eraEnd}
          onChange={(e) => setEraEnd(e.target.value)}
        />
      </fieldset>

      <div className="field-group">
        <label htmlFor="intent">Anything else? (optional)</label>
        <textarea
          id="intent"
          maxLength={500}
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={3}
        />
        <p className="status">
          Stored with your profile; it never changes recommendations directly until it is parsed
          into reviewable structured settings.
        </p>
      </div>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" onClick={onBack} className="secondary">
          Back
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </form>
  );
}

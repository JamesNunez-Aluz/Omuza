"use client";

import { useState } from "react";

import { ApiError, api } from "../api";
import { SearchPicker } from "./SearchPicker";
import type { SearchResult } from "./SearchPicker";

/**
 * Steps 2 and 3 (spec §5.2): positive and negative declarations. Every pick
 * gets an explicit strength/kind — no seed is silently treated as
 * universally positive, and negatives distinguish hard blocks from fatigue.
 */

const POSITIVE_KINDS = [
  { label: "Essential", sentiment: "strong_positive", strength: 1 },
  { label: "Strong like", sentiment: "positive", strength: 0.8 },
  { label: "Context-specific", sentiment: "positive", strength: 0.5 },
  { label: "Nostalgic only", sentiment: "positive", strength: 0.3 },
] as const;

const NEGATIVE_KINDS = [
  { label: "Never recommend", sentiment: "hard_block", strength: 1 },
  { label: "Usually avoid", sentiment: "negative", strength: 0.8 },
  { label: "Context-specific", sentiment: "negative", strength: 0.5 },
  { label: "Overplayed, but not disliked", sentiment: "fatigue", strength: 0.7 },
] as const;

interface AddedSeed {
  seedId: string;
  title: string;
  meta: string;
  kindLabel: string;
}

interface SeedsResponse {
  items: { id: string }[];
}

export function SeedStep({
  mode,
  onDone,
  onBack,
}: {
  mode: "positive" | "negative";
  onDone: () => void;
  onBack: () => void;
}) {
  const kinds = mode === "positive" ? POSITIVE_KINDS : NEGATIVE_KINDS;
  const minimum = mode === "positive" ? 5 : 3;
  const [kindIndex, setKindIndex] = useState(0);
  const [added, setAdded] = useState<AddedSeed[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function pick(result: SearchResult) {
    setError(null);
    const kind = kinds[kindIndex]!;
    try {
      const response = await api<SeedsResponse>("/api/v1/taste/seeds", {
        body: {
          items: [
            {
              entityType: result.entityType,
              entityId: result.id,
              sentiment: kind.sentiment,
              strength: kind.strength,
              contextId: null,
            },
          ],
        },
        idempotencyKey: crypto.randomUUID(),
      });
      setAdded((current) => [
        ...current,
        {
          seedId: response.items[0]!.id,
          title: result.title,
          meta:
            result.entityType === "recording"
              ? result.artists.map((artist) => artist.name).join(", ")
              : "artist",
          kindLabel: kind.label,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save that pick.");
    }
  }

  async function remove(seed: AddedSeed) {
    setError(null);
    try {
      await api(`/api/v1/taste/seeds/${seed.seedId}`, { method: "DELETE", body: undefined });
      setAdded((current) => current.filter((entry) => entry.seedId !== seed.seedId));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not remove that pick.");
    }
  }

  return (
    <div className="stack">
      <h2>{mode === "positive" ? "Music you love" : "Music to avoid"}</h2>
      <p>
        {mode === "positive"
          ? `Add at least ${minimum} artists or songs you genuinely love.`
          : `Add at least ${minimum} artists or songs to avoid — this matters as much as what you love.`}
      </p>

      <div className="field-group">
        <label htmlFor={`kind-${mode}`}>
          {mode === "positive" ? "How much do you love the next pick?" : "How strongly should we avoid it?"}
        </label>
        <select
          id={`kind-${mode}`}
          value={kindIndex}
          onChange={(event) => setKindIndex(Number(event.target.value))}
        >
          {kinds.map((kind, index) => (
            <option key={kind.label} value={index}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>

      <SearchPicker
        label={mode === "positive" ? "Search for artists or songs you love" : "Search for artists or songs to avoid"}
        onPick={pick}
      />

      <h3>
        Added ({added.length} of {minimum} minimum)
      </h3>
      {added.length > 0 ? (
        <ul className="seed-list">
          {added.map((seed) => (
            <li key={seed.seedId}>
              <span>
                {seed.title} <span className="result-meta">({seed.meta} · {seed.kindLabel})</span>
              </span>
              <button type="button" onClick={() => remove(seed)} aria-label={`Remove ${seed.title}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="status">Nothing added yet.</p>
      )}

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" onClick={onBack} className="secondary">
          Back
        </button>
        <button type="button" onClick={onDone} disabled={added.length < minimum}>
          Continue
        </button>
      </div>
    </div>
  );
}

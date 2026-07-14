"use client";

import { useState } from "react";

import { ApiError, api } from "./api";

/**
 * Feedback interaction (spec §5.4): six primary responses, optional reason
 * chips after love/like/dislike, and an explicit newness confirmation. Large
 * targets, real buttons, aria-pressed state — never color-only.
 */

const PRIMARY = [
  { value: "love", label: "❤️ Love" },
  { value: "like", label: "👍 Like" },
  { value: "neutral", label: "😐 Neutral" },
  { value: "dislike", label: "👎 Dislike" },
  { value: "not_now", label: "🕒 Not now" },
  { value: "already_knew", label: "✓ Already knew" },
] as const;

const POSITIVE_REASONS = [
  ["vocals", "Vocals"],
  ["rhythm_beat", "Rhythm/beat"],
  ["melody", "Melody"],
  ["energy", "Energy"],
  ["mood", "Mood"],
  ["production", "Production"],
] as const;

const NEGATIVE_REASONS = [
  ["vocals", "Vocals"],
  ["too_slow", "Too slow"],
  ["too_intense", "Too intense"],
  ["too_repetitive", "Too repetitive"],
  ["wrong_mood", "Wrong mood"],
  ["too_familiar", "Too familiar"],
] as const;

export interface FeedbackState {
  eventId: string;
  primaryResponse: string;
  newnessResponse: string | null;
}

export function FeedbackBar({
  recommendationItemId,
  contextId,
  initial,
  onSaved,
}: {
  recommendationItemId: string;
  contextId: string | null;
  initial: FeedbackState | null;
  onSaved?: (state: FeedbackState) => void;
}) {
  const [current, setCurrent] = useState<FeedbackState | null>(initial);
  const [reasonsFor, setReasonsFor] = useState<string | null>(null);
  const [pickedReasons, setPickedReasons] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(primaryResponse: string, reasonCodes: string[], newnessResponse: string | null) {
    setBusy(true);
    setError(null);
    try {
      const event = await api<{ id: string }>("/api/v1/feedback", {
        body: {
          clientEventId: crypto.randomUUID(),
          recommendationItemId,
          primaryResponse,
          reasonCodes,
          newnessResponse,
          contextId,
          // Changing your mind appends a revision superseding the old event.
          supersedesEventId: current?.eventId ?? null,
        },
      });
      const state = { eventId: event.id, primaryResponse, newnessResponse };
      setCurrent(state);
      onSaved?.(state);
      setReasonsFor(["love", "like", "dislike"].includes(primaryResponse) ? primaryResponse : null);
      setPickedReasons(reasonCodes);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your feedback.");
    } finally {
      setBusy(false);
    }
  }

  const reasons = reasonsFor === "dislike" ? NEGATIVE_REASONS : POSITIVE_REASONS;

  return (
    <div className="feedback stack">
      <div className="feedback-buttons" role="group" aria-label="How was this track?">
        {PRIMARY.map((option) => (
          <button
            key={option.value}
            type="button"
            className={current?.primaryResponse === option.value ? "" : "secondary"}
            aria-pressed={current?.primaryResponse === option.value}
            disabled={busy}
            onClick={() => submit(option.value, [], current?.newnessResponse ?? null)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {reasonsFor ? (
        <fieldset className="field-group">
          <legend>What stood out? (optional)</legend>
          <div className="feedback-buttons">
            {reasons.map(([code, label]) => {
              const active = pickedReasons.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  className={active ? "" : "secondary"}
                  aria-pressed={active}
                  disabled={busy}
                  onClick={() => {
                    const next = active
                      ? pickedReasons.filter((entry) => entry !== code)
                      : [...pickedReasons, code];
                    void submit(reasonsFor, next, current?.newnessResponse ?? null);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {current && current.primaryResponse !== "already_knew" ? (
        <div className="feedback-buttons" role="group" aria-label="Was this new to you?">
          <button
            type="button"
            className={current.newnessResponse === "new_to_me" ? "" : "secondary"}
            aria-pressed={current.newnessResponse === "new_to_me"}
            disabled={busy}
            onClick={() => submit(current.primaryResponse, pickedReasons, "new_to_me")}
          >
            New to me
          </button>
          <button
            type="button"
            className={current.newnessResponse === "already_knew" ? "" : "secondary"}
            aria-pressed={current.newnessResponse === "already_knew"}
            disabled={busy}
            onClick={() => submit(current.primaryResponse, pickedReasons, "already_knew")}
          >
            I knew it
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

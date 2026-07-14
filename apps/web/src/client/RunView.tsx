"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api } from "./api";
import { FeedbackBar } from "./FeedbackBar";
import type { FeedbackState } from "./FeedbackBar";
import { SavePlaylistButton } from "./SavePlaylistButton";

interface RunItem {
  recommendationItemId: string;
  position: number;
  recording: {
    id: string;
    title: string;
    artists: { id: string; name: string }[];
    durationMs: number | null;
  };
  novelty: { state: string; probability: number; confidence: number };
  explanation: { text: string; evidence: { type: string; label: string }[] } | null;
}

interface RunResponse {
  id: string;
  status: string;
  contextId: string | null;
  requestedCount: number;
  degradedProviders: string[];
  constraintRelaxations: string[];
  items?: RunItem[];
  failure?: { code: string; message: string };
}

interface FeedbackEventDto {
  id: string;
  recordingId: string;
  primaryResponse: string;
  newnessResponse: string | null;
  supersedesEventId: string | null;
}

/** Novelty badge copy (spec §5.3) — icon + label so meaning never rests on color. */
const NOVELTY_BADGE: Record<string, { label: string; symbol: string }> = {
  confirmed_new: { label: "New to you", symbol: "★" },
  high_confidence_new: { label: "Very likely new", symbol: "◆" },
  probably_new: { label: "Probably new", symbol: "◇" },
  unknown: { label: "Newness unknown", symbol: "?" },
  known: { label: "You know this", symbol: "●" },
};

const POLL_INTERVAL_MS = 1500;

export function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunResponse | null>(null);
  const [feedbackByRecording, setFeedbackByRecording] = useState<Map<string, FeedbackState>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await api<RunResponse>(`/api/v1/recommendation-runs/${runId}`);
        if (cancelled) return;
        setRun(response);
        if (response.status === "queued" || response.status === "generating") {
          timer.current = setTimeout(poll, POLL_INTERVAL_MS);
        } else if (response.status === "completed" || response.status === "degraded") {
          const existing = await api<{ items: FeedbackEventDto[] }>(`/api/v1/feedback?runId=${runId}`);
          if (cancelled) return;
          const superseded = new Set(
            existing.items.flatMap((event) => (event.supersedesEventId ? [event.supersedesEventId] : [])),
          );
          const map = new Map<string, FeedbackState>();
          for (const event of existing.items) {
            if (superseded.has(event.id)) continue;
            map.set(event.recordingId, {
              eventId: event.id,
              primaryResponse: event.primaryResponse,
              newnessResponse: event.newnessResponse,
            });
          }
          setFeedbackByRecording(map);
        }
      } catch {
        if (!cancelled) setError("Could not load this playlist run.");
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId]);

  if (error) {
    return (
      <p role="alert" className="error">
        {error} <Link href="/home">Back to your profile</Link>
      </p>
    );
  }
  if (!run) {
    return <p role="status">Loading…</p>;
  }

  if (run.status === "queued" || run.status === "generating") {
    return (
      <p role="status" className="status">
        {run.status === "queued" ? "Waiting for a worker…" : "Selecting tracks from your profile…"}{" "}
        This usually takes a few seconds.
      </p>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="stack" role="alert">
        <p className="error">{run.failure?.message ?? "Generation failed."}</p>
        <p>
          <Link href="/home">Back to your profile</Link>
        </p>
      </div>
    );
  }

  const items = run.items ?? [];
  const shortfall = items.length < run.requestedCount;

  return (
    <div className="stack">
      <p role="status" className="status">
        {items.length} tracks generated{run.status === "degraded" ? " with limitations" : ""}.
      </p>

      {run.status === "degraded" ? (
        <p className="notice">
          {run.degradedProviders.length > 0
            ? `A discovery source (${run.degradedProviders.join(", ")}) was unavailable, so coverage may be narrower than usual.`
            : shortfall
              ? `We could only find ${items.length} of ${run.requestedCount} tracks that honestly fit your profile — we don't pad lists with weak matches.`
              : "This list was generated with relaxed diversity constraints."}
        </p>
      ) : null}

      <ol className="track-list">
        {items.map((item) => {
          const badge = NOVELTY_BADGE[item.novelty.state] ?? NOVELTY_BADGE.unknown!;
          return (
            <li key={item.recommendationItemId} className="track">
              <div className="track-head">
                <span className="track-title">{item.recording.title}</span>
                <span className={`novelty-badge novelty-${item.novelty.state}`}>
                  <span aria-hidden="true">{badge.symbol}</span> {badge.label}
                </span>
              </div>
              <p className="result-meta">
                {item.recording.artists.map((artist) => artist.name).join(", ") || "Unknown artist"}
              </p>
              {item.explanation ? <p className="track-why">{item.explanation.text}</p> : null}
              <FeedbackBar
                recommendationItemId={item.recommendationItemId}
                contextId={run.contextId}
                initial={feedbackByRecording.get(item.recording.id) ?? null}
              />
            </li>
          );
        })}
      </ol>
      <SavePlaylistButton runId={run.id} contextId={run.contextId} />
      <p>
        <Link href="/home">Back to your profile</Link> ·{" "}
        <Link href="/playlists">Your saved playlists</Link>
      </p>
    </div>
  );
}

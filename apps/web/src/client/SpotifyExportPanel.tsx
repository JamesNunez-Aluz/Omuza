"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "./api";

interface ExportItemDto {
  recordingId: string;
  status: string;
  matchMethod: string | null;
  confidence: number | null;
  candidate: { displayTitle: string; displayArtist: string | null } | null;
}

interface ExportDto {
  id: string;
  status: string;
  destinationUrl: string | null;
  itemCount: number;
  inserted: number;
  unresolved: number;
  needsConfirmation: number;
  errorCode: string | null;
  items: ExportItemDto[];
}

const POLLABLE = ["requested", "resolving", "creating_playlist", "inserting_items"];

/** Spotify export flow on the playlist page (pilot users only). */
export function SpotifyExportPanel({ playlistId }: { playlistId: string }) {
  const [current, setCurrent] = useState<ExportDto | null>(null);
  const [decisions, setDecisions] = useState<Map<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function poll(exportId: string) {
    try {
      const state = await api<ExportDto>(`/api/v1/exports/${exportId}`);
      setCurrent(state);
      if (POLLABLE.includes(state.status)) {
        timer.current = setTimeout(() => void poll(exportId), 1500);
      }
    } catch {
      setError("Could not load the export status.");
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ exportId: string }>(
        `/api/v1/playlists/${playlistId}/exports/spotify`,
        { body: {}, idempotencyKey: crypto.randomUUID() },
      );
      await poll(created.exportId);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not start the export.");
    } finally {
      setBusy(false);
    }
  }

  async function submitConfirmations() {
    if (!current) return;
    const pending = current.items.filter((item) => item.status === "needs_confirmation");
    const confirmations = pending.map((item) => ({
      recordingId: item.recordingId,
      accept: decisions.get(item.recordingId) ?? false,
    }));
    setBusy(true);
    try {
      await api(`/api/v1/exports/${current.id}/confirm`, { body: { confirmations } });
      await poll(current.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your review.");
    } finally {
      setBusy(false);
    }
  }

  async function retry(mode: "resume" | "keep" | "clean_retry") {
    if (!current) return;
    setBusy(true);
    try {
      const result = await api<{ exportId: string }>(`/api/v1/exports/${current.id}/retry`, {
        body: { mode },
      });
      await poll(result.exportId ?? current.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="spotify-export-heading">
      <h2 id="spotify-export-heading">Export to Spotify</h2>
      {!current ? (
        <div className="actions">
          <button type="button" onClick={start} disabled={busy}>
            {busy ? "Starting…" : "Export as a private Spotify playlist"}
          </button>
        </div>
      ) : null}

      {current ? (
        <div className="stack">
          <p role="status" className="status">
            Status: {current.status.replaceAll("_", " ")}
            {current.inserted > 0 ? ` · ${current.inserted} of ${current.itemCount} added` : ""}
            {current.unresolved > 0
              ? ` · ${current.unresolved} unresolved (they stay in your Resonance playlist)`
              : ""}
          </p>

          {current.status === "needs_review" ? (
            <div className="stack">
              <h3>Confirm uncertain matches</h3>
              <ul className="seed-list">
                {current.items
                  .filter((item) => item.status === "needs_confirmation")
                  .map((item) => (
                    <li key={item.recordingId}>
                      <span>
                        {item.candidate?.displayTitle}{" "}
                        <span className="result-meta">
                          {item.candidate?.displayArtist} · confidence{" "}
                          {item.confidence?.toFixed(2) ?? "?"}
                        </span>
                      </span>
                      <span className="actions">
                        <button
                          type="button"
                          className={decisions.get(item.recordingId) === true ? "" : "secondary"}
                          aria-pressed={decisions.get(item.recordingId) === true}
                          onClick={() =>
                            setDecisions(new Map(decisions).set(item.recordingId, true))
                          }
                        >
                          Use this match
                        </button>
                        <button
                          type="button"
                          className={decisions.get(item.recordingId) === false ? "" : "secondary"}
                          aria-pressed={decisions.get(item.recordingId) === false}
                          onClick={() =>
                            setDecisions(new Map(decisions).set(item.recordingId, false))
                          }
                        >
                          Skip it
                        </button>
                      </span>
                    </li>
                  ))}
              </ul>
              <button type="button" onClick={submitConfirmations} disabled={busy}>
                Save review and continue
              </button>
            </div>
          ) : null}

          {current.status === "ambiguous" ? (
            <div className="stack">
              <p className="notice">
                We could not verify whether Spotify finished adding the tracks. Choose how to
                proceed — we never delete or overwrite playlists in your Spotify account.
              </p>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => retry("keep")} disabled={busy}>
                  Keep it as-is
                </button>
                <button type="button" onClick={() => retry("clean_retry")} disabled={busy}>
                  Create a clean new export
                </button>
                {current.destinationUrl ? (
                  <a href={current.destinationUrl} target="_blank" rel="noreferrer">
                    Inspect in Spotify
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {current.status === "rate_limited" || current.status === "authorization_required" ? (
            <div className="actions">
              <p className="notice">
                {current.status === "rate_limited"
                  ? "Spotify asked us to slow down. Try resuming in a minute."
                  : "Spotify needs you to reconnect in Settings, then resume."}
              </p>
              <button type="button" onClick={() => retry("resume")} disabled={busy}>
                Resume export
              </button>
            </div>
          ) : null}

          {current.status === "completed" && current.destinationUrl ? (
            <p>
              <a href={current.destinationUrl} target="_blank" rel="noreferrer">
                Open your private playlist in Spotify
              </a>
            </p>
          ) : null}
          {current.status === "failed" ? (
            <p role="alert" className="error">
              Export failed. Your Resonance playlist is unaffected — you can retry or use CSV/M3U.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

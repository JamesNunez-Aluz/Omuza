"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "./api";

interface PlaylistItem {
  id: string;
  position: number;
  recording: {
    id: string;
    title: string;
    artists: { id: string; name: string }[];
  };
}

interface PlaylistResponse {
  id: string;
  name: string;
  sourceRunId: string | null;
  contextId: string | null;
  items: PlaylistItem[];
}

interface FeedbackEventDto {
  id: string;
  recordingId: string;
  primaryResponse: string;
  supersedesEventId: string | null;
}

export function PlaylistView({ playlistId }: { playlistId: string }) {
  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);
  const [feedback, setFeedback] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await api<PlaylistResponse>(`/api/v1/playlists/${playlistId}`);
    setPlaylist(response);
    if (response.sourceRunId) {
      const events = await api<{ items: FeedbackEventDto[] }>(
        `/api/v1/feedback?runId=${response.sourceRunId}`,
      );
      const superseded = new Set(
        events.items.flatMap((event) => (event.supersedesEventId ? [event.supersedesEventId] : [])),
      );
      setFeedback(
        new Map(
          events.items
            .filter((event) => !superseded.has(event.id))
            .map((event) => [event.recordingId, event.primaryResponse]),
        ),
      );
    }
  }, [playlistId]);

  useEffect(() => {
    load().catch(() => setError("Could not load this playlist."));
  }, [load]);

  async function download(format: "csv" | "m3u") {
    setError(null);
    try {
      const response = await fetch(`/api/v1/playlists/${playlistId}/exports/file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (!response.ok) throw new Error("export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${playlist?.name ?? "playlist"}.${format === "csv" ? "csv" : "m3u8"}`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`${format.toUpperCase()} downloaded.`);
    } catch {
      setError("Could not export the playlist.");
    }
  }

  async function removeItem(item: PlaylistItem) {
    try {
      await api(`/api/v1/playlists/${playlistId}/items/${item.id}`, { method: "DELETE", body: undefined });
      await load();
    } catch {
      setError("Could not remove that track.");
    }
  }

  /**
   * Replace disliked tracks: generate a new run that preserves loved tracks
   * and excludes disliked + current ones, then apply it to this playlist
   * (spec §5.5 — lineage flows to the new run's items).
   */
  async function replaceDisliked() {
    if (!playlist) return;
    setBusy(true);
    setError(null);
    setStatus("Generating replacements…");
    try {
      const loved = playlist.items
        .filter((item) => ["love", "like"].includes(feedback.get(item.recording.id) ?? ""))
        .map((item) => item.recording.id);
      const currentIds = playlist.items.map((item) => item.recording.id);

      const run = await api<{ runId: string }>("/api/v1/recommendation-runs", {
        body: {
          contextId: playlist.contextId,
          requestedCount: Math.min(Math.max(playlist.items.length, 10), 50),
          preserveRecordingIds: loved,
          excludeRecordingIds: currentIds.filter((id) => !loved.includes(id)),
        },
        idempotencyKey: crypto.randomUUID(),
      });

      for (let attempt = 0; attempt < 40; attempt += 1) {
        const state = await api<{ status: string }>(`/api/v1/recommendation-runs/${run.runId}`);
        if (state.status === "completed" || state.status === "degraded") break;
        if (state.status === "failed") throw new Error("run failed");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      await api(`/api/v1/playlists/${playlistId}/rebuild`, {
        body: { runId: run.runId, preserveRecordingIds: loved },
      });
      await load();
      setStatus("Playlist rebuilt: loved tracks kept, the rest replaced.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not rebuild the playlist.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !playlist) {
    return (
      <p role="alert" className="error">
        {error} <Link href="/playlists">Back to playlists</Link>
      </p>
    );
  }
  if (!playlist) return <p role="status">Loading…</p>;

  return (
    <div className="stack">
      <h1>{playlist.name}</h1>
      <div className="actions">
        <button type="button" onClick={() => download("csv")}>
          Export CSV
        </button>
        <button type="button" onClick={() => download("m3u")}>
          Export M3U
        </button>
        <button type="button" className="secondary" onClick={replaceDisliked} disabled={busy}>
          {busy ? "Rebuilding…" : "Keep loved, replace the rest"}
        </button>
      </div>

      {status ? (
        <p role="status" className="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <ol className="track-list">
        {playlist.items.map((item) => {
          const response = feedback.get(item.recording.id);
          return (
            <li key={item.id} className="track">
              <div className="track-head">
                <span className="track-title">{item.recording.title}</span>
                {response ? <span className="result-meta">you said: {response.replaceAll("_", " ")}</span> : null}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => removeItem(item)}
                  aria-label={`Remove ${item.recording.title}`}
                >
                  Remove
                </button>
              </div>
              <p className="result-meta">
                {item.recording.artists.map((artist) => artist.name).join(", ")}
              </p>
            </li>
          );
        })}
      </ol>
      <p>
        <Link href="/playlists">All playlists</Link> · <Link href="/home">Your profile</Link>
      </p>
    </div>
  );
}

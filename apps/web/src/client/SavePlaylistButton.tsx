"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, api } from "./api";

export function SavePlaylistButton({ runId, contextId }: { runId: string; contextId: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(`Discoveries ${new Date().toLocaleDateString()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const playlist = await api<{ id: string }>("/api/v1/playlists", {
        body: { name, description: null, sourceRunId: runId, contextId },
      });
      router.push(`/playlists/${playlist.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the playlist.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card stack">
      <label htmlFor="playlist-name">Save this list as a playlist</label>
      <div className="search-controls">
        <input
          id="playlist-name"
          value={name}
          maxLength={120}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save playlist"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </form>
  );
}

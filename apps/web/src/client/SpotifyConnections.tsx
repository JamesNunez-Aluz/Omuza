"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "./api";

interface ConnectionDto {
  id: string;
  service: string;
  status: string;
  authorizedAt: string;
}

/** Settings section for the Spotify export pilot (only rendered for pilot users). */
export function SpotifyConnections() {
  const [connections, setConnections] = useState<ConnectionDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await api<{ items: ConnectionDto[] }>("/api/v1/connections");
    setConnections(response.items);
  }, []);

  useEffect(() => {
    load().catch(() => setError("Could not load connections."));
    const params = new URLSearchParams(window.location.search);
    const status = params.get("spotify");
    if (status === "connected") setMessage("Spotify connected. You can now export playlists.");
    else if (status) setError("Connecting Spotify did not complete. Try again.");
  }, [load]);

  async function connect() {
    setError(null);
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>(
        "/api/v1/connections/spotify/start",
        { body: {} },
      );
      window.location.href = authorizeUrl;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not start the connection.");
    }
  }

  async function disconnect(connectionId: string) {
    setError(null);
    try {
      const result = await api<{ note: string }>(`/api/v1/connections/${connectionId}`, {
        method: "DELETE",
        body: undefined,
      });
      setMessage(`Disconnected. ${result.note}`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not disconnect.");
    }
  }

  const active = connections?.find(
    (connection) => connection.service === "spotify" && connection.status === "active",
  );

  return (
    <section className="card stack" aria-labelledby="connections-heading">
      <h2 id="connections-heading">Spotify export (pilot)</h2>
      <p className="status">
        Spotify is used only to export playlists you choose. It never influences your
        recommendations or taste profile.
      </p>
      {active ? (
        <div className="actions">
          <span>Connected since {new Date(active.authorizedAt).toLocaleDateString()}</span>
          <button type="button" className="danger" onClick={() => disconnect(active.id)}>
            Disconnect and delete tokens
          </button>
        </div>
      ) : (
        <div className="actions">
          <button type="button" onClick={connect}>
            Connect Spotify
          </button>
        </div>
      )}
      {message ? (
        <p role="status" className="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

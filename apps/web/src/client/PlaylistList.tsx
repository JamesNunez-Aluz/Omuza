"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "./api";

interface PlaylistSummary {
  id: string;
  name: string;
  createdAt: string;
}

export function PlaylistList() {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: PlaylistSummary[] }>("/api/v1/playlists")
      .then((response) => setPlaylists(response.items))
      .catch(() => setError("Could not load your playlists. Are you signed in?"));
  }, []);

  if (error) {
    return (
      <p role="alert" className="error">
        {error} <a href="/">Sign in</a>
      </p>
    );
  }
  if (!playlists) return <p role="status">Loading…</p>;
  if (playlists.length === 0) {
    return (
      <p>
        No playlists yet. <Link href="/home">Generate one from your profile.</Link>
      </p>
    );
  }
  return (
    <ul className="seed-list">
      {playlists.map((playlist) => (
        <li key={playlist.id}>
          <Link href={`/playlists/${playlist.id}`}>{playlist.name}</Link>
          <span className="result-meta">{new Date(playlist.createdAt).toLocaleDateString()}</span>
        </li>
      ))}
    </ul>
  );
}

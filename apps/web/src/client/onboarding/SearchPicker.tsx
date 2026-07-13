"use client";

import { useId, useState } from "react";

import { ApiError, api } from "../api";

export interface SearchResult {
  entityType: "artist" | "recording";
  id: string;
  title: string;
  artists: { id: string | null; name: string }[];
  disambiguation: string | null;
  sourceAttribution: string[];
}

interface SearchResponse {
  items: SearchResult[];
  degraded: boolean;
}

/**
 * Structured catalog search (spec §5.2 Mode B). Fully keyboard-operable:
 * a labelled search input, a submit button, and results as real buttons.
 * Canonical disambiguation is always visible — never hover-only.
 */
export function SearchPicker({
  label,
  onPick,
}: {
  label: string;
  onPick: (result: SearchResult) => void;
}) {
  const inputId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [statusText, setStatusText] = useState("");
  const [busy, setBusy] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) {
      setStatusText("Type at least two characters to search.");
      return;
    }
    setBusy(true);
    setStatusText("Searching…");
    try {
      const response = await api<SearchResponse>(
        `/api/v1/catalog/search?q=${encodeURIComponent(query)}&limit=8`,
      );
      setResults(response.items);
      setStatusText(
        response.items.length === 0
          ? "No matches found. Try a different spelling."
          : `${response.items.length} result${response.items.length === 1 ? "" : "s"}${
              response.degraded ? " (catalog source degraded — results may be incomplete)" : ""
            }`,
      );
    } catch (cause) {
      setResults([]);
      setStatusText(
        cause instanceof ApiError ? cause.message : "Search failed. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form onSubmit={search} role="search" aria-label={label} className="search-row">
        <label htmlFor={inputId}>{label}</label>
        <div className="search-controls">
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby={statusId}
            autoComplete="off"
          />
          <button type="submit" disabled={busy}>
            Search
          </button>
        </div>
      </form>

      <p id={statusId} role="status" className="status">
        {statusText}
      </p>

      {results.length > 0 ? (
        <ul className="result-list">
          {results.map((result) => (
            <li key={`${result.entityType}:${result.id}`}>
              <button type="button" className="result" onClick={() => onPick(result)}>
                <span className="result-title">{result.title}</span>{" "}
                <span className="result-meta">
                  {result.entityType === "recording"
                    ? `song · ${result.artists.map((artist) => artist.name).join(", ")}`
                    : "artist"}
                  {result.disambiguation ? ` · ${result.disambiguation}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="attribution">Catalog data from MusicBrainz.</p>
    </div>
  );
}

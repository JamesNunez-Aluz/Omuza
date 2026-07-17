import { z } from "zod";

import { SpotifyAmbiguousError, SpotifyApiError } from "./errors.js";
import type { SpotifyTrackSearchResult } from "./types.js";

/**
 * The single centralized Spotify Web API client (spec §12.9). Only the three
 * allowlisted surfaces exist: search (export-time resolution), private
 * playlist creation, and item insertion. No read of history, libraries,
 * playlists, audio features, previews, or recommendations — ever.
 *
 * Mutating requests distinguish "failed before transmission" (retryable)
 * from "timed out after transmission" (ambiguous; never blindly replayed).
 */

const searchResponseSchema = z.object({
  tracks: z.object({
    items: z
      .array(
        z.object({
          uri: z.string(),
          id: z.string(),
          name: z.string(),
          duration_ms: z.number().int().nonnegative(),
          artists: z.array(z.object({ name: z.string() })).min(1),
          external_ids: z.object({ isrc: z.string().optional() }).optional(),
          album: z.object({ release_date: z.string().optional() }).optional(),
        }),
      )
      .default([]),
  }),
});

const createPlaylistResponseSchema = z.object({
  id: z.string().min(1),
  external_urls: z.object({ spotify: z.string().optional() }).optional(),
});

export interface SpotifyClientOptions {
  apiBaseUrl: string;
  getAccessToken: () => Promise<string>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Test hook for retry sleeping. */
  sleep?: (ms: number) => Promise<void>;
}

export class SpotifyClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Observability counters (spec §12.9). */
  readonly metrics = { requests: 0, rateLimited: 0, retries: 0 };

  constructor(private readonly options: SpotifyClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** ISRC-filtered search (spec §12.5 step 1). */
  async searchByIsrc(isrc: string): Promise<SpotifyTrackSearchResult[]> {
    return this.search(`isrc:${sanitizeQueryValue(isrc)}`, 5);
  }

  /** Artist/title fallback search (spec §12.5 step 2). */
  async searchByArtistTitle(artist: string, title: string): Promise<SpotifyTrackSearchResult[]> {
    const query = `track:"${sanitizeQueryValue(title)}" artist:"${sanitizeQueryValue(artist)}"`;
    return this.search(query, 10);
  }

  private async search(query: string, limit: number): Promise<SpotifyTrackSearchResult[]> {
    const params = new URLSearchParams({ q: query, type: "track", limit: String(limit) });
    const data = await this.request("GET", `/v1/search?${params}`, undefined, true);
    const parsed = searchResponseSchema.safeParse(data);
    if (!parsed.success) throw new SpotifyApiError("malformed", "search response shape");
    return parsed.data.tracks.items.map((item) => ({
      uri: item.uri,
      id: item.id,
      name: item.name,
      durationMs: item.duration_ms,
      artistNames: item.artists.map((artist) => artist.name),
      ...(item.external_ids?.isrc ? { isrc: item.external_ids.isrc } : {}),
      ...(item.album?.release_date ? { releaseDate: item.album.release_date } : {}),
    }));
  }

  /** Create a PRIVATE playlist (spec §12.6). Never implies endorsement. */
  async createPrivatePlaylist(
    name: string,
    description: string,
  ): Promise<{ id: string; url: string | null }> {
    const data = await this.request(
      "POST",
      "/v1/me/playlists",
      { name, public: false, description },
      false,
    );
    const parsed = createPlaylistResponseSchema.safeParse(data);
    if (!parsed.success) throw new SpotifyApiError("malformed", "create playlist response shape");
    return { id: parsed.data.id, url: parsed.data.external_urls?.spotify ?? null };
  }

  /** Insert items in canonical order, one batch for ≤100 tracks (spec §12.7). */
  async addPlaylistItems(playlistId: string, uris: string[]): Promise<void> {
    if (uris.length === 0) return;
    if (uris.length > 100) throw new SpotifyApiError("malformed", "batch exceeds endpoint maximum");
    await this.request(
      "POST",
      `/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
      { uris },
      false,
    );
  }

  /**
   * Core request with rate-limit + retry handling. Retries are permitted for
   * GETs and for mutations whose failure provably occurred before
   * transmission; a post-transmission timeout on a mutation raises
   * SpotifyAmbiguousError instead (spec §12.8).
   */
  private async request(
    method: "GET" | "POST",
    path: string,
    body: object | undefined,
    idempotentRead: boolean,
  ): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      this.metrics.requests += 1;
      const token = await this.options.getAccessToken();
      let response: Response;
      try {
        response = await this.fetchFn(`${this.options.apiBaseUrl.replace(/\/$/, "")}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const isTimeout =
          error instanceof DOMException &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        if (isTimeout && !idempotentRead) {
          // The request may have been transmitted: unknown outcome.
          throw new SpotifyAmbiguousError(`${method} ${path.split("?")[0]}`);
        }
        if (attempt < this.maxRetries) {
          attempt += 1;
          this.metrics.retries += 1;
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw new SpotifyApiError("unavailable", isTimeout ? "timeout" : "network failure");
      }

      if (response.status === 429) {
        this.metrics.rateLimited += 1;
        const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "1", 10);
        if (attempt < this.maxRetries) {
          attempt += 1;
          this.metrics.retries += 1;
          await this.sleep(Math.min(Math.max(retryAfter, 1), 30) * 1000);
          continue;
        }
        throw new SpotifyApiError("rate_limited", "retry budget exhausted", retryAfter);
      }
      if (response.status === 401) {
        throw new SpotifyApiError("unauthorized", "access token rejected");
      }
      if (response.status === 403) {
        throw new SpotifyApiError("forbidden", "scope or policy rejection");
      }
      if (response.status >= 500) {
        if (attempt < this.maxRetries) {
          attempt += 1;
          this.metrics.retries += 1;
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw new SpotifyApiError("unavailable", `status ${response.status}`);
      }
      if (!response.ok) {
        throw new SpotifyApiError("malformed", `status ${response.status}`);
      }

      if (response.status === 204) return {};
      try {
        return await response.json();
      } catch {
        return {};
      }
    }
  }
}

function backoffMs(attempt: number): number {
  const base = 400 * 2 ** (attempt - 1);
  return base + Math.floor((attempt * 137) % 250); // deterministic jitter
}

function sanitizeQueryValue(value: string): string {
  return value.replaceAll('"', "").replaceAll(/[\r\n]/g, " ").trim();
}

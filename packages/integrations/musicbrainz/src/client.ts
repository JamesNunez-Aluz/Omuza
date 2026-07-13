import type { ZodType } from "zod";

import { MusicBrainzError } from "./errors.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  mbArtistSearchResponseSchema,
  mbRecordingSearchResponseSchema,
} from "./types.js";
import type { MusicBrainzArtist, MusicBrainzRecording } from "./types.js";

/**
 * MusicBrainz WS/2 client (spec §11.1–11.2, §16.5).
 *
 * - Fixed base URL; no user-controlled URLs.
 * - Mandatory descriptive User-Agent.
 * - 1 request/second client-side rate limit.
 * - Timeout + response-size limit + content-type validation.
 * - Retry with backoff on 429/503, honoring Retry-After (capped).
 * - Zod validation before any field is used.
 * - Kill switch (`enabled: false` fails fast with a typed error).
 * - Core CC0 data only: supplementary datasets (tags/ratings/genres) are
 *   never requested (see assertCoreDataOnly).
 */

export interface MusicBrainzClientOptions {
  userAgent: string;
  baseUrl?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  fetchFn?: typeof fetch;
  /** Test hook: overrides retry/rate-limit sleeping. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_URL = "https://musicbrainz.org/ws/2";
const PROHIBITED_INCLUDES = ["tags", "ratings", "genres", "user-tags", "user-ratings", "user-genres"];

export interface MusicBrainzHealth {
  status: "ok" | "disabled" | "not_configured";
  detail?: string;
}

export class MusicBrainzClient {
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxResponseBytes: number;
  private readonly fetchFn: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: MusicBrainzClientOptions) {
    if (!options.userAgent || options.userAgent.trim().length < 5) {
      throw new Error("MusicBrainz requires a descriptive User-Agent (app/version contact)");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.enabled = options.enabled ?? true;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxResponseBytes = options.maxResponseBytes ?? 2_000_000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limiter = new RateLimiter(1000, this.sleep);
  }

  async healthCheck(): Promise<MusicBrainzHealth> {
    if (!this.enabled) return { status: "disabled" };
    return { status: "ok" };
  }

  async searchArtists(query: string, limit: number): Promise<MusicBrainzArtist[]> {
    const data = await this.get(
      "/artist",
      { query: escapeLucene(query), limit: String(limit), fmt: "json" },
      mbArtistSearchResponseSchema,
    );
    return data.artists.map((artist) => ({
      mbid: artist.id,
      name: artist.name,
      ...(artist["sort-name"] !== undefined && { sortName: artist["sort-name"] }),
      ...(artist.disambiguation && { disambiguation: artist.disambiguation }),
      ...(artist.country && { countryCode: artist.country }),
      ...(artist["life-span"]?.begin && { beginDate: artist["life-span"].begin }),
      ...(artist["life-span"]?.end && { endDate: artist["life-span"].end }),
    }));
  }

  async searchRecordings(query: string, limit: number): Promise<MusicBrainzRecording[]> {
    const data = await this.get(
      "/recording",
      { query: escapeLucene(query), limit: String(limit), fmt: "json" },
      mbRecordingSearchResponseSchema,
    );
    return data.recordings.map((recording) => ({
      mbid: recording.id,
      title: recording.title,
      ...(recording.length !== undefined && { durationMs: recording.length }),
      ...(recording.disambiguation && { disambiguation: recording.disambiguation }),
      ...(recording["first-release-date"] && { firstReleaseDate: recording["first-release-date"] }),
      credits: recording["artist-credit"].map((credit) => ({
        artistMbid: credit.artist.id,
        artistName: credit.artist.name,
        creditName: credit.name,
        ...(credit.joinphrase && { joinPhrase: credit.joinphrase }),
      })),
    }));
  }

  private async get<T>(path: string, params: Record<string, string>, schema: ZodType<T>): Promise<T> {
    if (!this.enabled) {
      throw new MusicBrainzError("disabled", "provider kill switch is off", false);
    }
    assertCoreDataOnly(params);

    let attempt = 0;
    for (;;) {
      await this.limiter.acquire();
      try {
        return await this.requestOnce(path, params, schema);
      } catch (error) {
        const isRetryable = error instanceof MusicBrainzError && error.retryable;
        if (!isRetryable || attempt >= this.maxRetries) throw error;
        attempt += 1;
        const retryAfterMs =
          error instanceof MusicBrainzError && error.kind === "rate_limited"
            ? Math.min((error as MusicBrainzError & { retryAfterMs?: number }).retryAfterMs ?? 0, 10_000)
            : 0;
        await this.sleep(Math.max(retryAfterMs, 500 * 2 ** (attempt - 1)));
      }
    }
  }

  private async requestOnce<T>(
    path: string,
    params: Record<string, string>,
    schema: ZodType<T>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(params)}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: {
          "user-agent": this.options.userAgent,
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new MusicBrainzError("timeout", `no response within ${this.timeoutMs}ms`, true);
      }
      throw new MusicBrainzError("unavailable", "network failure", true);
    }

    if (response.status === 429 || response.status === 503) {
      const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      const error = new MusicBrainzError("rate_limited", `status ${response.status}`, true) as MusicBrainzError & {
        retryAfterMs?: number;
      };
      if (Number.isFinite(retryAfterSeconds)) error.retryAfterMs = retryAfterSeconds * 1000;
      throw error;
    }
    if (!response.ok) {
      throw new MusicBrainzError("unavailable", `status ${response.status}`, response.status >= 500);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new MusicBrainzError("malformed_response", `unexpected content-type ${contentType}`, false);
    }

    const body = await response.text();
    if (body.length > this.maxResponseBytes) {
      throw new MusicBrainzError("malformed_response", "response exceeds size limit", false);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new MusicBrainzError("malformed_response", "invalid JSON", false);
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new MusicBrainzError(
        "malformed_response",
        `schema validation failed: ${validated.error.issues[0]?.path.join(".") ?? "unknown"}`,
        false,
      );
    }
    return validated.data;
  }
}

/** Escape Lucene query syntax so user text cannot inject search operators (spec §16.5). */
export function escapeLucene(input: string): string {
  return input.replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, "\\$&");
}

/** Structural guard: supplementary (noncommercial) datasets are never requested. */
function assertCoreDataOnly(params: Record<string, string>): void {
  const inc = params.inc ?? "";
  for (const prohibited of PROHIBITED_INCLUDES) {
    if (inc.split("+").includes(prohibited)) {
      throw new MusicBrainzError(
        "malformed_response",
        `prohibited supplementary dataset requested: ${prohibited}`,
        false,
      );
    }
  }
}

import { z } from "zod";

/**
 * ListenBrainz adapter — Strategy B, behind a double gate (spec §11.3):
 *
 * 1. `FEATURE_LISTENBRAINZ_PROVIDER` (off by default) — this client refuses
 *    to run when disabled.
 * 2. License registry: `listenbrainz-api@1` currently prohibits every use.
 *    Even with the flag on, candidates carrying ListenBrainz provenance are
 *    rejected by the recommender's hard filters until the registry is
 *    updated after endpoint/terms review (§6.3). Both changes require an ADR.
 *
 * The recording-recommendation endpoint shape is validated with Zod before
 * any field is used; provider rank is retained as evidence, never trusted as
 * final ordering (re-ranked like all sources).
 */

const lbRecommendationSchema = z.object({
  payload: z.object({
    mbids: z
      .array(
        z.object({
          recording_mbid: z.string().uuid(),
          score: z.number().optional(),
        }),
      )
      .default([]),
  }),
});

export interface ListenBrainzRecommendation {
  recordingMbid: string;
  providerScore: number;
  providerRank: number;
}

export interface ListenBrainzClientOptions {
  enabled: boolean;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class ListenBrainzDisabledError extends Error {
  constructor() {
    super("ListenBrainz provider is disabled (FEATURE_LISTENBRAINZ_PROVIDER=false)");
    this.name = "ListenBrainzDisabledError";
  }
}

export class ListenBrainzClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ListenBrainzClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.listenbrainz.org").replace(/\/$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async healthCheck(): Promise<{ status: "ok" | "disabled" }> {
    return { status: this.options.enabled ? "ok" : "disabled" };
  }

  /** Raw recommendations by user token; validated, HTTPS-only, bounded. */
  async recordingRecommendations(userName: string, count: number): Promise<ListenBrainzRecommendation[]> {
    if (!this.options.enabled) throw new ListenBrainzDisabledError();

    const url = `${this.baseUrl}/1/cf/recommendation/user/${encodeURIComponent(userName)}/recording?count=${count}`;
    const response = await this.fetchFn(url, {
      headers: {
        accept: "application/json",
        ...(this.options.token ? { authorization: `Token ${this.options.token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`listenbrainz unavailable: status ${response.status}`);
    }
    const parsed = lbRecommendationSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("listenbrainz malformed response");
    }
    return parsed.data.payload.mbids.map((entry, index) => ({
      recordingMbid: entry.recording_mbid,
      providerScore: entry.score ?? 0,
      providerRank: index + 1,
    }));
  }
}

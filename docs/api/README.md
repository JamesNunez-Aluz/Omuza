# API documentation

Versioned JSON API under `/api/v1` (spec §13). All inputs/outputs validated
with the shared Zod schemas in `packages/validation/src/api.ts`. Errors use
the envelope of §13.1 (`error.code`, `message`, `requestId`, `retryable`,
client-safe `details`). Authentication errors never reveal account existence.

Auth: session cookie (`rz_session`, HttpOnly, SameSite=Lax, Secure in prod),
issued by the passwordless email flow. All mutating routes require a
same-origin `Origin`/`Referer` header (CSRF defense). Retryable mutations
accept `Idempotency-Key` (same key + same body replays; different body → 409).

## Health

| Endpoint | Method | Notes |
|---|---|---|
| `/health/live` | GET | 200 when the process serves requests |
| `/health/ready` | GET | 200 when config valid and PostgreSQL answers; 503 otherwise |

Worker exposes the same paths on `WORKER_HEALTH_PORT` (default 3001).

## Authentication (passwordless email, spec §16.2)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/auth/request-link` | POST `{email}` | Always 202 for well-formed requests (enumeration-resistant); ≤5 links/email/hour, then 429 |
| `/api/v1/auth/verify` | POST `{token}` | Redeems a single-use, 15-minute token; sets the session cookie |
| `/api/v1/auth/logout` | POST | Revokes the session, clears the cookie |
| `/api/v1/auth/me` | GET | Current user + effective consents |

## Catalog

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/catalog/search` | GET `?q=&type=artist,recording&limit=` | Canonical entities with disambiguation, MBIDs, `sourceAttribution`; `degraded: true` when the provider fails; responses cached 24h |

## Taste

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/taste/seeds` | GET / POST | Bulk declare seeds (sentiments: strong_positive, positive, negative, hard_block, fatigue; strength 0–1; optional owned contextId). POST supports Idempotency-Key and enqueues profile recomputation |
| `/api/v1/taste/seeds/{seedId}` | PATCH / DELETE | User-scoped; DELETE is a soft delete and triggers recomputation |
| `/api/v1/taste/summary` | GET | Active seeds with display entities + derived preferences |
| `/api/v1/onboarding/complete` | POST | 409 until required consents and ≥5 positive / ≥3 negative seeds exist |

## Recommendation runs (spec §13.6–13.7)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/recommendation-runs` | POST | Queue an async generation: `{contextId?, requestedCount (10–50, default 20), discoveryLevel?, preserveRecordingIds, excludeRecordingIds}`. Discovery defaults to the context's level. 202 with `statusUrl`; supports Idempotency-Key |
| `/api/v1/recommendation-runs/{runId}` | GET | User-scoped status. Completed/degraded responses include items (recording display, novelty state/probability/confidence, evidence-backed explanation), `degradedProviders`, and `constraintRelaxations`; failed responses carry a safe `failure.code`/`message`. First owner fetch records exposures |

Internal affinity values and provider payloads are never exposed. The full
decision trace (all candidates, rejection reasons, score breakdowns,
ranker/selector versions, random seed) is persisted server-side for
reproducibility and offline evaluation.

## Feedback (spec §13.8)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/feedback` | POST | `{clientEventId, recommendationItemId, primaryResponse (love/like/neutral/dislike/not_now/already_knew), reasonCodes[], newnessResponse?, contextId?, supersedesEventId?}`. The item must have been exposed to this user (422 otherwise). Duplicate clientEventId replays the original (200). Revisions supersede — append-only, never edited. Newness answers update the known-recording ledger only, never taste. Triggers profile recomputation |
| `/api/v1/feedback?runId=` | GET | The user's feedback events for a run |

## Playlists & file export (spec §13.9–13.10)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/playlists` | GET / POST | POST saves a finished run: `{name, description?, sourceRunId, contextId?}`; items carry lineage to run items |
| `/api/v1/playlists/{id}` | GET / PATCH / DELETE | PATCH uses optimistic concurrency: body carries expected `version`; stale → 409 |
| `/api/v1/playlists/{id}/items/{itemId}` | DELETE | Soft remove |
| `/api/v1/playlists/{id}/items/reorder` | PATCH | `{orderedItemIds}` — must match current items exactly |
| `/api/v1/playlists/{id}/rebuild` | POST | `{runId, preserveRecordingIds}` — keeps preserved tracks, replaces the rest with the new run's items (lineage retained) |
| `/api/v1/playlists/{id}/exports/file` | POST | `{format: "csv"\|"m3u"}` → file download. Works with no destination connection. CSV columns per spec; M3U uses MusicBrainz permalinks as service-neutral references |

## Context profiles

`POST/GET /api/v1/contexts`, `GET/PATCH/DELETE /api/v1/contexts/{contextId}` —
discovery level 0–100, familiarity/popularity/vocals/explicit policies,
language lists, era range, declared free-text intent (stored, not yet parsed).

## Privacy (spec §13.13)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/privacy/consents` | GET / POST | Append-only consent records; withdrawal appends, never mutates |
| `/api/v1/privacy/export` | POST | 202; worker attaches the export payload to the request |
| `/api/v1/privacy/delete` | POST `{confirm}` | Requires the confirmation phrase; 202; asynchronous, auditable |
| `/api/v1/privacy/requests/{requestId}` | GET | User-scoped status/payload |

## Settings

`GET/PATCH /api/v1/settings` — display name, locale, time zone.

OpenAPI generation from these schemas is planned with the first external
consumer; the Zod schemas are the source of truth today.

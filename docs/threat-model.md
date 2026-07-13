# Threat model (skeleton — Milestone 0)

Scope grows with each milestone; every entry has an owner and a status. No
security-critical TODO may be unowned (spec §21 M0 acceptance).

## Assets

- A1. First-party taste/feedback/outcome data (Zone A) — the company asset.
- A2. User identity, credentials, consent records.
- A3. Destination OAuth tokens (Zone C, Milestone 4).
- A4. License/provenance integrity (compliance posture itself).

## Trust boundaries

- B1. Browser ↔ Next.js BFF (untrusted input).
- B2. App ↔ PostgreSQL (parameterized queries only).
- B3. Worker ↔ external providers (MusicBrainz M1, Spotify M4) — timeouts, rate limits, schema validation required before any call ships.
- B4. Code ↔ LLM (M2+): outputs are untrusted proposals, schema-validated (ADR 0015).

## Threats and controls

| ID | Threat | Control (status) | Owner |
|---|---|---|---|
| TM-1 | Prohibited Spotify data flow into recommendations/training | Layered: lint rule, policy script, db CHECKs, registry, fixture tests (**in place, M0**) | Engineering |
| TM-2 | Secrets/PII in logs | Pino redaction paths + tests (**in place, M0**); log review gate per milestone | Engineering |
| TM-3 | SQL injection | Parameterized queries everywhere (**in place**); no string-built SQL in review checklist | Engineering |
| TM-4 | XSS / clickjacking | CSP, frame-ancestors none, nosniff (**baseline, M0**); nonce-based CSP before auth ships (M1) | Engineering |
| TM-5 | Credential stuffing / session fixation | Passwordless email login: hashed single-use 15-min tokens, per-email rate limit, enumeration-resistant responses; sessions hashed, rotated past half-life, revocable; CSRF origin checks (**in place, M1** — tested in apps/web/integration) | Engineering |
| TM-6 | IDOR on user resources | Every repository query is user-scoped; foreign ids answer 404; horizontal-escalation tests per resource (**in place, M1**) | Engineering |
| TM-7 | OAuth token theft (Spotify) | Encrypted at rest, never logged, purge on disconnect (**open — M4**, ADR 0012) | Engineering |
| TM-8 | Provider abuse/outage cascades | MusicBrainz: fixed base URL, 1 req/s limiter, timeout, size limit, retry with Retry-After, schema validation, kill switch, contract tests for 429/timeout/malformed (**in place, M1**); degraded search is surfaced honestly | Engineering |
| TM-11 | Weak step-up on account deletion | Confirmation phrase today; full re-authentication step-up before public beta (**open — M5/M6**) | Engineering |
| TM-12 | Export payload retention | privacy_requests.payload holds exports indefinitely; retention/cleanup job (**open — M5**) | Engineering |
| TM-9 | Supply-chain compromise | Lockfile pinning, `pnpm audit` + gitleaks in CI (**in place, M0**); provenance review for new deps | Engineering |
| TM-10 | Migration tampering | Hash-verified applied migrations (**in place, M0**) | Engineering |

## Status notes (Milestone 1)

TM-5, TM-6, and TM-8 moved to “in place” with route-level security tests
(`apps/web/integration/*.integration.test.ts`) and provider contract tests
(`packages/integrations/musicbrainz`). Still open: TM-4 nonce CSP, TM-7
(Milestone 4), TM-11 step-up re-auth, TM-12 export retention.

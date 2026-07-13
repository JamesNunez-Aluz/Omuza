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
| TM-5 | Credential stuffing / session fixation | First-party auth hardening + tests (**open — M1**) | Engineering |
| TM-6 | IDOR on user resources | AuthZ tests per route (**open — M1**) | Engineering |
| TM-7 | OAuth token theft (Spotify) | Encrypted at rest, never logged, purge on disconnect (**open — M4**, ADR 0012) | Engineering |
| TM-8 | Provider abuse/outage cascades | Timeouts, rate limits, kill switches, contract tests (**open — M1 for MusicBrainz**) | Engineering |
| TM-9 | Supply-chain compromise | Lockfile pinning, `pnpm audit` + gitleaks in CI (**in place, M0**); provenance review for new deps | Engineering |
| TM-10 | Migration tampering | Hash-verified applied migrations (**in place, M0**) | Engineering |

## Non-goals at M0

No auth surface exists yet; no external provider calls exist yet. Entries TM-5..TM-8 are intentionally open with milestone owners rather than silently absent.

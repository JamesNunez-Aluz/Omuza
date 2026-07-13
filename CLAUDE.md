# Resonance Engineering Instructions

## Mission

Build a service-neutral music discovery engine that optimizes confirmed new loves.
The master specification is `docs/music-taste-engine-claude-build-spec.md` (v1.1).
Read the active milestone (§21) and relevant ADRs before any work. This file wins
on constraints; the spec wins on detail.

## Absolute constraints

- Never use Spotify data for recommendation features, taste profiles, analytics of
  taste, or model training.
- Spotify exists only in `packages/integrations/spotify` for OAuth, temporary track
  resolution, and playlist export.
- `packages/recommender` may not import any destination integration.
- All catalog features require provenance, a license-policy version, and eligibility
  flags. Unknown license/provenance means ineligible.
- The LLM is an interface/interpretation layer over first-party data (spec §10.20).
  It edits data, never state. It never nominates tracks or artists from model
  memory, never fabricates catalog entities or features, and every output is a
  schema-validated proposal the user can inspect.
- Never claim a track is unheard unless the user confirms it.
- Explanations must reference stored evidence; never invent musical properties.
- Core product must work with `FEATURE_SPOTIFY_EXPORT=false`.
- No secrets, tokens, personal email, raw free text, or provider payloads in logs.
- Do not add microservices or infrastructure without an ADR and measured need.

## Priority

The company-defining goal is Milestones 0–3: onboarding → playlist → feedback →
learning loop, usable by real users without any Spotify connection. Milestone 4
(Spotify export) is deferred until 0–3 are complete and validated. When in doubt,
choose the path that gets a real user a real playlist sooner without violating a
constraint above.

## Workflow

1. Read the active milestone and relevant ADRs.
2. Write an implementation plan.
3. Add/update tests.
4. Implement the smallest coherent vertical slice.
5. Run `pnpm check`.
6. Update API docs, data dictionary, ADRs, and runbooks.
7. Report changes, tests, and unresolved risks.

Never declare a milestone complete with skipped tests, unhandled type errors,
placeholder security, fake integration behavior, or unexplained TODOs.

## Required commands

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm policy:check`
- `pnpm check`

## Code standards

- Strict TypeScript. Zod at trust boundaries.
- Domain code independent of Next.js.
- Append-only personal evidence where history/reversal matters.
- UTC `timestamptz`. Idempotency for retryable mutations.
- Structured redacted logs. Explicit failure states.
- Accessible UI (WCAG 2.2 AA). Design tokens from `packages/ui/tokens` only —
  no ad-hoc values (spec §14.5).
- Synthetic test data only. No real OAuth tokens or production content in fixtures.

## Before changing recommendation logic

- Version the ranker/selector. Preserve reproducibility.
- Add golden/invariant tests.
- Document metric and guardrail effects.
- Confirm every feature's eligibility.

## Before changing an external integration

- Read current official docs. Verify policy/license.
- Add timeout, rate limit, retry, kill switch, schema validation, contract tests,
  and purge behavior.

## Prompts are code

LLM prompts live in the repository, are versioned, schema-validated, tested against
golden cases, and have deterministic fallbacks. A prompt regression is a release
blocker like any ranker regression.

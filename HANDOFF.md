# Resonance — Project Review & Handoff

**Date:** 2026-07-13 (updated 2026-07-18) · **State:** Milestones 0–4 implemented and verified; **direction reset toward validation — see §0** · **Branch:** `claude/project-review-handoff-64zd8o`

> **Milestone 1–4 update:** identity (passwordless email auth, sessions),
> append-only consent, MusicBrainz catalog adapter + search, onboarding
> (seeds, contexts, discovery controls, review), taste-profile derivation
> with recompute jobs, privacy export/delete, the recommendation engine v0
> (versioned, reproducible), the feedback learning loop, playlists with
> CSV/M3U export, and the flag-gated Spotify export pilot are all
> implemented on top of the M0 skeleton described below. See
> `docs/api/README.md`, `docs/data-dictionary.md`, and the per-milestone
> completion reports in the session log. Sections 2–8 below describe M0.

---

## 0. Project direction plan (added 2026-07-18) — validate before building more

### Where we actually are

Five milestones are built, every gate is green — and **zero humans have used
the product**. Three gaps surfaced in review:

1. **Nobody can hear any music in the product.** The UI presents
   recommendations as text. There is no playback, no preview, not even a
   per-track outbound "listen" link. The feedback loop asks users to rate
   tracks they have no way of hearing without leaving the app and searching
   by hand. For a music discovery product, this is the experience itself
   being absent, not a missing feature.
2. **Nothing is deployed.** All validation to date is synthetic tests. The
   spec's own priority (§21, CLAUDE.md) — Milestones 0–3 *validated with
   real users* — has not begun.
3. **Positioning is unanswered.** "Why would a specific person choose this
   over Spotify's built-in, zero-effort discovery?" has no written answer.
   The onboarding asks for 8+ hand-declared seeds before any payoff; some
   user must exist for whom that trade is worth it. Name that user.

The engineering is not wasted — the compliance posture and service-neutral
architecture are real assets *if* the product finds its user. But the next
unit of progress is evidence, not code.

### The plan

**Phase A — close the listening gap (days, not weeks).**
Add a service-neutral "listen" affordance to every recommended track:
outbound links (user-configurable preferred service, plus a neutral
search-link fallback) and, where licensing allows, embedded previews.
Links carry no licensing burden; embedded audio must pass the same
integration review as any provider. Exit: a user can go from
recommendation → hearing the track → feedback without leaving the flow.

**Phase B — deploy and run a closed pilot (week 1–2).**
Stand up a production instance (managed Postgres, real email delivery,
`FEATURE_SPOTIFY_EXPORT=false`). Recruit 5–10 people matching the target
profile. Watch at least five full sessions live (screen share or in
person). Instrument nothing new — the analytics funnel
(`pnpm report:funnel`) already exists; *use* it.

**Phase C — write the positioning sentence (parallel with B).**
One sentence: *"[Named user type] uses Resonance instead of [incumbent
behavior] because [specific value only we deliver]."* Candidate hypotheses
to test in the pilot, not debate in the abstract: (a) listeners who
distrust engagement-optimized algorithms and want an explainable,
ownable taste profile; (b) deliberate discoverers (RYM/Bandcamp types) who
treat finding music as an activity, not background automation; (c) people
leaving a streaming service who want their taste to be portable. The pilot
should kill or promote these.

**Phase D — validation gates (end of pilot).**
Provisional targets — revise the numbers with data, but never remove a
gate without replacing it:

| Gate | Metric | Target |
|---|---|---|
| G1 Onboarding survives contact | pilot users completing seed declaration | ≥ 70% |
| G2 The loop closes | users giving feedback on ≥ 5 tracks of their first playlist | ≥ 60% |
| G3 The product works | users with ≥ 1 *confirmed new love* in week one | ≥ 40% |
| G4 It's wanted | users generating a 2nd playlist unprompted in week two | ≥ 30% |

### Standing rule until the gates pass

**No new build milestones.** Specifically deferred: Milestone 5, additional
export destinations (Apple Music, Tidal, YouTube Music — the "universal"
expansion), native mobile apps, and LLM-layer work. The Spotify pilot flag
stays off (its launch checklist requires validated M0–3 anyway). Bug fixes,
Phase A, deployment work, and anything a pilot user is blocked by are in
scope. If a gate fails, the response is a positioning or product change and
a re-run — not a new feature.

The "work with any music service" goal is preserved, and already structural
(neutral core, per-service adapters, universal file export). Destination
adapters get built in demand order from pilot evidence, not speculatively.

---

## 1. What this project is

Resonance is a **service-neutral music discovery engine** whose north-star metric is
*Confirmed New Loves per Weekly Active User*: tracks a user explicitly confirms they
love **and** had never heard before. The master specification is
`docs/music-taste-engine-claude-build-spec.md` (v1.1, ~5,300 lines); `CLAUDE.md`
carries the binding engineering constraints.

The company-defining bet (spec §1, §24): the recommendation engine is built **only**
on first-party data (user declarations, feedback, exposure events) and licensed/open
catalog data. Spotify is deliberately just an *export destination* — never a data
source for taste, features, analytics, or training. That inversion is what makes the
taste graph an ownable asset instead of a platform-policy violation waiting to happen.

### The Spotify compliance boundary in one paragraph

`packages/integrations/spotify` is the only code allowed to talk to Spotify, for
exactly three things: OAuth, temporary track resolution, and playlist export. Raw
Spotify payload types never leave that package; the only DTO that crosses is
`ExportResolution` (canonical ID, destination URI, confidence, match method,
temporary display fields, mandatory expiry). Nothing Spotify-sourced may become a
recommendation feature, taste input, analytics dimension, or training datum — and
the product must be fully usable with `FEATURE_SPOTIFY_EXPORT=false`.

### Priority

Milestones 0–3 (onboarding → playlist → feedback → learning loop, usable with zero
streaming connections) are the company. Milestone 4 (Spotify export) is deferred
until 0–3 are validated with real users.

## 2. What was reviewed and what was built

The repository started empty except for the starter kit (spec, `CLAUDE.md`, kickoff
prompt, three Claude commands). This session implemented **Milestone 0 — compliance
skeleton and repository foundation** end-to-end: a pnpm/Turborepo TypeScript
modular monolith in which the prohibited data flow is *structurally difficult*, not
just discouraged.

### Repository tree (implemented)

```text
apps/
  web/          Next.js 15 App Router shell — /health/live, /health/ready,
                strict security headers, token-driven styling, Playwright scaffold
  worker/       pg-boss worker shell — ping queue, health server, graceful shutdown
packages/
  domain/       Provenance types, DataUse, code-owned LICENSE REGISTRY
                (deny-by-default), assertTrainingEligible / isRecommendationEligible
  validation/   Zod schemas mirroring domain types (trust-boundary validation)
  config/       Zod-validated env config (fails fast, never echoes secrets)
  observability/ Pino structured logging with enforced redaction paths (tested)
  db/           Drizzle schema + hand-written SQL migrations (hash-verified,
                forward-only), license-registry seed, integration tests
  recommender/  Ranker/CandidateProvider/ExplanationGenerator interfaces +
                versioned deterministic skeleton ranker (reproducible, eligibility-
                enforcing). MUST NOT import integrations — enforced.
  integrations/
    spotify/    Export-only stub behind FEATURE_SPOTIFY_EXPORT kill switch;
                payload types package-local; ExportResolution DTO; zero network code
    musicbrainz/ Client skeleton (real lookups + rate limiting land in Milestone 1)
  ui/tokens/    Design tokens per spec §14.5 (neutral ramp + one accent, 5 novelty
                + 6 feedback semantic colors, 5-step type scale, 4px grid, 2 radii,
                2 elevations, 120–240ms motion) emitted as CSS custom properties
  testkit/      Synthetic fixtures (validated on load) + fixture policy tests
scripts/
  verify-policy-boundaries.ts   Blocking gate: import-graph rules R1–R4
  verify-feature-provenance.ts  Blocking gate: license/fixture rules P1–P4
  seed-demo-data.ts             Idempotent synthetic seed
docs/
  adr/          ADRs 0001–0008, 0015–0017 accepted (0009–0014 reserved, see README)
  threat-model.md, data-dictionary.md, compliance/dependency-graph.md,
  runbooks/local-development.md, api/README.md
.github/workflows/  ci.yml (lint→typecheck→policy→test→migrate→integration),
                    security.yml (audit + gitleaks), migrations.yml (clean-db apply)
docker-compose.yml  postgres:17 + mailpit   ·   .devcontainer/   ·   .env.example
```

### Dependency direction (enforced, not aspirational)

`domain` ← `validation`/`db`/`recommender`/`testkit` ← apps. Integrations are
leaves injected at the application layer. Enforcement is **five-layered**:

1. ESLint `no-restricted-imports` scoped to recommender/domain (editor-time).
2. `pnpm policy:check` walks the real import graph (CI-blocking): recommender/domain
   can't import integrations; **nobody** may import `@resonance/spotify` today
   (Milestone 4 adds an allowlist via ADR); Spotify payload types/API host outside
   the adapter fail the build; domain must stay framework-free.
3. Database CHECK constraints: `spotify_never_training_eligible` and
   `spotify_never_recommendation_eligible` on `recording_features`.
4. License registry: deny-by-default `isUseAllowed`; Spotify policy permits only
   `temporary_cache`/`display` with 1-day retention.
5. Fixture/test gates: `assertTrainingEligible` rejects Spotify rows regardless of
   flags; testkit tests scan every fixture.

## 3. Verification results (all run in this session)

| Check | Result |
|---|---|
| `pnpm install` from clean checkout | ✅ |
| `pnpm build` (all 12 tasks incl. `next build`) | ✅ |
| `pnpm check` = lint + typecheck + test + policy:check | ✅ all green |
| Unit tests | ✅ 30 passed across 8 packages |
| `pnpm test:integration` (real PostgreSQL 16) | ✅ 6 passed — migrations idempotent, license seed idempotent, **both Spotify CHECK constraints reject violating inserts**, FK enforcement, queue delivers ping job exactly once |
| `pnpm db:seed` | ✅ 6 policies, 3 artists, 3 recordings (synthetic) |
| Health endpoints (live servers) | ✅ web+worker `/health/live` & `/health/ready` 200; ready → **503 when PostgreSQL stopped**, recovers on restart; liveness stays 200 |
| Security headers (live response) | ✅ CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, HSTS (prod only), no `unsafe-eval` in prod |
| **Deliberate violation #1**: recommender file importing `@resonance/spotify` | ✅ `policy:check` fails (R1 + R2), removed after proof |
| **Deliberate violation #2**: Spotify fixture flipped to `trainingEligible: true` | ✅ `policy:check` fails (P4 ×2) **and** testkit test fails, reverted after proof |
| No real credentials / no external provider calls in default tests | ✅ everything synthetic; no network code exists in integrations yet |

Not verifiable in this environment: `pnpm dev` full docker-compose path (no Docker
daemon in this CI container — verified against a local PostgreSQL 16 instead) and an
actual GitHub Actions run (workflows are committed; first PR will exercise them).

## 4. Key decisions made (ADRs)

Accepted: **0001** service-neutral core · **0002** Spotify export-only boundary ·
**0003** modular monolith · **0004** first-party auth · **0005** canonical recording
identity (MBID-anchored, internal UUIDs) · **0006** field-level provenance + license
registry (deny-by-default, versioned policies) · **0007** deterministic ranker before
ML (versioned, seed-pinned, reproducible) · **0008** Postgres-backed jobs (pg-boss) ·
**0015** LLM edits data never state · **0016** taste-language embedding provenance ·
**0017** generative-UI component registry. ADRs 0009–0014 are reserved for the
milestones that implement them (`docs/adr/README.md`).

Notable implementation choices beyond the spec:

- **Hand-written SQL migrations** with a hash-verifying forward-only migrator
  (drizzle-kit generation can come later; CHECK constraints needed hand SQL anyway).
  Drizzle schema mirrors the SQL for typed queries.
- **Lint runs once at the root** (ESLint 9 flat config) rather than per package.
- **Node 22 / Next 15.5 / React 19 / TS 5.9 / Vitest 3 / pg-boss 10 / Tailwind 4**,
  exact versions pinned in `pnpm-lock.yaml`.

## 5. Specification conflicts & resolutions

1. **ADR numbering vs Milestone 0 list** — M0 names 7 ADRs; spec §26 numbers 17; the
   kickoff adds 0015–0017. Resolved: implement 0001–0008 (0008 justified because the
   queue ships in M0) + 0015–0017 now, reserve 0009–0014 with their milestones.
2. **Spec §6.3 `LicensePolicy` interface** has no `id`/version field yet requires
   "every feature row references a license-policy version". Resolved: added versioned
   `id` (`provider-dataset@N`) as the primary key; new versions, never mutation.
3. **`docs/adr/` listed in starter README** but absent from the zip. Created.
4. **Design tokens (§14.5) vs M0 deliverables** — tokens are M1-adjacent but the
   kickoff names them explicitly. Shipped the package + tests now; dark-mode theme
   variants land with real UI in M1 (dark mode must be first-class there).
5. **Spec repo layout shows `scripts/purge-expired-provider-data.ts`** but no table
   holds provider cache yet. Deferred to Milestone 4 with the export cache itself —
   an empty stub would be fake behavior, which CLAUDE.md forbids.

## 6. How to run it

```bash
cp .env.example .env
pnpm install
docker compose up -d            # postgres:17 + mailpit
pnpm db:migrate && pnpm db:seed
pnpm dev                        # web :3000 · worker health :3001 · mailpit UI :8025
pnpm check                      # the full blocking gate
```

See `docs/runbooks/local-development.md` for failure modes.

## 7. Remaining Milestone 0 risks / follow-ups

1. **CI unexercised** — workflows are written but haven't run on GitHub yet; expect
   one round of environment friction (pnpm setup, service health timing).
2. **CSP allows `unsafe-inline` scripts** — required by Next bootstrap today; move to
   nonce-based CSP before auth ships (threat model TM-4, Milestone 1).
3. **License registry review dates are engineering-set** — `reviewedAt: 2026-07-13`
   records code review, not counsel sign-off. The §6.4 platform-policy gate (legal
   review of Spotify policy, ListenBrainz terms) must happen before Milestone 4 and
   before any commercial launch (spec §25 founder gates).
4. **Policy script is regex-based import scanning** — robust for current shapes, but
   consider `dependency-cruiser` or TS-API resolution as the codebase grows.
5. **Playwright scaffold not in CI** — intentional for M0 (no product UI); wire it in
   with Milestone 1's onboarding flows.
6. **`.claude/settings.example.json` and spec §28 hooks** not yet added — optional
   M0 nicety, zero product impact.

## 8. What's next: Milestone 1 (spec §21)

Identity, consent, catalog, onboarding: first-party auth + sessions, consent
records, MusicBrainz adapter (rate limit, cache, contract tests, 429/timeout
handling), catalog search with canonical disambiguation, positive/negative seed UI,
context profiles, discovery slider, accessibility baseline (keyboard-complete
onboarding), data export/deletion skeleton. Exit gate: a complete, privacy-aware
taste declaration from independent sources — no Spotify anywhere.

Suggested workflow: `/milestone 1` per `.claude/commands/milestone.md`, Fable 5 for
architecture/review passes, `/review` before calling it done.

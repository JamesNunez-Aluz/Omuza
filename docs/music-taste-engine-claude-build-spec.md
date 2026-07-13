# Music Taste Engine — Product, Architecture, and Claude Build Specification

**Document status:** Build-ready v1.1
**Last verified:** 2026-07-13
**Changelog v1.1:** Added Software 3.0 layer (§10.20), conversational onboarding path (§5.2), advanced interaction and generative-UI patterns (§5.7), full design system (§14.5), LLM-assisted evaluation (§15.4a), new feature flags (§17.5), and ADRs 0015–0017. Clarified LLM boundary: the LLM remains ineligible as a catalog or candidate source, but is elevated to a first-class *interface and interpretation layer* over first-party data.
**Primary implementer:** Claude Code
**Product codename:** `Resonance`
**Working product promise:** *Discover music that is probably new to you and unusually likely to become a favorite.*
**Commercial posture:** Cross-service discovery engine; Spotify is an optional destination adapter, not the data foundation or recommendation engine.

> **Important:** This document is an engineering and product specification, not legal advice. Spotify platform rules and third-party data licenses are launch-critical constraints. Before a commercial release, obtain qualified legal review and, where applicable, written approval or extended access from the platform provider.

---

## Contents

- [0. Instructions to Claude](#0-instructions-to-claude)
- [1–5. Product vision, users, scope, and experience](#1-executive-product-decision)
- [6–9. Compliance architecture, system design, catalog, and data model](#6-compliance-first-architecture)
- [10. Recommendation engine](#10-recommendation-engine)
- [11–12. Data providers and Spotify export](#11-external-data-and-provider-integrations)
- [13–14. Application API and front end](#13-application-api)
- [15–20. Analytics, security, reliability, testing, and operations](#15-analytics-and-experimentation)
- [21–22. Milestones and definition of done](#21-milestone-plan)
- [23–25. Risks, defensibility, acquisition, and product decisions](#23-risk-register)
- [26–30. ADRs, Claude workflow, backlog, and release gates](#26-architecture-decision-records-to-create)
- [31–35. Acceptance scenarios, extensions, platform facts, references, and directive](#31-example-acceptance-scenarios)

## How to read this document

This specification is long by design; it is the compliance and quality contract, not a tutorial. Use this map:

| If you are… | Read first | Treat as reference |
|---|---|---|
| Claude implementing a milestone | §0, §21 (active milestone only), relevant ADRs, `CLAUDE.md` | Everything else, pulled on demand |
| Reviewing compliance | §0, §6, §11, §12, §18.3 | §33–34 |
| Working on the recommender | §10, §8, §9.6, §18.2 | §15 |
| Working on UX | §5, §14, §5.7 | §3, §31 |
| Evaluating the business | §1.4, §23, §24 | §30 |

**Three invariants everything else derives from:** (1) Spotify is export-only and never a recommendation input; (2) every feature has provenance, license, and eligibility flags, defaulting to ineligible; (3) novelty and explanations are evidence-backed and probabilistic — never invented, never certain. When in doubt, these win.

---

# 0. Instructions to Claude

Read this entire document before editing code. Treat it as the source of truth unless a later Architecture Decision Record explicitly supersedes it.

### Non-negotiable implementation rules

1. **Do not use Spotify content, metadata, listening history, saved items, top items, playlists, audio features, previews, or other Spotify platform data to train a model, create a user taste profile, derive recommendation features, or rank recommendations.**
2. **Keep Spotify export code behind a hard architectural boundary.** Recommendation packages must not import Spotify packages.
3. Do not treat a user-uploaded Spotify data export, copied Spotify playlist, Spotify URL collection, or other re-imported Spotify-derived dataset as a loophole. A user may explicitly declare individual artists or recordings they like; resolve those declarations to the independent canonical catalog and retain the declaration—not Spotify metadata—as the evidence.
4. Build the recommendation engine from:
   - user-entered seed preferences;
   - first-party feedback and exposure events collected in this product;
   - catalog data whose license explicitly permits the intended use;
   - independently licensed or approved recommendation/collaborative signals.
5. Treat “unheard” as probabilistic unless the user explicitly confirms it. The default copy is **“probably new to you,”** never “you have never heard this.”
6. Build a **modular monolith**, not microservices.
7. Implement milestones in order. Do not begin a later milestone while the current milestone’s acceptance criteria or tests fail.
8. Prefer deterministic, explainable ranking before introducing learned models.
9. Every recommendation explanation must be generated from stored evidence. Never invent musical properties.
10. Every catalog feature must carry provenance, license, and model-eligibility metadata.
11. Never place secrets in source control, fixtures, screenshots, logs, telemetry, or generated documentation.
12. Use exact dependency versions in the lockfile. At bootstrap, choose currently supported stable versions that are mutually compatible; do not copy stale versions from this specification.
13. Keep the system fully useful without Spotify. A user must be able to onboard, receive recommendations, provide feedback, and save a service-neutral playlist without connecting any streaming service.
14. When a conflict exists between product convenience and a platform policy, privacy requirement, license, or security control, the policy/privacy/license/security control wins.

### Claude working protocol

For each milestone:

1. Restate the milestone goal in the implementation plan.
2. Inspect existing code and ADRs.
3. Identify policy, privacy, license, and security effects.
4. Write or update tests before completing the implementation.
5. Run the full relevant quality gate.
6. Update documentation, database diagrams, API schemas, and ADRs.
7. Provide a concise completion report containing:
   - files changed;
   - design decisions;
   - tests run and results;
   - unresolved risks;
   - migration or setup actions.
8. Do not declare completion with skipped tests, unhandled type errors, placeholder security, fake integration behavior, or unexplained TODOs.

---

# 1. Executive Product Decision

## 1.1 What is being built

Resonance is a service-neutral music discovery application that learns **why** a person responds to music and converts that understanding into playlists of unfamiliar tracks.

The core loop is:

```text
User declares taste
      ↓
System generates diverse candidates
      ↓
User receives a “probably new to you” playlist
      ↓
User listens on a destination service
      ↓
User gives reason-coded feedback
      ↓
Taste model and candidate strategy update
      ↓
Next playlist improves
```

The first product surface is a personalized discovery playlist. The durable asset is the **first-party taste and outcome graph**:

- which canonical recordings were shown;
- what the user believed they already knew;
- what they tried;
- what they loved, liked, rejected, or deferred;
- why they responded that way;
- which context they were in;
- what recommendation strategy produced the exposure;
- whether the track caused follow-on engagement.

## 1.2 What is deliberately not being built

This is not:

- a Spotify clone;
- a Spotify listening-history analyzer;
- an in-app streaming client;
- a generic “chat with your playlist” wrapper;
- an LLM that guesses songs from prose;
- a model trained on Spotify data;
- a social network in the MVP;
- an audio fingerprinting or copyrighted-audio ingestion service;
- a promise that every recommended song is definitively unheard.

## 1.3 Why Spotify is an adapter, not the foundation

Spotify’s current developer rules materially affect the architecture:

- Spotify prohibits using Spotify platform/content data to train machine-learning or AI systems.
- Spotify prohibits analyzing Spotify content or the Spotify service to create user profiles.
- Spotify’s current Development Mode is limited to a small authorized-user pilot and is explicitly not intended as a scalable business foundation.
- Several historical discovery endpoints—including Recommendations, Related Artists, Audio Features, and Audio Analysis—are unavailable to newer Development Mode apps.
- Spotify refresh tokens now have finite lifetimes and require a reauthorization path.
- Spotify permits playlist creation and item insertion endpoints, subject to scopes, rate limits, policy, quota mode, and approval.

Therefore:

> **The recommendation system must produce a canonical, service-neutral playlist first. Spotify may then be used only to resolve canonical tracks and export that playlist, using the minimum required permissions and temporary data handling.**

This separation is both a compliance control and a business advantage. The product can later export to multiple destinations and remains valuable even if a platform changes access.

## 1.4 Defensible company thesis

The acquisition-worthy product is not “a better Spotify playlist.”

It is:

> **A cross-service taste and discovery engine with a proprietary first-party dataset that predicts which unfamiliar recordings will become durable favorites—and can prove causal lift over existing discovery baselines.**

The most valuable assets should become:

1. A reason-coded, consented taste graph.
2. A canonical recording/artist identity graph.
3. Recommendation exposure and outcome data.
4. Reliable novelty estimation.
5. Demonstrated lift in “confirmed new loves.”
6. High-retention discovery behavior.
7. A portable engine and destination-adapter architecture.
8. Creator or curator supply relationships that competitors cannot instantly reproduce.

---

# 2. Product Vision, Principles, and Success

## 2.1 Mission

**Help people repeatedly find music they did not know and genuinely come to love.**

## 2.2 Product principles

### P1 — Discovery quality over engagement volume

Do not optimize for minutes in the app. Optimize for successful discovery outcomes.

### P2 — Negative taste matters

Dislikes, aversions, fatigue, context mismatch, and “not now” are first-class signals. A model that only learns positives will collapse toward generic similarity.

### P3 — The user controls adventure

A discovery slider controls the tradeoff between familiar fit and exploratory distance. It must change candidate composition and ranking—not merely UI copy.

### P4 — Explanations require evidence

Explanations may reference only supported catalog features, explicit user preferences, and first-party behavior. “Similar chord progression” is forbidden unless a licensed source actually provides that evidence.

### P5 — Separate identity, catalog, behavior, and destination data

Canonical music identity must not depend on a streaming-service ID. User accounts must not depend on a Spotify login. Destination-service data must not enter the recommendation feature store.

### P6 — Privacy and provenance by construction

Every feature has a source and license. Every personal event has a purpose. Every model input is auditable.

### P7 — Useful before machine learning

A well-designed hybrid heuristic and Bayesian preference model should create the first measurable product. Learned ranking is introduced only after enough first-party outcomes exist.

### P8 — Honest uncertainty

Use calibrated language and confidence states. Never present probabilistic inference as fact.

---

## 2.3 North-star metric

### Confirmed New Loves per Weekly Active User (`CNL/WAU`)

A **Confirmed New Love** occurs when all conditions are true:

1. The user was exposed to the recording through Resonance.
2. The user marks the recording as **new to me**, or the system’s independent listening ledger establishes high-confidence novelty and the user does not contradict it.
3. The user chooses **Love**.
4. At least one durability signal occurs within 30 days:
   - the user reaffirms Love;
   - the user adds it to another Resonance playlist;
   - the user records a repeat listen through an approved first-party or independently licensed signal;
   - the user follows the artist through a supported first-party action.

For the MVP, condition 4 may be reported separately as `provisional_new_love` until repeat-listen data exists.

### Why this metric

Raw playlist exports and clicks can be gamed. CNL/WAU ties together novelty, preference accuracy, and durable value.

---

## 2.4 Supporting metrics

| Metric | Definition | Initial target behavior |
|---|---|---|
| Playlist activation | User opens at least 5 recommendations in a generated playlist | Increasing cohort trend |
| Feedback completion | Share of exposed tracks receiving any explicit feedback | High enough to support learning |
| Love rate | `Love / evaluated recommendations` | Measured by source and context |
| Newness confirmation rate | `marked new / evaluated recommendations` | High, with confidence calibration |
| Known-track leakage | User marks “already knew” after a “probably new” label | Declining |
| Confirmed-new-love rate | `confirmed new loves / evaluated recommendations` | Must beat baseline |
| Export rate | Service-neutral playlists exported to any destination | Diagnostic, not north star |
| D7/D30 discovery retention | User returns to evaluate or generate another playlist | Cohort-based |
| Artist concentration | Share of recommendations from top artists | Must remain bounded |
| Source yield | Confirmed new loves per 100 candidates from each provider | Drives provider allocation |
| Calibration | Predicted love probability vs actual outcomes | Error declines over time |
| Diversity | Artist, genre/tag, era, language, and popularity spread | Context-dependent guardrail |
| Unresolved destination mapping | Canonical tracks that cannot be confidently resolved | Low and visible |
| Recommendation latency | Time from request to usable playlist | Fast enough for interactive use |
| Explanation validity | Explanations with complete evidence links | 100% |

Do not set arbitrary vanity targets before collecting a baseline. The first experiment should establish distributions and confidence intervals.

---

## 2.5 Primary personas

### The Disappointed Discoverer

- Uses one or more streaming services.
- Feels recommendations repeat familiar artists or obvious songs.
- Wants novelty without random noise.
- Values “why this fits me” explanations.

### The Intentional Listener

- Has context-specific tastes: work, drive, gym, late night, cooking.
- Wants control over energy, mood, vocals, era, explicit content, and adventurousness.
- Will provide feedback when it visibly improves results.

### The Music Explorer

- Seeks emerging, long-tail, international, or genre-adjacent music.
- Tolerates higher uncertainty.
- Cares about artist diversity and source transparency.

### The Curator or Creator Partner — later

- Wants to introduce appropriate listeners to music without payola-like placement.
- Needs transparent labeling and outcome reporting.
- Must never be able to buy an unmarked recommendation rank.

---

# 3. Jobs to Be Done and User Stories

## 3.1 Core job

> When I want something new to listen to, help me find songs I probably do not know but am unusually likely to love, without making me sift through generic or repetitive recommendations.

## 3.2 MVP user stories

### Account and privacy

- As a visitor, I can understand the product without connecting Spotify.
- As a user, I can create a first-party Resonance account.
- As a user, I can view and change my consent settings.
- As a user, I can export or delete my Resonance data.
- As a user, I can disconnect a destination service without losing my Resonance account.

### Taste onboarding

- As a new user, I can name or search for at least 5 artists or tracks I love.
- As a new user, I can provide at least 3 negative examples or aversions.
- As a new user, I can select discovery level, listening context, explicit-content preference, language preferences, and era preferences.
- As a new user, I can skip optional questions and still receive a playlist.
- As a user, I can see which inputs are explicit declarations versus learned estimates.

### Recommendations

- As a user, I can request a 20-track discovery playlist for a context.
- As a user, I can see a novelty confidence badge on each track.
- As a user, I can see an evidence-backed explanation.
- As a user, I can open a recording on an available destination.
- As a user, I can report that a track was already known.

### Feedback

- As a user, I can choose Love, Like, Neutral, Dislike, Not Now, or Already Knew.
- As a user, I can optionally choose reason codes such as vocals, lyrics, rhythm, energy, production, instrumentation, mood, repetition, or context.
- As a user, I can distinguish “bad recommendation” from “good song, wrong moment.”
- As a user, I can revise feedback.

### Playlists and export

- As a user, I can save a service-neutral playlist.
- As a user, I can export a playlist as CSV or M3U.
- As an authorized pilot user, I can connect Spotify and export a private playlist.
- As a user, I can see unresolved destination matches and correct them.
- As a user, I can retry a partially failed export without duplicating tracks.

### Trust

- As a user, I can inspect why a recommendation was made.
- As a user, I can see that the product does not train on Spotify data.
- As a user, I can see which external catalog sources contributed metadata.
- As a user, I can remove my feedback history and regenerate my taste profile.

---

# 4. Scope

## 4.1 MVP in scope

1. First-party account and session management.
2. Privacy/consent center.
3. Canonical artist and recording catalog.
4. Search for onboarding seeds using permitted catalog sources.
5. Explicit positive and negative taste onboarding.
6. Context profiles.
7. Discovery slider.
8. Candidate-provider abstraction.
9. At least two candidate strategies:
   - neighborhood/collaborative candidates from an approved source;
   - controlled exploration from catalog metadata and popularity bands.
10. Explainable hybrid ranker.
11. Diversity-aware playlist selection.
12. First-party exposure and feedback instrumentation.
13. Service-neutral playlists.
14. CSV and M3U export.
15. Spotify OAuth and private-playlist export for the authorized pilot.
16. Admin diagnostics for source health, mapping failures, and experiment metrics.
17. Automated tests, CI, local development environment, and operational documentation.

## 4.2 Post-MVP

- Multi-armed/contextual bandit across candidate buckets.
- Learned ranking from first-party data.
- More destination adapters.
- Optional independent listening-ledger integration.
- Natural-language playlist intent parser.
- Social discovery clubs.
- Creator/curator submission pipeline.
- Rich context scheduling.
- Emotional-arc sequencing.
- Artist-facing outcome analytics with privacy thresholds.
- Mobile applications.
- Licensed audio embeddings or acoustic features.
- Community and network effects.

## 4.3 Explicit non-goals for v1

- In-app Spotify playback.
- Spotify Web Playback SDK.
- Use of Spotify previews.
- Importing Spotify top tracks, saved tracks, recent plays, playlists, or recommendation data.
- Training on any Spotify data.
- Scraping streaming services.
- Storing copyrighted audio.
- Live collaborative playlists.
- User-to-user messaging.
- Public profiles.
- Paid placement.
- Exact cross-platform listening-history reconstruction.
- Automatic claims that a track is unheard.
- Microservices, Kubernetes, Kafka, or a separate feature-store product.

---

# 5. User Experience Specification

## 5.1 Information architecture

```text
/
├── /about
├── /privacy
├── /terms
├── /login
├── /onboarding
│   ├── /seeds
│   ├── /aversions
│   ├── /preferences
│   └── /review
├── /discover
│   ├── /new
│   └── /runs/:runId
├── /playlists
│   └── /:playlistId
├── /taste
│   ├── /profile
│   ├── /feedback
│   └── /contexts
├── /connections
├── /settings
│   ├── /privacy
│   ├── /data
│   └── /account
└── /admin
    ├── /providers
    ├── /exports
    ├── /experiments
    └── /audit
```

Admin routes require a distinct role and server-side authorization. They must never rely only on hidden navigation.

## 5.2 Onboarding flow

### Step 1 — Product promise and consent

Explain:

- recommendations are based on what the user tells Resonance and how they respond inside Resonance;
- destination services are optional;
- novelty is estimated;
- external catalog providers may contribute metadata;
- the user can delete their data.

Required action: accept Terms and Privacy Policy. Separate optional consent for model improvement and research analytics where legally appropriate.

### Step 2 — Positive seeds

Offer **two equivalent input modes**, user-switchable at any point:

**Mode A — Conversational (default when `FEATURE_CONVERSATIONAL_ONBOARDING=true`).** A single free-text prompt: *"Tell me about music you love — artists, songs, scenes, eras, or just how it feels."* The LLM parses the response into candidate seed declarations, each resolved against the canonical catalog and shown back as **editable structured chips with confirm/reject controls**. Nothing enters the taste profile until the user confirms the chip. Ambiguous resolutions surface disambiguation inline ("Did you mean *Beach House* (Baltimore dream pop) or *Beachhouse* (UK grime)?"). Unresolvable descriptors ("that 2019 lo-fi thing everyone slept on") become soft preference facts with `origin: explicit`, low confidence, and visible "interpreted from your words" provenance — never fabricated catalog entities. This is compliance-clean: the user's own words are Zone A data.

**Mode B — Structured search.** The classic search-and-select flow below, which is also the fallback whenever the LLM flag is off, parsing fails, or the user prefers it.

Both modes produce identical `user_seed_items` records. The onboarding funnel must instrument mode choice, switch rate, time-to-first-playlist, and seed count per mode, because reducing time-to-first-playlist is the primary onboarding metric.

Ask for 5–20 favorite artists and/or recordings.

For each selected seed, allow a strength:

- Essential
- Strong like
- Context-specific
- Nostalgic only

Do not silently treat every seed as universally positive.

### Step 3 — Negative seeds

Ask for at least 3 of:

- artists or tracks the user generally avoids;
- vocal styles they dislike;
- energy ranges they avoid;
- overplayed/fatigued artists;
- explicit-content restrictions;
- disliked eras, languages, or production styles.

The user may mark a negative as:

- Never recommend
- Usually avoid
- Context-specific
- Overplayed, but not disliked

### Step 4 — Discovery controls

Inputs:

- Discovery level: 0–100.
- Context: General, Focus, Drive, Workout, Wind Down, Social, Custom.
- Familiarity preference:
  - Mostly adjacent;
  - Balanced;
  - Farther afield.
- Popularity preference:
  - Any;
  - Avoid obvious hits;
  - Deep cuts/long tail.
- Language selections.
- Era range.
- Explicit content allowed, blocked, or context-specific.
- Vocals: any, mostly vocal, mostly instrumental.
- Optional free-text intent.

The free-text field is not used directly by the ranker. It is parsed into a validated structured intent object.

### Step 5 — Review

Show a plain-language summary and editable structured constraints. Example:

> “For late-night listening, favor reflective and low-to-medium-energy recordings, mostly from outside your seed artists, with moderate genre exploration. Avoid harsh vocals and tracks you have marked as overplayed.”

### Step 6 — First playlist

Generate 20 tracks. Present an honest quality message if candidate coverage is weak.

## 5.3 Recommendation card

Each card shows:

- title;
- canonical artist;
- release year if reliable;
- source attribution where required;
- novelty state;
- concise evidence-backed reason;
- destination links;
- feedback actions;
- optional detailed explanation.

Do not show unsupported album art. Use a neutral visual or a properly licensed image source with provenance and attribution.

### Novelty badge states

| State | Label | Rule |
|---|---|---|
| `confirmed_new` | New to you | User explicitly confirmed |
| `high_confidence_new` | Very likely new | Strong independent ledger evidence and no conflicting evidence |
| `probably_new` | Probably new | No exposure/known evidence in Resonance; artist familiarity is low |
| `unknown` | Newness unknown | Insufficient evidence |
| `known` | You know this | User or approved ledger indicates prior knowledge |

Before explicit confirmation, the UI should default to `probably_new` or `unknown`, not `confirmed_new`.

## 5.4 Feedback interaction

Primary buttons:

- ❤️ Love
- 👍 Like
- 😐 Neutral
- 👎 Dislike
- 🕒 Not now
- ✓ Already knew

After Love/Like/Dislike, offer optional reason chips:

**Positive**
- Vocals
- Lyrics
- Rhythm/beat
- Melody
- Energy
- Mood
- Instrumentation
- Production
- Unexpected but works
- Fits this context

**Negative**
- Vocals
- Lyrics
- Too slow
- Too intense
- Too repetitive
- Production
- Wrong mood
- Too familiar
- Too experimental
- Does not fit this context

Reason codes update preference evidence only when the corresponding catalog feature is known and license/model eligible. A reason such as “vocals” may update a general reason tendency while awaiting a more specific supported feature; it must not cause the system to fabricate a vocal descriptor.

## 5.5 Playlist review

The playlist page provides:

- playlist title and context;
- discovery setting;
- generation timestamp;
- evaluated/unevaluated counts;
- artist and era distribution;
- feedback progress;
- regeneration controls;
- export controls;
- unresolved mapping review.

Regeneration options:

- Replace one track.
- Replace all disliked tracks.
- Increase/decrease discovery.
- Preserve loved tracks and rebuild around them.
- Change context.

Every replacement creates a new recommendation exposure record and keeps lineage to the original run.

## 5.6 Empty, degraded, and failure states

Examples:

- **Insufficient seeds:** “Add two more favorites or widen your discovery settings.”
- **Provider outage:** Generate from cached eligible catalog data and label reduced coverage.
- **No confident destination match:** Keep the canonical item and invite manual resolution.
- **Spotify authorization expired:** Preserve playlist; ask the user to reconnect before export.
- **Rate limited:** Queue export, display status, and retry according to `Retry-After`.
- **Partial export:** Show inserted, skipped, unresolved, and failed counts; allow idempotent retry.
- **No Spotify:** Offer CSV, M3U, copyable track list, and destination deep links.

## 5.7 Advanced interaction patterns

These patterns turn the compliance-driven architecture into a felt product advantage. All are feature-flagged and degrade to the baseline flows above.

### 5.7.1 Streaming playlist generation

Because generation is asynchronous (§7.5), do not hide it behind a spinner. Stream tracks into the UI **as the selector commits them**, via SSE:

- each committed track animates into position with its novelty badge and one-line reason;
- a progress rail shows pipeline stages ("gathering candidates → filtering → selecting 12/20");
- the user can start reading, opening, and reacting to early tracks before the run completes;
- degraded-provider notices appear inline in the rail, not as a terminal error.

Perceived latency, not actual latency, is the budget. A 9-second run that streams feels faster than a 4-second run behind a spinner.

### 5.7.2 Conversational refinement thread

Each recommendation run carries an optional refinement thread anchored to the playlist:

> "Great, but less synth-heavy and nothing before 1990. Keep tracks 3 and 7."

The LLM parses this into a **diff against the structured intent** (`avoidGenresOrTags += synth-pop`, `eraStartYear = 1990`, `preserveRecordingIds = [...]`), renders the diff for confirmation, and triggers a lineage-linked regeneration. The LLM never selects tracks; it only edits the validated intent object the deterministic pipeline consumes. Refinement turns per user is a key engagement signal and a rich source of taste-language data.

### 5.7.3 Feedback ergonomics

- **Mobile:** swipe right = Like, swipe left = Dislike, long-press opens the full response sheet (Love, Not now, Already knew, reason chips). Haptic confirmation on commit. Swipe must be reversible via an undo toast (5s) that appends a reversal event, consistent with §10.7.
- **Desktop:** single-key shortcuts while a track row is focused (`L` love, `K` like, `D` dislike, `N` not now, `A` already knew), announced to screen readers.
- **Progressive disclosure:** primary buttons only on the card; reason chips appear post-response; newness confirmation is asked at most once per track and can be batch-answered at playlist end ("Which of these did you already know?").

### 5.7.4 Taste map

A `/taste/profile` visualization of the user's evidence-backed profile:

- clusters of eligible tags/eras/moods sized by affinity and shaded by confidence;
- explicit declarations visually distinct from inferred estimates (per §3.2 trust stories);
- tapping a cluster shows the evidence trail and offers "explore this edge" — which pre-fills a run biased toward that cluster boundary;
- low-confidence regions rendered honestly as sparse/hazy, not filled in.

This is the user-facing face of P8 (honest uncertainty) and a retention surface no thin wrapper can copy, because it is rendered entirely from the proprietary first-party evidence graph.

### 5.7.5 Generative UI boundary

LLM-composed interface copy (explanation wording, refinement summaries, taste-map cluster labels) is permitted. LLM-composed **interface structure** (layouts, controls, navigation) is not in MVP: every actionable control is a typed, tested component, and the LLM may only select among registered components with validated props. This keeps generative flexibility without untestable UI or injection-driven control surfaces (§16.6 applies to all rendered LLM text).

---

# 6. Compliance-First Architecture

## 6.1 Data zones

Use four explicit data zones:

```text
┌────────────────────────────────────────────────────────────┐
│ Zone A — First-party product data                          │
│ User declarations, contexts, exposures, feedback, outcomes │
│ Eligible for profiling/modeling subject to consent         │
└────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│ Zone B — Licensed/open catalog and discovery data          │
│ Canonical IDs, permitted metadata, licensed signals        │
│ Eligibility determined per field and license               │
└────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│ Recommendation domain                                     │
│ Candidate generation, features, ranking, explanations      │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ Zone C — Destination-service data                          │
│ OAuth tokens, temporary search results, destination IDs    │
│ Export only; never enters recommendation/model features    │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ Zone D — Security and operations                           │
│ Audit logs, provider health, redacted errors, rate limits   │
└────────────────────────────────────────────────────────────┘
```

## 6.2 Spotify compliance firewall

Required controls:

1. `packages/integrations/spotify` is the only package allowed to call Spotify.
2. `packages/recommender` cannot import from `packages/integrations/*`.
3. Spotify response types must be local to the Spotify package and converted only into an `ExportResolution` DTO.
4. The DTO may contain:
   - canonical recording ID;
   - destination recording URI/ID;
   - confidence;
   - match method;
   - temporary display fields for user review;
   - expiry timestamp.
5. The DTO must not be written to:
   - user feature tables;
   - candidate tables as a feature;
   - model-training datasets;
   - analytics event properties other than coarse export status.
6. Spotify search responses are cached only as needed for export and with a documented TTL.
7. A database check or application guard marks all Spotify-sourced fields `training_eligible = false`.
8. Dataset builders reject any record with prohibited provenance.
9. CI includes a policy test that fails when:
   - the recommender imports Spotify modules;
   - a training query references Spotify tables;
   - Spotify payload types appear outside the adapter;
   - a Spotify source is marked model eligible.
10. No Spotify preview or audio content is fetched or used.
11. No top-items, recent-history, saved-library, playlist-read, Recommendations, Related Artists, Audio Features, or Audio Analysis endpoint is used in the production design.
12. Spotify is not used as first-party authentication.
13. The app must function with `FEATURE_SPOTIFY_EXPORT=false`.

### Suggested dependency-boundary rule

Use ESLint or a package-boundary tool:

```js
// Conceptual rule; adapt to the selected lint configuration.
{
  from: "packages/recommender/**",
  disallow: [
    "packages/integrations/spotify/**",
    "apps/web/src/server/spotify/**"
  ]
}
```

### Suggested training-data assertion

```ts
export function assertTrainingEligible(rows: FeatureRow[]): void {
  const prohibited = rows.filter(
    (row) =>
      row.trainingEligible !== true ||
      row.provenance.provider === "spotify"
  );

  if (prohibited.length > 0) {
    throw new Error(
      `Training dataset contains ${prohibited.length} prohibited rows`
    );
  }
}
```

## 6.3 License registry

Create a code-owned and database-backed license registry.

Each provider/data class records:

```ts
type DataUse =
  | "display"
  | "temporary_cache"
  | "recommendation_feature"
  | "model_training"
  | "commercial_use"
  | "redistribution";

interface LicensePolicy {
  provider: string;
  dataset: string;
  licenseId: string;
  licenseUrl: string;
  reviewedAt: string;
  permittedUses: DataUse[];
  prohibitedUses: DataUse[];
  attributionTemplate?: string;
  retentionDays?: number;
  notes: string;
}
```

Every `recording_feature` row must reference a license-policy version.

### Initial policy posture

- **MusicBrainz core data:** generally CC0; still keep provenance.
- **MusicBrainz supplementary tags, ratings, and derived data:** do not use commercially unless the actual license or a commercial agreement permits it.
- **ListenBrainz:** use only endpoints/data whose terms support the intended use; retain attribution and provenance; confirm commercial and training rights before enabling those uses.
- **Spotify:** export-only, temporary cache, no recommendation feature or training eligibility.
- **User-entered data and first-party feedback:** eligible only within consent/purpose constraints.
- **LLM output:** never treated as source-of-truth catalog data without validation.

## 6.4 Platform-policy review gate

Before any public Spotify-enabled launch:

- current Developer Policy reviewed;
- current Terms of Service reviewed;
- Privacy Policy and EULA reviewed;
- data-retention behavior verified;
- user-disconnect deletion verified;
- OAuth scopes reviewed;
- extended-access eligibility reviewed;
- product positioning reviewed for “core experience” concerns;
- legal counsel sign-off recorded;
- written platform approval recorded where required.

Store the review as an ADR and compliance checklist in the repository. Re-review at least quarterly and whenever Spotify announces platform changes.

## 6.5 Data retention principles

- Store only fields needed for documented purposes.
- Separate canonical open/licensed catalog fields from destination-specific cache.
- Delete or anonymize personal data according to user request and legal obligations.
- On Spotify disconnect:
  - revoke/remove connection;
  - delete Spotify personal data and tokens promptly;
  - complete deletion within the platform-required period;
  - preserve only non-personal, independently sourced canonical playlist data.
- Do not indefinitely store stale Spotify content.
- Never log OAuth tokens or raw provider responses.
- Retention jobs must be testable and observable.

---

# 7. System Architecture

## 7.1 Technology stack

Use a TypeScript monorepo:

- **Package manager:** `pnpm`
- **Task orchestration:** Turborepo
- **Web application/BFF:** Next.js with App Router
- **UI:** React, Tailwind CSS, accessible headless/component primitives
- **Runtime validation:** Zod
- **Database:** PostgreSQL
- **Vector support:** `pgvector`, introduced only where useful
- **ORM/migrations:** Drizzle ORM and Drizzle Kit
- **Background jobs:** `pg-boss` or another Postgres-backed queue
- **Unit/integration tests:** Vitest
- **Browser tests:** Playwright
- **HTTP integration mocks:** MSW or a local mock server
- **Logging:** structured Pino logs
- **Tracing/metrics:** OpenTelemetry-compatible instrumentation
- **Error reporting:** provider-neutral interface; Sentry optional
- **API documentation:** OpenAPI generated/validated from shared schemas
- **Containers:** Docker Compose and a dev container
- **CI:** GitHub Actions or equivalent

Do not add Redis, a message broker, a separate search cluster, or Kubernetes to the MVP without a measured need and an ADR.

## 7.2 Architectural style

Modular monolith with explicit domain boundaries:

```mermaid
flowchart LR
    U[Browser] --> W[Next.js Web/BFF]
    W --> A[Application Services]
    A --> D[Domain Modules]
    D --> DB[(PostgreSQL)]
    A --> Q[Postgres Job Queue]
    Q --> WK[Worker]
    WK --> CP[Candidate Providers]
    WK --> RR[Recommendation Engine]
    WK --> DA[Destination Adapters]
    CP --> MB[MusicBrainz / Licensed Catalog]
    CP --> LB[ListenBrainz / Approved Provider]
    DA --> SP[Spotify Export API]
    W --> OBS[Telemetry]
    WK --> OBS
```

### Domain modules

- `identity`
- `consent`
- `catalog`
- `taste`
- `context`
- `recommendation`
- `playlist`
- `feedback`
- `destination`
- `experiment`
- `analytics`
- `privacy`
- `admin`

The domain layer must not depend on web-framework types.

## 7.3 Repository layout

```text
resonance/
├── .claude/
│   ├── commands/
│   └── settings.example.json
├── .devcontainer/
│   ├── devcontainer.json
│   └── Dockerfile
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── security.yml
│       └── migrations.yml
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── server/
│   │   │   ├── client/
│   │   │   └── instrumentation/
│   │   └── tests/
│   └── worker/
│       ├── src/
│       │   ├── jobs/
│       │   ├── providers/
│       │   └── instrumentation/
│       └── tests/
├── packages/
│   ├── config/
│   ├── db/
│   │   ├── schema/
│   │   ├── migrations/
│   │   ├── repositories/
│   │   └── seeds/
│   ├── domain/
│   │   ├── identity/
│   │   ├── catalog/
│   │   ├── taste/
│   │   ├── recommendation/
│   │   ├── playlist/
│   │   └── privacy/
│   ├── recommender/
│   │   ├── candidate-generation/
│   │   ├── features/
│   │   ├── ranking/
│   │   ├── selection/
│   │   ├── explanation/
│   │   └── evaluation/
│   ├── integrations/
│   │   ├── musicbrainz/
│   │   ├── listenbrainz/
│   │   ├── spotify/
│   │   └── llm/
│   ├── analytics/
│   ├── observability/
│   ├── testkit/
│   ├── ui/
│   └── validation/
├── docs/
│   ├── adr/
│   ├── api/
│   ├── compliance/
│   ├── data-dictionary.md
│   ├── threat-model.md
│   └── runbooks/
├── scripts/
│   ├── verify-policy-boundaries.ts
│   ├── verify-feature-provenance.ts
│   ├── seed-demo-data.ts
│   └── purge-expired-provider-data.ts
├── CLAUDE.md
├── README.md
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

## 7.4 Major interfaces

### Candidate provider

```ts
export interface CandidateProvider {
  readonly id: string;

  healthCheck(): Promise<ProviderHealth>;

  generateCandidates(
    request: CandidateRequest,
  ): Promise<CandidateBatch>;
}
```

### Destination adapter

```ts
export interface DestinationAdapter {
  readonly destination: DestinationType;

  beginConnection(input: ConnectionStart): Promise<ConnectionRedirect>;

  completeConnection(input: ConnectionCallback): Promise<ConnectionResult>;

  resolveRecordings(
    input: ResolveRecordingsRequest,
  ): Promise<DestinationResolution[]>;

  exportPlaylist(
    input: ExportPlaylistRequest,
  ): Promise<ExportResult>;

  disconnect(input: DisconnectRequest): Promise<void>;
}
```

### Ranker

```ts
export interface Ranker {
  rank(input: RankRequest): Promise<RankedCandidate[]>;
}
```

### Explanation generator

```ts
export interface ExplanationGenerator {
  explain(
    item: RankedCandidate,
    evidence: ExplanationEvidence[],
  ): Promise<RecommendationExplanation>;
}
```

An LLM implementation may satisfy `ExplanationGenerator`, but a deterministic template implementation must exist and remain the fallback.

## 7.5 Request lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Web
    participant App as Application Service
    participant Queue
    participant Worker
    participant Provider
    participant Ranker
    participant DB

    User->>Web: Generate playlist
    Web->>App: Validate intent and consent
    App->>DB: Create recommendation_run=queued
    App->>Queue: Enqueue run
    App-->>Web: 202 + runId
    Worker->>Queue: Claim job
    Worker->>DB: Load profile/context/exclusions
    Worker->>Provider: Generate candidate batches
    Provider-->>Worker: Candidates + provenance
    Worker->>Ranker: Score, filter, diversify
    Ranker-->>Worker: Ordered canonical items
    Worker->>DB: Persist candidates, items, evidence
    Worker->>DB: Mark run=completed
    Web->>DB: Poll/SSE for status
    Web-->>User: Playlist
```

Generation should be asynchronous to isolate provider latency and permit retries, while maintaining a fast UI with progress states.

---

# 8. Canonical Music Identity and Catalog

## 8.1 Canonical identifiers

Primary canonical entities:

- Artist: MusicBrainz Artist ID (`MBID`) when available.
- Recording: MusicBrainz Recording ID when available.
- Release/release group: MusicBrainz IDs when needed.
- ISRC: secondary identity and destination-resolution key.
- Internal UUID: always present, even when external identifiers are missing.

Do not use Spotify track IDs as canonical IDs.

## 8.2 Recording equivalence

“Same song” is not always “same recording.” Preserve:

- recording/work relationship where available;
- live vs studio;
- remix;
- remaster;
- edit;
- acoustic version;
- clean vs explicit version;
- re-release.

For playlist deduplication, define an equivalence policy:

1. Exact canonical recording duplicate: always remove.
2. Same ISRC: usually duplicate.
3. Same normalized artist/title and similar duration: potential duplicate.
4. Same musical work but materially different recording: allowed unless user requests one version only.
5. Remaster/re-release of same underlying recording: collapse by default.

Store the reason for every dedupe decision.

## 8.3 Entity resolution confidence

```ts
type MatchMethod =
  | "mbid_exact"
  | "isrc_exact"
  | "artist_title_duration"
  | "artist_title"
  | "manual";

interface EntityMatch {
  method: MatchMethod;
  confidence: number; // 0..1
  evidence: {
    artistSimilarity?: number;
    titleSimilarity?: number;
    durationDeltaMs?: number;
    isrcEqual?: boolean;
  };
}
```

Confidence thresholds:

- `>= 0.98`: automatic exact.
- `0.90–0.979`: automatic with audit record.
- `0.75–0.899`: candidate for user confirmation.
- `< 0.75`: unresolved.

Tune thresholds from labeled resolution data. Never silently force a low-confidence match.

## 8.4 Catalog ingestion

Use provider adapters with:

- a meaningful User-Agent;
- provider-specific rate limits;
- retry/backoff;
- ETag/conditional fetch where supported;
- raw-response isolation;
- normalization;
- provenance;
- license policy;
- ingestion timestamp;
- source version;
- tombstone/deletion handling.

MusicBrainz public API usage must respect its published rate limit. For production-scale/commercial usage, use an appropriate data feed, mirror, or commercial arrangement rather than abusing the public endpoint.

## 8.5 Feature provenance

Each feature row:

```ts
interface RecordingFeature {
  recordingId: string;
  namespace: string;       // e.g. "tag", "era", "language"
  key: string;             // e.g. "dream-pop"
  numericValue?: number;
  stringValue?: string;
  confidence: number;
  provider: string;
  dataset: string;
  licensePolicyVersion: string;
  observedAt?: string;
  ingestedAt: string;
  expiresAt?: string;
  displayEligible: boolean;
  recommendationEligible: boolean;
  trainingEligible: boolean;
}
```

If provenance or license is unknown, all eligibility flags default to false.

---

# 9. Data Model

Use PostgreSQL UUID primary keys. Use `timestamptz` in UTC. Store user-visible locale/time zone separately. Use `jsonb` only for genuinely flexible payloads; key business fields must be typed columns.

## 9.1 Identity and consent

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email_normalized` | text | Unique, encrypted or access-controlled as appropriate |
| `display_name` | text | Optional |
| `status` | enum | active, suspended, deletion_pending, deleted |
| `locale` | text | BCP 47 |
| `time_zone` | text | IANA |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz | Nullable |

### `auth_accounts` / `sessions`

Managed through the selected authentication library, with server-side session validation and rotation.

### `consent_records`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK |
| `purpose` | enum | core_personalization, analytics, model_improvement, research, marketing |
| `policy_version` | text | Immutable consent text version |
| `status` | enum | granted, withdrawn |
| `occurred_at` | timestamptz | |
| `source` | text | web, support, migration |
| `metadata` | jsonb | Minimal audit metadata |

Never overwrite a consent record; append changes.

## 9.2 Destination connections

### `service_connections`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK |
| `service` | enum | spotify, future providers |
| `external_user_id_hash` | text | Hash/index; raw value encrypted if needed |
| `status` | enum | active, expired, revoked, error |
| `scope_set` | text[] | Exact granted scopes |
| `authorized_at` | timestamptz | |
| `expires_at` | timestamptz | Access token expiry |
| `reauthorization_due_at` | timestamptz | Account for refresh-token lifetime |
| `last_used_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `disconnected_at` | timestamptz | |

Unique active connection per `(user_id, service)`.

### `encrypted_oauth_credentials`

Keep in a restricted schema or secret store.

| Column | Type | Notes |
|---|---|---|
| `connection_id` | uuid | PK/FK |
| `encrypted_access_token` | bytea | AES-256-GCM or envelope encryption |
| `encrypted_refresh_token` | bytea | |
| `key_version` | text | |
| `nonce` | bytea | |
| `auth_tag` | bytea | |
| `rotated_at` | timestamptz | |

Database roles used by analytics or recommender code must not have access.

## 9.3 Catalog

### `artists`

- `id`
- `musicbrainz_artist_mbid`
- `canonical_name`
- `sort_name`
- `disambiguation`
- `country_code`
- `begin_date`
- `end_date`
- `created_at`
- `updated_at`

### `recordings`

- `id`
- `musicbrainz_recording_mbid`
- `canonical_title`
- `duration_ms`
- `language_code`
- `is_explicit` nullable
- `first_release_date`
- `status`
- `created_at`
- `updated_at`

### `recording_artists`

- `recording_id`
- `artist_id`
- `credit_name`
- `position`
- `join_phrase`

Composite PK `(recording_id, artist_id, position)`.

### `recording_external_ids`

- `id`
- `recording_id`
- `id_type` (isrc, provider-specific approved identifiers)
- `provider`
- `external_id`
- `provenance`
- `license_policy_version`
- `valid_from`
- `valid_to`

Unique `(provider, id_type, external_id)` where appropriate.

### `recording_features`

As specified in Section 8.5. Index `(recording_id, namespace, key)` and eligibility fields.

### `catalog_source_records`

Tracks source lineage and hashes without exposing provider payloads broadly.

## 9.4 Taste and context

### `user_seed_items`

| Column | Type |
|---|---|
| `id` | uuid |
| `user_id` | uuid |
| `entity_type` | artist, recording |
| `artist_id` | uuid nullable |
| `recording_id` | uuid nullable |
| `sentiment` | strong_positive, positive, negative, hard_block, fatigue |
| `strength` | numeric 0..1 |
| `context_id` | uuid nullable |
| `declared_at` | timestamptz |
| `removed_at` | timestamptz nullable |

Check exactly one entity FK is populated.

### `user_preferences`

Explicit or inferred preference facts:

- `id`
- `user_id`
- `context_id` nullable
- `namespace`
- `key`
- `preference_value` from -1 to 1
- `confidence` 0 to 1
- `evidence_count`
- `origin` (`explicit`, `first_party_feedback`, `derived`)
- `last_evidence_at`
- `model_version`
- timestamps

Do not mix explicit and inferred values irreversibly. Keep evidence lineage.

### `context_profiles`

- `id`
- `user_id`
- `name`
- `system_key` nullable
- `discovery_level` 0–100
- `explicit_content_policy`
- `language_allowlist`
- `language_blocklist`
- `era_start_year`
- `era_end_year`
- `vocal_preference`
- `popularity_preference`
- `structured_intent`
- timestamps

### `preference_evidence`

- `id`
- `user_preference_id`
- `event_type`
- `source_entity_id`
- `weight`
- `occurred_at`
- `reversal_of_id` nullable

This permits recomputation and user deletion.

## 9.5 Novelty and behavior

### `exposures`

Every shown recommendation:

- `id`
- `user_id`
- `recording_id`
- `recommendation_run_id`
- `recommendation_item_id`
- `surface`
- `position`
- `shown_at`
- `opened_destination_at` nullable
- `novelty_state_at_exposure`
- `novelty_probability_at_exposure`
- `experiment_assignments`

Unique as appropriate to prevent accidental duplicate instrumentation, but permit repeat exposures with distinct IDs.

### `known_recordings`

- `user_id`
- `recording_id`
- `knowledge_state` (`confirmed_known`, `confirmed_new`, `ledger_known`, `unknown`)
- `confidence`
- `source` (`user_feedback`, `first_party_exposure`, approved independent ledger)
- `first_known_at`
- `last_confirmed_at`
- `evidence_id`

Spotify is not an allowed source.

### `feedback_events`

Append-only:

- `id`
- `user_id`
- `recording_id`
- `exposure_id`
- `recommendation_run_id`
- `primary_response`
- `reason_codes` text[]
- `context_id`
- `occurred_at`
- `supersedes_event_id` nullable
- `client_event_id` for idempotency
- `schema_version`

Never update feedback in place. A revision appends an event that supersedes the prior event.

### `listen_events` — optional/approved sources only

- `id`
- `user_id`
- `recording_id`
- `source`
- `occurred_at`
- `duration_ms` nullable
- `completion_ratio` nullable
- `provenance`
- `training_eligible`
- `consent_record_id`

Do not create this table’s production ingestion path until data rights are reviewed.

## 9.6 Recommendation lifecycle

### `recommendation_runs`

- `id`
- `user_id`
- `context_id`
- `status` (`queued`, `generating`, `completed`, `degraded`, `failed`, `cancelled`)
- `requested_count`
- `discovery_level`
- `structured_intent_snapshot`
- `profile_snapshot_version`
- `ranker_version`
- `selector_version`
- `experiment_assignments`
- `started_at`
- `completed_at`
- `failure_code`
- `failure_detail_redacted`
- timestamps

### `recommendation_candidates`

Store all considered candidates for evaluation:

- `id`
- `run_id`
- `recording_id`
- `provider`
- `provider_strategy`
- `provider_rank`
- `provider_score`
- `feature_snapshot`
- `eligibility_decision`
- `rejection_reasons`
- `base_score`
- `final_score`
- `selected`
- timestamps

The snapshot must include only eligible features and enough detail to reproduce ranking.

### `recommendation_items`

- `id`
- `run_id`
- `recording_id`
- `position`
- `score`
- `novelty_probability`
- `novelty_state`
- `explanation_id`
- `selection_reason`
- `created_at`

Unique `(run_id, position)` and `(run_id, recording_id)`.

### `recommendation_explanations`

- `id`
- `item_id`
- `template_key`
- `rendered_text`
- `evidence_ids`
- `generator` (`template`, `llm`)
- `generator_version`
- `validated`
- `created_at`

## 9.7 Playlists and exports

### `playlists`

- `id`
- `user_id`
- `name`
- `description`
- `context_id`
- `source_run_id`
- `status`
- timestamps

### `playlist_items`

- `id`
- `playlist_id`
- `recording_id`
- `position`
- `source_recommendation_item_id`
- `added_at`
- `removed_at`

### `exports`

- `id`
- `user_id`
- `playlist_id`
- `destination`
- `connection_id` nullable
- `idempotency_key`
- `status`
- `external_playlist_id_encrypted` or restricted
- `requested_at`
- `completed_at`
- `item_count`
- `resolved_count`
- `inserted_count`
- `skipped_count`
- `failed_count`
- `error_code`
- timestamps

Unique `(user_id, destination, idempotency_key)`.

### `export_item_resolutions`

- `id`
- `export_id`
- `recording_id`
- `destination_item_id_encrypted` or restricted
- `match_method`
- `confidence`
- `status`
- `temporary_display_data`
- `expires_at`
- timestamps

This table is destination-zone data and cannot be joined into recommendation features.

## 9.8 Experiments and analytics

### `experiments`

- `id`
- `key`
- `hypothesis`
- `status`
- `unit`
- `allocation`
- `primary_metric`
- `guardrails`
- timestamps

### `experiment_assignments`

- `experiment_id`
- `subject_id`
- `variant`
- `assigned_at`

Assignments are sticky and deterministic where possible.

### `analytics_events`

Use a strict event schema, not arbitrary PII-rich JSON. Include:

- `event_id`
- `event_name`
- `user_id_pseudonymous`
- `session_id`
- `occurred_at`
- `schema_version`
- approved dimensions
- experiment assignments

Operational analytics must not ingest OAuth tokens, raw provider payloads, email, or free-text intent by default.

## 9.9 Deletion and audit

### `deletion_requests`

- `id`
- `user_id`
- `scope`
- `status`
- `requested_at`
- `completed_at`
- `verification_report`

### `audit_events`

Security and privacy-sensitive actions only:

- actor
- action
- target type/id
- timestamp
- request ID
- result
- redacted metadata

Do not use an audit log as a shadow copy of personal data.

## 9.10 Database controls

- Foreign keys on all ownership relationships.
- Check constraints for probability/value ranges.
- Partial unique indexes for active connections.
- Row-level security or an equivalent repository-enforced tenant boundary.
- Separate DB roles:
  - migration;
  - application;
  - worker;
  - read-only analytics;
  - restricted credential access.
- No direct user-controlled SQL fragments.
- Migrations tested both up and down where reversibility is possible.
- Backups encrypted and restore drills documented.


---

# 10. Recommendation Engine

## 10.1 Design goals

The v1 engine must be:

- service-neutral;
- explainable;
- testable;
- reproducible;
- robust to sparse catalog features;
- capable of learning from explicit positive and negative feedback;
- diversity aware;
- able to distinguish global preference from context mismatch;
- instrumented for offline and online evaluation;
- independent of Spotify inputs.

The initial engine is a **hybrid retrieval, scoring, and constrained-selection pipeline**. It is not a single opaque model.

```text
Structured intent
      +
Taste/context profile
      +
Known/exposed exclusions
      ↓
Candidate providers
      ↓
Canonicalization and dedupe
      ↓
Hard eligibility filters
      ↓
Feature computation
      ↓
Fit / novelty / exploration / confidence scoring
      ↓
Diversity-aware list selection
      ↓
Evidence-backed explanations
      ↓
Persist full decision trace
```

## 10.2 Recommendation input

```ts
interface RecommendationRequest {
  userId: string;
  contextId: string;
  requestedCount: number;       // MVP default 20; allowed 10–50
  discoveryLevel: number;       // integer 0..100
  intent?: StructuredIntent;
  preserveRecordingIds?: string[];
  excludeRecordingIds?: string[];
  requestId: string;
}
```

### `StructuredIntent`

```ts
const StructuredIntentSchema = z.object({
  energy: z
    .object({
      min: z.number().min(0).max(1).optional(),
      max: z.number().min(0).max(1).optional(),
      target: z.number().min(0).max(1).optional(),
    })
    .optional(),
  moods: z.array(z.string()).max(10).default([]),
  genresOrTags: z.array(z.string()).max(20).default([]),
  avoidGenresOrTags: z.array(z.string()).max(20).default([]),
  languages: z.array(z.string()).max(20).default([]),
  eraStartYear: z.number().int().min(1900).max(2100).optional(),
  eraEndYear: z.number().int().min(1900).max(2100).optional(),
  vocals: z.enum(["any", "mostly_vocal", "mostly_instrumental"]).default("any"),
  explicitContent: z.enum(["allow", "block", "context_default"]),
  popularity: z.enum(["any", "avoid_obvious", "long_tail"]).default("any"),
  arc: z
    .enum(["flat", "rising", "falling", "wave", "custom"])
    .default("flat"),
  freeTextSummary: z.string().max(300).optional(),
});
```

Only fields supported by eligible metadata may affect ranking. Unsupported intent fields remain visible as “not currently used” rather than being silently approximated.

## 10.3 Candidate-generation strategies

Each provider returns canonical recording IDs, source evidence, a provider score/rank, and a strategy label. It does not return final recommendations.

### Strategy A — Seed neighborhood

Purpose: high-fit adjacent discovery.

Inputs:

- positive artist and recording seeds;
- negative seeds;
- context profile;
- eligible artist/recording relationships from approved sources.

Methods may include:

- licensed co-listen neighbors;
- open or licensed tag neighborhoods;
- recording/artist graph traversal;
- curator-provided relationships;
- later, first-party co-love relationships.

Rules:

- exclude the exact seed recordings by default;
- reduce weight for seed artists as discovery increases;
- never infer similarity from Spotify metadata;
- preserve relationship paths for explanations and auditing.

### Strategy B — Approved collaborative recommendations

Purpose: leverage an independent provider such as ListenBrainz where terms and endpoint behavior permit.

Requirements:

- provider adapter with timeouts, retry, circuit breaker, and schema validation;
- canonical MBIDs preferred;
- no blind trust in provider rank;
- provider may be disabled globally or per region;
- provider failures must not fail the full run;
- provider output is re-ranked and filtered;
- provenance is retained;
- commercial/model rights are reviewed separately.

### Strategy C — Controlled catalog exploration

Purpose: move beyond nearest neighbors.

Sample from eligible catalog slices:

- adjacent but unseen tags;
- same broad musical area, different geography or era;
- long-tail recordings with sufficient metadata confidence;
- underrepresented languages selected by the user;
- emerging/low-popularity bands from an approved popularity source;
- “bridge” recordings sharing some—but not all—preferred features.

Sampling must be weighted and reproducible from a run seed.

### Strategy D — First-party outcome graph — later

Once sufficient density exists:

- user-recording positive graph;
- user-feature graph;
- recording-recording co-love graph;
- context-specific co-love graph.

Minimum privacy thresholds and k-anonymity/aggregation rules are required before cross-user signals are used.

### Strategy E — Curator/creator feeds — later

Eligible only when:

- rights and metadata are verified;
- paid relationships are disclosed;
- provider cannot force ranking;
- candidate source is measured independently;
- spam/quality controls exist;
- user preference fit remains the ranking criterion.

## 10.4 Candidate budgets

For a 20-track playlist, target 300–800 deduplicated candidates before hard filtering. Use a configurable maximum to control cost.

At discovery level `D = discoveryLevel / 100`, initial provider allocation may be:

```text
adjacent_seed_share      = 0.55 - 0.25D
collaborative_share      = 0.25
catalog_exploration      = 0.15 + 0.15D
wildcard_bridge_share    = 0.05 + 0.10D
```

Normalize shares after disabled/unhealthy providers are removed.

These are starting heuristics, not permanent truth. Log provider yield and learn allocation later.

### Provider deadline policy

- Per-provider soft timeout: configurable, initially a few seconds.
- Full-run deadline: configurable.
- At least one healthy provider must return enough candidates.
- Mark the run `degraded` when a non-critical provider fails.
- Do not hide provider degradation from observability.
- Never block indefinitely.

## 10.5 Hard filters

Apply before scoring:

1. User hard-blocked artist or recording.
2. Explicit-content policy violation when reliable explicitness is known.
3. Language blocklist when language is reliable.
4. Recording is unavailable in the canonical catalog.
5. Recording is an exact duplicate or collapsed equivalent.
6. Recording was explicitly disliked and the dislike has not expired or been reversed.
7. Recording is preserved in the playlist already.
8. Provider/license marks recommendation use as prohibited.
9. Provenance is missing.
10. Destination-specific availability is **not** a hard filter at recommendation time; the playlist remains service neutral.

When metadata is unknown, do not assume a restriction is satisfied. For safety-sensitive restrictions such as explicit content, either exclude unknowns in strict mode or label them unresolved according to the user’s selected policy.

## 10.6 Taste representation

### Binary/categorical features

For each `(user, context, feature)`, maintain weighted positive and negative evidence:

```text
positive_mass
negative_mass
prior_positive
prior_negative
```

Posterior positive affinity:

```text
p_like(feature) =
  (positive_mass + prior_positive)
  /
  (positive_mass + negative_mass + prior_positive + prior_negative)
```

Map to signed affinity:

```text
affinity(feature) = 2 * p_like(feature) - 1
```

Confidence:

```text
confidence(feature) =
  1 - exp(-(positive_mass + negative_mass) / evidence_scale)
```

Store both affinity and confidence. Unknown features must not be treated as disliked.

### Continuous features — only when licensed/supported

For features such as energy or tempo, maintain a weighted target distribution:

- weighted mean;
- weighted variance;
- context-specific sample mass;
- global fallback;
- confidence.

Candidate compatibility can use a Gaussian/RBF distance or bounded triangular distance. Do not create continuous acoustic features from Spotify.

### Global and context layers

The effective preference is a blend:

```text
effective_affinity =
  context_confidence * context_affinity
  +
  (1 - context_confidence) * global_affinity
```

A “Not now” event affects context more than the global profile. A hard dislike affects both only when explicitly indicated.

## 10.7 Feedback weights

Initial configurable event weights:

| Event | Global weight | Context weight | Novelty effect |
|---|---:|---:|---|
| Love | +3.0 | +3.5 | none unless newness answered |
| Like | +1.5 | +2.0 | none |
| Neutral | 0 | 0 | none |
| Dislike | -2.5 | -3.0 | none |
| Not now | 0 | -1.0 | none |
| Already knew | 0 | 0 | mark known |
| New to me | 0 | 0 | mark confirmed new |
| Hard block | -6.0 | -6.0 | none |
| Fatigued/overplayed | 0 | -1.5 or global fatigue | mark known |

Reason-coded feedback distributes a bounded additional weight only to features supported by evidence. Cap the contribution from one recording so a single event cannot dominate a profile.

### Reversal handling

Recompute from append-only evidence or append an equal-and-opposite reversal. Never mutate history in a way that prevents auditing or deletion.

### Decay

- Explicit declarations do not decay automatically.
- Inferred context preferences may decay with a configurable half-life.
- Fatigue decays faster.
- Hard blocks do not expire without user action.
- Keep decay configuration versioned with the model.

## 10.8 Candidate feature vector

A candidate may have:

```ts
interface CandidateFeatures {
  recordingId: string;
  fitEvidence: FeatureEvidence[];
  novelty: {
    probability: number;
    evidence: NoveltyEvidence[];
    confidence: number;
  };
  sourceConfidence: number;
  metadataConfidence: number;
  popularityBand?: number;       // approved source only
  freshness?: number;
  fatiguePenalty: number;
  artistFamiliarity: number;
  explicitnessState: "explicit" | "clean" | "unknown";
  providerScores: ProviderScore[];
}
```

All source-derived fields must be eligible for recommendation use.

## 10.9 Novelty estimation

### Truth hierarchy

1. User says “Already knew” → `known`, probability 0.
2. User says “New to me” → `confirmed_new`, probability 1 for that exposure.
3. Approved listening ledger has a prior listen → `known` or high-confidence known.
4. Resonance has prior exposure/open/feedback → lower novelty.
5. Artist/recording appears in explicit user seeds → lower novelty.
6. No evidence either way → `unknown` or `probably_new`; never certainty.

### Initial heuristic

For unconfirmed tracks:

```text
novelty_probability =
  0.35 * no_prior_recording_evidence
+ 0.20 * no_prior_artist_evidence
+ 0.15 * not_in_seed_neighborhood_history
+ 0.15 * low_exposure_band
+ 0.15 * provider_novelty_confidence
```

Each component is 0–1 and must be based on permitted data. If a component is unavailable, renormalize over available weights and reduce overall confidence.

Map to states:

- `>= 0.85` with strong evidence: `high_confidence_new`
- `>= 0.60`: `probably_new`
- otherwise: `unknown`

Calibrate thresholds after collecting user newness confirmations. Track Brier score and reliability curves.

## 10.10 Fit score

For categorical features:

```text
feature_contribution_i =
  candidate_feature_strength_i
  * user_affinity_i
  * user_confidence_i
  * source_confidence_i
```

Aggregate positive and negative evidence separately. Apply stronger penalties to explicit aversions.

Suggested normalized fit:

```text
raw_fit =
  sum(feature_contribution_i * feature_importance_i)
  / sum(abs(feature_importance_i) for observed eligible features)

fit_score = clamp((raw_fit + 1) / 2, 0, 1)
```

Include seed-neighborhood path confidence and first-party recording/artist affinities as separate terms. Do not let missing metadata produce a high fit score; lower fit confidence when coverage is sparse.

## 10.11 Serendipity/exploration score

A useful discovery is not merely distant. Estimate “surprising but connected”:

```text
serendipity =
  bridge_strength
  * (1 - overfamiliarity)
  * metadata_confidence
```

`bridge_strength` is high when a candidate shares a small number of high-value preferred features while differing on other dimensions.

Wild randomness should not receive a high serendipity score.

## 10.12 Final score

Let `D = discoveryLevel / 100`.

Weights:

```text
w_fit         = 0.70 - 0.30D
w_novelty     = 0.10 + 0.15D
w_serendipity = 0.05 + 0.15D
w_quality     = 0.10
w_freshness   = 0.05
```

The weights sum to 1.0 for every `D`.

```text
positive_score =
    w_fit         * fit_score
  + w_novelty     * novelty_probability
  + w_serendipity * serendipity_score
  + w_quality     * source_quality_score
  + w_freshness   * freshness_score

final_score =
  positive_score
  - 0.35 * known_probability
  - 0.25 * fatigue_penalty
  - 0.20 * aversion_risk
  - 0.15 * metadata_uncertainty_penalty
```

Clamp only for display; retain raw score for diagnostics.

### Quality score warning

“Quality” must not become a disguised popularity bias. It may include:

- provider confidence;
- metadata completeness;
- spam/duplicate risk;
- independent curator confidence;
- first-party aggregate outcomes after privacy thresholds.

Popularity alone cannot define quality.

## 10.13 Diversity-aware selection

Ranking candidates independently will create repetitive lists. Select iteratively with constraints and Maximum Marginal Relevance (MMR).

```text
MMR(candidate) =
  lambda * final_score(candidate)
  - (1 - lambda) * max_similarity(candidate, selected_items)
```

Initial:

```text
lambda = 0.85 - 0.25D
```

Higher discovery creates stronger diversity pressure.

### Default list constraints

For 20 tracks:

- max 2 tracks per primary artist;
- max 1 version of the same underlying recording;
- no more than 35% from one top-level eligible tag;
- at least 4 distinct candidate strategies when available;
- at least 5 artists not directly represented in positive seeds at balanced discovery;
- cap one provider at 60% unless other providers fail;
- avoid more than 3 consecutive tracks from the same era band;
- do not enforce demographic assumptions from artist identity.

Constraints may relax in a documented order when the candidate pool is insufficient. Store relaxation events.

## 10.14 Sequencing and emotional arc

MVP sequencing is conservative:

- preserve selected rank order or use a simple transition score from supported metadata;
- do not claim BPM/key/energy arcs when those features are unavailable;
- if the user requests an arc but eligible features are incomplete, label it experimental or unavailable.

Later, when licensed features exist:

```text
sequence objective =
  item_quality
  - transition_distance
  + target_arc_alignment
  - repeated_artist_penalty
```

Use beam search or dynamic programming for 20–50 tracks; avoid a heavyweight optimizer initially.

## 10.15 Explanations

### Evidence classes

- explicit seed relationship;
- explicit user preference;
- first-party prior feedback;
- context match;
- novelty rationale;
- provider relationship/path;
- diversity/exploration rationale.

### Deterministic examples

> “Recommended for your Focus profile because it matches two tags you consistently like and comes from an artist outside your usual seed set.”

> “A more adventurous pick: it shares the reflective mood you favor, but comes from a different era and scene.”

> “Probably new to you because neither this recording nor this artist appears in your Resonance history.”

### Forbidden explanations without evidence

- “You will love this.”
- “It uses the same chord progression as…”
- “The singer sounds exactly like…”
- “Spotify listeners like you enjoy…”
- “You have never heard this.”
- “This is trending” without an approved, current source.
- Any claim based only on an LLM’s world knowledge.

### LLM explanation flow

1. Construct a small evidence object.
2. Remove external free text or treat it as quoted data.
3. Ask for JSON matching a strict schema.
4. Validate all referenced evidence IDs.
5. Run prohibited-claim checks.
6. Fall back to a deterministic template on any failure.
7. Store generator/version and evidence.

## 10.16 Natural-language intent

An LLM may parse:

> “Music for driving through the mountains at sunrise after getting over a breakup.”

into:

```json
{
  "energy": { "min": 0.35, "max": 0.75, "target": 0.55 },
  "moods": ["reflective", "hopeful", "expansive"],
  "genresOrTags": [],
  "avoidGenresOrTags": [],
  "languages": [],
  "vocals": "any",
  "explicitContent": "context_default",
  "popularity": "avoid_obvious",
  "arc": "rising",
  "freeTextSummary": "Reflective to hopeful mountain-drive discovery."
}
```

But only supported fields affect ranking. Show the parsed interpretation for confirmation/editing. Never let the LLM directly call providers or insert unvalidated catalog entities.

## 10.17 Exploration learning — post-MVP

Use a contextual bandit over **candidate strategies**, not individual copyrighted items:

- arms: adjacent, collaborative, long-tail, bridge, curator, etc.;
- context: discovery level, context profile, user maturity, source health;
- reward:
  - Love: +3;
  - Like: +1;
  - Dislike: -2;
  - Already knew: novelty penalty;
  - durable repeat outcome: +4;
- delayed rewards handled separately;
- minimum exploration floor;
- per-user and global guardrails;
- offline replay evaluation before online rollout.

Thompson sampling with Beta or Gaussian reward models is a reasonable first implementation. Keep deterministic allocation for experiment cohorts.

## 10.18 Learned ranking — post-MVP gate

Do not train a learned ranker until:

- sufficient first-party labeled exposures exist;
- training consent and deletion propagation are implemented;
- source/provenance checks are automated;
- a temporal holdout evaluation exists;
- baseline performance is stable;
- model rollback exists;
- feature leakage tests pass;
- legal review confirms training eligibility.

Candidate models:

1. Regularized logistic regression as the first learned baseline.
2. Gradient-boosted ranking with carefully audited features.
3. Matrix factorization/BPR from first-party outcomes.
4. Two-tower retrieval after dataset scale justifies it.
5. Contextual learning-to-rank.

A deep model is not inherently better. Promote a model only if it improves online CNL/WAU or a validated proxy without harming novelty, diversity, privacy, or retention.

## 10.19 Reproducibility

Every run stores:

- random seed;
- profile snapshot version;
- feature snapshot identifiers;
- provider versions;
- provider candidate sets;
- ranker/selector versions;
- experiment assignments;
- constraints and relaxations;
- explanation evidence.

A developer should be able to rerun a historical decision against the original snapshot in a test environment.

## 10.20 Software 3.0 layer

v1 of this spec confined the LLM to intent parsing and explanation wording. That remains the right *candidate-source* boundary — an LLM must never nominate recordings from world knowledge — but it undersells the LLM as an **interface and interpretation layer over first-party data**, which is exactly where it is both compliance-clean and strategically differentiating. This section defines the expanded, still-bounded role.

### Principles

1. **Deterministic core, probabilistic shell.** The retrieval → filter → score → select pipeline stays deterministic and reproducible. The LLM operates at the edges: translating human language in, translating evidence out.
2. **The LLM edits data, never state.** Every LLM output is a proposal in a strict schema (intent diff, seed candidates, cluster label, explanation JSON) that application code validates, the user can inspect, and the deterministic system consumes. No tool access, no direct mutations (§11.5 controls apply).
3. **First-party language is a licensed asset.** The words users write — conversational seeds, refinements, reason elaborations — are Zone A data, fully eligible for features and (with consent) training. This is the one rich signal source with zero third-party license risk. Capture it deliberately.

### Taste-language embeddings (post-MVP, `FEATURE_TASTE_EMBEDDINGS`)

Build an embedding space from **eligible text only**: user free-text intents and refinements, confirmed reason elaborations, and license-eligible catalog tags. Store in `pgvector` with the same provenance/eligibility columns as any feature (§8.5).

Uses, in order of introduction:

1. Soft matching between a user's descriptive language ("hazy," "propulsive," "like driving at night") and eligible catalog tags — improving Strategy C exploration slices without new licensed data.
2. Cross-user taste-language neighborhoods for Strategy D, subject to the same k-anonymity thresholds.
3. Retrieval features for the Milestone 7 learned ranker, passing the same provenance assertions as every other feature.

Embeddings must never be computed from Spotify data, provider payloads, or unlicensed supplementary text. The embedding model and version are recorded per row; re-embedding is a versioned migration.

### Model-agnostic LLM contract

Treat the LLM like any provider (§11.1): versioned prompts in the repository, schema-validated outputs, evaluated per prompt+model pair against golden cases before rollout, cost/latency budgets, deterministic fallback, and a kill switch. A prompt is code: it gets review, tests, and a changelog. Prompt regressions are release blockers exactly like ranker regressions (§20.4).

### What stays forbidden

Unchanged from §11.5, restated because the expanded role increases temptation:

- no track/artist selection or nomination from model memory;
- no fabricated catalog entities or features;
- no LLM output as source-of-truth catalog data;
- no OAuth credentials, raw provider payloads, or unnecessary personal data in prompts;
- no unvalidated LLM output rendered as actionable UI or persisted as evidence.

---

# 11. External Data and Provider Integrations

## 11.1 General provider contract

Each integration must include:

- official API/client documentation link;
- owner;
- data/license review;
- authentication method;
- rate-limit policy;
- timeout;
- retry policy;
- circuit breaker;
- schema validation;
- cache/retention policy;
- attribution requirements;
- health metrics;
- deletion/tombstone behavior;
- fixture-based contract tests;
- a feature flag.

No provider becomes a silent single point of failure.

## 11.2 MusicBrainz adapter

Primary uses:

- canonical artists and recordings;
- MBIDs;
- ISRC relationships where available;
- releases and credits;
- basic dates and identity metadata.

Requirements:

- set a meaningful User-Agent with app name/version/contact;
- respect the published request rate;
- cache permitted canonical data;
- prefer bulk data or a commercial arrangement at scale;
- distinguish core CC0 data from supplementary data with different licensing;
- never mark a field training/commercial eligible merely because it came from the MusicBrainz domain.

Search must tolerate ambiguity and expose disambiguation to the user during onboarding.

## 11.3 ListenBrainz adapter

Potential uses, subject to endpoint and license review:

- recording recommendations;
- popularity signals;
- metadata lookup by recording MBID;
- similar-user or collaborative signals;
- optional user-directed independent listening ledger.

Requirements:

- provider token stored as a secret where required;
- HTTPS only;
- validate MBIDs;
- measure incomplete/experimental endpoint quality;
- retain provider strategy and rank;
- re-rank all output;
- do not assume every recommendation is available on every destination;
- implement graceful fallback;
- document whether a particular data class may be used for commercial recommendation and/or training.

If a user connects a ListenBrainz identity, obtain explicit consent and make deletion/disconnect behavior clear. Do not silently import public user history merely because it is technically accessible.

## 11.4 Licensed commercial data — later

A richer catalog may require licensed:

- genre/tags;
- mood/instrumentation;
- popularity;
- audio analysis;
- editorial relationships;
- creator metadata.

Before integration, require:

- rights for commercial recommendation;
- rights for model training, if needed;
- retention and attribution terms;
- geographic constraints;
- audit/deletion obligations;
- cost model;
- vendor exit plan;
- canonical ID coverage;
- quality benchmark.

## 11.5 LLM provider

Use behind `packages/integrations/llm`.

Permitted MVP tasks:

- structured intent parsing;
- bounded explanation wording;
- administrative summaries of aggregate experiment results.

Not permitted:

- selecting songs from model memory;
- inventing catalog features;
- training on destination-service data;
- receiving OAuth credentials;
- receiving unnecessary personal data;
- making irreversible account or playlist actions without application validation.

Privacy controls:

- send pseudonymous IDs or none;
- avoid raw free-text analytics retention;
- configure provider retention appropriately;
- redact external metadata that could contain prompt injection;
- validate structured outputs;
- cost/latency limits;
- deterministic fallback.

## 11.6 Provider source registry

Create `docs/compliance/data-sources.md` and a machine-readable registry:

```yaml
sources:
  - provider: musicbrainz
    dataset: core
    uses:
      display: allowed
      recommendation_feature: allowed
      model_training: allowed
      commercial_use: allowed
    review_required: true
    reviewed_at: null
  - provider: musicbrainz
    dataset: supplementary
    uses:
      display: review
      recommendation_feature: prohibited_until_licensed
      model_training: prohibited_until_licensed
      commercial_use: prohibited_until_licensed
  - provider: spotify
    dataset: web_api
    uses:
      temporary_cache: export_only
      recommendation_feature: prohibited
      model_training: prohibited
      commercial_use: platform_review
```

The example is not a substitute for an actual license review. CI should verify that enabled features have an approved registry entry.

---

# 12. Spotify Destination Adapter

## 12.1 Strict purpose

The Spotify adapter may:

1. Connect a user through OAuth.
2. Resolve canonical recordings to Spotify tracks during export.
3. Create a private Spotify playlist.
4. Add resolved tracks.
5. Return export status and a destination link.
6. Disconnect and delete Spotify-related credentials/data.

It may not:

- create the taste profile;
- import listening history;
- read saved tracks or playlists for recommendations;
- request Spotify recommendations;
- read audio features/analysis;
- use preview clips;
- train any model;
- influence rank except for post-ranking export resolvability shown as a user-facing issue;
- act as the user’s Resonance login;
- store Spotify content indefinitely.

## 12.2 Quota reality

Current Development Mode is suitable only for an authorized pilot and is limited to a very small number of users. The product must launch its core without depending on Spotify export. Treat extended access as a business-development/compliance milestone, not an assumed entitlement.

Do not design growth projections around receiving extended access. Apply only after the product demonstrates:

- independent user value;
- excellent security/privacy practices;
- stable integration;
- policy alignment;
- clear benefit to users and creators;
- support and incident processes.

## 12.3 OAuth

Use Authorization Code with PKCE and server-side callback handling.

Controls:

- cryptographically random `state`;
- PKCE verifier/challenge;
- exact allowlisted redirect URI;
- HTTPS in production;
- local development redirect uses `http://127.0.0.1`, not `localhost`;
- secure, HTTP-only, same-site cookies;
- short callback transaction lifetime;
- one-time state consumption;
- server-side token exchange;
- encrypted token storage;
- minimum scope request;
- clear reconnection flow;
- refresh-token rotation handling;
- `invalid_grant` handling;
- reauthorization reminder before current refresh-token lifetime is reached.

### Initial scope

Request only:

```text
playlist-modify-private
```

Do not request public playlist creation unless the user explicitly selects a public export and policy review approves adding `playlist-modify-public`.

Do not request read scopes in the strict MVP.

## 12.4 Token lifecycle

- Store `authorized_at`.
- Track provider refresh-token policy via configuration, not scattered constants.
- Schedule a reconnection reminder before expected expiry.
- Refresh access tokens only when needed.
- A refresh does not imply the refresh token’s lifetime restarts.
- On `invalid_grant`, mark connection expired and require reauthorization.
- Never retry invalid credentials in a loop.
- Rotate encryption keys with versioned envelope encryption.
- Delete credentials on disconnect.

## 12.5 Track resolution

For every canonical recording:

### Step 1 — ISRC exact search

When a trusted ISRC exists, query Spotify Search with the ISRC filter and a small result limit.

Validate:

- returned ISRC;
- normalized primary artist;
- normalized title;
- duration tolerance;
- market availability where determinable.

### Step 2 — Artist/title search

Fallback query uses quoted/escaped title and artist fields. Limit results to the current API maximum.

Score each result:

```text
resolution_confidence =
  0.45 * title_similarity
+ 0.30 * artist_similarity
+ 0.15 * duration_similarity
+ 0.10 * release_context_similarity
+ isrc_exact_bonus
```

An exact ISRC dominates but still check gross contradictions.

### Step 3 — Decision

- `>= 0.95`: auto-resolve.
- `0.80–0.949`: display for user confirmation.
- `< 0.80`: unresolved.

Tune with labeled data. Store method and confidence, not the full Spotify response.

### Step 4 — Temporary cache

Cache resolution only for the documented export purpose, with expiry and purge. The mapping must not become a recommendation feature.

## 12.6 Playlist creation

Use the current endpoint:

```http
POST /me/playlists
```

Request body:

```json
{
  "name": "Resonance — Late Night Discovery",
  "public": false,
  "description": "Created from a service-neutral Resonance discovery playlist."
}
```

Do not imply Spotify endorsement in the name or description.

## 12.7 Add items

Use the current endpoint:

```http
POST /playlists/{playlist_id}/items
```

- Add at most the endpoint’s documented maximum per request.
- For the default 20-track playlist, use one batch.
- Preserve canonical order.
- Record batch state before and after the call.
- Respect `429` and `Retry-After`.
- Use bounded jittered backoff for retryable failures.
- Do not retry authentication failures without reauthorization.

## 12.8 Export idempotency

Spotify does not provide application-level idempotency for every export step. Implement local idempotency carefully.

### State machine

```text
requested
  → resolving
  → needs_review
  → creating_playlist
  → inserting_items
  → completed

failure branches:
  → rate_limited
  → authorization_required
  → partial
  → ambiguous
  → failed
```

Rules:

1. `idempotency_key` deduplicates repeated user clicks.
2. Once a destination playlist ID is received and persisted, do not create another during an ordinary retry.
3. Track every insertion batch.
4. Retry only when the failure is known to have occurred before the provider accepted the request or the provider explicitly indicates retry safety.
5. A network timeout after request transmission is **ambiguous**. Without read scope, do not blindly replay the insertion and risk duplicates.
6. For an ambiguous insertion, offer:
   - keep the possibly completed playlist;
   - create a clean new export;
   - open Spotify for manual inspection.
7. A clean retry creates a new destination playlist and marks the prior export superseded; it does not delete or overwrite a user playlist.

## 12.9 Rate limiting

Centralize Spotify calls in one client.

- Track rolling request volume.
- Honor `Retry-After`.
- Use bounded exponential backoff with jitter.
- Limit concurrent search requests.
- Coalesce duplicate ISRC resolutions within one export.
- Cache eligible temporary resolution results.
- Stop retrying after a configured budget.
- Expose queue depth, 429 count, and retry duration.
- Development and extended quota modes must be configurable.

## 12.10 Disconnect

On disconnect:

1. Mark connection revoked.
2. Stop queued provider jobs.
3. Delete encrypted tokens.
4. Delete or expire destination personal data and temporary mappings.
5. Preserve service-neutral playlists and canonical IDs.
6. Record completion in the deletion/audit system.
7. Tell the user that existing playlists already created in Spotify remain in their Spotify account unless they remove them there.

## 12.11 Spotify adapter contract tests

Use an official-schema-derived or carefully maintained mock server. Test:

- OAuth success;
- state mismatch;
- expired callback;
- token refresh;
- `invalid_grant`;
- exact ISRC match;
- multiple ambiguous matches;
- no match;
- search max-limit handling;
- create playlist;
- add items;
- 429 with `Retry-After`;
- 401 reauthorization;
- 403 policy/scope error;
- 5xx retry;
- timeout ambiguity;
- partial export;
- disconnect and purge;
- no recommendation-domain imports;
- no Spotify data in training fixtures.

Do not run destructive integration tests against a real user account in CI.

---

# 13. Application API

Use versioned JSON APIs under `/api/v1`. Validate all inputs and outputs with shared schemas. Authentication errors must not reveal account existence.

## 13.1 Error envelope

```json
{
  "error": {
    "code": "RECOMMENDATION_PROVIDER_DEGRADED",
    "message": "A discovery source is temporarily unavailable.",
    "requestId": "req_...",
    "retryable": true,
    "details": {}
  }
}
```

`details` must be safe for the client. Raw provider errors stay in restricted logs.

## 13.2 Idempotency

Mutating endpoints that can be retried accept:

```http
Idempotency-Key: <uuid-or-random-token>
```

Store key, user, route, request hash, status, and response for a bounded period. Reject reuse with a different body.

## 13.3 Catalog search

```http
GET /api/v1/catalog/search?q=<query>&type=artist,recording&limit=10
```

Response:

```json
{
  "items": [
    {
      "entityType": "recording",
      "id": "internal-uuid",
      "title": "Example",
      "artists": [{ "id": "uuid", "name": "Artist" }],
      "disambiguation": "studio recording",
      "externalIdentity": { "musicbrainzMbid": "..." },
      "sourceAttribution": ["MusicBrainz"]
    }
  ],
  "nextCursor": null
}
```

Do not expose license-ineligible fields.

## 13.4 Seeds

```http
POST /api/v1/taste/seeds
```

```json
{
  "items": [
    {
      "entityType": "artist",
      "entityId": "uuid",
      "sentiment": "strong_positive",
      "strength": 1,
      "contextId": null
    },
    {
      "entityType": "recording",
      "entityId": "uuid",
      "sentiment": "fatigue",
      "strength": 0.8,
      "contextId": null
    }
  ]
}
```

Support `GET`, `PATCH`, and soft-delete with audit/recomputation.

## 13.5 Context profiles

```http
POST /api/v1/contexts
GET /api/v1/contexts
GET /api/v1/contexts/{contextId}
PATCH /api/v1/contexts/{contextId}
DELETE /api/v1/contexts/{contextId}
```

Validate structured intent and user ownership.

## 13.6 Generate recommendations

```http
POST /api/v1/recommendation-runs
```

```json
{
  "contextId": "uuid",
  "requestedCount": 20,
  "discoveryLevel": 65,
  "intent": {
    "moods": ["reflective", "hopeful"],
    "explicitContent": "block",
    "popularity": "avoid_obvious",
    "arc": "rising"
  },
  "preserveRecordingIds": [],
  "excludeRecordingIds": []
}
```

Response:

```json
{
  "runId": "uuid",
  "status": "queued",
  "statusUrl": "/api/v1/recommendation-runs/uuid"
}
```

## 13.7 Get recommendation run

```http
GET /api/v1/recommendation-runs/{runId}
```

Completed response:

```json
{
  "id": "uuid",
  "status": "completed",
  "degradedProviders": [],
  "items": [
    {
      "recommendationItemId": "uuid",
      "recording": {
        "id": "uuid",
        "title": "Example",
        "artists": [{ "id": "uuid", "name": "Artist" }]
      },
      "position": 1,
      "novelty": {
        "state": "probably_new",
        "probability": 0.79,
        "confidence": 0.61
      },
      "explanation": {
        "text": "A more adventurous pick...",
        "evidence": [
          { "type": "context_match", "label": "Reflective mood" },
          { "type": "seed_bridge", "label": "Adjacent to one of your seeds" }
        ]
      }
    }
  ]
}
```

Never expose internal user affinity values or sensitive provider payloads unnecessarily.

## 13.8 Feedback

```http
POST /api/v1/feedback
```

```json
{
  "clientEventId": "uuid",
  "recommendationItemId": "uuid",
  "primaryResponse": "love",
  "reasonCodes": ["mood", "instrumentation"],
  "newnessResponse": "new_to_me",
  "contextId": "uuid",
  "occurredAt": "2026-07-13T18:00:00Z"
}
```

Server verifies that the item was actually exposed to this user. Duplicate `clientEventId` returns the original result.

## 13.9 Playlist endpoints

```http
POST   /api/v1/playlists
GET    /api/v1/playlists
GET    /api/v1/playlists/{playlistId}
PATCH  /api/v1/playlists/{playlistId}
DELETE /api/v1/playlists/{playlistId}
POST   /api/v1/playlists/{playlistId}/items
PATCH  /api/v1/playlists/{playlistId}/items/reorder
DELETE /api/v1/playlists/{playlistId}/items/{itemId}
```

All mutations enforce ownership and optimistic concurrency via version/ETag.

## 13.10 File exports

```http
POST /api/v1/playlists/{playlistId}/exports/file
```

```json
{
  "format": "csv"
}
```

CSV columns:

```text
position,title,artist,recording_mbid,isrc,release_year,novelty_state,explanation
```

Do not include personal preference values unless explicitly requested in a personal data export.

M3U uses service-neutral or approved destination URLs where possible.

## 13.11 Connections

```http
POST /api/v1/connections/spotify/start
GET  /api/v1/connections/spotify/callback
GET  /api/v1/connections
DELETE /api/v1/connections/{connectionId}
```

The start endpoint returns a redirect or performs one. The callback never renders raw provider errors.

## 13.12 Spotify export

```http
POST /api/v1/playlists/{playlistId}/exports/spotify
```

Response:

```json
{
  "exportId": "uuid",
  "status": "resolving",
  "statusUrl": "/api/v1/exports/uuid"
}
```

Review response:

```json
{
  "id": "uuid",
  "status": "needs_review",
  "resolved": 17,
  "unresolved": 1,
  "needsConfirmation": 2,
  "items": [
    {
      "recordingId": "uuid",
      "status": "needs_confirmation",
      "candidate": {
        "displayTitle": "Example",
        "displayArtist": "Artist"
      },
      "matchMethod": "artist_title_duration",
      "confidence": 0.87
    }
  ]
}
```

Manual confirmation is scoped only to export resolution and must not update taste.

## 13.13 Privacy endpoints

```http
GET  /api/v1/privacy/consents
POST /api/v1/privacy/consents
POST /api/v1/privacy/export
POST /api/v1/privacy/delete
GET  /api/v1/privacy/requests/{requestId}
```

Deletion is asynchronous, auditable, and has a user-visible status.

## 13.14 Admin endpoints

Admin actions require:

- role check;
- step-up authentication for sensitive actions;
- audit event;
- CSRF protection;
- no ability to view decrypted OAuth tokens;
- aggregated user data by default.

---

# 14. Front-End Engineering

## 14.1 Rendering strategy

- Server-render public and account-shell pages where useful.
- Keep secrets and provider calls server-side.
- Use client components only for interactivity.
- Use progressive enhancement for forms.
- Use optimistic updates only when reversibility and idempotency are clear.
- Recommendation generation uses polling, Server-Sent Events, or a lightweight status channel; do not add WebSockets without need.

## 14.2 State

Prefer:

- server state through the application API and framework data primitives;
- URL state for filters;
- local component state for transient UI;
- a small client cache only if needed.

Do not introduce a large global state library by default.

## 14.3 Accessibility

Target WCAG 2.2 AA:

- keyboard-complete flows;
- visible focus;
- semantic headings;
- labels and descriptions;
- sufficient contrast;
- no color-only status;
- motion reduction;
- screen-reader announcements for generation/export progress;
- large feedback targets;
- accessible slider alternative using numeric/select controls;
- meaningful error association.

Automated accessibility tests are necessary but not sufficient; include manual keyboard and screen-reader checks.

## 14.4 Responsive behavior

Primary flows must work at:

- 320px mobile width;
- tablet;
- desktop.

Recommendation feedback should be one-handed on mobile. Do not hide explanation or novelty details behind hover-only interactions.

## 14.5 Design language and system

### Direction

- Quiet, editorial, music-forward — closer to a well-set liner-note essay than a streaming dashboard.
- Avoid fake scientific “DNA” scores that imply more certainty than exists.
- Show confidence where it helps decisions; render uncertainty as texture (haze, dashed strokes, muted weight), not as apologetic copy.
- Explanations are concise by default; progressive disclosure for technical provenance.
- Never use dark patterns to obtain destination permissions or model-training consent.

### Design tokens

Define once in `packages/ui/tokens` and consume everywhere (Tailwind theme extends from these; no ad-hoc hex values in components):

- **Color:** a near-black/near-paper neutral ramp plus one restrained accent. Semantic tokens for the five novelty states (§5.3) and the six feedback responses; these are the only places color carries meaning, and each also has an icon/label so meaning never rests on color alone (§14.3). Dark mode is a first-class theme from Milestone 1, not a retrofit.
- **Typography:** an editorial serif or high-contrast grotesque for titles and explanations; a neutral sans for UI chrome; tabular numerals for confidence values. Type scale limited to 5 steps.
- **Spacing/radius/elevation:** 4px base grid; two radii; at most two elevation levels. Recommendation cards should feel like printed cards, not floating glass.
- **Motion:** durations 120–240ms, standard easing tokens; motion communicates state change (track committed to playlist, feedback registered), never decoration. All motion respects `prefers-reduced-motion` with opacity-only fallbacks. Streaming generation (§5.7.1) is the one choreographed sequence and gets an explicit motion spec.

### Signature moments

Budget craft where it compounds trust and identity:

1. **The generation reveal** — streaming tracks with reasons (§5.7.1). This is the product's "magical moment" (§35) and deserves the most design investment.
2. **The novelty badge** — the honest-uncertainty brand promise in one component. It must be instantly legible at card size and expand to show its evidence.
3. **The taste map** (§5.7.4) — the retention surface.

Everything else defaults to plain, fast, and dense enough for a 20-track review session.

### Anti-patterns

- No infinite feeds; playlists are finite, evaluable objects.
- No engagement-bait notifications; the product's own principle P1 applies to the UI.
- No skeleton screens that misrepresent structure; stream real content instead.
- No hover-only affordances (§14.4).

## 14.6 Client analytics

Instrument semantic events:

- `onboarding_started`
- `seed_added`
- `aversion_added`
- `context_created`
- `recommendation_run_requested`
- `recommendation_run_viewed`
- `recommendation_item_opened`
- `feedback_submitted`
- `newness_confirmed`
- `playlist_saved`
- `export_started`
- `export_completed`
- `export_failed`
- `connection_started`
- `connection_completed`
- `connection_removed`
- `privacy_request_created`

Events are schema-validated. Avoid raw free text and destination payloads.

---

# 15. Analytics and Experimentation

## 15.1 Event quality

Every event has:

- unique event ID;
- server-received timestamp;
- client occurrence timestamp when relevant;
- schema version;
- pseudonymous user ID;
- session ID;
- request/run/item IDs;
- experiment assignments;
- source surface;
- validated properties.

Critical conversion events should be emitted server-side or reconciled server-side.

## 15.2 Funnel

```text
Account created
→ onboarding completed
→ first run requested
→ first playlist viewed
→ 5 items evaluated
→ first provisional new love
→ playlist saved/exported
→ second run within 7 days
→ confirmed durable new love
```

Break down by:

- acquisition source;
- candidate strategy;
- context;
- discovery band;
- onboarding depth;
- catalog coverage;
- provider health;
- destination connection;
- cohort week.

Do not infer sensitive attributes.

## 15.3 First baseline experiment

### Hypothesis

The Resonance hybrid ranker creates more provisional confirmed-new loves than a popularity- and metadata-coverage-matched baseline.

### Arms

- **Control:** eligible candidates sampled from the same provider pool, matched on popularity band and metadata completeness, with basic hard filters/diversity.
- **Treatment:** full fit/novelty/serendipity ranker and selector.

### Primary metric

`provisional_confirmed_new_love / evaluated_item`

### Guardrails

- known-track leakage;
- dislike rate;
- artist concentration;
- explicit-content violations;
- provider failure rate;
- playlist generation latency;
- user-level D7 return;
- feedback burden.

### Unit and analysis

Randomize by user for a stable initial experience. Predefine exclusions, minimum evaluated items, confidence intervals, and stopping rules. Do not repeatedly peek and declare success.

## 15.4 Offline evaluation

Build a temporal replay dataset from first-party events:

- train/profile snapshot uses only events before cutoff;
- candidates generated as of cutoff;
- outcomes after cutoff;
- no future features;
- user-level split;
- report by cold-start vs mature users.

Metrics:

- Precision@K for Love/Like;
- Recall@K where candidate coverage permits;
- NDCG@K;
- novelty confirmation precision;
- catalog coverage;
- intra-list diversity;
- artist coverage;
- calibration/Brier score;
- source yield;
- long-tail exposure;
- aversion violation rate.

Offline metrics do not replace online experiments.

## 15.4a LLM-assisted evaluation

Two bounded uses, both flagged (`FEATURE_LLM_JUDGE`) and never a substitute for user outcomes:

**Explanation quality judging.** Sample generated explanations nightly and have an LLM grade them against a rubric: evidence-grounded, concise, no forbidden claim patterns (§10.15), tone-consistent. Judge outputs are structured scores with cited spans, spot-audited by humans weekly, and calibrated against human labels before any gating use. Use for monitoring drift and prompt regressions, not as the sole release gate.

**Synthetic persona simulation.** Maintain scripted synthetic users (personas from §2.5 with fixed seed profiles and deterministic response policies, optionally LLM-role-played within those policies) that run the full onboarding → generate → feedback loop against the real pipeline in CI. This smoke-tests end-to-end coherence — "does the Disappointed Discoverer's third playlist actually diverge from their first" — cheaply and before real users do. Synthetic feedback is marked as such and is never eligible for training or production metrics.

## 15.5 Metric definitions as code

Store metrics in version-controlled SQL or a semantic layer. Every dashboard links to:

- exact definition;
- owner;
- freshness;
- known limitations;
- change history.

Do not let two teams use different “love rate” denominators.

## 15.6 Causal evidence for acquisition value

An eventual buyer will care more about demonstrated incremental value than raw activity. Preserve:

- experiment assignments;
- baseline definitions;
- cohort retention;
- novelty calibration;
- treatment lift;
- provider/source contribution;
- follow-on behavior;
- model/version history.

Produce a repeatable “Recommendation Quality Report” quarterly.

---

# 16. Security, Privacy, and Abuse Prevention

## 16.1 Threat model

Protect:

- user identity and email;
- taste/feedback history;
- destination OAuth tokens;
- private playlists and context;
- model/feature datasets;
- provider credentials;
- admin controls;
- recommendation integrity.

Threat actors:

- unauthenticated attacker;
- malicious user;
- compromised browser/session;
- compromised provider response;
- insider with excess access;
- dependency/supply-chain attacker;
- prompt-injection content;
- bot/spam creator;
- accidental developer leakage.

## 16.2 Authentication and sessions

- Passwordless email or another well-supported first-party method.
- Short-lived session with secure rotation.
- HTTP-only, Secure, SameSite cookies.
- CSRF defense on state-changing browser requests.
- Account enumeration resistance.
- Rate limits on login and callbacks.
- Session revocation.
- Step-up authentication for data deletion and sensitive admin actions.
- Do not make Spotify the account identity provider.

## 16.3 Authorization

- Deny by default.
- Every repository query is user-scoped.
- Server-side ownership checks.
- Admin role checked in server code.
- Separate service roles.
- Test horizontal and vertical privilege escalation.
- Signed URLs expire quickly.
- No object ID alone grants access.

## 16.4 OAuth token security

- Encrypt at the application layer or use a managed secret vault.
- AES-256-GCM/envelope encryption with per-record nonce.
- Key versioning and rotation.
- Restrict decryption to destination worker/service path.
- Redact tokens from errors.
- Detect accidental secret patterns in CI.
- Never send tokens to the client after callback.
- Never send tokens to an LLM or analytics system.

## 16.5 External request security

- Fixed provider base URLs.
- No user-controlled URL fetch.
- DNS/egress controls where feasible.
- Timeouts and response-size limits.
- Content-type validation.
- Zod validation before use.
- Avoid following arbitrary redirects.
- Escape search syntax.
- Sanitize display data.
- Protect against SSRF and decompression bombs.

## 16.6 Prompt injection

Catalog and user text is untrusted.

- Put external strings in explicit data fields, not system instructions.
- Never give the LLM tools that can mutate playlists or accounts directly.
- Use strict JSON schema.
- Limit output length.
- Validate referenced evidence.
- Reject instruction-like output.
- Keep deterministic fallbacks.
- Log prompt version, not unnecessary prompt content.
- Red-team artist names, titles, and free text containing instructions.

## 16.7 Abuse and integrity

Potential abuse:

- bots generating many runs;
- candidate-provider exhaustion;
- creator spam;
- brigaded feedback;
- paid manipulation;
- catalog poisoning;
- export spam.

Controls:

- per-account/IP generation rate limits;
- email verification;
- queue quotas;
- provider cost budgets;
- source reputation;
- minimum evidence thresholds;
- anomaly detection;
- no paid rank guarantees;
- admin review and source disable switch;
- provenance and immutable decision traces.

## 16.8 Privacy

- Data minimization.
- Clear purpose limitation.
- Separate core personalization from optional model-improvement consent.
- User access/export/deletion.
- Deletion propagation to derived profiles and future training datasets.
- Pseudonymize analytics.
- Avoid sensitive-trait inference.
- Free-text intent excluded from analytics/model training by default.
- Document subprocessors.
- Geographic/legal review before expansion.
- Retention schedule visible internally and summarized to users.

## 16.9 Security headers

At minimum:

- Content-Security-Policy;
- Strict-Transport-Security;
- X-Content-Type-Options;
- Referrer-Policy;
- Permissions-Policy;
- frame-ancestors or equivalent anti-framing;
- secure cookies.

CSP must be tested against destination links and any analytics scripts.

## 16.10 Dependency and supply-chain security

- Lockfile committed.
- Automated dependency update PRs.
- Vulnerability scanning.
- License scanning.
- Minimal install scripts.
- Provenance/SBOM where practical.
- Pin CI actions by commit.
- Protected main branch.
- Signed releases where practical.
- Secret scanning.
- No unreviewed packages merely to save a few lines.

## 16.11 Incident response

Create runbooks for:

- OAuth token exposure;
- user data exposure;
- provider credential exposure;
- malicious dependency;
- unauthorized admin access;
- recommendation manipulation;
- deletion failure;
- Spotify or provider security incident.

Current Spotify terms include a short notification window for suspected incidents involving Spotify personal data. Treat notification obligations as an urgent legal/operational control and verify the exact current requirement in every policy review.

---

# 17. Reliability and Observability

## 17.1 Service-level indicators

- web request success/latency;
- recommendation run completion/latency;
- provider success/latency;
- candidate count after each stage;
- queue age/depth;
- export success/latency;
- destination resolution rate;
- 429 and retry volume;
- OAuth refresh/reauthorization failures;
- purge/deletion job completion;
- data-provenance validation failures;
- explanation fallback rate.

## 17.2 Initial service objectives

Set targets only after baseline measurement, but define alertable failure conditions immediately:

- critical API routes unavailable;
- recommendation queue stuck;
- all candidate providers unhealthy;
- export error spike;
- token-decryption errors;
- deletion SLA at risk;
- destination cache purge overdue;
- prohibited provenance detected;
- explicit-content hard-filter violation;
- admin authorization failure spike.

## 17.3 Structured logs

Every log includes:

- timestamp;
- level;
- service;
- environment;
- request/job ID;
- user pseudonymous ID where needed;
- run/export/provider IDs;
- event code;
- redacted error class.

Do not log:

- access/refresh tokens;
- cookies;
- email;
- raw free-text intent;
- raw provider payloads;
- full playlist contents at info level;
- encryption keys;
- authorization codes.

## 17.4 Tracing

Trace:

- recommendation request;
- candidate-provider calls;
- ranking stages;
- database operations;
- export resolution;
- playlist creation/insertion.

Attach counts and timings, not copyrighted or personal content.

## 17.5 Feature flags and kill switches

Required flags:

```text
FEATURE_SPOTIFY_EXPORT
FEATURE_LISTENBRAINZ_PROVIDER
FEATURE_LLM_INTENT
FEATURE_LLM_EXPLANATIONS
FEATURE_EXPERIMENTS
FEATURE_MODEL_TRAINING
FEATURE_CREATOR_FEEDS
FEATURE_CONVERSATIONAL_ONBOARDING
FEATURE_STREAMING_GENERATION_UI
FEATURE_REFINEMENT_THREAD
FEATURE_TASTE_MAP
FEATURE_TASTE_EMBEDDINGS
FEATURE_LLM_JUDGE
```

Operational kill switches must disable:

- a candidate provider;
- all destination exports;
- LLM calls;
- a model version;
- a compromised source dataset.

Flags are server-enforced.

---

# 18. Testing Strategy

## 18.1 Test pyramid

### Unit

- profile updates;
- feedback weights;
- novelty calculation;
- fit scoring;
- final weight math;
- dedupe;
- resolution scoring;
- constraints;
- explanation validation;
- license eligibility;
- retention calculations;
- token encryption helpers.

### Property/invariant tests

Use generated data to assert:

- hard blocks are never selected;
- selected recording IDs are unique;
- probabilities remain 0–1;
- no list exceeds artist caps unless a logged relaxation occurs;
- the final score is deterministic for identical snapshots/seeds;
- raising discovery generally does not increase direct seed-artist concentration;
- unknown feature absence is not treated as dislike;
- revisions do not double-count feedback;
- prohibited provider data cannot be training eligible;
- Spotify-sourced rows never enter recommendation snapshots.

### Integration

Use a real ephemeral PostgreSQL database:

- migrations;
- transaction behavior;
- queue jobs;
- ownership;
- idempotency;
- deletion propagation;
- provider caching;
- export state machine;
- RLS/repository scoping.

### Contract

Mock each external provider from official response fixtures and malformed variants.

### End-to-end

Playwright:

1. Create account.
2. Complete onboarding.
3. Generate playlist.
4. Inspect explanation.
5. Submit feedback.
6. Regenerate.
7. Save playlist.
8. export CSV.
9. Connect mocked Spotify.
10. review ambiguous match.
11. complete private export.
12. disconnect.
13. request personal data export.
14. request deletion.

### Security

- CSRF;
- session fixation;
- OAuth state mismatch;
- callback replay;
- IDOR;
- admin access;
- rate-limit bypass;
- SSRF attempts;
- stored/reflected XSS through titles/free text;
- SQL injection;
- prompt injection;
- token/log leakage;
- secret scanning.

### Accessibility

- automated axe scans;
- keyboard scripts;
- manual screen-reader checklist;
- focus management during async status changes;
- reduced-motion.

## 18.2 Recommendation golden fixtures

Create small synthetic catalogs where expected behavior is obvious:

- candidate shares preferred feature;
- candidate triggers aversion;
- known track;
- same artist duplicate;
- sparse metadata;
- context mismatch;
- high discovery bridge;
- provider disagreement;
- low-confidence novelty;
- license-ineligible feature.

Golden tests should assert ranking rationale, not freeze an entire opaque ordering unnecessarily.

## 18.3 Policy boundary tests

`pnpm policy:check` must:

- build the package dependency graph;
- reject recommender → Spotify imports;
- scan feature/training SQL for Spotify tables or provider labels;
- verify all enabled features have license registry entries;
- verify Spotify scopes match an allowlist;
- verify no prohibited endpoint strings are referenced;
- verify preview/audio-feature schemas do not exist in the adapter;
- verify destination cache tables have expiry fields;
- verify deletion jobs include destination data.

Make this a blocking CI job.

## 18.4 Migration tests

For every migration:

- apply from an empty DB;
- apply from previous release snapshot;
- run constraints;
- run representative queries;
- test rollback where safe;
- verify no credential table data is copied into analytics schemas.

## 18.5 Performance tests

Before beta:

- 100 concurrent web users;
- burst of recommendation jobs;
- provider latency/failure simulation;
- 429 export simulation;
- large feedback history;
- 500–800 candidate ranking;
- deletion batch;
- catalog search latency.

Set budgets after measurement. Optimize based on profiles, not intuition.

## 18.6 Test data policy

- Synthetic users only.
- No real OAuth tokens.
- No production playlist content in fixtures.
- Provider fixtures minimized and license reviewed.
- Seed catalog may use clearly fictional artists/recordings.
- Production data is never copied to developer machines by default.

---

# 19. Local Development and Operations

## 19.1 Environment variables

`.env.example`:

```dotenv
NODE_ENV=development
APP_BASE_URL=http://127.0.0.1:3000

DATABASE_URL=postgresql://resonance:resonance@postgres:5432/resonance
AUTH_SECRET=replace-with-generated-secret
TOKEN_ENCRYPTION_KEY_B64=replace-with-32-byte-key
TOKEN_ENCRYPTION_KEY_VERSION=v1

EMAIL_PROVIDER=local
EMAIL_FROM=login@example.test
RESEND_API_KEY=

MUSICBRAINZ_BASE_URL=https://musicbrainz.org/ws/2
MUSICBRAINZ_USER_AGENT=Resonance/dev contact@example.test

LISTENBRAINZ_BASE_URL=https://api.listenbrainz.org
LISTENBRAINZ_TOKEN=

SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/v1/connections/spotify/callback

LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL_INTENT=
LLM_MODEL_EXPLANATION=

FEATURE_SPOTIFY_EXPORT=false
FEATURE_LISTENBRAINZ_PROVIDER=false
FEATURE_LLM_INTENT=false
FEATURE_LLM_EXPLANATIONS=false
FEATURE_EXPERIMENTS=false
FEATURE_MODEL_TRAINING=false

OTEL_EXPORTER_OTLP_ENDPOINT=
SENTRY_DSN=
LOG_LEVEL=info
```

Use a secure secret manager outside local development.

## 19.2 Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm policy:check
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:reset
pnpm check
```

`pnpm check` runs all blocking static checks and the appropriate test suite.

## 19.3 Docker Compose

Services:

- `web`
- `worker`
- `postgres`
- `mailpit` or equivalent local mail catcher
- optional local telemetry collector

External providers are mocked by default in automated environments.

## 19.4 Seed data

Provide:

- 100–500 fictional or clearly permitted canonical recordings;
- feature/provenance/license examples;
- three demo personas;
- positive/negative seeds;
- provider candidates;
- feedback histories;
- export resolution scenarios;
- experiment assignments.

The demo must exercise degraded and ambiguous states.

## 19.5 Runbooks

Required:

- deploy/rollback;
- database restore;
- rotate OAuth encryption key;
- rotate provider credentials;
- provider outage;
- queue backlog;
- purge destination cache;
- user deletion failure;
- disable compromised data source;
- disable ranker/model;
- Spotify policy change;
- security incident.

---

# 20. CI/CD and Environments

## 20.1 Environments

- Local
- CI
- Preview
- Staging
- Production

Use separate provider credentials and databases. Preview environments default to provider mocks and Spotify disabled.

## 20.2 Pull-request checks

Blocking:

- formatting;
- lint;
- typecheck;
- unit tests;
- integration tests;
- policy boundary tests;
- license scan;
- dependency vulnerability scan;
- migration validation;
- OpenAPI/schema diff;
- build;
- selected Playwright smoke tests.

## 20.3 Deployment

- Immutable artifact.
- Database migration as an explicit guarded step.
- Backward-compatible expand/migrate/contract sequence for risky changes.
- Health checks.
- Progressive rollout.
- Feature flags default off for high-risk integrations.
- Automatic rollback only when safe.
- Post-deploy smoke tests.
- Release notes include model/ranker/provider changes.

## 20.4 Data/model release discipline

A ranker/model release records:

- version;
- code commit;
- feature registry version;
- training dataset lineage if applicable;
- offline metrics;
- experiment result;
- approving owner;
- rollback version.

No silent ranker changes.



---

# 21. Milestone Plan

Milestones are ordered by dependency and risk, not by calendar promises. Claude must complete acceptance criteria before proceeding.

## Milestone 0 — Compliance skeleton and repository foundation

### Goal

Create a secure, testable monorepo that makes prohibited data flow structurally difficult.

### Deliverables

- Monorepo and package boundaries.
- Next.js web shell.
- Worker shell.
- PostgreSQL and migration tooling.
- Postgres-backed queue.
- Shared config and validation.
- Structured logging.
- Dev container and Docker Compose.
- CI pipeline.
- `CLAUDE.md`.
- Initial ADRs:
  - service-neutral core;
  - Spotify export-only;
  - modular monolith;
  - canonical IDs;
  - deterministic ranker first;
  - provenance/license registry;
  - first-party auth.
- Machine-readable data-source registry.
- Policy-boundary script and test.
- Health endpoints.
- `.env.example`.
- Security headers.
- Synthetic seed data.

### Acceptance criteria

- `pnpm install` succeeds from a clean checkout.
- `pnpm dev` starts web, worker, database, and local email.
- `/health/live` and `/health/ready` behave correctly.
- `pnpm check` passes.
- CI passes on a fresh branch.
- A deliberate recommender → Spotify import causes `pnpm policy:check` to fail.
- A deliberately model-eligible Spotify feature fixture causes a test failure.
- No real provider credentials are needed.
- No external provider call occurs in default test runs.
- Dependency graph is documented.
- Threat-model skeleton exists.
- License registry defaults unknown uses to prohibited.
- There are no unowned TODOs for security-critical code.

### Exit gate

Repository can enforce the central compliance decision before product logic is added.

---

## Milestone 1 — Identity, consent, catalog, and onboarding

### Goal

A user can create an independent account and declare a useful taste profile from eligible canonical catalog data.

### Deliverables

- First-party authentication.
- Session management and logout.
- Consent records and policy versioning.
- User settings.
- Catalog tables and MusicBrainz adapter.
- Provider rate limiting and cache.
- Catalog search.
- Canonical entity selection and disambiguation.
- Positive/negative seed UI.
- Context profile UI.
- Discovery slider and restrictions.
- Onboarding review.
- Data export/deletion request skeleton.
- Accessibility baseline.

### Acceptance criteria

- User can complete onboarding without Spotify.
- At least 5 positive and 3 negative seeds can be recorded.
- Strong positive, hard block, fatigue, and context-specific distinctions persist.
- Search results show canonical disambiguation.
- Every catalog field shown has provenance and an approved display license.
- Supplementary/noncommercial data is disabled unless licensed.
- Provider 429/timeout/malformed responses are tested.
- Session and IDOR security tests pass.
- Keyboard-only onboarding is complete.
- Consent withdrawal creates a new record rather than mutating history.
- User can delete a seed and trigger profile recomputation.
- No destination-service fields exist in taste tables.

### Exit gate

A complete, privacy-aware taste declaration exists from independent sources.

---

## Milestone 2 — Recommendation engine v0

### Goal

Generate a reproducible 20-track service-neutral playlist with honest novelty estimates and evidence-backed explanations.

### Deliverables

- Candidate-provider interface.
- Synthetic/mock candidate provider.
- Approved provider adapter behind a flag.
- Candidate canonicalization and dedupe.
- Hard filters.
- Taste posterior/evidence computation.
- Novelty heuristic.
- Fit/serendipity/final scoring.
- MMR/diversity selector.
- Explanation templates.
- Asynchronous run/job lifecycle.
- Recommendation run API.
- Run UI with progress/degraded states.
- Full decision trace.
- Offline evaluation harness with synthetic fixtures.

### Acceptance criteria

- Same snapshot + random seed yields the same playlist.
- Hard-blocked recordings/artists never appear.
- Exact duplicates never appear.
- Default 20-track list respects artist caps or records an explicit relaxation.
- Discovery 100 produces measurably less direct-seed concentration than Discovery 0 in golden fixtures.
- “Unknown” metadata is not interpreted as a negative feature.
- Every item has at least one valid evidence record or is omitted.
- No explanation contains unsupported claims.
- Spotify package is not loaded during recommendation.
- Recommendation can succeed with Spotify flag off and Spotify credentials absent.
- Provider failure creates a degraded run when fallback coverage is sufficient.
- Full failure gives a safe, actionable error.
- Candidate and ranking snapshots are reproducible.
- Unit, property, integration, and E2E tests pass.

### Exit gate

The product can independently produce a credible first playlist.

---

## Milestone 3 — Feedback loop, playlists, and file export

### Goal

Turn recommendations into a first-party learning loop and durable service-neutral product.

### Deliverables

- Feedback UI and API.
- Append-only feedback events and reversal.
- Newness confirmation.
- Known-recording ledger.
- Preference evidence updates.
- Context-sensitive “Not now.”
- Saved playlists.
- Track replacement/regeneration.
- CSV export.
- M3U export.
- Analytics event schemas.
- First funnel dashboard/query.
- Data export and deletion implementation for core data.

### Acceptance criteria

- Duplicate feedback requests are idempotent.
- Revised feedback does not double-count.
- “Already knew” updates novelty but not taste.
- “Not now” affects context more than global preference.
- Reason-code updates occur only when matching eligible features exist.
- User can preserve loved tracks while replacing disliked tracks.
- CSV/M3U exports work without a destination connection.
- User deletion removes or irreversibly anonymizes personal taste/feedback as specified.
- Derived profiles are rebuilt or removed after deletion/withdrawal.
- Analytics events contain no raw free text, email, or provider payload.
- First-party feedback improves expected rankings in golden scenarios.
- Accessibility and mobile feedback flows pass.

### Exit gate

The core moat—first-party exposure, reason, and outcome data—is being collected with consent and lineage.

---

## Milestone 4 — Spotify export pilot

### Goal

Allow the authorized pilot to export a canonical playlist to a private Spotify playlist without weakening the compliance firewall.

### Deliverables

- OAuth Authorization Code + PKCE.
- Minimal scope.
- Encrypted token storage.
- Token refresh/reauthorization.
- ISRC-first resolution.
- Artist/title/duration fallback.
- Match review UI.
- Private playlist creation.
- Item insertion.
- Rate-limit/retry handling.
- Export state machine.
- Ambiguous-request handling.
- Disconnect and data purge.
- Spotify-specific audit/metrics.
- Mock contract suite.
- Pilot allowlist consistent with Development Mode.

### Acceptance criteria

- Spotify is optional and disabled by default outside the pilot.
- Only allowed endpoint/scope strings exist.
- OAuth state mismatch and replay fail safely.
- Tokens never appear in logs/client/API responses.
- Exact ISRC mapping works.
- Ambiguous matches require confirmation.
- Unresolved tracks remain in the canonical playlist.
- Export retries do not automatically duplicate known-completed batches.
- Ambiguous network completion does not trigger a blind retry.
- `429` honors `Retry-After`.
- `invalid_grant` triggers reauthorization.
- Disconnect deletes tokens and destination personal data within the required process.
- Existing Spotify-created playlist is not falsely reported as deleted.
- Recommendation output is byte-for-byte unchanged whether Spotify is connected or not.
- `pnpm policy:check` passes.
- A manual pilot checklist is signed.

### Exit gate

Export works for the constrained pilot and has a documented path to removal if policy/access changes.

---

## Milestone 5 — Measurement, experimentation, and admin operations

### Goal

Prove recommendation value and operate the system responsibly.

### Deliverables

- Experiment definitions and sticky assignment.
- Control/treatment baseline.
- Metric definitions as code.
- Recommendation Quality Report.
- Provider/source yield dashboard.
- Novelty calibration dashboard.
- Export diagnostics.
- Provider health and kill switches.
- Admin RBAC and audit.
- Deletion SLA dashboard.
- Incident runbooks.
- Data-retention jobs.
- Security review.

### Acceptance criteria

- Experiment assignment is stable and tested.
- Primary and guardrail metrics reproduce from versioned queries.
- User-level randomization has no obvious sample-ratio mismatch.
- Known-track leakage and novelty calibration are reported.
- Source contribution is measurable.
- Admin cannot decrypt OAuth tokens.
- Sensitive admin actions are audited.
- Provider kill switch works without deployment.
- Expired destination cache is purged and monitored.
- Recommendation Quality Report can be regenerated from a clean analytics environment.
- Security, privacy, and policy review findings are closed or explicitly accepted by an owner.

### Exit gate

The team can answer whether the product is better than a fair baseline.

---

## Milestone 6 — Private beta hardening and platform-access readiness

### Goal

Prepare for a larger independent beta while treating Spotify extended access as uncertain.

### Deliverables

- Load/performance testing.
- Restore drill.
- Encryption-key rotation drill.
- Abuse controls.
- Support tooling.
- Privacy/EULA/Terms finalization.
- Commercial data-license decisions.
- Platform-policy review.
- Extended-access application package if justified.
- Non-Spotify acquisition and export path.
- Beta cohort dashboard.
- User interview process.
- Data-room foundations.

### Acceptance criteria

- Core beta works with no Spotify connection.
- Recommendation and feedback systems meet measured latency/reliability budgets.
- Restore and key-rotation drills succeed.
- Deletion requests complete and are verified.
- No unresolved critical/high security findings.
- Licensing review covers every enabled data source.
- Marketing claims match measured evidence.
- Support can resolve account/export issues without accessing decrypted tokens.
- A Spotify access denial would not invalidate the business.
- Platform application accurately describes the data architecture and constraints.
- Pilot metrics show a reason to scale.

### Exit gate

The company has independent product value and credible operating discipline.

---

## Milestone 7 — Learned ranking from first-party data

### Goal

Improve ranking with a carefully governed first-party model.

### Preconditions

- Minimum labeled-data threshold defined and met.
- Model-improvement consent and deletion propagation verified.
- Training source whitelist approved.
- Temporal holdout built.
- Feature leakage tests pass.
- Baseline online experiment complete.
- Rollback path tested.

### Deliverables

- Dataset builder with provenance assertions.
- Baseline logistic model.
- Calibration.
- Model registry.
- Offline comparison.
- Shadow deployment.
- Online experiment.
- Model card.
- Deletion/retraining policy.

### Acceptance criteria

- Training dataset contains no Spotify data or ineligible source.
- Dataset lineage is reproducible.
- No future leakage.
- Model beats deterministic baseline offline on predeclared metrics.
- Shadow predictions are monitored.
- Online treatment improves the primary metric or a validated proxy without violating guardrails.
- Rollback is one feature-flag change.
- User deletion prevents future use and follows the documented derived-data policy.
- Model card identifies limitations and cohort disparities.

### Exit gate

Machine learning adds measured value rather than complexity theater.

---

# 22. Definition of Done

A feature is done only when:

- acceptance criteria pass;
- types and schemas are explicit;
- authorization is server-enforced;
- privacy and license effects are documented;
- telemetry is added without sensitive leakage;
- failure/degraded states work;
- tests cover happy, failure, and abuse paths;
- accessibility is checked;
- documentation and OpenAPI are updated;
- migrations are validated;
- feature flag/rollback exists when risk warrants;
- no critical TODO is left;
- code is reviewed;
- `pnpm check` passes.

A recommendation-model change additionally requires:

- version bump;
- offline report;
- evidence/provenance review;
- experiment or justified emergency path;
- rollback version;
- change note.

An external integration additionally requires:

- current official docs review;
- license/policy review;
- timeouts;
- retries;
- rate limits;
- schema validation;
- kill switch;
- contract tests;
- data retention/purge;
- runbook.

---

# 23. Risk Register

| Risk | Likelihood | Impact | Early warning | Mitigation |
|---|---|---:|---|---|
| Spotify policy/access changes | High | Critical | Changelog, approval delay, endpoint errors | Service-neutral core; export flag; quarterly review; no Spotify-derived model |
| Development Mode cannot support growth | Certain for scaled use | High | Authorized-user limit | Core works without Spotify; apply for extended access only after evidence |
| Product considered a core-experience replacement | Medium | High | Platform feedback/denial | No streaming; cross-service positioning; legal/platform review |
| Open-data license mismatch | Medium | Critical | Unknown provenance, commercial transition | Field-level registry; default deny; commercial agreements |
| Candidate quality is weak | High early | High | Low love/newness rate | Multiple providers; feedback loop; source-yield measurement; curator supply |
| Cold start | High | High | Abandonment, generic first list | Rich seed/aversion onboarding; pairwise quiz; context; honest degraded state |
| “Unheard” claim is wrong | High without ledger | High trust cost | Already-knew rate | Probabilistic labels; explicit confirmation; calibration |
| Sparse metadata | High | Medium | Low explanation coverage | Confidence-aware scoring; provider diversity; omit unsupported claims |
| Entity-resolution errors | Medium | High | User corrections, wrong exports | MBID/ISRC; title/artist/duration; thresholds; manual confirmation |
| Filter bubble | Medium | High | Artist/tag concentration | Discovery slider; quotas; MMR; strategy exploration |
| Random novelty/no fit | Medium | High | Dislike rate rises with discovery | Serendipity bridge; fit floor; bandit guardrails |
| LLM hallucinations | High if unconstrained | High | Unsupported explanations | Structured evidence; validator; template fallback; no LLM candidate source |
| Prompt injection | Medium | High | Malformed output/tool attempts | No mutating tools; untrusted-data isolation; schema checks |
| OAuth token compromise | Low/medium | Critical | Secret alerts, unusual exports | Encryption, least privilege, restricted roles, rotation, incident plan |
| Data deletion fails to propagate | Medium | Critical | SLA misses, residual profiles | Lineage; deletion jobs; verification report; tests |
| Creator manipulation/payola | Medium later | High | Source anomaly, complaints | No paid rank; disclosure; source caps; reputation; audits |
| Popularity bias | High | Medium | Recommendations converge to hits | Long-tail source, popularity-band controls, quality ≠ popularity |
| Provider outage/rate limit | High | Medium | 429/latency/error rate | Caches, backoff, circuit breakers, fallback, degraded mode |
| Vendor lock-in | Medium | High | Provider-specific features spread | Adapter interfaces; canonical IDs; feature registry |
| Insufficient first-party labels | High early | High | Low feedback completion | Low-friction feedback; visible learning value; do not train prematurely |
| Overfitting power users | Medium | Medium | Cohort disparity | Cohort reports; weighting; cold-start-specific logic |
| Privacy backlash | Medium | High | Opt-outs, complaints | Minimize, explain, consent, user controls, no sensitive inference |
| Security/supply-chain incident | Medium | Critical | Scanner/monitor alert | Locked deps, scanning, SBOM, restricted CI, runbooks |
| Acquisition thesis depends on one buyer | Medium | High | Roadmap bends to Spotify only | Multi-service engine; consumer/B2B value; independent revenue |
| Metrics optimize feedback rather than love | Medium | Medium | Feedback rises, durable outcomes flat | CNL/WAU and repeat outcomes; causal tests |
| Catalog spam/poisoning | Medium | High | anomalous candidates | Source trust, canonical verification, anomaly controls |
| Legal/commercial model conflict | Medium | Critical | counsel/provider objection | Review before monetization; separate data classes; disable flags |

Risk owners and review dates belong in `docs/risk-register.md`. Critical risks are reviewed at every release.

---

# 24. Defensibility and Acquisition Strategy

## 24.1 What cannot be protected effectively

The general idea—“recommend unfamiliar music based on taste”—is not a durable moat by itself. A large platform can reproduce surface features.

Do not rely on:

- secrecy of the concept;
- a generic LLM prompt;
- a thin Spotify API wrapper;
- a UI feature;
- patents as the sole defense;
- assumed platform partnership;
- vanity user counts without retention or quality evidence.

## 24.2 The compounding moat

### First-party outcome graph

For every recommendation:

```text
user/context
→ candidate source
→ canonical recording
→ evidence and score
→ novelty estimate
→ exposure
→ newness confirmation
→ reason-coded preference
→ later durability outcome
```

This is more valuable than a simple “liked song” table because it contains counterfactual and decision context.

### Taste semantics

Build a vocabulary connecting:

- explicit language users use;
- catalog features;
- positive and negative reasons;
- context;
- exploration tolerance;
- temporal changes.

The semantics, data-cleaning process, and calibrated mappings can be trade secrets.

### Entity-resolution graph

Reliable cross-service identity is difficult and valuable:

- recording/version equivalence;
- ISRC/MBID mapping;
- correction history;
- confidence labels;
- destination resolution performance.

Keep corrections and adjudication workflows proprietary while respecting source licenses.

### Experiment evidence

A buyer should be able to see:

- fair baseline;
- incremental lift;
- stable cohort retention;
- novelty calibration;
- source contribution;
- long-tail/creator impact;
- model performance by maturity/context;
- no platform-policy contamination.

### Distribution and community

Later defensibility may include:

- discovery rituals;
- curator communities;
- creator supply;
- shared taste-language;
- trusted brand;
- multi-service portability.

### Operational trust

Security, privacy, provenance, and platform compliance can become an advantage. A buyer does not want an attractive dataset that cannot legally be used.

## 24.3 Protecting intellectual property

Operational actions:

1. Company owns code, models, documentation, and inventions through signed founder/employee/contractor IP assignment.
2. Repositories and production data use least privilege.
3. Confidential algorithms, source-yield data, curation processes, and unreleased metrics are marked and handled as trade secrets.
4. Contractor access is scoped and removed promptly.
5. Public demos reveal outcomes and experience, not sensitive implementation details.
6. Open-source dependencies and contributions are inventoried.
7. Trademarks/domain strategy is reviewed after product naming.
8. Patent counsel evaluates genuinely novel, specific methods before public disclosure; do not assume broad recommendation concepts are patentable.
9. Dataset rights and user terms clearly cover the intended first-party personalization/model uses, with privacy choices and deletion.
10. Before sending detailed product or algorithm “feedback” to a platform, review its feedback-assignment terms. Do not disclose confidential implementation details through generic feedback channels.
11. Keep a dated invention/decision record and ADR history.
12. Do not use NDAs as a substitute for execution, access control, or data rights.

## 24.4 Buyer-value scorecard

Track a quarterly scorecard:

### Product

- WAU/MAU;
- D7, D30, and 8-week discovery retention;
- playlists evaluated per active user;
- feedback completion;
- CNL/WAU;
- durable new-love conversion.

### Recommendation advantage

- treatment lift over baseline;
- novelty precision/calibration;
- love-rate calibration;
- source yield;
- artist/catalog coverage;
- diversity without dislike penalty;
- performance for cold-start and mature users.

### Strategic assets

- consented first-party labeled events;
- users with enough evidence for reliable personalization;
- canonical recording coverage;
- correction/adjudication count;
- provider and curator partnerships;
- destination adapter coverage;
- proprietary models/processes;
- IP and licensing cleanliness.

### Creator ecosystem

- unique artists discovered;
- share of new loves going to long-tail artists;
- follow-on engagement;
- discovery distribution;
- partner retention;
- manipulation/fraud rate.

### Operations

- security/privacy audit status;
- deletion compliance;
- uptime and generation success;
- provider dependence;
- gross margin and provider cost per successful discovery.

## 24.5 Acquisition narrative

Do not pitch:

> “We built an AI playlist maker for Spotify.”

Pitch:

> “We built a cross-service discovery and taste engine that predicts which unfamiliar recordings become durable favorites. It learns from a consented, reason-coded first-party outcome graph, resolves music identities across catalogs, and has demonstrated causal lift over matched discovery baselines.”

Potential strategic value:

- recommendation quality;
- cold-start personalization;
- explicit negative preference learning;
- cross-context taste;
- long-tail/creator discovery;
- explainability and trust;
- cross-service entity resolution;
- high-intent discovery audience;
- team/talent.

## 24.6 Independent business value

Build a company that does not require acquisition.

Potential models:

- consumer subscription for high-quality discovery;
- premium discovery modes and context profiles;
- B2B recommendation API using only appropriately licensed data;
- white-label discovery for catalogs/services;
- privacy-preserving aggregate creator insights;
- curator tools;
- artist discovery partnerships with clear disclosures.

Avoid:

- undisclosed paid placement;
- selling individual taste histories;
- training/licensing data beyond consent and source rights;
- business models that make user trust incompatible with ranking quality.

## 24.7 Due-diligence readiness

Maintain a data room containing:

- cap table and IP assignments;
- source-code ownership;
- open-source/license inventory;
- data-source licenses;
- user Terms/Privacy versions;
- consent architecture;
- security policies and incidents;
- platform approvals;
- model cards and dataset lineage;
- experiment reports;
- retention/cohort metrics;
- provider contracts;
- architecture/ADRs;
- privacy deletion evidence;
- financial and cost metrics.

Clean provenance can materially affect whether an acquirer can use the product’s assets.

---

# 25. Product Decisions and Open Gates

These defaults let Claude build without waiting for clarification.

| Decision | Default |
|---|---|
| Product name | `Resonance` as codename only |
| Core account | First-party account, independent of destinations |
| Initial playlist size | 20 |
| Default discovery level | 60 |
| Default export privacy | Private |
| Spotify role | Export-only pilot adapter |
| Primary catalog identity | MusicBrainz MBID + internal UUID |
| Secondary resolution key | ISRC |
| Recommendation v0 | Explainable hybrid heuristic |
| LLM role | Interface/interpretation layer per §10.20; never a candidate or catalog source |
| Queue | PostgreSQL-backed |
| Architecture | Modular monolith |
| Initial analytics | First-party/event warehouse path; no arbitrary PII |
| Initial rollout | Small private beta |
| Initial geography | One legally reviewed market before expansion |
| Commercial supplementary metadata | Disabled until licensed |
| Model training | Disabled until Milestone 7 gate |
| Paid placement | Prohibited |

### Founder/legal gates before public commercialization

- final company/product name;
- launch geography;
- Terms and Privacy Policy;
- data-source commercial licenses;
- app-store/mobile considerations if applicable;
- Spotify extended-access decision;
- user age floor;
- creator partnership terms;
- model-improvement consent wording;
- insurance and incident obligations.

These gates should not block local MVP engineering unless they change a data-use assumption.

---

# 26. Architecture Decision Records to Create

Claude must create these under `docs/adr/`:

1. `0001-service-neutral-recommendation-core.md`
2. `0002-spotify-export-only-boundary.md`
3. `0003-modular-monolith.md`
4. `0004-first-party-authentication.md`
5. `0005-canonical-recording-identity.md`
6. `0006-field-level-provenance-and-license.md`
7. `0007-deterministic-ranker-before-ml.md`
8. `0008-postgres-backed-jobs.md`
9. `0009-append-only-feedback.md`
10. `0010-honest-novelty-states.md`
11. `0011-evidence-only-explanations.md`
12. `0012-oauth-token-encryption.md`
13. `0013-analytics-data-minimization.md`
14. `0014-model-training-governance.md`
15. `0015-llm-interface-layer-boundaries.md` — the Software 3.0 contract of §10.20: LLM edits data, never state; deterministic core, probabilistic shell.
16. `0016-first-party-taste-language-embeddings.md` — eligible text sources, embedding versioning, provenance, and prohibited inputs.
17. `0017-generative-ui-component-registry.md` — LLM may compose copy and select registered components; may not compose interface structure or controls.

ADR template:

```markdown
# ADR NNNN — Title

- Status:
- Date:
- Owners:
- Related policies/licenses:

## Context

## Decision

## Alternatives considered

## Consequences

### Positive

### Negative

## Security/privacy/license effects

## Verification

## Revisit triggers
```

---

# 27. Suggested `CLAUDE.md`

Create the repository’s root `CLAUDE.md` with concise, persistent instructions like the following:

```markdown
# Resonance Engineering Instructions

## Mission

Build a service-neutral music discovery engine that optimizes confirmed new loves.

## Absolute constraints

- Never use Spotify data for recommendation features, taste profiles, analytics of taste, or model training.
- Spotify exists only in `packages/integrations/spotify` for OAuth, temporary track resolution, and playlist export.
- `packages/recommender` may not import any destination integration.
- All catalog features require provenance, a license-policy version, and eligibility flags.
- Unknown license/provenance means ineligible.
- Never claim a track is unheard unless the user confirms it.
- Explanations must reference stored evidence; never invent musical properties.
- Core product must work with `FEATURE_SPOTIFY_EXPORT=false`.
- No secrets, tokens, personal email, raw free text, or provider payloads in logs.
- Do not add microservices or infrastructure without an ADR and measured need.

## Workflow

1. Read the active milestone and relevant ADRs.
2. Write an implementation plan.
3. Add/update tests.
4. Implement the smallest coherent vertical slice.
5. Run `pnpm check`.
6. Update API docs, data dictionary, ADRs, and runbooks.
7. Report changes, tests, and unresolved risks.

## Required commands

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm policy:check`
- `pnpm check`

## Code standards

- Strict TypeScript.
- Zod at trust boundaries.
- Domain code independent of Next.js.
- Append-only personal evidence where history/reversal matters.
- UTC `timestamptz`.
- Idempotency for retryable mutations.
- Structured redacted logs.
- Explicit failure states.
- Accessible UI.
- Synthetic test data only.

## Before changing recommendation logic

- Version the ranker/selector.
- Preserve reproducibility.
- Add golden/invariant tests.
- Document metric and guardrail effects.
- Confirm every feature’s eligibility.

## Before changing an external integration

- Read current official docs.
- Verify policy/license.
- Add timeout, rate limit, retry, kill switch, schema validation, contract tests, and purge behavior.
```

Keep `CLAUDE.md` short enough to remain salient. Put detailed rules in linked docs rather than duplicating this entire specification.

---

# 28. Claude Code Execution Strategy

## 28.1 Suggested specialist agents

Use focused agents/worktrees only when they reduce conflict:

- **Architecture/compliance agent:** package boundaries, ADRs, provenance registry, policy tests.
- **Data agent:** schema, migrations, repositories, deletion lineage.
- **Recommendation agent:** candidate pipeline, ranker, selector, evaluation.
- **Integration agent:** provider adapters and Spotify export.
- **UX/accessibility agent:** onboarding, playlist, feedback.
- **QA/security agent:** invariants, E2E, threat model, abuse tests.

One coordinating agent owns interfaces and integration. Do not let multiple agents independently redefine shared schemas.

## 28.2 Hooks

Useful hooks may:

- run formatting on changed files;
- block completion when `pnpm policy:check` fails;
- run focused tests after package edits;
- warn on edits to credential or policy-registry code;
- detect secrets.

Hooks must not execute untrusted repository text as shell commands. Keep them deterministic and reviewed.

## 28.3 First implementation prompt for Claude

```text
Read `music-taste-engine-claude-build-spec.md` and the root `CLAUDE.md`.
Implement Milestone 0 only.

Before editing:
1. Summarize the architecture and the Spotify compliance boundary.
2. Propose the exact repository tree and dependency direction.
3. List ADRs and policy tests to create.
4. Identify any specification conflict.

Then implement a clean TypeScript pnpm/Turborepo modular-monolith skeleton with
Next.js, a worker, PostgreSQL/Drizzle, a Postgres-backed job queue, strict linting,
Vitest, Playwright scaffolding, Docker Compose, a dev container, CI, structured
logging, Zod configuration, a source-license registry, and a blocking
`pnpm policy:check`.

Use synthetic fixtures only. Do not add real Spotify functionality. Do not proceed
to Milestone 1. Run all checks and report results, files changed, and remaining
Milestone 0 risks.
```

## 28.4 Subsequent milestone prompt template

```text
Read the active specification, `CLAUDE.md`, existing ADRs, and the prior milestone
completion report. Implement Milestone <N> only.

Start with:
- current-state inspection;
- plan;
- affected data/policy/privacy boundaries;
- acceptance-test mapping.

Implement vertical slices, add tests, run `pnpm check`, update documentation, and
provide a completion report. Do not begin Milestone <N+1>. Do not weaken existing
policy tests or skip failing checks.
```

## 28.5 Code-review prompt

```text
Review this change as a skeptical staff engineer, privacy engineer, and music-data
licensing reviewer.

Check:
- Spotify data boundary;
- provenance/license eligibility;
- authentication/authorization;
- token or PII leakage;
- idempotency and failure states;
- recommendation invariants;
- evidence-only explanations;
- deletion propagation;
- accessibility;
- tests and observability.

Report concrete issues by severity with file/line references. Do not approve based
only on happy-path behavior.
```

## 28.6 Recommendation-change prompt

```text
Evaluate this recommendation change against the deterministic baseline.

Require:
- explicit hypothesis;
- feature provenance;
- leakage review;
- versioned ranker/selector;
- golden and property tests;
- offline temporal evaluation;
- novelty, diversity, aversion, and calibration guardrails;
- rollback plan.

Reject any feature derived from Spotify or a source without approved model/
recommendation eligibility.
```

---

# 29. Implementation Backlog

Order within milestones may use these work items.

## Foundation

- [ ] Initialize pnpm/Turbo workspace.
- [ ] Add strict TypeScript configs.
- [ ] Add lint/format.
- [ ] Add web and worker.
- [ ] Add DB/Drizzle/migrations.
- [ ] Add queue.
- [ ] Add config schemas.
- [ ] Add structured logging.
- [ ] Add dev container/Compose.
- [ ] Add CI.
- [ ] Add ADRs.
- [ ] Add source/license registry.
- [ ] Add dependency-boundary checks.
- [ ] Add security headers.
- [ ] Add synthetic fixtures.

## Identity and taste

- [ ] Account auth.
- [ ] Session lifecycle.
- [ ] Consent records.
- [ ] User settings.
- [ ] Catalog schema.
- [ ] MusicBrainz adapter.
- [ ] Catalog search/disambiguation.
- [ ] Seed CRUD.
- [ ] Context CRUD.
- [ ] Onboarding UI.
- [ ] Privacy center.

## Recommendation

- [ ] Candidate interfaces.
- [ ] Mock provider.
- [ ] Approved provider adapter.
- [ ] Candidate normalization.
- [ ] Dedupe/equivalence.
- [ ] Hard filters.
- [ ] Taste posterior.
- [ ] Novelty estimate.
- [ ] Score components.
- [ ] MMR selector.
- [ ] Explanation evidence/templates.
- [ ] Job lifecycle.
- [ ] Run API/UI.
- [ ] Reproducibility snapshot.
- [ ] Evaluation harness.

## Feedback and playlist

- [ ] Exposure tracking.
- [ ] Feedback API/UI.
- [ ] Revision semantics.
- [ ] Known/new ledger.
- [ ] Preference update worker.
- [ ] Saved playlist.
- [ ] Replacement/regeneration.
- [ ] CSV/M3U.
- [ ] Core analytics events.
- [ ] Data deletion propagation.

## Spotify pilot

- [ ] OAuth/PKCE/state.
- [ ] Token encryption.
- [ ] Refresh/reauthorization.
- [ ] ISRC resolution.
- [ ] Fuzzy fallback.
- [ ] Review UI.
- [ ] Create private playlist.
- [ ] Insert items.
- [ ] Rate-limit/retry.
- [ ] Ambiguity handling.
- [ ] Disconnect/purge.
- [ ] Contract/policy tests.
- [ ] Pilot allowlist.

## Measurement/operations

- [ ] Experiment framework.
- [ ] Baseline arm.
- [ ] Metric queries.
- [ ] Quality report.
- [ ] Calibration.
- [ ] Provider dashboards.
- [ ] Admin RBAC.
- [ ] Kill switches.
- [ ] Incident runbooks.
- [ ] Retention jobs.
- [ ] Security review.
- [ ] Load/restore/rotation drills.

---

# 30. Go/No-Go Criteria

## Prototype → private alpha

Go only when:

- playlist generation works without Spotify;
- no hard-filter violations in test fixtures;
- explanations are evidence-backed;
- full decision trace exists;
- core deletion works;
- critical security basics pass.

## Private alpha → Spotify pilot

Go only when:

- policy boundary tests pass;
- OAuth/token threat model is reviewed;
- Spotify scopes/endpoints are minimal;
- contract suite passes;
- pilot user limit is enforced;
- disconnect purge is verified;
- product claims are compliant.

## Pilot → independent beta

Go only when:

- core value is observed without relying on Spotify;
- provisional new-love rate is measurable;
- known-track leakage is understood;
- candidate sources are commercially permitted;
- support/runbooks exist;
- no critical/high security issue remains;
- legal documents are approved.

## Beta → learned model

Go only when Milestone 7 preconditions are met.

## Beta → platform extended-access application

Go only when:

- a real, scalable use case is demonstrated;
- security/privacy/licensing standards are strong;
- integration is stable;
- creator/user benefits are clear;
- business remains viable if access is denied.

---

# 31. Example Acceptance Scenarios

## Scenario A — Balanced discovery

User loves two dream-pop artists, dislikes harsh vocals, and uses Discovery 60.

Expected:

- list includes adjacent and bridge candidates;
- no hard-blocked artist;
- harsh-vocal feature candidates excluded only when reliable metadata supports the feature;
- unknown vocal metadata handled according to restriction strictness;
- seed artists capped;
- explanations reference supported tags/relationships;
- novelty label is probabilistic.

## Scenario B — “Good, not now”

User likes a high-energy track in general but selects “Not now” in Focus.

Expected:

- global affinity remains positive;
- Focus context reduces similar high-energy candidates;
- later Workout context may still recommend them;
- explanation does not say the user dislikes the style globally.

## Scenario C — Already knew

A recommended track is marked “Already knew” and Love.

Expected:

- taste receives positive evidence;
- novelty ledger marks known;
- run does not count a new love;
- future novelty estimation changes;
- the user can still save the track.

## Scenario D — Sparse metadata

Candidate has reliable identity but few eligible features.

Expected:

- lower fit confidence;
- no invented explanation;
- may be selected as exploration only if source confidence is sufficient;
- UI explains limited evidence or omits detailed claims.

## Scenario E — Spotify unavailable

Spotify flag off or provider down.

Expected:

- recommendation unaffected;
- playlist can be saved;
- CSV/M3U works;
- export control shows unavailable;
- no generation error.

## Scenario F — Ambiguous Spotify match

Canonical track has no ISRC and two similar results.

Expected:

- export pauses at review;
- user sees limited temporary display information;
- manual choice affects only resolution;
- no choice is used as taste feedback.

## Scenario G — OAuth expiry

Refresh returns `invalid_grant`.

Expected:

- connection marked expired;
- canonical playlist preserved;
- user asked to reconnect;
- no retry loop;
- no token in logs.

## Scenario H — License disabled

A feature’s license registry changes to prohibited.

Expected:

- new recommendations cannot use it;
- feature snapshots identify old usage;
- cache/training pipeline responds according to policy;
- CI and admin diagnostics surface the change;
- model release is blocked until reevaluated.

---

# 32. Future Product Extensions

These require separate specifications and policy review.

## 32.1 Pairwise taste calibration

Show two independently sourced canonical recordings or descriptors and ask which direction is more appealing. Ensure the user can legally listen through destinations; do not host unauthorized audio.

## 32.2 Discovery clubs

Small groups share first-party discovery outcomes. Privacy defaults to private; no public taste profile without explicit action.

## 32.3 Creator submissions

Creators verify rights and submit canonical metadata. Submission does not guarantee recommendation. Separate commercial relationship from ranking.

## 32.4 Multi-service export

Implement adapters that accept the same canonical playlist contract. Each provider receives its own policy boundary, OAuth scopes, cache, and tests.

## 32.5 Licensed audio understanding

Only after rights are secured. Store embeddings/features, not raw audio where possible. Document training and derivative rights.

## 32.6 Taste portability

Allow user export of their explicit profile and first-party feedback in a documented schema. Do not include restricted third-party data.

## 32.7 Music-to-other-domain taste engine

Do not pursue until the music engine demonstrates repeatable value. Cross-domain taste is a separate research/product problem, not an automatic extension.

---

# 33. Current Platform Facts Driving This Specification

Verified against official sources on 2026-07-13; re-verify before implementation milestones involving external platforms.

1. Spotify’s Developer Policy prohibits using Spotify Platform or Spotify Content to train machine-learning/AI models and restricts analysis that creates user profiles.
2. Spotify Development Mode currently has strict eligibility and authorized-user limits and is not intended as a foundation for scaling a business.
3. Newer Development Mode apps do not have access to several former discovery endpoints, including Recommendations, Related Artists, Audio Features, and Audio Analysis.
4. Spotify’s playlist creation and item-addition endpoints remain relevant for export, with current names and limits documented in the Web API reference.
5. Spotify rate limiting uses a rolling window and `429`/`Retry-After`.
6. Spotify OAuth implementations must use current redirect-URI and security requirements.
7. Spotify refresh tokens now have a finite lifetime under the platform’s 2026 changes; applications need explicit reauthorization handling.
8. MusicBrainz core and supplementary datasets have materially different licenses.
9. MusicBrainz public API usage is rate limited and commercial-scale use needs a responsible access/data strategy.
10. ListenBrainz offers recommendation and metadata-related APIs, but each data class’s quality and use rights must be reviewed.
11. Claude Code supports persistent project instructions through `CLAUDE.md`, focused subagents/worktrees, hooks, and isolated development environments; these should support—not replace—code review and tests.

---

# 34. Official References

## Spotify

- Developer Policy: <https://developer.spotify.com/policy>
- Developer Terms: <https://developer.spotify.com/terms>
- February 2026 developer-access update: <https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security>
- February 2026 Web API changes/migration material: <https://developer.spotify.com/documentation/web-api>
- Building with AI guidance: <https://developer.spotify.com/documentation/web-api/tutorials/building-with-ai>
- Official Web API OpenAPI schema: <https://developer.spotify.com/reference/web-api/open-api-schema.yaml>
- Authorization concepts: <https://developer.spotify.com/documentation/web-api/concepts/authorization>
- Scopes: <https://developer.spotify.com/documentation/web-api/concepts/scopes>
- Rate limits: <https://developer.spotify.com/documentation/web-api/concepts/rate-limits>
- Create Playlist reference: <https://developer.spotify.com/documentation/web-api/reference/create-playlist>
- Add Items to Playlist reference: <https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist>
- Search reference: <https://developer.spotify.com/documentation/web-api/reference/search>

## MusicBrainz / MetaBrainz

- MusicBrainz database: <https://musicbrainz.org/doc/MusicBrainz_Database>
- API rate limiting: <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
- Data dumps and licenses: <https://metabrainz.org/datasets/postgres-dumps>
- Commercial services: <https://metabrainz.org/commercial>

## ListenBrainz

- Documentation: <https://listenbrainz.readthedocs.io/>
- API: <https://listenbrainz.readthedocs.io/en/latest/users/api/index.html>

## Claude Code

- Claude Code documentation: <https://docs.anthropic.com/en/docs/claude-code/overview>
- Memory and `CLAUDE.md`: <https://docs.anthropic.com/en/docs/claude-code/memory>
- Common workflows: <https://docs.anthropic.com/en/docs/claude-code/common-workflows>
- Hooks: <https://docs.anthropic.com/en/docs/claude-code/hooks>
- Security: <https://docs.anthropic.com/en/docs/claude-code/security>
- Development containers: <https://docs.anthropic.com/en/docs/claude-code/devcontainer>

---

# 35. Final Build Directive

Build the smallest trustworthy system that proves this statement:

> **Given only consented first-party taste declarations, first-party feedback, and appropriately licensed independent music data, Resonance can produce more confirmed-new favorites than a fair discovery baseline.**

Do not optimize for feature count. Optimize for:

- clean data rights;
- recommendation quality;
- honest novelty;
- feedback value;
- causal evidence;
- user trust;
- service independence;
- architectural reversibility.

The first magical moment is a playlist. The company is the compounding, legally usable understanding of **why unfamiliar music becomes loved**.

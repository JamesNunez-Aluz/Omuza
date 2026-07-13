Review the current change set ($ARGUMENTS if specified, otherwise the working diff
against main) as a skeptical staff engineer, privacy engineer, and music-data
licensing reviewer.

Check:
- Spotify data boundary (no recommender imports of destination integrations; no
  Spotify-sourced fields marked recommendation- or training-eligible);
- provenance/license eligibility on every new feature or data field;
- authentication/authorization (server-side ownership checks, deny by default);
- token or PII leakage in code, logs, fixtures, or telemetry;
- idempotency and failure states;
- recommendation invariants (hard blocks never selected, probabilities in 0–1,
  determinism per snapshot+seed);
- evidence-only explanations — no invented musical properties;
- LLM boundary (spec §10.20): outputs are schema-validated proposals; no track
  nomination from model memory; no unvalidated LLM text rendered as controls;
- deletion propagation;
- accessibility (keyboard-complete, no color-only meaning, reduced motion);
- tests and observability.

Report concrete issues by severity with file/line references. Do not approve based
only on happy-path behavior.

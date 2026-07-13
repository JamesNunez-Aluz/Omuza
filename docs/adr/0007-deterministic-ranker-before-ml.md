# ADR 0007 — Deterministic ranker before ML

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §2.2 P7, §10, §21 Milestone 7 preconditions

## Context

Learned rankers need first-party outcome data that does not exist yet, and unexplainable recommendations violate product principle P4 (explanations require evidence).

## Decision

Rankers implement a versioned `Ranker` interface. Milestones 2–6 ship deterministic, explainable scoring; every recommendation run pins `rankerVersion` and a `randomSeed` so runs are reproducible. Learned models (Milestone 7) arrive only after go/no-go data thresholds, behind the same interface, gated by `/rec-change` (golden/invariant tests, guardrail metrics, ADR 0014 governance).

## Alternatives considered

- Early embedding/collaborative model on public datasets: unclear license fit, cold-start data leakage risk, and unexplainable output.
- Pure heuristics without versioning: blocks A/B attribution and reproducibility later.

## Consequences

### Positive

- Every rank is explainable from stored evidence; regressions are diffable run-to-run.

### Negative

- Early recommendation quality is bounded by hand-tuned scoring.

## Security/privacy/license effects

No model training occurs before the training-governance controls exist; `assertTrainingEligible` already blocks prohibited rows.

## Verification

`packages/recommender` reproducibility and version-pin tests (golden invariants); Milestone 2 acceptance criteria.

## Revisit triggers

Milestone 7 preconditions met (outcome volume, experiment infra, governance ADRs in force).

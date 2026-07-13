# ADR 0015 — LLM interface-layer boundaries

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §10.20, §5.7; CLAUDE.md absolute constraints

## Context

LLMs are useful for interpreting user intent and phrasing evidence, and dangerous as sources of catalog facts or hidden state mutations. The system needs a "Software 3.0" contract before any LLM code lands: deterministic core, probabilistic shell.

## Decision

The LLM (`packages/integrations/llm`, Milestone 2+) is an interface/interpretation layer over first-party data only:

1. **Edits data, never state** — every LLM output is a schema-validated proposal the user can inspect; committing a proposal is a deterministic application-code path.
2. **Never nominates tracks or artists from model memory**; candidates come only from the catalog/recommender.
3. **Never fabricates catalog entities, features, or musical properties**; explanations reference stored evidence IDs.
4. Prompts are code: versioned in-repo, schema-validated, tested against golden cases, with deterministic fallbacks (`ExplanationGenerator` keeps a template implementation as the permanent fallback).
5. Prompt regressions are release blockers, same as ranker regressions.

## Alternatives considered

- LLM-orchestrated recommendation ("agent picks tracks"): unexplainable, unreproducible, and hallucination-prone by construction.
- No LLM at all: forgoes genuinely good interface affordances (conversational refinement, §5.7.2).

## Consequences

### Positive

- LLM failures degrade to deterministic behavior; no user-visible state depends on model availability.

### Negative

- Every LLM feature needs a schema, a validator, a fallback, and golden tests before shipping.

## Security/privacy/license effects

Prompts must not include secrets or raw provider payloads; LLM outputs are never source-of-truth catalog data without validation (registry note `LLM output`).

## Verification

Schema validation at the adapter boundary; golden prompt tests (Milestone 2); policy review in `/rec-change` for any LLM-adjacent ranking change.

## Revisit triggers

Any proposal to let the LLM write state directly; new model capabilities that change the fallback calculus.

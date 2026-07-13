# ADR 0003 — Modular monolith

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §7.2

## Context

A pre-product-market-fit team needs iteration speed and enforceable boundaries, not distributed-systems operations.

## Decision

One repository, one deployable web app (Next.js BFF) plus one worker, one PostgreSQL. Domain boundaries are packages with explicit dependency direction (`domain` ← `recommender` ← apps; integrations are leaves injected at the application layer). No Redis, brokers, search clusters, or Kubernetes without an ADR and measured need.

## Alternatives considered

- Microservices: boundary enforcement via network, but at the cost of operational drag disproportionate to team size.
- Single unstructured app: fastest start, but the compliance boundary (ADR 0002) would rely on discipline alone.

## Consequences

### Positive

- Policy boundaries are testable as import-graph properties.
- One database gives transactional integrity for append-only evidence.

### Negative

- Worker and web share a deploy cadence; noisy-neighbor risks handled by queue isolation.

## Security/privacy/license effects

Smaller attack surface; a single place to apply security headers, config validation, and log redaction.

## Verification

`scripts/verify-policy-boundaries.ts`; `docs/compliance/dependency-graph.md` documents the allowed edges.

## Revisit triggers

Sustained queue latency/scaling limits with measurements; team growth making independent deploys valuable.

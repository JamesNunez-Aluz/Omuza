# ADR 0008 — Postgres-backed job queue

- Status: Accepted
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §7.1 (no new infrastructure without measured need)

## Context

Playlist generation is asynchronous (spec §7.5): the web tier enqueues, a worker generates. The MVP needs retries, scheduling, and observability — not a distributed broker.

## Decision

Use pg-boss on the existing PostgreSQL instance. Queues are declared in `apps/worker/src/queue.ts`; jobs are JSON payloads with idempotent handlers. No Redis/RabbitMQ/Kafka until measurements show Postgres queueing is a bottleneck, recorded in a superseding ADR.

## Alternatives considered

- Redis + BullMQ: more throughput than needed, plus a second stateful service to secure and operate.
- Cron polling of state tables: no retry/backoff semantics; reinvents the queue poorly.

## Consequences

### Positive

- One database to back up, secure, and reason about transactionally (job + domain state can commit together).

### Negative

- Throughput ceiling in the tens-of-jobs/second range — far above MVP needs, but a known limit.

## Security/privacy/license effects

Job payloads must contain IDs, not personal data or provider payloads; log redaction applies to job logging.

## Verification

`apps/worker` queue integration test (send → handled exactly once); worker readiness probe covers queue + database.

## Revisit triggers

Measured queue latency/backlog beyond targets; multi-region workers.

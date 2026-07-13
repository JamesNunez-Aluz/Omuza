# ADR 0017 — Generative UI component registry

- Status: Accepted (design constraint; implementation deferred)
- Date: 2026-07-13
- Owners: Resonance engineering
- Related policies/licenses: spec §5.7.5, §10.20, §14.5

## Context

Generative UI ("the model lays out the page") conflicts with accessibility guarantees, design-token discipline, and the honesty requirements around novelty/confidence display.

## Decision

The LLM may compose **copy** and **select registered components with typed props** — never interface structure or controls:

- A component registry (in `packages/ui`) enumerates the components the LLM may select, each with a Zod props schema.
- LLM output proposing UI is validated against the registry; unknown components or props are rejected and fall back to the deterministic layout.
- The LLM cannot create, remove, reorder, or restyle interactive controls; feedback buttons, consent flows, and novelty badges are fixed, token-styled components (spec §14.5 — no ad-hoc values).
- Accessibility semantics (roles, labels, focus order) belong to the components, not to generated markup.

## Alternatives considered

- Free-form generated JSX/HTML: unbounded a11y, security (injection), and design regressions.
- No generative UI at all: acceptable fallback; this ADR keeps the door open safely.

## Consequences

### Positive

- Generated experiences stay accessible, on-token, and testable.

### Negative

- Registry maintenance overhead; novel layouts require engineer-added components first.

## Security/privacy/license effects

Eliminates markup-injection risk from model output; generated copy passes the same redaction rules as any rendered user data.

## Verification

Future: registry schema tests; snapshot tests that rejected proposals fall back deterministically.

## Revisit triggers

First generative-UI feature (post-MVP); component-registry drift from the design system.

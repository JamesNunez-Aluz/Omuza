Read `docs/music-taste-engine-claude-build-spec.md`, `CLAUDE.md`, existing ADRs in
`docs/adr/`, and the prior milestone completion report. Implement Milestone $ARGUMENTS only.

Start with:
- current-state inspection;
- plan;
- affected data/policy/privacy boundaries;
- acceptance-test mapping against the milestone's acceptance criteria in spec §21.

Implement vertical slices, add tests, run `pnpm check`, update documentation, and
provide a completion report (files changed, design decisions, tests run and results,
unresolved risks, migration/setup actions).

Do not begin the next milestone. Do not weaken existing policy tests or skip
failing checks.

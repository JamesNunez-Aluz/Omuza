# Kickoff prompt — paste this as your first message in Claude Code

Recommended model: Fable 5 (`/model claude-fable-5`) for this milestone.

---

Read `docs/music-taste-engine-claude-build-spec.md` and the root `CLAUDE.md`.
Implement Milestone 0 only.

Before editing:
1. Summarize the architecture and the Spotify compliance boundary.
2. Propose the exact repository tree and dependency direction.
3. List ADRs and policy tests to create (including ADRs 0015–0017 from spec §26).
4. Identify any specification conflict.

Then implement a clean TypeScript pnpm/Turborepo modular-monolith skeleton with
Next.js, a worker, PostgreSQL/Drizzle, a Postgres-backed job queue, strict linting,
Vitest, Playwright scaffolding, Docker Compose, a dev container, CI, structured
logging, Zod configuration, a source-license registry, design tokens package
(spec §14.5), and a blocking `pnpm policy:check`.

Use synthetic fixtures only. Do not add real Spotify functionality. Do not proceed
to Milestone 1. Run all checks and report results, files changed, and remaining
Milestone 0 risks.

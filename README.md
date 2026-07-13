# Resonance — starter kit

Service-neutral music discovery engine. Codename `Resonance`.

## What's in this starter

```text
CLAUDE.md                                   Persistent Claude Code instructions (root, always loaded)
README.md                                   This file
docs/
├── music-taste-engine-claude-build-spec.md Master specification v1.1 (source of truth)
├── KICKOFF-PROMPT.md                       First prompt to paste into Claude Code
└── adr/                                    Architecture Decision Records (created in Milestone 0)
.claude/
└── commands/
    ├── milestone.md                        /milestone <N> — implement a milestone
    ├── review.md                           /review — skeptical compliance/security review
    └── rec-change.md                       /rec-change — gate recommendation-logic changes
```

## Getting started

1. `git init` this directory and make the first commit.
2. Open Claude Code here: `claude --model claude-fable-5`
3. Paste the prompt from `docs/KICKOFF-PROMPT.md`.
4. Review the Milestone 0 completion report against spec §21 acceptance criteria
   yourself before running `/milestone 1`.

## Working rhythm

- Fable 5 for architecture, the recommendation engine, and `/review` passes.
- Opus 4.8 (`/model claude-opus-4-8`) for well-scoped feature work in Milestones 1 and 3.
- One milestone at a time. `/review` before considering any milestone done.

## Priority

Milestones 0–3 are the company: onboarding → playlist → feedback → learning loop,
fully usable without Spotify. Milestone 4 (Spotify export) is deferred until 0–3
are validated with real users.

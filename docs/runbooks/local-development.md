# Runbook — local development

## First run

```bash
cp .env.example .env          # synthetic dev defaults; edit if ports clash
pnpm install
docker compose up -d          # postgres:5432, mailpit:1025/8025
pnpm db:migrate
pnpm db:seed                  # synthetic demo data (idempotent)
pnpm dev                      # web :3000, worker health :3001
```

## Health

- Web liveness: `curl localhost:3000/health/live`
- Web readiness (db check): `curl localhost:3000/health/ready`
- Worker liveness/readiness: `curl localhost:3001/health/live` / `/health/ready`
- Mailpit UI: http://localhost:8025

## Quality gates

```bash
pnpm check                    # lint + typecheck + test + policy:check
pnpm test:integration         # needs DATABASE_URL (docker compose up)
pnpm test:e2e                 # Playwright, boots next dev itself
```

`pnpm policy:check` is blocking: it fails on prohibited imports (Spotify into
recommender etc.) and license/provenance violations. Do not merge with it red;
do not "fix" it by editing the allowlists without an ADR.

## Common failures

- **`/health/ready` 503** — postgres not up or migrations missing: `docker compose up -d && pnpm db:migrate`.
- **Migration hash mismatch** — an applied migration file was edited. Revert the edit and write a new migration instead.
- **Integration tests skipped** — DATABASE_URL unset; export it or start docker compose.

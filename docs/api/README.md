# API documentation

Milestone 0 surface is health-only. OpenAPI generation from shared Zod
schemas begins in Milestone 1 with the first product endpoints.

| Endpoint | Method | Purpose |
|---|---|---|
| `/health/live` | GET | Web liveness — 200 when the process serves requests |
| `/health/ready` | GET | Web readiness — 200 only when config is valid and PostgreSQL answers; 503 otherwise |

Worker exposes the same two paths on `WORKER_HEALTH_PORT` (default 3001);
readiness additionally requires the pg-boss queue to be started.

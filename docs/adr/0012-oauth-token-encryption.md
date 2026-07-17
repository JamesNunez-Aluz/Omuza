# ADR 0012 — OAuth token encryption

- Status: Accepted
- Date: 2026-07-14
- Owners: Resonance engineering
- Related policies/licenses: spec §12.4, §16.4; Spotify Developer Policy

## Context

Spotify OAuth tokens are the highest-sensitivity destination data we hold. A database leak must not yield usable credentials, and non-destination code paths (recommender, analytics) must be structurally unable to read them.

## Decision

Tokens are encrypted at the application layer with AES-256-GCM envelope encryption (`TokenCipher` in `packages/integrations/spotify`): a 32-byte key from `TOKEN_ENCRYPTION_KEY_B64`, per-record random 12-byte nonce, authenticated tags, and a `key_version` column for rotation (decrypt refuses mismatched versions, forcing an explicit rotation path). Ciphertext lives in `encrypted_oauth_credentials`, cascade-deleted with its connection. Decryption code exists only in the destination package, and the policy gate's import allowlist limits it to exactly two call sites: the worker export job and the web server's single Spotify module. PKCE verifiers in `oauth_transactions` use the same cipher. Plaintext tokens are never logged (Pino redaction is a second layer), never returned by any API, never sent to the client or any analytics/LLM system, and deleted on disconnect and on account deletion.

## Alternatives considered

- pgcrypto in-database encryption: keys visible to the database role; weaker isolation than app-layer.
- Managed secret vault per user token: better isolation, heavier ops; revisit before extended access.

## Consequences

### Positive

- Database dumps and SQL injection cannot produce usable tokens; rotation is a first-class path.

### Negative

- Key management is on us: losing the key strands all connections (users simply reconnect).

## Security/privacy/license effects

Satisfies §16.4 controls; disconnect purge meets the platform's deletion expectations (§12.10).

## Verification

TokenCipher contract tests (round trip, nonce uniqueness, version enforcement); web integration test asserting ciphertext at rest and token-free API responses; policy allowlist R2; CI secret scanning.

## Revisit triggers

Key rotation implementation; extended-access application (consider a managed vault); any credential incident.

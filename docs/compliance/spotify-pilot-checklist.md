# Spotify export pilot — launch checklist

Milestone 4 acceptance requires this checklist to be **manually completed and
signed by a human** before `FEATURE_SPOTIFY_EXPORT=true` is set in any shared
or production environment. Code being merged does NOT constitute launch.
Re-review quarterly and whenever Spotify announces platform changes (§6.4).

Note: CLAUDE.md defers the pilot until Milestones 0–3 are validated with real
users. Item 1 records that validation explicitly.

## Preconditions

- [ ] 1. Milestones 0–3 validated with real users (dates, evidence link): ______
- [ ] 2. Current Spotify Developer Policy reviewed (date, reviewer): ______
- [ ] 3. Current Spotify Developer Terms of Service reviewed: ______
- [ ] 4. Resonance Privacy Policy and EULA cover destination export: ______
- [ ] 5. Legal counsel sign-off recorded (name, date): ______

## Technical verification

- [ ] 6. `pnpm policy:check` green on the release commit: ______
- [ ] 7. Data-retention behavior verified: `pnpm purge:provider-data` scheduled;
       `export_item_resolutions`/`oauth_transactions` expiries observed: ______
- [ ] 8. User-disconnect deletion verified end-to-end in staging: ______
- [ ] 9. OAuth scopes verified: exactly `playlist-modify-private`: ______
- [ ] 10. `TOKEN_ENCRYPTION_KEY_B64` provisioned from a secret manager, never
        committed; key version recorded: ______
- [ ] 11. Redirect URI allowlisted in the Spotify dashboard matches
        `SPOTIFY_REDIRECT_URI` exactly (HTTPS in production): ______
- [ ] 12. `SPOTIFY_PILOT_ALLOWLIST` contains only the Development-Mode
        authorized users (max per current platform limits): ______

## Product/positioning

- [ ] 13. Product positioning reviewed for "core experience" concerns — the
        product is fully usable without Spotify (§6.4): ______
- [ ] 14. Export UI copy implies no Spotify endorsement: ______
- [ ] 15. Extended-access strategy documented as business development, not an
        assumed entitlement (§12.2): ______
- [ ] 16. Path to removal documented: disabling the flag degrades cleanly to
        CSV/M3U export with no data loss (M4 exit gate): ______

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Founder | | | |
| Legal | | | |
| Engineering | | | |

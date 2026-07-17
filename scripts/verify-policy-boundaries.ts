import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Blocking policy gate #1 (spec §6.2 control 9): dependency-boundary checks.
 *
 * Walks every source file and fails the build when:
 *  R1. packages/recommender or packages/domain imports any integration
 *      package (Spotify, MusicBrainz, or anything under packages/integrations).
 *  R2. Any file outside packages/integrations/spotify imports the Spotify
 *      package. (Milestone 4 will add an explicit allowlist for the worker's
 *      destination jobs and the web export routes — additions require an ADR.)
 *  R3. Any file outside packages/integrations/spotify mentions the Spotify
 *      API host or Spotify payload type names.
 *  R4. packages/domain imports web-framework code (domain stays framework-free).
 *
 * Exit code 1 with a per-violation report; exit code 0 when clean.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_ROOTS = ["apps", "packages", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const IGNORED_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage"]);

/**
 * Files allowed to import @resonance/spotify (ADR 0002/0012, Milestone 4):
 * exactly the worker export job, the web server's single Spotify module, and
 * the integration tests that exercise that boundary with synthetic tokens.
 * Recommendation, taste, and analytics code can never join this list.
 */
const SPOTIFY_IMPORT_ALLOWLIST: string[] = [
  "apps/worker/src/jobs/spotify-export.ts",
  "apps/web/src/server/spotify.ts",
  "apps/worker/integration/spotify-export.integration.test.ts",
  "apps/web/integration/spotify-connections.integration.test.ts",
];

/**
 * Spotify surfaces that must never exist in this codebase (spec §6.2 c.11,
 * §12.1): listening history, libraries, playlists-read, player state, audio
 * features/analysis, previews, recommendations, and every read scope.
 */
const PROHIBITED_SPOTIFY_STRINGS = [
  "audio-features",
  "audio-analysis",
  "v1/recommendations",
  "me/top",
  "recently-played",
  "v1/me/tracks",
  "me/player",
  "preview_url",
  "user-read-",
  "user-library-",
  "user-top-read",
  "user-follow-",
  "playlist-read-",
];

interface Violation {
  rule: string;
  file: string;
  detail: string;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      yield full;
    }
  }
}

function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s+[^"']*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function isInside(relativeFile: string, prefix: string): boolean {
  return relativeFile === prefix || relativeFile.startsWith(`${prefix}/`);
}

function resolvesIntoIntegrations(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(file), specifier);
  return path.relative(repoRoot, resolved).startsWith(path.join("packages", "integrations"));
}

const violations: Violation[] = [];

for (const root of SOURCE_ROOTS) {
  const rootDir = path.join(repoRoot, root);
  let files: string[];
  try {
    files = [...walk(rootDir)];
  } catch {
    continue;
  }

  for (const file of files) {
    const relative = path.relative(repoRoot, file).replaceAll(path.sep, "/");
    const source = readFileSync(file, "utf8");
    const specifiers = importsOf(source);

    const inRecommenderOrDomain =
      isInside(relative, "packages/recommender") || isInside(relative, "packages/domain");
    const inSpotifyPackage = isInside(relative, "packages/integrations/spotify");
    const isThisScript = relative === "scripts/verify-policy-boundaries.ts";

    for (const specifier of specifiers) {
      if (inRecommenderOrDomain) {
        if (
          specifier.startsWith("@resonance/spotify") ||
          specifier.startsWith("@resonance/musicbrainz") ||
          specifier.startsWith("@resonance/listenbrainz") ||
          resolvesIntoIntegrations(file, specifier)
        ) {
          violations.push({
            rule: "R1 recommender/domain must not import integrations",
            file: relative,
            detail: `imports "${specifier}"`,
          });
        }
        if (specifier === "next" || specifier.startsWith("next/") || specifier === "react") {
          violations.push({
            rule: "R4 domain layer must stay framework-free",
            file: relative,
            detail: `imports "${specifier}"`,
          });
        }
      }

      if (
        !inSpotifyPackage &&
        !SPOTIFY_IMPORT_ALLOWLIST.includes(relative) &&
        (specifier.startsWith("@resonance/spotify") ||
          (resolvesIntoIntegrations(file, specifier) && specifier.includes("spotify")))
      ) {
        violations.push({
          rule: "R2 Spotify package is import-restricted (export-only boundary)",
          file: relative,
          detail: `imports "${specifier}"`,
        });
      }
    }

    // The config package may declare the base URL (consumed only by the
    // adapter); no other file outside the adapter may reference the host.
    const isConfigModule = relative === "packages/config/src/config.ts";
    if (!inSpotifyPackage && !isThisScript && !isConfigModule) {
      if (source.includes("api.spotify.com")) {
        violations.push({
          rule: "R3 Spotify API host outside the adapter",
          file: relative,
          detail: "references api.spotify.com",
        });
      }
      if (/SpotifyTrackSearchResult/.test(source)) {
        violations.push({
          rule: "R3 Spotify payload type outside the adapter",
          file: relative,
          detail: "references SpotifyTrackSearchResult",
        });
      }
    }

    // R5: prohibited Spotify endpoint/scope strings anywhere in source
    // (spec §12.1, §18.3): no history, libraries, players, audio features,
    // previews, recommendations, or read/public scopes — not even inside
    // the adapter.
    if (!isThisScript) {
      for (const prohibited of PROHIBITED_SPOTIFY_STRINGS) {
        if (source.includes(prohibited)) {
          violations.push({
            rule: "R5 prohibited Spotify endpoint/scope string",
            file: relative,
            detail: `contains "${prohibited}"`,
          });
        }
      }
      const scopeMatches = source.match(/playlist-modify-\w+/g) ?? [];
      for (const scope of scopeMatches) {
        if (scope !== "playlist-modify-private") {
          violations.push({
            rule: "R5 Spotify scope outside the allowlist",
            file: relative,
            detail: `scope "${scope}" is not allowlisted`,
          });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`policy:check FAILED — ${violations.length} boundary violation(s):\n`);
  for (const violation of violations) {
    console.error(`  [${violation.rule}]\n    ${violation.file}: ${violation.detail}\n`);
  }
  process.exit(1);
}

console.log("policy:check boundaries OK — no prohibited imports or payload leakage found");

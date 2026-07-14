import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Root ESLint flat config shared by every workspace package.
 *
 * The Spotify compliance boundary (spec §6.2) is enforced twice:
 *  - here, via no-restricted-imports scoped to packages/recommender and
 *    packages/domain so violations surface in editors immediately;
 *  - in scripts/verify-policy-boundaries.ts, which walks the real import
 *    graph and is the blocking CI gate (`pnpm policy:check`).
 */

const prohibitedDestinationImports = [
  {
    group: [
      "@resonance/spotify",
      "@resonance/spotify/*",
      "@resonance/musicbrainz",
      "@resonance/musicbrainz/*",
      "@resonance/listenbrainz",
      "@resonance/listenbrainz/*",
      "**/integrations/spotify/**",
    ],
    message:
      "packages/recommender and packages/domain must never import destination or provider integrations (spec §6.2). Providers are injected behind interfaces.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "error",
    },
  },
  {
    files: ["packages/recommender/**", "packages/domain/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: prohibitedDestinationImports }],
    },
  },
  {
    // CLI entry points write to stdout/stderr by design.
    files: [
      "scripts/**",
      "**/*.config.{ts,mjs,js}",
      "**/src/migrate-cli.ts",
      "**/src/generate-css.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
);

/**
 * Resonance design tokens (spec §14.5). Single source of truth for the UI:
 * Tailwind themes and components consume these — no ad-hoc values.
 *
 * Direction: quiet, editorial, music-forward. Near-black/near-paper neutral
 * ramp plus one restrained accent. Color carries meaning only in the novelty
 * and feedback semantic tokens, and each of those pairs with an icon/label so
 * meaning never rests on color alone (§14.3).
 */

/** Neutral ramp: near-paper (0) to near-black (900). */
export const neutral = {
  0: "#faf9f6",
  50: "#f2f0eb",
  100: "#e6e3db",
  200: "#cfcbc0",
  300: "#aaa79d",
  400: "#82806f",
  500: "#5f5d51",
  600: "#45443b",
  700: "#32312b",
  800: "#211f1c",
  900: "#141311",
} as const;

/** The one restrained accent — deep oxblood, printed-ink character. */
export const accent = {
  default: "#7a3030",
  strong: "#5c2323",
  soft: "#a86a5f",
  subtle: "#f0e4e1",
} as const;

/**
 * Novelty badge states (§5.3). The only other place color carries meaning is
 * feedback. Each state has an icon and label in the component layer.
 */
export const novelty = {
  confirmedNew: "#2f6f4f",
  highConfidenceNew: "#4c7a5c",
  probablyNew: "#6f7a4c",
  unknown: "#82806f",
  known: "#5f5d51",
} as const;

/** Feedback responses (§5.4): love, like, neutral, dislike, not-now, already-knew. */
export const feedback = {
  love: "#7a3030",
  like: "#2f6f4f",
  neutral: "#82806f",
  dislike: "#8a5a2a",
  notNow: "#4c5c7a",
  alreadyKnew: "#5f5d51",
} as const;

/** Typography: editorial serif for titles/explanations, neutral sans for chrome. */
export const typography = {
  fontFamilySerif: "'Source Serif 4', Georgia, 'Times New Roman', serif",
  fontFamilySans:
    "'Inter', -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  /** Tabular numerals for confidence values. */
  fontFeatureNumeric: "'tnum' 1",
  /** Type scale limited to 5 steps (rem). */
  scale: {
    xs: "0.8125rem",
    sm: "0.9375rem",
    md: "1.0625rem",
    lg: "1.375rem",
    xl: "1.875rem",
  },
  lineHeight: {
    tight: "1.25",
    normal: "1.55",
  },
} as const;

/** Spacing: 4px base grid. */
export const spacing = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
} as const;

/** Exactly two radii. */
export const radius = {
  sm: "4px",
  md: "10px",
} as const;

/** At most two elevation levels — printed cards, not floating glass. */
export const elevation = {
  raised: "0 1px 2px rgba(20, 19, 17, 0.10)",
  overlay: "0 4px 16px rgba(20, 19, 17, 0.16)",
} as const;

/** Motion: 120–240ms, state change only, reduced-motion falls back to opacity. */
export const motion = {
  durationFast: "120ms",
  durationBase: "180ms",
  durationSlow: "240ms",
  easingStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easingDecelerate: "cubic-bezier(0, 0, 0, 1)",
} as const;

export const tokens = {
  neutral,
  accent,
  novelty,
  feedback,
  typography,
  spacing,
  radius,
  elevation,
  motion,
} as const;

export type Tokens = typeof tokens;

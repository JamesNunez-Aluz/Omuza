import { tokens } from "./tokens.js";

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Render the token object as CSS custom properties on :root, e.g.
 * `--rz-neutral-900`, `--rz-novelty-probably-new`, `--rz-motion-duration-fast`.
 */
export function tokensToCss(): string {
  const lines: string[] = [];
  for (const [groupName, group] of Object.entries(tokens)) {
    for (const [key, value] of Object.entries(group)) {
      if (typeof value === "object") {
        for (const [subKey, subValue] of Object.entries(value as Record<string, string>)) {
          lines.push(`  --rz-${kebab(groupName)}-${kebab(key)}-${kebab(subKey)}: ${subValue};`);
        }
      } else {
        lines.push(`  --rz-${kebab(groupName)}-${kebab(key)}: ${value};`);
      }
    }
  }
  return `/* Generated from @resonance/ui-tokens — do not edit by hand. */\n:root {\n${lines.join("\n")}\n}\n`;
}

import { writeFileSync } from "node:fs";

import { tokensToCss } from "./css.js";

const outPath = process.argv[2];
if (!outPath) {
  console.error("usage: generate-css <out-path>");
  process.exit(1);
}
writeFileSync(outPath, tokensToCss());

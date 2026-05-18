/**
 * S63 Phase 3 v0.1.1 E2E — slim variant for use_figma 50KB cap.
 *
 * max_nodes=30 → emit ~12KB stays under use_figma 50000 char limit.
 * Outputs /out/figma-script-slim.js + .recipe.md for live E2E test.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toFigmaScript } from "../src/tools/to_figma_script.js";
import { closeShared } from "../src/tools/to_claude.js";

const URL = "https://www.awwwards.com/sites_of_the_day";
const MAX_NODES = 30;

async function main() {
  const t0 = Date.now();
  const r = await toFigmaScript({ url: URL, max_nodes: MAX_NODES });
  const dur = Date.now() - t0;

  const outDir = resolve(import.meta.dir, "..", "out");
  await writeFile(`${outDir}/figma-script-slim.js`, r.code);
  if (r.recipe_md) await writeFile(`${outDir}/figma-script-slim.recipe.md`, r.recipe_md);

  console.log(JSON.stringify({
    duration_ms: dur,
    nodes: r.metrics.nodes,
    estimated_ops: r.estimated_ops,
    code_chars: r.code.length,
    fits_use_figma_50k: r.code.length <= 50000,
    bundle_warnings: r.bundle_warnings,
    emit_warnings: r.emit_warnings,
    code_out: `${outDir}/figma-script-slim.js`,
  }, null, 2));

  await closeShared();
}

await main();

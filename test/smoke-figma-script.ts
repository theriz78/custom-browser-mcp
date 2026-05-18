import { toFigmaScript } from "../src/tools/to_figma_script.js";
import { closeSharedContext } from "../src/lib/browser.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2] ?? "https://www.awwwards.com/sites_of_the_day";

try {
  const r = await toFigmaScript({ url, max_nodes: 300 });
  const codeOut = resolve(import.meta.dir, "..", "out", `figma-script-${r.metrics.nodes}n.js`);
  const recipeOut = resolve(import.meta.dir, "..", "out", `figma-script-${r.metrics.nodes}n.recipe.md`);
  await writeFile(codeOut, r.code, "utf-8");
  if (r.recipe_md) await writeFile(recipeOut, r.recipe_md, "utf-8");
  console.log(
    JSON.stringify(
      {
        schema: r.schema,
        source_url: r.source_url,
        page_name: r.page_name,
        nodes: r.metrics.nodes,
        estimated_ops: r.estimated_ops,
        code_chars: r.code.length,
        bundle_warnings: r.bundle_warnings.map((w) => w.kind),
        emit_warnings: r.emit_warnings.map((w) => w.kind),
        code_head_preview: r.code.slice(0, 400),
        code_out: codeOut,
        recipe_out: r.recipe_md ? recipeOut : null,
      },
      null,
      2
    )
  );
} finally {
  await closeSharedContext();
}

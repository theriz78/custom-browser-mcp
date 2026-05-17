import { toFigma, closeShared } from "../src/tools/to_figma.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2] ?? "https://www.awwwards.com/sites_of_the_day";

try {
  const { document, rendered } = await toFigma({ url });
  const outJson = resolve(
    import.meta.dir,
    "..",
    "out",
    `htmltofigma-${document.metrics.nodes}n.json`
  );
  await writeFile(outJson, rendered, "utf-8");
  const summary = {
    schema: document.schema,
    source_url: document.source_url,
    viewport: document.viewport,
    metrics: document.metrics,
    canvas_children: document.document.children[0].children.length,
    warnings: document.warnings,
    json_chars: rendered.length,
    json_approx_tokens: Math.ceil(rendered.length / 4),
    json_out: outJson,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await closeShared();
}

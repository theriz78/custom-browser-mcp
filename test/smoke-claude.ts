import { toClaude, closeShared } from "../src/tools/to_claude.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2] ?? "https://www.awwwards.com/sites_of_the_day";

try {
  const { bundle, rendered } = await toClaude({ url, format: "yaml" });
  const outYaml = resolve(import.meta.dir, "..", "out", `htmltoclaude-${bundle.metrics.nodes}n.yaml`);
  await writeFile(outYaml, rendered, "utf-8");
  const summary = {
    schema: bundle.schema,
    url: bundle.url,
    viewport: bundle.viewport,
    metrics: bundle.metrics,
    tokens: {
      colors: Object.entries(bundle.tokens.colors).length,
      fonts: Object.entries(bundle.tokens.fonts).length,
      type_sizes: bundle.tokens.type.length,
    },
    tree_roots: bundle.tree.length,
    warnings: bundle.warnings,
    yaml_chars: rendered.length,
    yaml_approx_tokens: Math.ceil(rendered.length / 4),
    yaml_out: outYaml,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await closeShared();
}

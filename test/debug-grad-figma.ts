import { toClaude, closeShared } from "../src/tools/to_claude.js";
import { bundleToFigma } from "../src/extractors/figma.js";

const URL = "https://web.archive.org/web/20240108214548/https://www.awwwards.com/";

try {
  const { bundle } = await toClaude({
    url: URL,
    viewport: { width: 1440, height: 900 },
    format: "json",
    max_nodes: 1500,
  });

  function collect(nodes: any[], out: string[]): void {
    for (const n of nodes) {
      if (n.gradient) out.push(n.gradient);
      if (n.children?.length) collect(n.children, out);
    }
  }
  const grads: string[] = [];
  collect(bundle.tree, grads);
  console.log("Total gradients collected from ClaudeBundle:", grads.length);
  console.log("First 3 unique:");
  [...new Set(grads)].slice(0, 3).forEach((g, i) => console.log(`  [${i}]`, g));

  const fig = bundleToFigma(bundle);
  console.log("\nFigma adapter warnings:");
  fig.warnings.forEach((w) => console.log(`  ${w.kind}: ${w.count} - ${w.hint.slice(0, 80)}`));
} finally {
  await closeShared();
}

import { toClaude, closeShared } from "../src/tools/to_claude.js";

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

  console.log("Total gradients found:", grads.length);
  console.log("\n--- Unique gradient strings (max 10) ---");
  const uniq = [...new Set(grads)].slice(0, 10);
  uniq.forEach((g, i) => console.log(`\n[${i}]`, g.slice(0, 300)));
} finally {
  await closeShared();
}

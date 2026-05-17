import { analyzePage } from "../src/tools/analyze_page.js";
import { toClaude } from "../src/tools/to_claude.js";
import { toFigma } from "../src/tools/to_figma.js";
import { closeSharedContext } from "../src/lib/browser.js";

const url = process.argv[2] ?? "https://www.awwwards.com/sites_of_the_day";

interface ToolResult {
  tool: string;
  ok: boolean;
  duration_ms: number;
  nodes?: number;
  warnings?: number;
  error?: string;
  bytes?: number;
}

const results: ToolResult[] = [];

async function run<T>(name: string, fn: () => Promise<T>, extract: (r: T) => Partial<ToolResult>): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    results.push({ tool: name, ok: true, duration_ms: Date.now() - t0, ...extract(r) });
  } catch (e) {
    results.push({ tool: name, ok: false, duration_ms: Date.now() - t0, error: (e as Error).message });
  }
}

try {
  await run(
    "analyze_page",
    () => analyzePage({ url, outputs: ["a11y", "tokens", "screenshot"] }),
    (r) => ({
      nodes: r.a11y?.node_count,
      warnings: r.warnings.length,
      bytes: r.screenshot?.bytes,
    })
  );

  await run(
    "to_claude",
    () => toClaude({ url, format: "yaml" }),
    (r) => ({
      nodes: r.bundle.metrics.nodes,
      warnings: r.bundle.warnings.length,
      bytes: r.rendered.length,
    })
  );

  await run(
    "to_figma",
    () => toFigma({ url }),
    (r) => ({
      nodes: r.document.metrics.nodes,
      warnings: r.document.warnings.length,
      bytes: r.rendered.length,
    })
  );
} finally {
  await closeSharedContext();
}

const allOk = results.every((r) => r.ok);
const claudeNodes = results.find((r) => r.tool === "to_claude")?.nodes;
const figmaNodes = results.find((r) => r.tool === "to_figma")?.nodes;
const nodesMatch = claudeNodes !== undefined && claudeNodes === figmaNodes;
const totalDuration = results.reduce((a, r) => a + r.duration_ms, 0);

const summary = {
  url,
  consolidated: allOk && nodesMatch,
  all_tools_ok: allOk,
  htmltoclaude_to_figma_nodes_match: nodesMatch,
  total_duration_ms: totalDuration,
  results,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.consolidated ? 0 : 1);

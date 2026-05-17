import { stringify as yamlStringify } from "yaml";
import { extractClaudeBundle, type ClaudeBundle } from "../extractors/htmltoclaude.js";
import { getSharedContext, closeSharedContext } from "../lib/browser.js";

export interface ToClaudeInput {
  url: string;
  viewport?: { width: number; height: number };
  wait_until?: "load" | "domcontentloaded" | "networkidle";
  timeout_ms?: number;
  format?: "yaml" | "json";
}

export const closeShared = closeSharedContext;

export interface ToClaudeResult {
  bundle: ClaudeBundle;
  rendered: string;
  format: "yaml" | "json";
}

export async function toClaude(input: ToClaudeInput): Promise<ToClaudeResult> {
  const viewport = input.viewport ?? { width: 1440, height: 900 };
  const waitUntil = input.wait_until ?? "networkidle";
  const timeout = input.timeout_ms ?? 30000;
  const format = input.format ?? "yaml";

  const started = Date.now();
  const ctx = await getSharedContext(viewport);
  const page = await ctx.newPage();
  try {
    await page.goto(input.url, { waitUntil, timeout });
    const partial = await extractClaudeBundle(page, viewport);
    const duration_ms = Date.now() - started;
    const approxText = JSON.stringify(partial.tree);
    const nodeCount = (approxText.match(/"id":"n/g) ?? []).length;
    const bundle: ClaudeBundle = {
      ...partial,
      url: input.url,
      captured_at: new Date(started).toISOString(),
      metrics: {
        nodes: nodeCount,
        approx_tokens: Math.ceil(approxText.length / 4),
        duration_ms,
      },
    };
    const rendered = format === "yaml" ? yamlStringify(bundle) : JSON.stringify(bundle, null, 2);
    return { bundle, rendered, format };
  } finally {
    await page.close();
  }
}

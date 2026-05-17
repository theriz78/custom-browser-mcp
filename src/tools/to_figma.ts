import { extractClaudeBundle, type ClaudeBundle } from "../extractors/htmltoclaude.js";
import { bundleToFigma, type FigmaDocument } from "../extractors/figma.js";
import { getSharedContext, closeSharedContext } from "../lib/browser.js";

export interface ToFigmaInput {
  url: string;
  viewport?: { width: number; height: number };
  wait_until?: "load" | "domcontentloaded" | "networkidle";
  timeout_ms?: number;
}

export const closeShared = closeSharedContext;

export interface ToFigmaResult {
  document: FigmaDocument;
  rendered: string;
}

export async function toFigma(input: ToFigmaInput): Promise<ToFigmaResult> {
  const viewport = input.viewport ?? { width: 1440, height: 900 };
  const waitUntil = input.wait_until ?? "networkidle";
  const timeout = input.timeout_ms ?? 30000;

  const started = Date.now();
  const ctx = await getSharedContext(viewport);
  const page = await ctx.newPage();
  try {
    await page.goto(input.url, { waitUntil, timeout });
    const partial = await extractClaudeBundle(page, viewport);
    const approxText = JSON.stringify(partial.tree);
    const nodeCount = (approxText.match(/"id":"n/g) ?? []).length;
    const claude: ClaudeBundle = {
      ...partial,
      url: input.url,
      captured_at: new Date(started).toISOString(),
      metrics: {
        nodes: nodeCount,
        approx_tokens: Math.ceil(approxText.length / 4),
        duration_ms: Date.now() - started,
      },
    };
    const document = bundleToFigma(claude);
    const rendered = JSON.stringify(document, null, 2);
    return { document, rendered };
  } finally {
    await page.close();
  }
}

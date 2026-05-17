import { stringify as yamlStringify } from "yaml";
import { z } from "zod";
import { extractClaudeBundle, type ClaudeBundle, type ClaudeNode } from "../extractors/htmltoclaude.js";
import { getSharedContext, closeSharedContext } from "../lib/browser.js";
import { acceptCookieConsent, clearCookiesAndStorage } from "../lib/cookies.js";
import { CookieConsentMode, type CookieConsentLog } from "../schemas/output.js";

export const ToClaudeInput = z.object({
  url: z.string().url(),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1440, height: 900 }),
  wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
  timeout_ms: z.number().int().positive().default(30000),
  format: z.enum(["yaml", "json"]).default("yaml"),
  cookie_consent: CookieConsentMode.default("auto"),
  clear_cookies_after: z.boolean().default(true),
});
export type ToClaudeInput = z.infer<typeof ToClaudeInput>;

export const closeShared = closeSharedContext;

export interface ToClaudeResult {
  bundle: ClaudeBundle & { cookie_consent?: CookieConsentLog; cookies_cleared?: boolean };
  rendered: string;
  format: "yaml" | "json";
}

function countNodes(tree: ClaudeNode[]): number {
  let n = 0;
  const stack: ClaudeNode[] = [...tree];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    n++;
    if (node.children?.length) stack.push(...node.children);
  }
  return n;
}

export async function toClaude(rawInput: unknown): Promise<ToClaudeResult> {
  const input = ToClaudeInput.parse(rawInput);
  const started = Date.now();
  const ctx = await getSharedContext(input.viewport);
  const page = await ctx.newPage();
  let cookieLog: CookieConsentLog | undefined;
  let cookiesCleared = false;
  try {
    await page.goto(input.url, { waitUntil: input.wait_until, timeout: input.timeout_ms });
    if (input.cookie_consent === "auto") {
      cookieLog = await acceptCookieConsent(page);
    }
    const partial = await extractClaudeBundle(page, input.viewport);
    const duration_ms = Date.now() - started;
    const nodeCount = countNodes(partial.tree);
    const approxText = JSON.stringify(partial.tree);
    const bundle = {
      ...partial,
      url: input.url,
      captured_at: new Date(started).toISOString(),
      metrics: {
        nodes: nodeCount,
        approx_tokens: Math.ceil(approxText.length / 4),
        duration_ms,
      },
      ...(cookieLog ? { cookie_consent: cookieLog } : {}),
    };
    const rendered = input.format === "yaml" ? yamlStringify(bundle) : JSON.stringify(bundle, null, 2);
    return { bundle: { ...bundle, cookies_cleared: false }, rendered, format: input.format };
  } finally {
    if (input.clear_cookies_after && process.env.CBM_BROWSER_MODE !== "cdp") {
      try {
        await clearCookiesAndStorage(ctx, page);
        cookiesCleared = true;
      } catch {}
    }
    await page.close();
    void cookiesCleared;
  }
}

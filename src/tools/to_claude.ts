import { stringify as yamlStringify } from "yaml";
import { z } from "zod";
import { extractClaudeBundle, type ClaudeBundle, type ClaudeNode } from "../extractors/htmltoclaude.js";
import { getSharedContext, closeSharedContext } from "../lib/browser.js";
import { acceptCookieConsent, clearCookiesAndStorage } from "../lib/cookies.js";
import { CookieConsentMode, type CookieConsentLog } from "../schemas/output.js";
import { assertSafeUrl } from "../lib/urlGuard.js";

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
  allow_private_urls: z.boolean().default(false),
  pre_render_script: z.string().optional(),
  pre_render_delay_ms: z.number().int().nonnegative().default(0),
});
export type ToClaudeInput = z.infer<typeof ToClaudeInput>;

export const closeShared = closeSharedContext;

export type ClaudeBundleWithCookies = ClaudeBundle & {
  cookie_consent?: CookieConsentLog;
  cookies_cleared?: boolean;
};

export interface ToClaudeResult {
  bundle: ClaudeBundleWithCookies;
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
  assertSafeUrl(input.url, { allowPrivate: input.allow_private_urls });
  const started = Date.now();
  const ctx = await getSharedContext(input.viewport);
  const page = await ctx.newPage();
  let bundle: ClaudeBundleWithCookies | null = null;
  try {
    await page.goto(input.url, { waitUntil: input.wait_until, timeout: input.timeout_ms });
    const cookieLog =
      input.cookie_consent === "auto" ? await acceptCookieConsent(page) : undefined;
    if (input.pre_render_script) {
      await page.evaluate(input.pre_render_script);
      if (input.pre_render_delay_ms > 0) {
        await page.waitForTimeout(input.pre_render_delay_ms);
      }
    }
    const partial = await extractClaudeBundle(page, input.viewport);
    const duration_ms = Date.now() - started;
    const nodeCount = countNodes(partial.tree);
    const approxText = JSON.stringify(partial.tree);
    bundle = {
      ...partial,
      url: input.url,
      captured_at: new Date(started).toISOString(),
      metrics: {
        nodes: nodeCount,
        approx_tokens: Math.ceil(approxText.length / 4),
        duration_ms,
      },
      ...(cookieLog ? { cookie_consent: cookieLog } : {}),
      cookies_cleared: false,
    };
  } finally {
    if (bundle && input.clear_cookies_after && process.env.CBM_BROWSER_MODE !== "cdp") {
      try {
        await clearCookiesAndStorage(ctx, page);
        bundle.cookies_cleared = true;
      } catch {}
    }
    await page.close();
  }
  if (!bundle) throw new Error("toClaude: extraction failed before bundle assembly");
  const rendered = input.format === "yaml" ? yamlStringify(bundle) : JSON.stringify(bundle, null, 2);
  return { bundle, rendered, format: input.format };
}

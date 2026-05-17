import { z } from "zod";
import { extractClaudeBundle, type ClaudeBundle, type ClaudeNode } from "../extractors/htmltoclaude.js";
import { bundleToFigma, type FigmaDocument } from "../extractors/figma.js";
import { getSharedContext, closeSharedContext } from "../lib/browser.js";
import { acceptCookieConsent, clearCookiesAndStorage } from "../lib/cookies.js";
import { CookieConsentMode, type CookieConsentLog } from "../schemas/output.js";
import { assertSafeUrl } from "../lib/urlGuard.js";

export const ToFigmaInput = z.object({
  url: z.string().url(),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1440, height: 900 }),
  wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
  timeout_ms: z.number().int().positive().default(30000),
  cookie_consent: CookieConsentMode.default("auto"),
  clear_cookies_after: z.boolean().default(true),
  allow_private_urls: z.boolean().default(false),
});
export type ToFigmaInput = z.infer<typeof ToFigmaInput>;

export const closeShared = closeSharedContext;

export type FigmaDocumentWithCookies = FigmaDocument & {
  cookie_consent?: CookieConsentLog;
  cookies_cleared?: boolean;
};

export interface ToFigmaResult {
  document: FigmaDocumentWithCookies;
  rendered: string;
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

export async function toFigma(rawInput: unknown): Promise<ToFigmaResult> {
  const input = ToFigmaInput.parse(rawInput);
  assertSafeUrl(input.url, { allowPrivate: input.allow_private_urls });
  const started = Date.now();
  const ctx = await getSharedContext(input.viewport);
  const page = await ctx.newPage();
  let document: FigmaDocumentWithCookies | null = null;
  try {
    await page.goto(input.url, { waitUntil: input.wait_until, timeout: input.timeout_ms });
    const cookieLog =
      input.cookie_consent === "auto" ? await acceptCookieConsent(page) : undefined;
    const partial = await extractClaudeBundle(page, input.viewport);
    const nodeCount = countNodes(partial.tree);
    const approxText = JSON.stringify(partial.tree);
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
    document = {
      ...bundleToFigma(claude),
      ...(cookieLog ? { cookie_consent: cookieLog } : {}),
      cookies_cleared: false,
    };
  } finally {
    if (document && input.clear_cookies_after && process.env.CBM_BROWSER_MODE !== "cdp") {
      try {
        await clearCookiesAndStorage(ctx, page);
        document.cookies_cleared = true;
      } catch {}
    }
    await page.close();
  }
  if (!document) throw new Error("toFigma: extraction failed before document assembly");
  const rendered = JSON.stringify(document, null, 2);
  return { document, rendered };
}

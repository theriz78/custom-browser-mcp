import { z } from "zod";
import { extractClaudeBundle, type ClaudeBundle, type ClaudeNode } from "../extractors/htmltoclaude.js";
import { bundleToFigma, type FigmaDocument } from "../extractors/figma.js";
import { closeSharedContext, newPageForViewport } from "../lib/browser.js";
import { acceptCookieConsent, clearCookiesAndStorage } from "../lib/cookies.js";
import { CookieConsentMode, type CookieConsentLog } from "../schemas/output.js";
import { resolveSource, loadIntoPage, cleanupSource } from "../lib/source.js";

const PASTE_HTML_MAX_BYTES = 8 * 1024 * 1024;

export const ToFigmaInput = z
  .object({
    url: z.string().min(1).optional(),
    html: z.string().min(1).max(PASTE_HTML_MAX_BYTES).optional(),
    html_path: z.string().min(1).optional(),
    base_url: z.string().url().optional(),
    viewport: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .default({ width: 1440, height: 900 }),
    wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
    timeout_ms: z.number().int().positive().default(30000),
    cookie_consent: CookieConsentMode.default("auto"),
    clear_cookies_after: z.boolean().default(true),
    allow_private_urls: z.boolean().default(false),
    pre_render_script: z.string().optional(),
    pre_render_delay_ms: z.number().int().nonnegative().default(0),
    max_nodes: z.number().int().positive().max(10000).default(800),
  })
  .refine(
    (d) => [d.url, d.html, d.html_path].filter((v) => typeof v === "string" && v.length > 0).length === 1,
    { message: "provide exactly one of `url` | `html` | `html_path` (mutually exclusive)" }
  );
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
  const source = await resolveSource({
    url: input.url,
    html: input.html,
    html_path: input.html_path,
    base_url: input.base_url,
    allow_private_urls: input.allow_private_urls,
  });
  const started = Date.now();
  const { ctx, page } = await newPageForViewport(input.viewport);
  let document: FigmaDocumentWithCookies | null = null;
  try {
    await loadIntoPage(page, source, { waitUntil: input.wait_until, timeoutMs: input.timeout_ms });
    const cookieLog =
      source.kind === "url" && input.cookie_consent === "auto"
        ? await acceptCookieConsent(page)
        : undefined;
    if (input.pre_render_script) {
      await page.evaluate(input.pre_render_script);
      if (input.pre_render_delay_ms > 0) {
        await page.waitForTimeout(input.pre_render_delay_ms);
      }
    }
    const partial = await extractClaudeBundle(page, input.viewport, { maxNodes: input.max_nodes });
    const nodeCount = countNodes(partial.tree);
    const approxText = JSON.stringify(partial.tree);
    const claude: ClaudeBundle = {
      ...partial,
      url: source.label,
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
    if (
      document &&
      source.kind === "url" &&
      input.clear_cookies_after &&
      process.env.CBM_BROWSER_MODE !== "cdp"
    ) {
      try {
        await clearCookiesAndStorage(ctx, page);
        document.cookies_cleared = true;
      } catch {}
    }
    await page.close();
    await cleanupSource(source);
  }
  if (!document) throw new Error("toFigma: extraction failed before document assembly");
  const rendered = JSON.stringify(document, null, 2);
  return { document, rendered };
}

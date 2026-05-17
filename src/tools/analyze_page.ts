import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { AnalyzePageInput, Bundle, BUNDLE_SCHEMA_VERSION } from "../schemas/output.js";
import { extractA11y } from "../extractors/a11y.js";
import { extractTokens } from "../extractors/tokens.js";
import { captureScreenshot } from "../extractors/screenshot.js";
import { getSharedContext, closeSharedContext } from "../lib/browser.js";
import { acceptCookieConsent, clearCookiesAndStorage } from "../lib/cookies.js";

const OUT_DIR = resolve(import.meta.dir, "..", "..", "out");

export const closeShared = closeSharedContext;

function snapshotId(url: string, ts: number): string {
  const h = createHash("sha256").update(`${url}|${ts}`).digest("hex").slice(0, 16);
  return `cbm-${ts}-${h}`;
}

export async function analyzePage(rawInput: unknown): Promise<Bundle> {
  const input = AnalyzePageInput.parse(rawInput);
  const started = Date.now();
  const fetched_at = new Date(started).toISOString();
  const sid = snapshotId(input.url, started);
  const warnings: string[] = [];

  const ctx = await getSharedContext(input.viewport);
  const page = await ctx.newPage();
  const bundle: Bundle = {
    schema_version: BUNDLE_SCHEMA_VERSION,
    url: input.url,
    fetched_at,
    duration_ms: 0,
    outputs_requested: input.outputs,
    warnings,
    snapshot_id: sid,
  };

  try {
    await page.goto(input.url, { waitUntil: input.wait_until, timeout: input.timeout_ms });

    if (input.cookie_consent === "auto") {
      try {
        bundle.cookie_consent = await acceptCookieConsent(page);
      } catch (e) {
        warnings.push(`cookie_consent_failed: ${(e as Error).message}`);
      }
    }

    if (input.outputs.includes("a11y")) {
      try {
        bundle.a11y = await extractA11y(page);
      } catch (e) {
        warnings.push(`a11y_failed: ${(e as Error).message}`);
      }
    }
    if (input.outputs.includes("tokens")) {
      try {
        bundle.tokens = await extractTokens(page);
      } catch (e) {
        warnings.push(`tokens_failed: ${(e as Error).message}`);
      }
    }
    if (input.outputs.includes("screenshot")) {
      try {
        const path = resolve(OUT_DIR, "screenshots", `${sid}.png`);
        const meta = await captureScreenshot(page, path, { fullPage: input.full_page_screenshot });
        bundle.screenshot = { ...meta, viewport: input.viewport };
      } catch (e) {
        warnings.push(`screenshot_failed: ${(e as Error).message}`);
      }
    }
  } finally {
    if (input.clear_cookies_after && process.env.CBM_BROWSER_MODE !== "cdp") {
      try {
        await clearCookiesAndStorage(ctx, page);
        bundle.cookies_cleared = true;
      } catch (e) {
        warnings.push(`clear_cookies_failed: ${(e as Error).message}`);
      }
    }
    await page.close();
  }

  bundle.duration_ms = Date.now() - started;
  return Bundle.parse(bundle);
}

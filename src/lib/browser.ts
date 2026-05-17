import { chromium, type Browser, type BrowserContext } from "patchright";
import { resolve } from "node:path";

const OUT_DIR = resolve(import.meta.dir, "..", "..", "out");
const USER_DATA_DIR = process.env.CBM_USER_DATA_DIR ?? resolve(OUT_DIR, ".chromium-profile");

export interface Viewport {
  width: number;
  height: number;
}

export type BrowserMode = "chromium" | "chrome" | "cdp";

function resolveMode(): BrowserMode {
  const raw = (process.env.CBM_BROWSER_MODE ?? "chromium").toLowerCase();
  if (raw === "chrome" || raw === "cdp") return raw;
  return "chromium";
}

interface SharedState {
  context: BrowserContext;
  browser: Browser | null;
  viewport: Viewport;
  mode: BrowserMode;
}

let shared: SharedState | null = null;

async function launchPersistent(viewport: Viewport, channel?: "chrome"): Promise<BrowserContext> {
  return chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport,
    ...(channel ? { channel } : {}),
  });
}

async function connectCdp(viewport: Viewport): Promise<{ browser: Browser; context: BrowserContext }> {
  const endpoint = process.env.CBM_CDP_URL ?? "http://localhost:9222";
  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    try {
      await browser.close();
    } catch (e) {
      console.error(`CDP browser.close() after empty contexts failed: ${(e as Error).message}`);
    }
    throw new Error(
      `CDP endpoint ${endpoint} returned 0 contexts. Open at least one tab in target Chrome.`
    );
  }
  const context = contexts[0]!;
  const existingPages = context.pages();
  for (const p of existingPages) {
    try {
      await p.setViewportSize(viewport);
    } catch (e) {
      console.error(`CDP page.setViewportSize failed: ${(e as Error).message}`);
    }
  }
  return { browser, context };
}

function viewportEqual(a: Viewport, b: Viewport): boolean {
  return a.width === b.width && a.height === b.height;
}

export async function getSharedContext(viewport: Viewport): Promise<BrowserContext> {
  const mode = resolveMode();

  if (shared) {
    if (shared.mode !== mode || !viewportEqual(shared.viewport, viewport)) {
      await closeSharedContext();
    } else {
      return shared.context;
    }
  }

  if (mode === "cdp") {
    const { browser, context } = await connectCdp(viewport);
    shared = { context, browser, viewport, mode };
  } else if (mode === "chrome") {
    const context = await launchPersistent(viewport, "chrome");
    shared = { context, browser: null, viewport, mode };
  } else {
    const context = await launchPersistent(viewport);
    shared = { context, browser: null, viewport, mode };
  }
  return shared.context;
}

export async function closeSharedContext(): Promise<void> {
  if (!shared) return;
  try {
    if (shared.mode === "cdp" && shared.browser) {
      await shared.browser.close();
    } else {
      await shared.context.close();
    }
  } catch (e) {
    console.error(`closeSharedContext (${shared.mode}) failed: ${(e as Error).message}`);
  }
  shared = null;
}

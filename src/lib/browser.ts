import { chromium, type Browser, type BrowserContext } from "playwright";
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

let sharedContext: BrowserContext | null = null;
let sharedBrowser: Browser | null = null;
let sharedViewport: Viewport | null = null;
let sharedMode: BrowserMode | null = null;

async function launchPersistent(viewport: Viewport, channel?: "chrome"): Promise<BrowserContext> {
  return chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport,
    ...(channel ? { channel } : {}),
  });
}

async function connectCdp(): Promise<{ browser: Browser; context: BrowserContext }> {
  const endpoint = process.env.CBM_CDP_URL ?? "http://localhost:9222";
  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error(
      `CDP endpoint ${endpoint} returned 0 contexts. Open at least one tab in target Chrome.`
    );
  }
  return { browser, context: contexts[0]! };
}

export async function getSharedContext(viewport: Viewport): Promise<BrowserContext> {
  const mode = resolveMode();

  if (sharedContext) {
    const viewportChanged =
      sharedViewport &&
      (sharedViewport.width !== viewport.width || sharedViewport.height !== viewport.height);
    const modeChanged = sharedMode !== mode;
    if (viewportChanged || modeChanged) {
      await closeSharedContext();
    } else {
      return sharedContext;
    }
  }

  if (mode === "cdp") {
    const { browser, context } = await connectCdp();
    sharedBrowser = browser;
    sharedContext = context;
  } else if (mode === "chrome") {
    sharedContext = await launchPersistent(viewport, "chrome");
  } else {
    sharedContext = await launchPersistent(viewport);
  }
  sharedViewport = viewport;
  sharedMode = mode;
  return sharedContext;
}

export async function closeSharedContext(): Promise<void> {
  if (sharedMode === "cdp") {
    if (sharedBrowser) {
      await sharedBrowser.close();
      sharedBrowser = null;
    }
    sharedContext = null;
  } else if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
  }
  sharedViewport = null;
  sharedMode = null;
}

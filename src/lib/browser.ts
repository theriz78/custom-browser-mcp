import { chromium, type BrowserContext } from "playwright";
import { resolve } from "node:path";

const OUT_DIR = resolve(import.meta.dir, "..", "..", "out");
const USER_DATA_DIR = process.env.CBM_USER_DATA_DIR ?? resolve(OUT_DIR, ".chromium-profile");

export interface Viewport {
  width: number;
  height: number;
}

let sharedContext: BrowserContext | null = null;
let sharedViewport: Viewport | null = null;

export async function getSharedContext(viewport: Viewport): Promise<BrowserContext> {
  if (sharedContext) {
    if (
      sharedViewport &&
      (sharedViewport.width !== viewport.width || sharedViewport.height !== viewport.height)
    ) {
      await sharedContext.close();
      sharedContext = null;
      sharedViewport = null;
    } else {
      return sharedContext;
    }
  }
  sharedContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport,
  });
  sharedViewport = viewport;
  return sharedContext;
}

export async function closeSharedContext(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
    sharedViewport = null;
  }
}

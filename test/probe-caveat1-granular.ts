/**
 * S63 P0 #2 — Caveat #1 granular probe.
 *
 * H2 v2 reproduced HANG at iter 2+ (viewport switch + file://).
 * Granular probe : log each iteration step (close, launch, goto) to find
 * which API call hangs.
 *
 * Run : bun test/probe-caveat1-granular.ts
 */
import { chromium } from "patchright";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HTML = `<!doctype html><html><body><h1>granular</h1></body></html>`;
const WALL = 30_000;
const UDD = resolve(import.meta.dir, "..", "out", ".probe-gran-udd");

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${label}`)), ms).unref?.()
    ),
  ]);
}

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  process.stdout.write(`   [${label}] ... `);
  try {
    const r = await withTimeout(fn(), WALL, label);
    console.log(`${Date.now() - t0}ms ✅`);
    return r;
  } catch (e) {
    console.log(`${Date.now() - t0}ms ❌ ${(e as Error).message.slice(0, 100)}`);
    throw e;
  }
}

async function main() {
  await rm(UDD, { recursive: true, force: true }).catch(() => {});
  const dir = await mkdtemp(join(tmpdir(), "ebm-gran-"));
  const filePath = join(dir, "x.html");
  await writeFile(filePath, HTML);
  const url = `file://${filePath}`;

  const viewports = [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ];

  for (let i = 0; i < viewports.length; i++) {
    const vp = viewports[i]!;
    console.log(`\n--- iter ${i + 1}/${viewports.length} viewport ${vp.width}x${vp.height} ---`);
    try {
      const c = await step(`launchPersistentContext`, () =>
        chromium.launchPersistentContext(UDD, { headless: true, viewport: vp })
      );
      const page = c.pages()[0] ?? (await step(`newPage`, () => c.newPage()));
      await step(`goto(file://)`, () => page.goto(url, { waitUntil: "networkidle", timeout: 20_000 }));
      await step(`title()`, () => page.title());
      await step(`page.close()`, () => page.close());
      await step(`ctx.close()`, () => c.close());
    } catch (e) {
      console.log(`   ⛔ iter ${i + 1} ABORTED: ${(e as Error).message.slice(0, 200)}`);
      break;
    }
  }

  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await rm(UDD, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}

await main();

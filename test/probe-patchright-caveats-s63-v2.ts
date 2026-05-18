/**
 * S63 P0 v2 — Patchright caveats probes refined.
 *
 * V1 results : A-D all PASS (caveat #1 not reproduced under default wait_until=load).
 * V2 hypotheses :
 *   H1 : networkidle wait_until + heavier file (Awwwards-sized HTML) might trip it
 *   H2 : multiple iterations expose UDD lock race only on Nth iteration
 *   H3 : caveat was zombie chromium from S62 session, not a real bug — confirmable by clean smoke run
 *
 * Caveat #2 v2 : test ctx.on('close') when last page is page.close()'d
 *   (mimics user closing the window which is the last/only page).
 *
 * Run : bun test/probe-patchright-caveats-s63-v2.ts
 */
import { chromium as patchrightChromium, type BrowserContext } from "patchright";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { toClaude, closeShared } from "../src/tools/to_claude.js";

// Heavier HTML to force real networkidle wait (no external resources).
const HEAVY_HTML = (() => {
  const blocks = Array.from({ length: 200 }, (_, i) =>
    `<section data-i="${i}"><h2>Section ${i}</h2><p>${"lorem ipsum ".repeat(40)}</p></section>`
  ).join("\n");
  return `<!doctype html><html><head><title>heavy</title>
<style>body{font-family:system-ui;padding:2rem}section{margin:1rem 0;border-top:1px solid #ddd}</style>
</head><body>${blocks}</body></html>`;
})();

const WALL_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${label}`)), ms).unref?.()
    ),
  ]);
}

async function writeTempHtml(): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "ebm-probe-v2-"));
  const fp = join(dir, "sample.html");
  await writeFile(fp, HEAVY_HTML);
  return { filePath: fp, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

interface Result {
  label: string;
  ok: boolean;
  duration_ms: number;
  err?: string;
}
const results: Result[] = [];

async function timed(label: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await withTimeout(fn(), WALL_TIMEOUT_MS, label);
    results.push({ label, ok: true, duration_ms: Date.now() - t0 });
    console.log(`✅ ${label} (${Date.now() - t0}ms)`);
  } catch (e) {
    const err = (e as Error).message;
    results.push({ label, ok: false, duration_ms: Date.now() - t0, err });
    console.log(`❌ ${label} (${Date.now() - t0}ms) → ${err.slice(0, 200)}`);
  }
}

// VARIANT H1 : toClaude with default wait_until (networkidle), viewport switch, file://, heavy HTML
async function variantWrapperNetworkidleHeavy(filePath: string): Promise<void> {
  await toClaude({
    html_path: filePath,
    viewport: { width: 1440, height: 900 },
    // wait_until omitted = default networkidle
  });
  await toClaude({
    html_path: filePath,
    viewport: { width: 1280, height: 720 },
  });
  await toClaude({
    html_path: filePath,
    viewport: { width: 1920, height: 1080 },
  });
}

// VARIANT H2 : 5 iterations alternating viewports, file://
async function variantWrapperManyIterations(filePath: string): Promise<void> {
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ];
  for (let i = 0; i < viewports.length; i++) {
    const vp = viewports[i]!;
    const t0 = Date.now();
    await toClaude({ html_path: filePath, viewport: vp });
    console.log(`   iter ${i + 1}/5 viewport ${vp.width}x${vp.height} → ${Date.now() - t0}ms`);
  }
}

// VARIANT H3 : raw Patchright + concurrent UDD launch (race condition simulation)
async function variantConcurrentUDD(filePath: string): Promise<void> {
  const udd = resolve(import.meta.dir, "..", "out", ".probe-v2-conc");
  const c1 = await patchrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const p1 = await c1.newPage();
  await p1.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 30_000 });
  // close immediately, then re-launch w/o delay
  const closeP = c1.close();
  // try launching second context BEFORE close resolves (race)
  let secondLaunched = false;
  try {
    const c2 = await Promise.race([
      patchrightChromium.launchPersistentContext(udd, {
        headless: true,
        viewport: { width: 1280, height: 720 },
      }),
      new Promise<BrowserContext>((_, rej) =>
        setTimeout(() => rej(new Error("second-launch-timeout-3s")), 3000)
      ),
    ]);
    secondLaunched = true;
    const p2 = await c2.newPage();
    await p2.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 30_000 });
    await c2.close();
  } finally {
    await closeP.catch(() => {});
    await rm(udd, { recursive: true, force: true }).catch(() => {});
  }
  if (!secondLaunched) throw new Error("second context never launched (UDD lock race)");
}

// =====================================
// CAVEAT #2 v2 — ctx.on('close') variants
// =====================================

// V2a : ctx.on('close') when last page is closed via page.close()
//       (mimics user closing the only window)
async function probeCloseLastPage(udd: string): Promise<void> {
  const c = await patchrightChromium.launchPersistentContext(udd, {
    headless: false,
    viewport: { width: 800, height: 600 },
  });
  let ctxClosed = false;
  let pageClosed = false;
  c.on("close", () => {
    ctxClosed = true;
  });
  const page = c.pages()[0] ?? (await c.newPage());
  page.on("close", () => {
    pageClosed = true;
  });
  // simulate user closing the window by closing the page
  await page.close();
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`   pageClosed=${pageClosed} ctxClosed=${ctxClosed}`);
  // cleanup if not closed
  try {
    await c.close();
  } catch {}
  if (!pageClosed) throw new Error("page.on('close') NOT fired after page.close()");
  if (!ctxClosed) {
    // expected behavior : closing last page may not close context (browser stays open)
    // → ctx.close needed explicit
    console.log("   (note) closing last page did NOT trigger ctx.on('close') — explicit ctx.close needed");
  }
}

// V2b : event listener registered BEFORE launch vs AFTER (timing variance)
async function probeCloseEventTimings(udd: string): Promise<void> {
  // headless + programmatic close, but with delayed listener registration
  const c = await patchrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 800, height: 600 },
  });
  // register listener after launch+page setup (mimics seed_auth pattern)
  await c.newPage();
  let fired = false;
  c.on("close", () => {
    fired = true;
  });
  await c.close();
  await new Promise((r) => setTimeout(r, 500));
  if (!fired) throw new Error("Patchright ctx.on('close') NOT fired (listener registered after pages)");
}

async function main() {
  const t = await writeTempHtml();
  try {
    console.log("\n--- CAVEAT #1 v2 probes (networkidle default + heavy HTML) ---");
    await timed("H1) toClaude × 3 viewport-switch networkidle heavy file://", () =>
      variantWrapperNetworkidleHeavy(t.filePath)
    );
    await closeShared();

    await timed("H2) toClaude × 5 iterations alternating viewports file://", () =>
      variantWrapperManyIterations(t.filePath)
    );
    await closeShared();

    await timed("H3) raw Patchright concurrent UDD launch (race)", () =>
      variantConcurrentUDD(t.filePath)
    );

    console.log("\n--- CAVEAT #2 v2 probes (close event variants) ---");
    const baseUdd = resolve(import.meta.dir, "..", "out", ".probe-v2-close");
    await timed("V2a) close last page (headed, mimics user-close)", () =>
      probeCloseLastPage(baseUdd + "-A")
    );
    await timed("V2b) ctx.on('close') registered after page setup", () =>
      probeCloseEventTimings(baseUdd + "-B")
    );

    for (const s of ["-A", "-B"]) {
      await rm(baseUdd + s, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    await t.cleanup();
    await closeShared();
  }

  console.log("\n========== SUMMARY ==========");
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.label} (${r.duration_ms}ms)${r.err ? " | " + r.err.slice(0, 120) : ""}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAIL`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();

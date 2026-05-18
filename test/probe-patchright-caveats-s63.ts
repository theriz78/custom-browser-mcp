/**
 * S63 P0 #2 + #3 — Patchright caveats minimal repros.
 *
 * Caveat #1 (S62-d1) : toClaude + viewport switch mid-session + file:// goto = HANG.
 *   Hypothesis : closeSharedContext + launchPersistent UDD-lock release race + file:// goto.
 *   Variants A/B/C/D below isolate where the hang originates.
 *
 * Caveat #2 (S62-d2) : seedAuthSession ctx.on('close') silent on user-close-window.
 *   Hypothesis : Patchright wraps headed close event differently than Playwright.
 *
 * Run : bun test/probe-patchright-caveats-s63.ts [variant]
 *   variants : v-raw | v-wrapper | v-http | v-delay | close-event | all
 */
import { chromium as patchrightChromium } from "patchright";
import { chromium as playwrightChromium } from "playwright";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { toClaude, closeShared } from "../src/tools/to_claude.js";

const HTML_SAMPLE = `<!doctype html>
<html><head><title>probe</title></head>
<body><h1>caveat probe</h1><p>Minimal HTML for file:// + setContent tests.</p></body>
</html>`;

const WALL_TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${label}`)), ms).unref?.()
    ),
  ]);
}

async function writeTempHtml(): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "ebm-probe-s63-"));
  const fp = join(dir, "sample.html");
  await writeFile(fp, HTML_SAMPLE);
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

// ============================================================
// VARIANT A : raw Patchright API, 2 launches with viewport switch + file://
// Tests if bug is in Patchright UDD-lock release OR in wrapper.
// ============================================================
async function variantRawPatchright(udd: string, filePath: string): Promise<void> {
  // launch 1 — viewport 1440x900 — file://
  const c1 = await patchrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const p1 = c1.pages()[0] ?? (await c1.newPage());
  await p1.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 15_000 });
  await p1.title();
  await c1.close();
  // launch 2 — viewport 1280x720 — file:// (the "viewport switch")
  const c2 = await patchrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
  const p2 = c2.pages()[0] ?? (await c2.newPage());
  await p2.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 15_000 });
  await p2.title();
  await c2.close();
}

// ============================================================
// VARIANT B : toClaude wrapper × 2 with viewport switch + file://
// Reproduces the actual reported caveat path.
// ============================================================
async function variantWrapperFile(filePath: string): Promise<void> {
  await toClaude({
    html_path: filePath,
    viewport: { width: 1440, height: 900 },
    wait_until: "load",
  });
  await toClaude({
    html_path: filePath,
    viewport: { width: 1280, height: 720 },
    wait_until: "load",
  });
}

// ============================================================
// VARIANT C : toClaude wrapper × 2 with viewport switch + HTTP (not file://)
// Tests if hang is file://-specific or generic viewport-switch issue.
// ============================================================
async function variantWrapperHttp(): Promise<void> {
  await toClaude({
    url: "https://example.com",
    viewport: { width: 1440, height: 900 },
    wait_until: "domcontentloaded",
  });
  await toClaude({
    url: "https://example.com",
    viewport: { width: 1280, height: 720 },
    wait_until: "domcontentloaded",
  });
}

// ============================================================
// VARIANT D : raw Patchright, same viewport-switch + file:// pattern
// but with an explicit delay between close + relaunch (UDD-lock release window).
// If A hangs and D passes → UDD-lock race condition.
// ============================================================
async function variantRawPatchrightDelay(udd: string, filePath: string): Promise<void> {
  const c1 = await patchrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const p1 = c1.pages()[0] ?? (await c1.newPage());
  await p1.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 15_000 });
  await c1.close();
  await new Promise((r) => setTimeout(r, 1500));
  const c2 = await patchrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
  const p2 = c2.pages()[0] ?? (await c2.newPage());
  await p2.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 15_000 });
  await c2.close();
}

// ============================================================
// VARIANT E : raw Playwright (not Patchright) same as A
// Controls : if Playwright passes and Patchright hangs → Patchright-specific.
// ============================================================
async function variantRawPlaywright(udd: string, filePath: string): Promise<void> {
  const c1 = await playwrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const p1 = c1.pages()[0] ?? (await c1.newPage());
  await p1.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 15_000 });
  await c1.close();
  const c2 = await playwrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
  const p2 = c2.pages()[0] ?? (await c2.newPage());
  await p2.goto(`file://${filePath}`, { waitUntil: "networkidle", timeout: 15_000 });
  await c2.close();
}

// ============================================================
// CAVEAT #2 — ctx.on('close') silent on user-close-window.
// Headless probe (cannot test user-close manually in script) :
//   - Launch persistent headed
//   - Register ctx.on('close')
//   - Programmatically ctx.close() — should fire
//   - Compare Patchright vs Playwright behavior
// Note : true user-close-window can only be tested manually (headed + interactive).
//        This probe verifies the event listener mechanism itself.
// ============================================================
async function probeCloseEventPatchright(udd: string): Promise<void> {
  const c = await patchrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1024, height: 768 },
  });
  let fired = false;
  c.on("close", () => {
    fired = true;
  });
  await c.close();
  await new Promise((r) => setTimeout(r, 500));
  if (!fired) throw new Error("Patchright ctx.on('close') NOT fired after programmatic close");
}

async function probeCloseEventPlaywright(udd: string): Promise<void> {
  const c = await playwrightChromium.launchPersistentContext(udd, {
    headless: true,
    viewport: { width: 1024, height: 768 },
  });
  let fired = false;
  c.on("close", () => {
    fired = true;
  });
  await c.close();
  await new Promise((r) => setTimeout(r, 500));
  if (!fired) throw new Error("Playwright ctx.on('close') NOT fired after programmatic close");
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const variant = process.argv[2] ?? "all";
  const t = await writeTempHtml();
  const baseUdd = resolve(import.meta.dir, "..", "out", ".probe-s63-udd");

  try {
    if (variant === "v-raw" || variant === "all") {
      await timed("A) raw Patchright + viewport-switch + file://", () =>
        variantRawPatchright(baseUdd + "-A", t.filePath)
      );
    }
    if (variant === "v-wrapper" || variant === "all") {
      await timed("B) toClaude wrapper + viewport-switch + file://", () =>
        variantWrapperFile(t.filePath)
      );
      await closeShared();
    }
    if (variant === "v-http" || variant === "all") {
      await timed("C) toClaude wrapper + viewport-switch + HTTP", () => variantWrapperHttp());
      await closeShared();
    }
    if (variant === "v-delay" || variant === "all") {
      await timed("D) raw Patchright + 1500ms delay + viewport-switch + file://", () =>
        variantRawPatchrightDelay(baseUdd + "-D", t.filePath)
      );
    }
    if (variant === "v-playwright" || variant === "all") {
      await timed("E) raw PLAYWRIGHT control + viewport-switch + file://", () =>
        variantRawPlaywright(baseUdd + "-E", t.filePath)
      );
    }
    if (variant === "close-event" || variant === "all") {
      await timed("F) Patchright ctx.on('close') after programmatic close", () =>
        probeCloseEventPatchright(baseUdd + "-F")
      );
      await timed("G) Playwright  ctx.on('close') after programmatic close", () =>
        probeCloseEventPlaywright(baseUdd + "-G")
      );
    }
  } finally {
    await t.cleanup();
    // cleanup probe UDDs
    for (const suffix of ["-A", "-D", "-E", "-F", "-G"]) {
      await rm(baseUdd + suffix, { recursive: true, force: true }).catch(() => {});
    }
  }

  console.log("\n========== SUMMARY ==========");
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.label} (${r.duration_ms}ms)${r.err ? " | " + r.err.slice(0, 120) : ""}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAIL`}`);

  // exit explicit (bun doesn't always release after persistent contexts)
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();

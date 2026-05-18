/**
 * S63 P0 #2 — Caveat #1 isolate UDD-state vs viewport-switch.
 *
 * Granular revealed iter 3 title() hangs (3 consecutive launches on same UDD).
 * Isolate variables :
 *   X) Same UDD, same viewport × 5
 *   Y) Same UDD, alternating viewport × 5
 *   Z) Fresh UDD per iter, alternating viewport × 5
 * Detects if hang triggered by UDD reuse OR viewport switch OR both.
 */
import { chromium } from "patchright";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HTML = `<!doctype html><html><body><h1>x</h1></body></html>`;
const WALL = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`TIMEOUT ${label}`)), ms).unref?.()
    ),
  ]);
}

async function runIter(udd: string, vp: { width: number; height: number }, url: string): Promise<{ ok: boolean; durations: Record<string, number> }> {
  const durations: Record<string, number> = {};
  let t0 = Date.now();
  const c = await withTimeout(
    chromium.launchPersistentContext(udd, { headless: true, viewport: vp }),
    WALL,
    "launch"
  );
  durations.launch = Date.now() - t0;
  try {
    const page = c.pages()[0] ?? (await c.newPage());
    t0 = Date.now();
    await withTimeout(page.goto(url, { waitUntil: "networkidle", timeout: 15_000 }), WALL, "goto");
    durations.goto = Date.now() - t0;
    t0 = Date.now();
    await withTimeout(page.title(), WALL, "title");
    durations.title = Date.now() - t0;
    t0 = Date.now();
    await withTimeout(page.close(), WALL, "page.close");
    durations.pageClose = Date.now() - t0;
    t0 = Date.now();
    await withTimeout(c.close(), WALL, "ctx.close");
    durations.ctxClose = Date.now() - t0;
    return { ok: true, durations };
  } catch (e) {
    durations.error = -1;
    try {
      await c.close();
    } catch {}
    return { ok: false, durations };
  }
}

async function runVariant(
  name: string,
  iters: number,
  viewportFn: (i: number) => { width: number; height: number },
  uddFn: (i: number, base: string) => string
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `ebm-iso-${name}-`));
  const url = `file://${join(dir, "x.html")}`;
  await writeFile(join(dir, "x.html"), HTML);
  const baseUdd = resolve(import.meta.dir, "..", "out", `.iso-${name}`);

  console.log(`\n=== ${name} ===`);
  for (let i = 0; i < iters; i++) {
    const vp = viewportFn(i);
    const udd = uddFn(i, baseUdd);
    const r = await runIter(udd, vp, url);
    const tag = r.ok ? "✅" : "❌";
    const d = Object.entries(r.durations).map(([k, v]) => `${k}=${v}ms`).join(" ");
    console.log(`  ${tag} iter ${i + 1} vp=${vp.width}x${vp.height} | ${d}`);
    if (!r.ok) break;
  }

  await rm(dir, { recursive: true, force: true }).catch(() => {});
  // cleanup any UDDs we created
  for (let i = 0; i < iters; i++) {
    await rm(uddFn(i, baseUdd), { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const vpA = { width: 1440, height: 900 };
  const vpsAlt = [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ];

  // X — same UDD, same viewport × 5
  await runVariant("X-sameUDD-sameVP", 5, () => vpA, (_, b) => b);

  // Y — same UDD, alternating viewport × 5
  await runVariant("Y-sameUDD-altVP", 5, (i) => vpsAlt[i]!, (_, b) => b);

  // Z — fresh UDD per iter, alternating viewport × 5
  await runVariant("Z-freshUDD-altVP", 5, (i) => vpsAlt[i]!, (i, b) => `${b}-${i}`);

  process.exit(0);
}

await main();

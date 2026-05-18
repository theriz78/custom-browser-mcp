/**
 * S63 P0 #2 — Caveat #1 workaround verification.
 *
 * Re-run H2 (5 iterations alternating viewports via toClaude wrapper).
 * Pre-fix : iter 2 timed out 60s (Patchright UDD-reuse hang).
 * Post-fix : newPageForViewport keeps shared context alive (no relaunch) +
 *            page.setViewportSize per-page on viewport switch.
 * Expected : ALL 5 iterations PASS.
 */
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toClaude, closeShared } from "../src/tools/to_claude.js";

const HTML = `<!doctype html><html><body><h1>caveat1-fixed</h1>${"<p>line</p>".repeat(50)}</body></html>`;

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ebm-fix-"));
  const fp = join(dir, "x.html");
  await writeFile(fp, HTML);

  const viewports = [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ];

  let failed = false;
  for (let i = 0; i < viewports.length; i++) {
    const vp = viewports[i]!;
    const t0 = Date.now();
    try {
      const r = await toClaude({ html_path: fp, viewport: vp });
      const dur = Date.now() - t0;
      const tag = dur < 5000 ? "✅" : "⚠️";
      console.log(`${tag} iter ${i + 1}/5 vp=${vp.width}x${vp.height} → ${dur}ms nodes=${r.bundle.metrics.nodes}`);
    } catch (e) {
      console.log(`❌ iter ${i + 1}/5 vp=${vp.width}x${vp.height} → ${Date.now() - t0}ms ERR: ${(e as Error).message.slice(0, 120)}`);
      failed = true;
      break;
    }
  }

  await closeShared();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}

await main();

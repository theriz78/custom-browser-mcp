import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { analyzePage } from "../src/tools/analyze_page.js";
import { toClaude, closeShared as closeClaude } from "../src/tools/to_claude.js";
import { toFigma } from "../src/tools/to_figma.js";

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>EBM paste-html smoke v0.7.0</title>
<style>
  body { font-family: Georgia, serif; background: #fafafa; color: #1a1a1a; margin: 0; padding: 32px; }
  h1 { font-size: 48px; font-weight: 700; background: linear-gradient(90deg, #ff6b6b, #4ecdc4); -webkit-background-clip: text; color: transparent; }
  .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,.06); margin-top: 24px; }
  .card::before { content: "★"; color: #ffb400; margin-right: 8px; }
  button { background: #1a1a1a; color: #fff; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Inline paste smoke</h1>
  <p>Generated entirely from a local HTML string — no URL fetched.</p>
  <div class="card">Card with pseudo ::before star + gradient heading above</div>
  <button>Submit</button>
</main>
</body>
</html>`;

async function smokeInline() {
  console.log("\n[1/4] inline html → to_claude");
  const t0 = Date.now();
  const r = await toClaude({ html: SAMPLE_HTML, viewport: { width: 1280, height: 720 } });
  const dur = Date.now() - t0;
  console.log(
    `  duration=${dur}ms label=${r.bundle.url} nodes=${r.bundle.metrics.nodes} tokens=${r.bundle.metrics.approx_tokens} warnings=${r.bundle.warnings.length}`
  );
  if (!r.bundle.url.startsWith("inline:html#")) throw new Error(`expected inline:html# label, got ${r.bundle.url}`);
  if (r.bundle.metrics.nodes < 3) throw new Error(`expected ≥3 nodes, got ${r.bundle.metrics.nodes}`);
}

async function smokeAnalyzeInline() {
  console.log("\n[2/4] inline html → analyze_page (a11y only)");
  const t0 = Date.now();
  const b = await analyzePage({ html: SAMPLE_HTML, outputs: ["a11y"], viewport: { width: 1280, height: 720 } });
  const dur = Date.now() - t0;
  console.log(
    `  duration=${dur}ms label=${b.url} a11y_nodes=${b.a11y?.node_count} warnings=${b.warnings.length}`
  );
  if (!b.a11y) throw new Error("expected a11y payload");
  if ((b.a11y.node_count ?? 0) < 1) throw new Error(`expected ≥1 a11y nodes, got ${b.a11y.node_count}`);
}

async function smokeFigmaInline() {
  console.log("\n[3/4] inline html → to_figma");
  const t0 = Date.now();
  const r = await toFigma({ html: SAMPLE_HTML, viewport: { width: 1280, height: 720 } });
  const dur = Date.now() - t0;
  const docAny = r.document as { document?: { children?: unknown[] } };
  const pages = docAny.document?.children?.length ?? "?";
  console.log(`  duration=${dur}ms label=${r.document.source_url} pages=${pages}`);
  if (!r.document.source_url.startsWith("inline:html#")) throw new Error(`expected inline:html#, got ${r.document.source_url}`);
}

async function smokeHtmlFile() {
  console.log("\n[4/4] html_path .html + .zip");
  const dir = await mkdtemp(join(tmpdir(), "ebm-smoke-paste-"));
  const htmlPath = join(dir, "page.html");
  await writeFile(htmlPath, SAMPLE_HTML);

  const t0 = Date.now();
  const r1 = await toClaude({ html_path: htmlPath });
  console.log(
    `  .html label=${r1.bundle.url} nodes=${r1.bundle.metrics.nodes} dur=${Date.now() - t0}ms`
  );
  if (!r1.bundle.url.startsWith("file://")) throw new Error(`expected file:// label, got ${r1.bundle.url}`);

  const zipPath = join(dir, "bundle.zip");
  await new Promise<void>((res, rej) => {
    const proc = spawn("zip", ["-q", "-j", zipPath, htmlPath]);
    proc.on("close", (code) => (code === 0 ? res() : rej(new Error(`zip exited ${code}`))));
    proc.on("error", rej);
  });

  const t1 = Date.now();
  const r2 = await toClaude({ html_path: zipPath });
  console.log(
    `  .zip label=${r2.bundle.url} nodes=${r2.bundle.metrics.nodes} dur=${Date.now() - t1}ms`
  );
  if (!r2.bundle.url.startsWith("file://")) throw new Error(`expected file:// label from zip, got ${r2.bundle.url}`);
  if (!r2.bundle.url.includes("page.html")) throw new Error(`expected page.html entry, got ${r2.bundle.url}`);

  await rm(dir, { recursive: true, force: true });
}

async function smokeXorReject() {
  console.log("\n[xor] reject multi-source input");
  let threw = false;
  try {
    await toClaude({ url: "https://example.com", html: "<p>x</p>" });
  } catch (e) {
    threw = true;
    console.log(`  ✓ rejected: ${(e as Error).message.slice(0, 80)}`);
  }
  if (!threw) throw new Error("expected xor refine error");

  let threw2 = false;
  try {
    await toClaude({});
  } catch (e) {
    threw2 = true;
    console.log(`  ✓ empty rejected: ${(e as Error).message.slice(0, 80)}`);
  }
  if (!threw2) throw new Error("expected empty-source refine error");
}

async function main() {
  try {
    await smokeXorReject();
    await smokeInline();
    await smokeAnalyzeInline();
    await smokeFigmaInline();
    await smokeHtmlFile();
    console.log("\n✅ paste-html smoke PASS v0.7.0");
  } finally {
    await closeClaude();
  }
}

await main();

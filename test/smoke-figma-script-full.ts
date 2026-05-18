/**
 * S66 Phase 3 v0.2 E2E — full multi-chunk variant.
 *
 * Forces multi-chunk emit by max_nodes high enough to exceed 40KB per-chunk budget.
 * Writes /out/figma-script-full-chunkN.js + .recipe.md.
 * Simulates client-side substitution of __EBM_PAGE_ID__ + __EBM_ID_MAP_JSON__ and parses
 * each substituted chunk via `new Function(...)` to catch syntax errors before live E2E.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toFigmaScript } from "../src/tools/to_figma_script.js";
import { closeSharedContext } from "../src/lib/browser.js";

const URL = "https://www.awwwards.com/sites_of_the_day";
const MAX_NODES = 300;

async function main() {
  const t0 = Date.now();
  const r = await toFigmaScript({ url: URL, max_nodes: MAX_NODES, max_bytes_per_chunk: 40 * 1024 });
  const dur = Date.now() - t0;

  const outDir = resolve(import.meta.dir, "..", "out");
  for (const c of r.chunks) {
    await writeFile(`${outDir}/figma-script-full-chunk${c.index}.js`, c.code);
  }
  if (r.recipe_md) await writeFile(`${outDir}/figma-script-full.recipe.md`, r.recipe_md);

  // Simulate client-side substitution + syntax-parse each chunk
  const fakePageId = "1:99";
  let idMapAcc: Record<string, string> = {};
  const parseReport: { index: number; bytes_after_sub: number; parse_ok: boolean; parse_err?: string }[] = [];
  for (const c of r.chunks) {
    let substituted = c.code;
    if (c.needs_substitution) {
      substituted = substituted
        .replaceAll(r.page_id_placeholder, fakePageId)
        .replaceAll(r.id_map_placeholder, JSON.stringify(idMapAcc));
    }
    let parseOk = false;
    let parseErr: string | undefined;
    try {
      new Function("figma", `return (async () => { ${substituted} })();`);
      parseOk = true;
    } catch (e) {
      parseErr = (e as Error).message;
    }
    parseReport.push({
      index: c.index,
      bytes_after_sub: Buffer.byteLength(substituted, "utf8"),
      parse_ok: parseOk,
      ...(parseErr ? { parse_err: parseErr } : {}),
    });
    // Simulate result : add chunk's vars to idMap so next chunk's substitution works
    // (real client would parse result_i.id_map / result_i.id_map_additions ; here we mock via the emitted var list)
    const varMatches = c.code.matchAll(/_idMap\["(n\d+)"\] = (n\d+)\.id;/g);
    for (const m of varMatches) {
      idMapAcc[m[1]!] = `1:${100 + Object.keys(idMapAcc).length}`;
    }
  }

  console.log(
    JSON.stringify(
      {
        duration_ms: dur,
        nodes: r.metrics.nodes,
        estimated_ops: r.estimated_ops,
        chunk_count: r.chunks.length,
        chunks: r.chunks.map((c) => ({
          index: c.index,
          bytes: c.bytes,
          ops: c.ops,
          image_count: c.image_count,
          needs_substitution: c.needs_substitution,
          imported_parent_vars: c.imported_parent_vars,
          fits_50k: c.bytes <= 50000,
        })),
        all_chunks_fit_50k: r.chunks.every((c) => c.bytes <= 50000),
        bundle_warnings: r.bundle_warnings.map((w) => w.kind),
        emit_warnings: r.emit_warnings.map((w) => w.kind),
        parse_report: parseReport,
        all_chunks_parse_ok: parseReport.every((p) => p.parse_ok),
      },
      null,
      2,
    ),
  );

  await closeSharedContext();
}

await main();

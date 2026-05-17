import { toFigma, closeShared } from "../src/tools/to_figma.js";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const url =
  process.argv[2] ??
  "https://web.archive.org/web/20240108214548/https://www.awwwards.com/";

const OUT_DIR = resolve(import.meta.dir, "..", "out", "wayback-dock");

const EXPAND_DOCK_SCRIPT = `
  (() => {
    const hamburger = document.querySelector('.menu-float__hamburger');
    if (!hamburger) return { clicked: false, reason: 'hamburger not found' };
    hamburger.click();
    const menu = document.querySelector('.menu-float__menu');
    const content = document.querySelector('.menu-float__menu-content');
    const dock = document.querySelector('.menu-float');
    return {
      clicked: true,
      menuClass: menu ? menu.className : null,
      contentClass: content ? content.className : null,
      dockHeight: dock ? dock.offsetHeight : null,
    };
  })()
`;

await mkdir(OUT_DIR, { recursive: true });

async function captureState(stateName: string, script?: string) {
  const started = Date.now();
  const args: any = { url, viewport: { width: 1440, height: 900 }, max_nodes: 1500 };
  if (script) {
    args.pre_render_script = script;
    args.pre_render_delay_ms = 1200;
  }
  const { document, rendered } = await toFigma(args);
  const outPath = resolve(OUT_DIR, `${stateName}-${document.metrics.nodes}n.json`);
  await writeFile(outPath, rendered, "utf-8");
  return {
    state: stateName,
    duration_ms: Date.now() - started,
    nodes: document.metrics.nodes,
    warnings: document.warnings,
    canvas_children: document.document.children[0].children.length,
    json_chars: rendered.length,
    output_file: outPath,
  };
}

try {
  console.log("=== STATE 1: folded (default) ===");
  const folded = await captureState("folded");
  console.log(JSON.stringify(folded, null, 2));

  console.log("\n=== STATE 2: dock expanded (pre_render_script injected) ===");
  const expanded = await captureState("expanded", EXPAND_DOCK_SCRIPT);
  console.log(JSON.stringify(expanded, null, 2));

  console.log("\n=== DELTA ===");
  console.log(
    JSON.stringify(
      {
        nodes_added_by_expansion: expanded.nodes - folded.nodes,
        canvas_children_delta: expanded.canvas_children - folded.canvas_children,
        size_delta_chars: expanded.json_chars - folded.json_chars,
      },
      null,
      2
    )
  );
} finally {
  await closeShared();
}

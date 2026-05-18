/**
 * Phase 3 v0.3 — EBM bundle → use_figma plugin JS string emitter (flat + chunked + upload_assets).
 *
 * Strategy v0.3 (S67) :
 * 1. Walk the tree pre-order, emit each node as a flat record with its own `nX` var, parent var,
 *    create/config lines (no inline appendChild), and image fill targets collected separately.
 * 2. Bin-pack the flat sequence into chunks under maxBytesPerChunk (default 40KB, under 50KB cap).
 * 3. For each chunk[i>0], re-resolve any parent var created in a previous chunk via
 *    `figma.getNodeByIdAsync(_idMap[parentVar])`.
 * 4. Image fills emitted as RECT placeholders (figma.createRectangle) with name prefix `IMAGE:`.
 *    Actual bitmap fills applied client-side post-chunks via `upload_assets` MCP. Emit aggregates
 *    `image_targets: [{var, src, scaleMode, chunkIndex}]` ; client resolves `var → real node id`
 *    through the accumulated idMap, then calls upload_assets with that nodeId + POSTs raw bytes
 *    fetched from `src` to the returned `submitUrl`.
 *
 * Why no createImageAsync ? The use_figma sandbox does NOT expose the otherwise-standard Plugin
 * API method `figma.createImageAsync` (verified live S66, error : '"createImageAsync" is not a
 * supported API'). upload_assets is the server-side path : it returns presigned URLs and binds
 * the resulting imageHash as a fill on the target node automatically.
 *
 * Client-side threading (recipe.md explains in detail) :
 * - chunks[0] returns `{ page_id, id_map: { nX: "real_id", ... }, createdNodeIds }`.
 * - For each chunk[i>0] : client substitutes `__EBM_PAGE_ID__` with page_id (literal string) and
 *   `__EBM_ID_MAP_JSON__` with JSON.stringify(idMap accumulated so far) — then runs use_figma.
 * - chunk[i>0] returns its own `{ id_map_additions, createdNodeIds }` which the client merges
 *   into the running idMap before invoking the next chunk.
 * - After ALL chunks done, client iterates `image_targets` and per-target :
 *     (a) lookup `real_id = id_map_accumulated[target.var]` ;
 *     (b) call upload_assets({fileKey, nodeId: real_id, count: 1, scaleMode: target.scaleMode}) ;
 *     (c) fetch source bytes from target.src ; POST to upload response submitUrl with
 *         Content-Type matching the image MIME.
 *
 * v0.1.1 (S65) figma-use compat preserved : no IIFE wrap, setCurrentPageAsync, no figma.notify,
 * paint color {r,g,b} + paint-level opacity, createdNodeIds returned.
 *
 * Spec : research/PROBE-PHASE3-FIGMA-IMPORTER-S62.md.
 */
import type { FigmaDocument, FigmaNode, FigmaPaint, FigmaColor } from "../extractors/figma.js";

export interface EmitOptions {
  /** Page name override. Defaults to bundle.source_url. */
  pageName?: string;
  /** Max bytes per chunk (default 40 * 1024 = 40KB, under use_figma 50KB cap). */
  maxBytesPerChunk?: number;
  /** Deprecated v0.1.1 (figma.notify throws inside use_figma). Ignored. */
  emitNotify?: boolean;
}

export interface EmitChunk {
  index: number;
  code: string;
  bytes: number;
  /** Number of figma.createX ops in this chunk. */
  ops: number;
  /** Number of image fill targets in this chunk (deferred to client upload_assets loop). */
  image_count: number;
  /** True if chunk requires __EBM_PAGE_ID__ + __EBM_ID_MAP_JSON__ substitution (chunks[i>0]). */
  needs_substitution: boolean;
  /** Vars (e.g. "n5") that this chunk re-resolves from a previous chunk's idMap. */
  imported_parent_vars: string[];
}

export interface ImageTarget {
  /** Emit-time var (e.g. "n42"). Client maps to real node id via accumulated idMap. */
  var: string;
  /** Source URL — client fetches bytes, POSTs to upload_assets submitUrl. */
  src: string;
  /** Figma scale mode for the image fill (FILL | FIT | CROP | TILE). */
  scaleMode: "FILL" | "FIT" | "CROP" | "TILE";
  /** Index of the chunk that created the var (informational). */
  chunkIndex: number;
}

export interface EmitResult {
  /** Self-contained chunks (chunks[0] runs first; chunks[i>0] need substitution). */
  chunks: EmitChunk[];
  /** Back-compat shortcut. Always equals chunks[0].code. */
  code: string;
  estimatedOps: number;
  /** Image fill targets aggregated across chunks. Client iterates post-chunks via upload_assets. */
  image_targets: ImageTarget[];
  warnings: { kind: string; count: number; hint: string }[];
}

const PAGE_ID_PLACEHOLDER = "__EBM_PAGE_ID__";
const ID_MAP_PLACEHOLDER = "__EBM_ID_MAP_JSON__";
const DEFAULT_MAX_BYTES_PER_CHUNK = 40 * 1024;

function safeJson(value: unknown): string {
  return JSON.stringify(value);
}

function flattenColorRgb(c: FigmaColor): string {
  return `{ r: ${c.r}, g: ${c.g}, b: ${c.b} }`;
}

function gradientTransformFromHandles(handles: { x: number; y: number }[]): number[][] {
  // Plugin API GRADIENT_* paints take a 2x3 affine transform matrix [[a,b,tx],[c,d,ty]]
  // mapping (0,0)..(1,0)..(0,1) in unit space to the gradient handle positions.
  // handles[0] = origin, handles[1] = end-of-primary-axis, handles[2] = end-of-perpendicular-axis.
  // If handles are missing or malformed, fall back to identity (left-to-right horizontal).
  const h0 = handles?.[0];
  const h1 = handles?.[1];
  const h2 = handles?.[2];
  if (!h0 || !h1 || !h2) return [[1, 0, 0], [0, 1, 0]];
  return [
    [h1.x - h0.x, h2.x - h0.x, h0.x],
    [h1.y - h0.y, h2.y - h0.y, h0.y],
  ];
}

function emitSolidOrGradientPaint(p: FigmaPaint): string | null {
  if (p.type === "SOLID" && p.color) {
    const a = p.color.a;
    const opacitySuffix = a !== undefined && a < 1 ? `, opacity: ${a}` : "";
    return `{ type: "SOLID", color: ${flattenColorRgb(p.color)}${opacitySuffix} }`;
  }
  if ((p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL") && p.gradientStops && p.gradientHandlePositions) {
    // Plugin API rejects `gradientHandlePositions` ; it expects `gradientTransform` 2x3 matrix.
    // ColorStop.color REQUIRES all four channels {r,g,b,a} — alpha defaults to 1 if missing.
    const stops = p.gradientStops.map((s: { color: FigmaColor; position: number }) => ({
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a ?? 1 },
      position: s.position,
    }));
    const transform = gradientTransformFromHandles(p.gradientHandlePositions);
    return `{ type: ${safeJson(p.type)}, gradientStops: ${safeJson(stops)}, gradientTransform: ${safeJson(transform)} }`;
  }
  return null;
}

interface NodeEmit {
  var: string;
  parentVar: string;
  /** Create + config lines WITHOUT the appendChild line. */
  createLines: string[];
  /** Image fill targets emitted by this node (deferred to client upload_assets loop). */
  imageTargets: { src: string; scaleMode: "FILL" | "FIT" | "CROP" | "TILE" }[];
  /** Counted ops (createX call count = 1). */
  ops: number;
  /** Warnings raised during emit. */
  warnings: Map<string, number>;
}

function emitNodeFlat(
  node: FigmaNode,
  parentVar: string,
  varCounter: { i: number },
  out: NodeEmit[],
): void {
  const v = `n${varCounter.i++}`;
  const lines: string[] = [];
  const warnings = new Map<string, number>();
  const imageTargets: { src: string; scaleMode: "FILL" | "FIT" | "CROP" | "TILE" }[] = [];
  const { x, y, width, height } = node.absoluteBoundingBox;
  let ops = 0;

  switch (node.type) {
    case "FRAME":
    case "GROUP": {
      lines.push(`const ${v} = figma.createFrame();`);
      ops++;
      break;
    }
    case "RECTANGLE": {
      lines.push(`const ${v} = figma.createRectangle();`);
      ops++;
      break;
    }
    case "TEXT": {
      const family = node.style?.fontFamily ?? "Inter";
      const weightNum = node.style?.fontWeight ?? 400;
      const styleStr = weightNum >= 700 ? "Bold" : weightNum >= 600 ? "Semi Bold" : weightNum >= 500 ? "Medium" : "Regular";
      lines.push(`const ${v} = figma.createText();`);
      lines.push(`try { await figma.loadFontAsync({ family: ${safeJson(family)}, style: ${safeJson(styleStr)} }); ${v}.fontName = { family: ${safeJson(family)}, style: ${safeJson(styleStr)} }; }`);
      lines.push(`catch (e) { await figma.loadFontAsync({ family: "Inter", style: ${safeJson(styleStr)} }); ${v}.fontName = { family: "Inter", style: ${safeJson(styleStr)} }; }`);
      if (node.characters !== undefined) {
        lines.push(`${v}.characters = ${safeJson(node.characters)};`);
      }
      if (node.style?.fontSize !== undefined) {
        lines.push(`${v}.fontSize = ${node.style.fontSize};`);
      }
      ops++;
      break;
    }
    case "VECTOR": {
      if (node.svgOuterHtml) {
        // Collapse newlines + indent to single space — SVG is whitespace-tolerant, avoids
        // transport mangling of `\n` escapes in multi-KB use_figma `code` arg.
        const collapsed = node.svgOuterHtml.replace(/\s+/g, " ").trim();
        lines.push(`const ${v} = figma.createNodeFromSvg(${safeJson(collapsed)});`);
        ops++;
      } else {
        lines.push(`const ${v} = figma.createRectangle(); // VECTOR without svgOuterHtml — fallback`);
        warnings.set("vector_no_svg", (warnings.get("vector_no_svg") ?? 0) + 1);
        ops++;
      }
      break;
    }
    default: {
      lines.push(`const ${v} = figma.createFrame(); // ${node.type} unsupported v0.2`);
      warnings.set("unsupported_type", (warnings.get("unsupported_type") ?? 0) + 1);
      ops++;
    }
  }

  lines.push(`${v}.name = ${safeJson(node.name)};`);
  lines.push(`${v}.x = ${x}; ${v}.y = ${y};`);
  if (width > 0 && height > 0 && node.type !== "TEXT") {
    lines.push(`${v}.resize(${width}, ${height});`);
  }

  if (node.fills && node.fills.length > 0) {
    const fillExprs: string[] = [];
    let hasImageFill = false;

    for (const p of node.fills) {
      if (p.type === "IMAGE" && p.imageRef) {
        hasImageFill = true;
        const scaleMode = (p.scaleMode ?? "FILL") as "FILL" | "FIT" | "CROP" | "TILE";
        imageTargets.push({ src: p.imageRef, scaleMode });
        continue;
      }
      const e = emitSolidOrGradientPaint(p);
      if (e !== null) fillExprs.push(e);
    }

    if (hasImageFill) {
      // Mark placeholder; client will overwrite fill via upload_assets post-chunks.
      lines.push(`${v}.name = ${safeJson(`IMAGE:${node.name}`)};`);
    }

    if (fillExprs.length > 0) {
      lines.push(`${v}.fills = [${fillExprs.join(", ")}];`);
    }
  }

  if (node.cornerRadius !== undefined && node.type === "RECTANGLE") {
    lines.push(`${v}.cornerRadius = ${node.cornerRadius};`);
  } else if (node.rectangleCornerRadii && node.type === "RECTANGLE") {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    lines.push(`${v}.topLeftRadius = ${tl}; ${v}.topRightRadius = ${tr}; ${v}.bottomRightRadius = ${br}; ${v}.bottomLeftRadius = ${bl};`);
  }

  if (node.clipsContent !== undefined && (node.type === "FRAME" || node.type === "GROUP")) {
    lines.push(`${v}.clipsContent = ${node.clipsContent};`);
  }

  out.push({ var: v, parentVar, createLines: lines, imageTargets, ops, warnings });

  if (node.children && node.children.length > 0 && (node.type === "FRAME" || node.type === "GROUP")) {
    for (const child of node.children) {
      emitNodeFlat(child, v, varCounter, out);
    }
  }
}

interface ChunkPack {
  emits: NodeEmit[];
  bytes: number;
}

function packEmitsIntoChunks(emits: NodeEmit[], maxBytes: number, overheadReserve: number): ChunkPack[] {
  const budget = maxBytes - overheadReserve;
  const packs: ChunkPack[] = [];
  let current: ChunkPack = { emits: [], bytes: 0 };
  for (const e of emits) {
    const sz = e.createLines.reduce((s, l) => s + l.length + 1, 0) + e.parentVar.length + e.var.length + 16; // ~ appendChild line size + padding
    if (current.emits.length > 0 && current.bytes + sz > budget) {
      packs.push(current);
      current = { emits: [], bytes: 0 };
    }
    current.emits.push(e);
    current.bytes += sz;
  }
  if (current.emits.length > 0) packs.push(current);
  return packs;
}

function buildChunkCode(opts: {
  pack: ChunkPack;
  chunkIndex: number;
  totalChunks: number;
  isFirst: boolean;
  pageName: string;
  bundle: FigmaDocument;
  vars_created_in_earlier_chunks: Set<string>;
}): { code: string; importedParents: string[]; imageCount: number; imageTargets: ImageTarget[]; ops: number; warnings: Map<string, number>; createdVars: string[] } {
  const { pack, chunkIndex, totalChunks, isFirst, pageName, bundle, vars_created_in_earlier_chunks } = opts;
  const lines: string[] = [];

  // ── Comment header
  lines.push(`// EBM Phase 3 v0.3 emitter — chunk ${chunkIndex + 1}/${totalChunks} (${isFirst ? "creates page" : "re-attaches page + idMap"})`);
  lines.push(`// source: ${bundle.source_url}`);
  if (isFirst) {
    lines.push(`// captured_at: ${bundle.captured_at}`);
  } else {
    lines.push(`// substitution required: ${PAGE_ID_PLACEHOLDER} → page_id ; ${ID_MAP_PLACEHOLDER} → JSON of idMap accumulated so far`);
  }

  // ── Header : page setup
  if (isFirst) {
    lines.push(`const page = figma.createPage();`);
    lines.push(`page.name = ${safeJson(pageName)};`);
    lines.push(`await figma.setCurrentPageAsync(page);`);
    lines.push(`const _idMap = {};`);
  } else {
    lines.push(`const page = (await figma.getNodeByIdAsync(${safeJson(PAGE_ID_PLACEHOLDER)}));`);
    lines.push(`if (!page || page.type !== "PAGE") throw new Error("EBM chunk: page not found by id " + ${safeJson(PAGE_ID_PLACEHOLDER)});`);
    lines.push(`await figma.setCurrentPageAsync(page);`);
    lines.push(`const _idMap = ${ID_MAP_PLACEHOLDER};`);
  }

  // ── Re-resolve imported parent vars (parents created in earlier chunks but used in this chunk)
  const importedParents: string[] = [];
  const localVars = new Set(pack.emits.map((e) => e.var));
  const neededParents = new Set<string>();
  for (const e of pack.emits) {
    if (e.parentVar !== "page" && !localVars.has(e.parentVar)) {
      neededParents.add(e.parentVar);
    }
  }
  for (const p of neededParents) {
    if (!vars_created_in_earlier_chunks.has(p)) {
      throw new Error(`EBM emit invariant: parent var ${p} referenced in chunk ${chunkIndex} but not created in any earlier chunk`);
    }
    lines.push(`const ${p} = (await figma.getNodeByIdAsync(_idMap[${safeJson(p)}]));`);
    lines.push(`if (!${p}) throw new Error("EBM chunk: parent ${p} not found in idMap");`);
    importedParents.push(p);
  }

  // ── No image prelude (v0.3) : image fills deferred to client upload_assets loop post-chunks.

  // ── Node creates + configs + appendChild
  const ops = pack.emits.reduce((s, e) => s + e.ops, 0);
  const warningAgg = new Map<string, number>();
  const createdVars: string[] = [];
  const chunkImageTargets: ImageTarget[] = [];
  for (const e of pack.emits) {
    for (const l of e.createLines) lines.push(`  ${l}`);
    lines.push(`  ${e.parentVar}.appendChild(${e.var});`);
    lines.push(`  _idMap[${safeJson(e.var)}] = ${e.var}.id;`);
    createdVars.push(e.var);
    for (const [k, v] of e.warnings) warningAgg.set(k, (warningAgg.get(k) ?? 0) + v);
    for (const t of e.imageTargets) {
      chunkImageTargets.push({ var: e.var, src: t.src, scaleMode: t.scaleMode, chunkIndex });
    }
  }

  // ── Footer
  const idsArr = `[${createdVars.map((v) => `${v}.id`).join(", ")}]`;
  if (isFirst) {
    lines.push(`return { page_id: page.id, node_count: ${createdVars.length}, createdNodeIds: ${idsArr}, id_map: _idMap };`);
  } else {
    lines.push(`return { page_id: page.id, node_count: ${createdVars.length}, createdNodeIds: ${idsArr}, id_map_additions: _idMap };`);
  }

  return {
    code: lines.join("\n"),
    importedParents,
    imageCount: chunkImageTargets.length,
    imageTargets: chunkImageTargets,
    ops,
    warnings: warningAgg,
    createdVars,
  };
}

export function emitFigmaPluginCode(bundle: FigmaDocument, opts: EmitOptions = {}): EmitResult {
  const pageName = opts.pageName ?? bundle.source_url.slice(0, 80);
  const maxBytes = opts.maxBytesPerChunk ?? DEFAULT_MAX_BYTES_PER_CHUNK;
  const canvas = bundle.document.children[0];
  const rootNodes = canvas.children;

  // Step 1 — flat emit (pre-order traversal, page-rooted)
  const flatEmits: NodeEmit[] = [];
  const varCounter = { i: 0 };
  for (const root of rootNodes) {
    emitNodeFlat(root, "page", varCounter, flatEmits);
  }

  // Step 2 — bin-pack flat sequence into chunks
  const overheadReserve = 2 * 1024;
  const packs = packEmitsIntoChunks(flatEmits, maxBytes, overheadReserve);

  // Step 3 — assemble chunks with idMap re-resolve
  const varsCreatedInEarlierChunks = new Set<string>();
  const aggregatedWarnings = new Map<string, number>();
  const aggregatedImageTargets: ImageTarget[] = [];
  let totalOps = 0;
  const chunks: EmitChunk[] = packs.map((pack, idx) => {
    const built = buildChunkCode({
      pack,
      chunkIndex: idx,
      totalChunks: packs.length,
      isFirst: idx === 0,
      pageName,
      bundle,
      vars_created_in_earlier_chunks: varsCreatedInEarlierChunks,
    });
    totalOps += built.ops;
    for (const [k, v] of built.warnings) {
      aggregatedWarnings.set(k, (aggregatedWarnings.get(k) ?? 0) + v);
    }
    for (const v of built.createdVars) varsCreatedInEarlierChunks.add(v);
    for (const t of built.imageTargets) aggregatedImageTargets.push(t);
    return {
      index: idx,
      code: built.code,
      bytes: Buffer.byteLength(built.code, "utf8"),
      ops: built.ops,
      image_count: built.imageCount,
      needs_substitution: idx > 0,
      imported_parent_vars: built.importedParents,
    };
  });

  const totalImages = chunks.reduce((s, c) => s + c.image_count, 0);
  if (totalImages > 0) {
    aggregatedWarnings.set("image_deferred_upload", totalImages);
  }

  const warnings = Array.from(aggregatedWarnings.entries()).map(([kind, count]) => ({
    kind,
    count,
    hint:
      kind === "image_deferred_upload"
        ? "v0.3 : IMAGE paints emitted as RECT placeholders + name prefix IMAGE:. Client must iterate result.image_targets post-chunks, call upload_assets({fileKey, nodeId: id_map_accumulated[t.var], count: 1, scaleMode: t.scaleMode}) per target, fetch bytes from t.src, POST to returned submitUrl."
        : kind === "vector_no_svg"
          ? "VECTOR node missing svgOuterHtml — emitted RECT fallback."
          : kind === "unsupported_type"
            ? "FigmaNode.type unsupported in v0.3 emitter — emitted FRAME fallback."
            : "Unknown warning.",
  }));

  return {
    chunks,
    code: chunks[0]?.code ?? "",
    estimatedOps: totalOps,
    image_targets: aggregatedImageTargets,
    warnings,
  };
}

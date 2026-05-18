/**
 * Phase 3 v0.1 — EBM bundle → use_figma plugin JS string emitter.
 *
 * Pure-TS function. Does NOT call use_figma itself (client-side responsibility :
 * Claude main thread or external orchestrator runs the produced script via
 * Claude.ai Figma MCP `use_figma({ code, skillNames: "figma-use" })`).
 *
 * Scope v0.1 (S62 Brain-proxy decisions documented in handoff S62) :
 * - FRAME / GROUP / TEXT / RECTANGLE / VECTOR (via createNodeFromSvg)
 * - SOLID fills + strokes + cornerRadius
 * - Page-per-site (Brain Q1=B) — emit creates new page named after source_url
 * - Image fills SKIPPED (Brain Q2=A) — emits placeholder RECT with name "IMAGE:src=..."
 * - No font preload (Brain v0.1) — uses figma.loadFontAsync lazily per text node ;
 *   fallback Inter if family unavailable
 * - No multi-call chunking — entire script ; client splits via use_figma 10-op rule if needed
 * - No re-parenting pass — children inline via appendChild
 *
 * Deferred v0.2+ (S63) :
 * - Image hybrid Brain Q2-C parallel generate_figma_design imageHash capture
 * - Chunking + idMap re-parent pass for 137+ node bundles
 * - Variable bindings, Code Connect, effect shadows
 *
 * Spec : research/PROBE-PHASE3-FIGMA-IMPORTER-S62.md (v0.1 = MVP Q3=A 3j scope).
 */
import type { FigmaDocument, FigmaNode, FigmaPaint, FigmaColor } from "../extractors/figma.js";

export interface EmitOptions {
  /** Page name override. Defaults to bundle.source_url. */
  pageName?: string;
  /** Whether to include initial figma.notify() with bundle metrics. Default true. */
  emitNotify?: boolean;
}

export interface EmitResult {
  /** The JS source string ready to pass to use_figma({ code }). */
  code: string;
  /** Estimated logical-op count (figma.createX calls). Client uses for chunk planning. */
  estimatedOps: number;
  /** Warnings emitted at compile time (image skips, unsupported types, etc.). */
  warnings: { kind: string; count: number; hint: string }[];
}

function safeJson(value: unknown): string {
  return JSON.stringify(value);
}

function flattenColor(c: FigmaColor): string {
  return `{ r: ${c.r}, g: ${c.g}, b: ${c.b}, a: ${c.a} }`;
}

function emitPaint(p: FigmaPaint): string | null {
  if (p.type === "SOLID" && p.color) {
    return `{ type: "SOLID", color: ${flattenColor(p.color)} }`;
  }
  if ((p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL") && p.gradientStops && p.gradientHandlePositions) {
    return `{ type: ${safeJson(p.type)}, gradientStops: ${safeJson(p.gradientStops)}, gradientHandlePositions: ${safeJson(p.gradientHandlePositions)} }`;
  }
  return null;
}

function emitNode(
  node: FigmaNode,
  parentVar: string,
  counter: { i: number; ops: number; warnings: Map<string, number> }
): string {
  const v = `n${counter.i++}`;
  const lines: string[] = [];
  const { x, y, width, height } = node.absoluteBoundingBox;

  switch (node.type) {
    case "FRAME":
    case "GROUP": {
      const ctor = node.type === "FRAME" ? "createFrame" : "createFrame";
      lines.push(`  const ${v} = figma.${ctor}();`);
      counter.ops++;
      break;
    }
    case "RECTANGLE": {
      lines.push(`  const ${v} = figma.createRectangle();`);
      counter.ops++;
      break;
    }
    case "TEXT": {
      const family = node.style?.fontFamily ?? "Inter";
      const weightNum = node.style?.fontWeight ?? 400;
      const styleStr = weightNum >= 700 ? "Bold" : weightNum >= 600 ? "Semi Bold" : weightNum >= 500 ? "Medium" : "Regular";
      lines.push(`  const ${v} = figma.createText();`);
      lines.push(`  try { await figma.loadFontAsync({ family: ${safeJson(family)}, style: ${safeJson(styleStr)} }); ${v}.fontName = { family: ${safeJson(family)}, style: ${safeJson(styleStr)} }; }`);
      lines.push(`  catch (e) { await figma.loadFontAsync({ family: "Inter", style: ${safeJson(styleStr)} }); ${v}.fontName = { family: "Inter", style: ${safeJson(styleStr)} }; }`);
      if (node.characters !== undefined) {
        lines.push(`  ${v}.characters = ${safeJson(node.characters)};`);
      }
      if (node.style?.fontSize !== undefined) {
        lines.push(`  ${v}.fontSize = ${node.style.fontSize};`);
      }
      counter.ops++;
      break;
    }
    case "VECTOR": {
      if (node.svgOuterHtml) {
        lines.push(`  const ${v} = figma.createNodeFromSvg(${safeJson(node.svgOuterHtml)});`);
        counter.ops++;
      } else {
        lines.push(`  const ${v} = figma.createRectangle(); // VECTOR without svgOuterHtml — fallback`);
        counter.warnings.set("vector_no_svg", (counter.warnings.get("vector_no_svg") ?? 0) + 1);
        counter.ops++;
      }
      break;
    }
    default: {
      lines.push(`  const ${v} = figma.createFrame(); // ${node.type} unsupported v0.1`);
      counter.warnings.set("unsupported_type", (counter.warnings.get("unsupported_type") ?? 0) + 1);
      counter.ops++;
    }
  }

  lines.push(`  ${v}.name = ${safeJson(node.name)};`);
  lines.push(`  ${v}.x = ${x}; ${v}.y = ${y};`);
  if (width > 0 && height > 0 && node.type !== "TEXT") {
    lines.push(`  ${v}.resize(${width}, ${height});`);
  }

  if (node.fills && node.fills.length > 0) {
    const hasImage = node.fills.some((p) => p.type === "IMAGE");
    if (hasImage) {
      counter.warnings.set("image_skipped", (counter.warnings.get("image_skipped") ?? 0) + 1);
      lines.push(`  ${v}.name = ${safeJson(`IMAGE:${node.name}`)};`);
    }
    const paints = node.fills.map(emitPaint).filter((s): s is string => s !== null);
    if (paints.length > 0) {
      lines.push(`  ${v}.fills = [${paints.join(", ")}];`);
    }
  }

  if (node.cornerRadius !== undefined && node.type === "RECTANGLE") {
    lines.push(`  ${v}.cornerRadius = ${node.cornerRadius};`);
  } else if (node.rectangleCornerRadii && node.type === "RECTANGLE") {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    lines.push(`  ${v}.topLeftRadius = ${tl}; ${v}.topRightRadius = ${tr}; ${v}.bottomRightRadius = ${br}; ${v}.bottomLeftRadius = ${bl};`);
  }

  if (node.clipsContent !== undefined && (node.type === "FRAME" || node.type === "GROUP")) {
    lines.push(`  ${v}.clipsContent = ${node.clipsContent};`);
  }

  if (node.children && node.children.length > 0 && (node.type === "FRAME" || node.type === "GROUP")) {
    for (const child of node.children) {
      lines.push(emitNode(child, v, counter));
    }
  }

  lines.push(`  ${parentVar}.appendChild(${v});`);

  return lines.join("\n");
}

export function emitFigmaPluginCode(bundle: FigmaDocument, opts: EmitOptions = {}): EmitResult {
  const pageName = opts.pageName ?? bundle.source_url.slice(0, 80);
  const emitNotify = opts.emitNotify ?? true;
  const counter = { i: 0, ops: 0, warnings: new Map<string, number>() };
  const canvas = bundle.document.children[0];
  const rootNodes = canvas.children;

  const nodeBlocks = rootNodes.map((n) => emitNode(n, "page", counter));

  const header = [
    `// EBM Phase 3 v0.1 emitter — auto-generated from bundle ${bundle.schema}`,
    `// source: ${bundle.source_url}`,
    `// captured_at: ${bundle.captured_at}`,
    `// nodes: ${bundle.metrics.nodes}, viewport: ${bundle.viewport.width}x${bundle.viewport.height}`,
    `(async () => {`,
    `  const page = figma.createPage();`,
    `  page.name = ${safeJson(pageName)};`,
    `  figma.setCurrentPage(page);`,
  ].join("\n");

  const footer = [
    emitNotify
      ? `  figma.notify(${safeJson(`EBM imported ${bundle.metrics.nodes} nodes from ${pageName}`)});`
      : "",
    `  return { page_id: page.id, node_count: ${counter.i} };`,
    `})();`,
  ].filter(Boolean).join("\n");

  const code = [header, ...nodeBlocks, footer].join("\n");

  const warnings = Array.from(counter.warnings.entries()).map(([kind, count]) => ({
    kind,
    count,
    hint:
      kind === "image_skipped"
        ? "IMAGE fills skipped in v0.1 (Brain Q2=A). Defer v0.2 via Brain Q2-C parallel generate_figma_design imageHash capture."
        : kind === "vector_no_svg"
          ? "VECTOR node missing svgOuterHtml — emitted RECT fallback."
          : kind === "unsupported_type"
            ? "FigmaNode.type unsupported in v0.1 emitter — emitted FRAME fallback."
            : "Unknown warning.",
  }));

  return { code, estimatedOps: counter.ops, warnings };
}

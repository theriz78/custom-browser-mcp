import type { ClaudeBundle, ClaudeNode } from "./htmltoclaude.js";

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: "SOLID" | "IMAGE" | "GRADIENT_LINEAR";
  color?: FigmaColor;
  scaleMode?: "FILL" | "FIT";
  imageRef?: string;
  visible?: boolean;
}

export interface FigmaEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR";
  visible?: boolean;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  radius?: number;
}

export interface FigmaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaTextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
}

export interface FigmaStroke {
  type: "SOLID";
  color: FigmaColor;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: "FRAME" | "GROUP" | "TEXT" | "RECTANGLE" | "VECTOR" | "INSTANCE";
  absoluteBoundingBox: FigmaBoundingBox;
  fills?: FigmaPaint[];
  strokes?: FigmaStroke[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  clipsContent?: boolean;
  characters?: string;
  style?: FigmaTextStyle;
  children?: FigmaNode[];
}

export interface FigmaDocument {
  schema: "cbm/htmltofigma/v0";
  source_url: string;
  captured_at: string;
  viewport: { width: number; height: number };
  document: {
    id: "0:0";
    name: "Document";
    type: "DOCUMENT";
    children: [
      {
        id: "0:1";
        name: string;
        type: "CANVAS";
        backgroundColor: FigmaColor;
        children: FigmaNode[];
      }
    ];
  };
  warnings: { kind: string; count: number; hint: string }[];
  metrics: { nodes: number; approx_tokens: number; duration_ms: number };
}

const WHITE: FigmaColor = { r: 1, g: 1, b: 1, a: 1 };

function parseColor(input: string | undefined, tokens?: ClaudeBundle["tokens"]): FigmaColor | null {
  if (!input) return null;
  let raw = input;
  if (tokens && raw in tokens.colors) raw = tokens.colors[raw]!;
  const m = raw.match(/rgba?\(([^)]+)\)/i);
  if (!m || !m[1]) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [r, g, b, a] = parts;
  return {
    r: (r ?? 0) / 255,
    g: (g ?? 0) / 255,
    b: (b ?? 0) / 255,
    a: a === undefined ? 1 : a,
  };
}

function resolveFont(input: string | undefined, tokens?: ClaudeBundle["tokens"]): string | undefined {
  if (!input) return undefined;
  if (tokens && input in tokens.fonts) return tokens.fonts[input]!.family;
  return input;
}

function mapType(t: ClaudeNode["type"]): FigmaNode["type"] {
  switch (t) {
    case "FRAME":
      return "FRAME";
    case "TEXT":
      return "TEXT";
    case "IMAGE":
      return "RECTANGLE";
    case "SVG":
      return "VECTOR";
    case "GROUP":
      return "GROUP";
    case "INPUT":
      return "FRAME";
    default:
      return "FRAME";
  }
}

interface AdapterCounters {
  gradient_skipped: number;
  svg_outline_only: number;
  iframe_skipped: number;
  shadow_only_color_default: number;
}

function convertNode(
  n: ClaudeNode,
  tokens: ClaudeBundle["tokens"],
  counters: AdapterCounters
): FigmaNode {
  const [x, y, w, h] = n.box;
  const out: FigmaNode = {
    id: n.id,
    name: n.role ? `${n.type}:${n.role}` : n.type,
    type: mapType(n.type),
    absoluteBoundingBox: { x, y, width: w, height: h },
  };

  const fills: FigmaPaint[] = [];
  const fillColor = parseColor(n.fill, tokens);
  if (fillColor) fills.push({ type: "SOLID", color: fillColor });
  if (n.src && (n.type === "IMAGE" || n.fit)) {
    fills.push({ type: "IMAGE", imageRef: n.src, scaleMode: n.fit ?? "FILL" });
  }
  if (fills.length) out.fills = fills;

  if (n.border) {
    const sc = parseColor(n.border.color, tokens);
    if (sc) {
      out.strokes = [{ type: "SOLID", color: sc }];
      out.strokeWeight = n.border.w;
    }
  }

  if (n.radius) {
    const [tl, tr, br, bl] = n.radius;
    if (tl === tr && tr === br && br === bl) {
      out.cornerRadius = tl;
    } else {
      out.rectangleCornerRadii = [tl, tr, br, bl];
    }
  }

  if (n.clip) out.clipsContent = true;

  if (out.type === "TEXT" && n.chars) {
    out.characters = n.chars;
    const fontFamily = resolveFont(n.font, tokens);
    const fontSize = n.size ?? undefined;
    const weight = n.weight ? parseInt(n.weight, 10) : undefined;
    const style: FigmaTextStyle = {};
    if (fontFamily) style.fontFamily = fontFamily;
    if (fontSize) style.fontSize = fontSize;
    if (weight && Number.isFinite(weight)) style.fontWeight = weight;
    if (Object.keys(style).length) out.style = style;
    if (n.color) {
      const tc = parseColor(n.color, tokens);
      if (tc) out.fills = [{ type: "SOLID", color: tc }];
    }
  }

  if (n.type === "SVG") counters.svg_outline_only++;

  if (n.children?.length) {
    out.children = n.children.map((c) => convertNode(c, tokens, counters));
  }

  return out;
}

export function bundleToFigma(bundle: ClaudeBundle): FigmaDocument {
  const started = Date.now();
  const counters: AdapterCounters = {
    gradient_skipped: 0,
    svg_outline_only: 0,
    iframe_skipped: 0,
    shadow_only_color_default: 0,
  };
  for (const w of bundle.warnings) {
    if (w.kind === "bg_gradient_unmapped") counters.gradient_skipped = w.count;
    if (w.kind === "iframe_cross_origin") counters.iframe_skipped = w.count;
  }

  const children = bundle.tree.map((n) => convertNode(n, bundle.tokens, counters));
  const warnings = [
    ...bundle.warnings,
    counters.svg_outline_only > 0 && {
      kind: "svg_outline_only_v0",
      count: counters.svg_outline_only,
      hint: "SVG nodes mapped to empty VECTOR shells (no path data). Phase 3 path traversal deferred.",
    },
    counters.gradient_skipped > 0 && {
      kind: "gradient_paint_deferred",
      count: counters.gradient_skipped,
      hint: "Gradients not emitted as GRADIENT_LINEAR paints. Phase 3 parser deferred.",
    },
  ].filter((x): x is { kind: string; count: number; hint: string } => !!x);

  const doc: FigmaDocument = {
    schema: "cbm/htmltofigma/v0",
    source_url: bundle.url,
    captured_at: bundle.captured_at,
    viewport: { width: bundle.viewport.w, height: bundle.viewport.h },
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          name: bundle.url,
          type: "CANVAS",
          backgroundColor: WHITE,
          children,
        },
      ],
    },
    warnings,
    metrics: {
      nodes: 0,
      approx_tokens: 0,
      duration_ms: 0,
    },
  };

  const json = JSON.stringify(doc);
  let count = 0;
  function tally(n: FigmaNode): void {
    count++;
    if (n.children) for (const c of n.children) tally(c);
  }
  for (const c of children) tally(c);
  doc.metrics = {
    nodes: count,
    approx_tokens: Math.ceil(json.length / 4),
    duration_ms: Date.now() - started,
  };
  return doc;
}

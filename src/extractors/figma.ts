import type { ClaudeBundle, ClaudeNode } from "./htmltoclaude.js";

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaGradientStop {
  color: FigmaColor;
  position: number;
}

export interface FigmaGradientHandle {
  x: number;
  y: number;
}

export interface FigmaPaint {
  type: "SOLID" | "IMAGE" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL";
  color?: FigmaColor;
  scaleMode?: "FILL" | "FIT";
  imageRef?: string;
  visible?: boolean;
  gradientStops?: FigmaGradientStop[];
  gradientHandlePositions?: [FigmaGradientHandle, FigmaGradientHandle, FigmaGradientHandle];
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
  svgOuterHtml?: string;
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
  text_dump: string[];
  metrics: { nodes: number; approx_tokens: number; duration_ms: number };
}

const WHITE: FigmaColor = { r: 1, g: 1, b: 1, a: 1 };

function angleToHandles(angleDeg: number): [FigmaGradientHandle, FigmaGradientHandle, FigmaGradientHandle] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const cx = 0.5, cy = 0.5;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  const start: FigmaGradientHandle = { x: cx - dx, y: cy - dy };
  const end: FigmaGradientHandle = { x: cx + dx, y: cy + dy };
  const width: FigmaGradientHandle = { x: cx - dy, y: cy + dx };
  return [start, end, width];
}

function parseGradientStops(stopsRaw: string): FigmaGradientStop[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of stopsRaw) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current.trim()); current = ""; }
    else current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  const stops: FigmaGradientStop[] = [];
  parts.forEach((p, i) => {
    const m = p.match(/(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-f]{3,8}|\b[a-z]+\b)\s*(?:(\d+(?:\.\d+)?)(%|px)?)?/i);
    if (!m || !m[1]) return;
    const color = parseColor(m[1]);
    if (!color) return;
    let pos: number;
    if (m[2] !== undefined && m[3] === "%") {
      pos = parseFloat(m[2]) / 100;
    } else if (m[2] !== undefined && m[3] === "px") {
      pos = parseFloat(m[2]) === 0 ? 0 : i / Math.max(parts.length - 1, 1);
    } else if (parts.length === 1) {
      pos = 0;
    } else {
      pos = i / (parts.length - 1);
    }
    stops.push({ color, position: Math.max(0, Math.min(1, pos)) });
  });
  const seen = new Set<number>();
  return stops.filter((s) => {
    const key = Math.round(s.position * 10000);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractGradientBody(raw: string, prefix: string): string | null {
  if (!raw.startsWith(prefix + "(")) return null;
  const start = prefix.length + 1;
  let depth = 1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "(") depth++;
    else if (raw[i] === ")") {
      depth--;
      if (depth === 0) return raw.slice(start, i);
    }
  }
  return null;
}

function parseGradient(raw: string): FigmaPaint | null {
  const linearBody = extractGradientBody(raw, "linear-gradient");
  if (linearBody) {
    const body = linearBody;
    const firstComma = body.indexOf(",");
    let angleDeg = 180;
    let stopsRaw = body;
    const head = body.slice(0, firstComma).trim();
    if (/^-?\d+(?:\.\d+)?deg$/.test(head)) {
      angleDeg = parseFloat(head);
      stopsRaw = body.slice(firstComma + 1);
    } else if (/^to\s/.test(head)) {
      const dirMap: Record<string, number> = {
        "to top": 0, "to right": 90, "to bottom": 180, "to left": 270,
        "to top right": 45, "to right top": 45,
        "to bottom right": 135, "to right bottom": 135,
        "to bottom left": 225, "to left bottom": 225,
        "to top left": 315, "to left top": 315,
      };
      angleDeg = dirMap[head.toLowerCase()] ?? 180;
      stopsRaw = body.slice(firstComma + 1);
    }
    const stops = parseGradientStops(stopsRaw);
    if (stops.length < 2) return null;
    return { type: "GRADIENT_LINEAR", gradientStops: stops, gradientHandlePositions: angleToHandles(angleDeg) };
  }

  const radialBody = extractGradientBody(raw, "radial-gradient");
  if (radialBody) {
    const body = radialBody;
    const firstComma = body.indexOf(",");
    const head = body.slice(0, firstComma).trim();
    const stopsRaw = head.match(/^(circle|ellipse|closest|farthest|at\s)/i) ? body.slice(firstComma + 1) : body;
    const stops = parseGradientStops(stopsRaw);
    if (stops.length < 2) return null;
    const handles: [FigmaGradientHandle, FigmaGradientHandle, FigmaGradientHandle] = [
      { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 },
    ];
    return { type: "GRADIENT_RADIAL", gradientStops: stops, gradientHandlePositions: handles };
  }
  return null;
}

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
  gradient_mapped: number;
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
  if (n.gradient) {
    const gradPaint = parseGradient(n.gradient);
    if (gradPaint) {
      fills.push(gradPaint);
      counters.gradient_mapped++;
    } else {
      counters.gradient_skipped++;
    }
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

  if (n.type === "SVG") {
    if (n.svg) {
      out.svgOuterHtml = n.svg;
    } else {
      counters.svg_outline_only++;
    }
  }

  if (n.children?.length) {
    out.children = n.children.map((c) => convertNode(c, tokens, counters));
  }

  return out;
}

export function bundleToFigma(bundle: ClaudeBundle): FigmaDocument {
  const started = Date.now();
  const counters: AdapterCounters = {
    gradient_skipped: 0,
    gradient_mapped: 0,
    svg_outline_only: 0,
    iframe_skipped: 0,
    shadow_only_color_default: 0,
  };
  for (const w of bundle.warnings) {
    if (w.kind === "iframe_cross_origin") counters.iframe_skipped = w.count;
  }

  const upstreamWarnings = bundle.warnings.filter((w) => w.kind !== "bg_gradient_unmapped");
  const children = bundle.tree.map((n) => convertNode(n, bundle.tokens, counters));
  const warnings = [
    ...upstreamWarnings,
    counters.svg_outline_only > 0 && {
      kind: "svg_outline_only_v0",
      count: counters.svg_outline_only,
      hint: "SVG nodes mapped to empty VECTOR shells (no path data). Phase 3 path traversal deferred.",
    },
    counters.gradient_mapped > 0 && {
      kind: "gradient_paint_mapped",
      count: counters.gradient_mapped,
      hint: "CSS gradients parsed to GRADIENT_LINEAR/GRADIENT_RADIAL paints with stops + handle positions.",
    },
    counters.gradient_skipped > 0 && {
      kind: "gradient_paint_failed",
      count: counters.gradient_skipped,
      hint: "Gradient CSS string present but parser could not extract stops (conic/multi-position/edge syntax).",
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
    text_dump: bundle.text_dump ?? [],
    metrics: {
      nodes: 0,
      approx_tokens: 0,
      duration_ms: 0,
    },
  };

  let count = 0;
  function tally(n: FigmaNode): void {
    count++;
    if (n.children) for (const c of n.children) tally(c);
  }
  for (const c of children) tally(c);
  doc.metrics = {
    nodes: count,
    approx_tokens: Math.ceil(JSON.stringify(doc).length / 4),
    duration_ms: Date.now() - started,
  };
  return doc;
}

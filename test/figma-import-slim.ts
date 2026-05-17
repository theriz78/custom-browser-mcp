import { readFile, writeFile } from "node:fs/promises";

interface AnyNode {
  id: string;
  name?: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: any[];
  strokes?: any[];
  strokeWeight?: number;
  cornerRadius?: number;
  characters?: string;
  style?: any;
  clipsContent?: boolean;
  children?: AnyNode[];
}

interface Slim {
  i: string;
  t: string;
  n: string;
  b: [number, number, number, number];
  f?: { r: number; g: number; b: number; a: number };
  ch?: string;
  fs?: number;
  fw?: number;
  ff?: string;
  tc?: { r: number; g: number; b: number };
  r?: number;
  c?: number[];
}

const SRC = process.argv[2] ?? "/Users/pare/Projects/Eclectique/custom-browser-mcp/out/htmltofigma-134n.json";
const OUT = process.argv[3] ?? "/Users/pare/Projects/Eclectique/custom-browser-mcp/out/htmltofigma-134n-slim.json";

const raw = JSON.parse(await readFile(SRC, "utf-8"));
const root: AnyNode[] = raw.document.children[0].children;

function slim(n: AnyNode): Slim | null {
  if (!n.absoluteBoundingBox) return null;
  const b = n.absoluteBoundingBox;
  if (b.width < 1 || b.height < 1) return null;
  const out: Slim = {
    i: n.id,
    t: n.type,
    n: n.name ?? n.type,
    b: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
  };
  const solid = n.fills?.find((f: any) => f.type === "SOLID")?.color;
  if (solid) out.f = { r: solid.r, g: solid.g, b: solid.b, a: solid.a ?? 1 };
  if (n.characters) {
    out.ch = n.characters.slice(0, 80);
    out.fs = n.style?.fontSize ?? 14;
    out.fw = n.style?.fontWeight ?? 400;
    out.ff = n.style?.fontFamily ?? "Inter";
    const tc = n.fills?.find((f: any) => f.type === "SOLID")?.color;
    if (tc) out.tc = { r: tc.r, g: tc.g, b: tc.b };
  }
  if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) out.r = n.cornerRadius;
  if (n.children?.length) {
    const kids = n.children.map(slim).filter((x): x is Slim => !!x);
    if (kids.length) out.c = kids as any;
  }
  return out;
}

const slimTree = root.map(slim).filter((x): x is Slim => !!x);
const json = JSON.stringify(slimTree);
await writeFile(OUT, json, "utf-8");
console.log(JSON.stringify({
  src_bytes: (await readFile(SRC, "utf-8")).length,
  slim_bytes: json.length,
  reduction_pct: Math.round((1 - json.length / (await readFile(SRC, "utf-8")).length) * 100),
  nodes_top: slimTree.length,
  out: OUT,
}, null, 2));

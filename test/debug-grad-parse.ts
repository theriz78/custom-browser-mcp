// Mini repro
function parseColor(input: string): any {
  const m = input.match(/rgba?\(([^)]+)\)/i);
  if (!m || !m[1]) return null;
  const parts = m[1].split(",").map((s: string) => parseFloat(s.trim()));
  if (parts.length < 3) return null;
  const [r, g, b, a] = parts;
  return { r: (r ?? 0) / 255, g: (g ?? 0) / 255, b: (b ?? 0) / 255, a: a === undefined ? 1 : a };
}

function parseGradientStops(stopsRaw: string) {
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
  console.log("PARTS:", parts);

  const stops: any[] = [];
  parts.forEach((p, i) => {
    const m = p.match(/(rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-f]{3,8}|\b[a-z]+\b)\s*(?:(\d+(?:\.\d+)?)(%|px)?)?/i);
    console.log(`PART[${i}] '${p}' → match:`, m?.[1], m?.[2], m?.[3]);
    if (!m || !m[1]) return;
    const color = parseColor(m[1]);
    console.log(`PART[${i}] color:`, color);
    if (!color) return;
    let pos: number;
    if (m[2] !== undefined && m[3] === "%") pos = parseFloat(m[2]) / 100;
    else if (m[2] !== undefined && m[3] === "px") pos = parseFloat(m[2]) === 0 ? 0 : i / Math.max(parts.length - 1, 1);
    else if (parts.length === 1) pos = 0;
    else pos = i / (parts.length - 1);
    stops.push({ color, position: pos });
  });
  return stops;
}

const sample = "to right, rgb(34, 34, 34) 0px, rgb(34, 34, 34) 10%, rgba(255, 255, 255, 0) 10%";
// strip head "to right,"
const body = sample.replace(/^to right,\s*/, "");
console.log("BODY:", body);
console.log("\nSTOPS:", parseGradientStops(body));

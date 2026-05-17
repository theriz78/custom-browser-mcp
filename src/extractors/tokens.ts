import type { Page } from "playwright";

type ConfidenceTier = "high" | "medium" | "low";

function confidence(count: number, total: number): ConfidenceTier {
  if (total === 0) return "low";
  const ratio = count / total;
  if (ratio >= 0.15) return "high";
  if (ratio >= 0.05) return "medium";
  return "low";
}

function normalizeColor(c: string): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  if (s === "transparent" || s === "rgba(0, 0, 0, 0)" || s === "inherit") return null;
  return s;
}

function parsePx(s: string): number | null {
  const m = s.match(/^(-?[\d.]+)px$/);
  if (!m) return null;
  const n = parseFloat(m[1] ?? "");
  return Number.isFinite(n) ? n : null;
}

export async function extractTokens(page: Page): Promise<{
  colors_top: { value: string; count: number; confidence: ConfidenceTier }[];
  fonts: { family: string; weights: string[]; sample_count: number }[];
  spacing_scale: number[];
  type_scale_px: number[];
}> {
  const raw = await page.evaluate(() => {
    const colors: string[] = [];
    const fonts: Record<string, Set<string>> = {};
    const fontCounts: Record<string, number> = {};
    const margins: string[] = [];
    const paddings: string[] = [];
    const fontSizes: string[] = [];

    const els = Array.from(document.querySelectorAll<HTMLElement>("*")).slice(0, 2000);
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.color) colors.push(cs.color);
      if (cs.backgroundColor) colors.push(cs.backgroundColor);
      const famRaw = (cs.fontFamily ?? "").split(",")[0] ?? "";
      const fam = famRaw.replace(/["']/g, "").trim();
      if (fam) {
        fonts[fam] ??= new Set<string>();
        fonts[fam].add(cs.fontWeight || "400");
        fontCounts[fam] = (fontCounts[fam] ?? 0) + 1;
      }
      if (cs.margin) margins.push(cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft);
      if (cs.padding) paddings.push(cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft);
      if (cs.fontSize) fontSizes.push(cs.fontSize);
    }
    return {
      colors,
      fonts: Object.fromEntries(Object.entries(fonts).map(([k, v]) => [k, [...v]])),
      fontCounts,
      margins,
      paddings,
      fontSizes,
    };
  });

  const colorTally: Record<string, number> = {};
  for (const c of raw.colors) {
    const n = normalizeColor(c);
    if (!n) continue;
    colorTally[n] = (colorTally[n] ?? 0) + 1;
  }
  const totalColors = Object.values(colorTally).reduce((a, b) => a + b, 0);
  const colors_top = Object.entries(colorTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count, confidence: confidence(count, totalColors) }));

  const fonts = Object.entries(raw.fonts)
    .map(([family, weights]) => ({
      family,
      weights: weights as string[],
      sample_count: raw.fontCounts[family] ?? 0,
    }))
    .sort((a, b) => b.sample_count - a.sample_count)
    .slice(0, 3);

  const spacingSet = new Set<number>();
  for (const v of [...raw.margins, ...raw.paddings]) {
    const px = parsePx(v);
    if (px !== null && px >= 0 && px <= 256) spacingSet.add(px);
  }
  const spacing_scale = [...spacingSet].sort((a, b) => a - b).slice(0, 12);

  const typeSet = new Set<number>();
  for (const v of raw.fontSizes) {
    const px = parsePx(v);
    if (px !== null && px >= 8 && px <= 128) typeSet.add(px);
  }
  const type_scale_px = [...typeSet].sort((a, b) => a - b);

  return { colors_top, fonts, spacing_scale, type_scale_px };
}

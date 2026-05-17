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

export type FontSource = "system" | "webfont" | "unknown";

export interface FontEntry {
  family: string;
  weights: string[];
  styles: string[];
  stack: string[];
  sample_count: number;
  source: FontSource;
  face_urls?: string[];
}

export async function extractTokens(page: Page): Promise<{
  colors_top: { value: string; count: number; confidence: ConfidenceTier }[];
  fonts: FontEntry[];
  spacing_scale: number[];
  type_scale_px: number[];
}> {
  const raw = await page.evaluate(() => {
    const colors: string[] = [];
    const fonts: Record<string, {
      weights: Set<string>;
      styles: Set<string>;
      stack: string[];
    }> = {};
    const fontCounts: Record<string, number> = {};
    const margins: string[] = [];
    const paddings: string[] = [];
    const fontSizes: string[] = [];

    const els = Array.from(document.querySelectorAll<HTMLElement>("*")).slice(0, 2000);
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.color) colors.push(cs.color);
      if (cs.backgroundColor) colors.push(cs.backgroundColor);

      const famRaw = cs.fontFamily ?? "";
      if (famRaw) {
        const stack = famRaw
          .split(",")
          .map((s) => s.replace(/["']/g, "").trim())
          .filter((s) => s.length > 0);
        const fam = stack[0];
        if (fam) {
          if (!fonts[fam]) {
            fonts[fam] = { weights: new Set(), styles: new Set(), stack };
          } else {
            for (let i = 0; i < stack.length; i++) {
              const item = stack[i];
              if (item && !fonts[fam]!.stack.includes(item)) fonts[fam]!.stack.push(item);
            }
          }
          fonts[fam]!.weights.add(cs.fontWeight || "400");
          fonts[fam]!.styles.add((cs.fontStyle || "normal").toLowerCase());
          fontCounts[fam] = (fontCounts[fam] ?? 0) + 1;
        }
      }

      if (cs.margin) margins.push(cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft);
      if (cs.padding) paddings.push(cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft);
      if (cs.fontSize) fontSizes.push(cs.fontSize);
    }

    const fontFaces: { family: string; urls: string[] }[] = [];
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList | null = null;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule.constructor && rule.constructor.name === "CSSFontFaceRule") {
            const styleRule = rule as CSSFontFaceRule & { style: CSSStyleDeclaration };
            const fam = (styleRule.style.getPropertyValue("font-family") || "").replace(/["']/g, "").trim();
            const src = styleRule.style.getPropertyValue("src") || "";
            const urls: string[] = [];
            const re = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(src)) !== null) {
              if (m[1]) urls.push(m[1]);
            }
            if (fam) fontFaces.push({ family: fam, urls });
          }
        }
      }
    } catch {}

    const googleFontsLinks = Array.from(
      document.querySelectorAll<HTMLLinkElement>("link[href]")
    )
      .map((l) => l.href)
      .filter((h) => h.includes("fonts.googleapis.com") || h.includes("fonts.gstatic.com") || h.includes("use.typekit.net"));

    return {
      colors,
      fonts: Object.fromEntries(
        Object.entries(fonts).map(([k, v]) => [
          k,
          { weights: [...v.weights], styles: [...v.styles], stack: v.stack },
        ])
      ),
      fontCounts,
      fontFaces,
      googleFontsLinks,
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

  const faceByFamily: Record<string, string[]> = {};
  for (const f of raw.fontFaces ?? []) {
    if (!f.family) continue;
    faceByFamily[f.family] ??= [];
    for (const u of f.urls) if (!faceByFamily[f.family]!.includes(u)) faceByFamily[f.family]!.push(u);
  }
  const hasGoogleLink = (raw.googleFontsLinks ?? []).length > 0;

  function detectSource(family: string, faceUrls: string[] | undefined): FontSource {
    if (faceUrls && faceUrls.length > 0) return "webfont";
    if (hasGoogleLink) {
      const slug = family.replace(/\s+/g, "+");
      const hit = (raw.googleFontsLinks ?? []).some((h) => h.includes(`family=${slug}`) || h.includes(slug));
      if (hit) return "webfont";
    }
    const systemHints = [
      "arial",
      "helvetica",
      "times",
      "georgia",
      "courier",
      "verdana",
      "tahoma",
      "trebuchet",
      "garamond",
      "palatino",
      "monospace",
      "serif",
      "sans-serif",
      "system-ui",
      "-apple-system",
      "blinkmacsystemfont",
      "segoe ui",
      "roboto",
    ];
    const l = family.toLowerCase();
    if (systemHints.some((s) => l === s || l.startsWith(s))) return "system";
    return "unknown";
  }

  const fonts: FontEntry[] = Object.entries(raw.fonts as Record<string, { weights: string[]; styles: string[]; stack: string[] }>)
    .map(([family, info]) => {
      const faceUrls = faceByFamily[family];
      return {
        family,
        weights: info.weights,
        styles: info.styles,
        stack: info.stack,
        sample_count: raw.fontCounts[family] ?? 0,
        source: detectSource(family, faceUrls),
        ...(faceUrls && faceUrls.length ? { face_urls: faceUrls } : {}),
      };
    })
    .sort((a, b) => b.sample_count - a.sample_count)
    .slice(0, 5);

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

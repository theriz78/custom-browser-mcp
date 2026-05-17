import type { Page } from "patchright";

export interface ClaudeNode {
  id: string;
  type: "FRAME" | "TEXT" | "IMAGE" | "SVG" | "GROUP" | "INPUT";
  role?: string;
  box: [number, number, number, number];
  fill?: string;
  z?: number;
  chars?: string;
  font?: string;
  size?: number;
  weight?: string;
  color?: string;
  src?: string;
  fit?: "FILL" | "FIT";
  radius?: [number, number, number, number];
  border?: { w: number; color: string };
  clip?: boolean;
  svg?: string;
  gradient?: string;
  children?: ClaudeNode[];
}

export interface ClaudeWarning {
  kind: string;
  count: number;
  hint: string;
}

export interface ClaudeBundle {
  schema: "cbm/htmltoclaude/v0";
  url: string;
  captured_at: string;
  viewport: { w: number; h: number };
  tokens: {
    colors: Record<string, string>;
    fonts: Record<string, { family: string; weights: string[] }>;
    spacing: number[];
    type: number[];
  };
  tree: ClaudeNode[];
  text_dump: string[];
  warnings: ClaudeWarning[];
  metrics: { nodes: number; approx_tokens: number; duration_ms: number };
  extract_duration_ms?: number;
}

export interface ExtractOptions {
  maxNodes?: number;
}

export async function extractClaudeBundle(
  page: Page,
  viewport: { width: number; height: number },
  options: ExtractOptions = {}
): Promise<Omit<ClaudeBundle, "captured_at" | "metrics" | "url">> {
  const started = Date.now();
  const maxNodes = options.maxNodes ?? 800;
  const raw = await page.evaluate((injectedMaxNodes: number) => {
    type RawNode = {
      tag: string;
      role: string | null;
      box: [number, number, number, number];
      fill: string | null;
      z: number | null;
      chars: string | null;
      family: string | null;
      weight: string | null;
      size: number | null;
      color: string | null;
      src: string | null;
      fit: "FILL" | "FIT" | null;
      radius: [number, number, number, number] | null;
      border: { w: number; color: string } | null;
      clip: boolean;
      svg: string | null;
      gradient: string | null;
      hasShadowRoot: boolean;
      isIframe: boolean;
      hasGradient: boolean;
      children: RawNode[];
    };

    const counters = { shadow_dom_skipped: 0, iframe_cross_origin: 0, bg_gradient_unmapped: 0, pseudo_extracted: 0 };
    let visitedCount = 0;
    const MAX_NODES = injectedMaxNodes;

    function isHidden(el: Element): boolean {
      const cs = getComputedStyle(el as HTMLElement);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
      const op = parseFloat(cs.opacity);
      if (!Number.isNaN(op) && op === 0) return true;
      return false;
    }

    function pickRole(el: Element): string | null {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");
      if (role) return role;
      const semantic: Record<string, string> = {
        main: "main",
        nav: "navigation",
        header: "banner",
        footer: "contentinfo",
        article: "article",
        section: "region",
        button: "button",
        a: "link",
        h1: "heading",
        h2: "heading",
        h3: "heading",
        h4: "heading",
        h5: "heading",
        h6: "heading",
        ul: "list",
        ol: "list",
        li: "listitem",
        img: "img",
        input: "input",
        textarea: "input",
        select: "input",
      };
      return semantic[tag] ?? null;
    }

    function normColor(c: string | null): string | null {
      if (!c) return null;
      const s = c.trim().toLowerCase();
      if (!s || s === "transparent" || s === "rgba(0, 0, 0, 0)" || s === "inherit") return null;
      return s;
    }

    function bgUrl(bg: string): string | null {
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      return m && m[1] ? m[1] : null;
    }

    function parseRadius(cs: CSSStyleDeclaration): [number, number, number, number] | null {
      const px = (v: string) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
      };
      const tl = px(cs.borderTopLeftRadius);
      const tr = px(cs.borderTopRightRadius);
      const br = px(cs.borderBottomRightRadius);
      const bl = px(cs.borderBottomLeftRadius);
      if (tl + tr + br + bl === 0) return null;
      return [tl, tr, br, bl];
    }

    function bestType(
      el: Element,
      cs: CSSStyleDeclaration,
      hasText: boolean,
      hasFill: boolean
    ): RawNode["tag"] {
      const t = el.tagName.toLowerCase();
      if (t === "img" || t === "picture" || t === "video") return "IMAGE";
      if (t === "svg") return "SVG";
      if (t === "input" || t === "textarea" || t === "select") return "INPUT";
      if (hasText) return "TEXT";
      if (hasFill || cs.backgroundImage !== "none" || cs.boxShadow !== "none") return "FRAME";
      return "GROUP";
    }

    function getDirectText(el: Element): string {
      let s = "";
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) s += child.textContent ?? "";
      }
      return s.replace(/\s+/g, " ").trim();
    }

    function parsePseudoContent(raw: string): string | null {
      if (!raw || raw === "none" || raw === "normal") return null;
      const trimmed = raw.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
      if (trimmed.startsWith("url(") || trimmed.startsWith("counter(") || trimmed.startsWith("attr(")) return null;
      return trimmed;
    }

    function walkPseudo(el: Element, pseudo: "::before" | "::after", parentBox: DOMRect): RawNode | null {
      if (visitedCount >= MAX_NODES) return null;
      const cs = getComputedStyle(el as HTMLElement, pseudo);
      if (!cs.content || cs.content === "none" || cs.content === "normal") return null;
      if (cs.display === "none" || cs.visibility === "hidden") return null;
      const op = parseFloat(cs.opacity);
      if (!Number.isNaN(op) && op === 0) return null;

      const text = parsePseudoContent(cs.content);
      const bgUrlVal = cs.backgroundImage && cs.backgroundImage !== "none" ? bgUrl(cs.backgroundImage) : null;
      const fillColor = normColor(cs.backgroundColor);
      if (!text && !bgUrlVal && !fillColor) return null;

      visitedCount++;
      counters.pseudo_extracted++;

      const w = parseFloat(cs.width);
      const h = parseFloat(cs.height);
      const top = parseFloat(cs.top);
      const left = parseFloat(cs.left);
      const px = Number.isFinite(left) ? parentBox.left + left : parentBox.left;
      const py = Number.isFinite(top) ? parentBox.top + top : parentBox.top;
      const pw = Number.isFinite(w) && w > 0 ? w : parentBox.width;
      const ph = Number.isFinite(h) && h > 0 ? h : Math.max(parseFloat(cs.fontSize) || 16, 16);

      const fontFamily = (cs.fontFamily ?? "").split(",")[0]?.replace(/["']/g, "").trim() || null;
      const fontSizeRaw = parseFloat(cs.fontSize);
      const fontSize = Number.isFinite(fontSizeRaw) ? Math.round(fontSizeRaw) : null;
      const textColor = text ? normColor(cs.color) : null;

      return {
        tag: text ? "TEXT" : bgUrlVal ? "IMAGE" : "FRAME",
        role: `pseudo${pseudo}`,
        box: [Math.round(px), Math.round(py), Math.round(pw), Math.round(ph)],
        fill: fillColor,
        z: null,
        chars: text,
        family: fontFamily,
        weight: text ? cs.fontWeight || null : null,
        size: text ? fontSize : null,
        color: textColor,
        src: bgUrlVal,
        fit: bgUrlVal ? (cs.backgroundSize === "contain" ? "FIT" : "FILL") : null,
        radius: parseRadius(cs),
        border: null,
        clip: cs.overflow !== "visible",
        svg: null,
        gradient: null,
        hasShadowRoot: false,
        isIframe: false,
        hasGradient: cs.backgroundImage?.includes("gradient") ?? false,
        children: [],
      };
    }

    function walk(el: Element): RawNode | null {
      if (visitedCount >= MAX_NODES) return null;
      if (isHidden(el)) return null;

      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;

      visitedCount++;
      const cs = getComputedStyle(el as HTMLElement);

      const hasShadowRoot = !!(el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const isIframe = el.tagName.toLowerCase() === "iframe";
      if (isIframe) counters.iframe_cross_origin++;

      if (cs.backgroundImage && cs.backgroundImage.startsWith("linear-gradient")) {
        counters.bg_gradient_unmapped++;
      }
      if (cs.backgroundImage && cs.backgroundImage.startsWith("radial-gradient")) {
        counters.bg_gradient_unmapped++;
      }

      const fill = normColor(cs.backgroundColor);
      const directText = getDirectText(el);
      const hasText = directText.length > 0 && el.children.length === 0;

      const z = (() => {
        const n = parseInt(cs.zIndex, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const family = (cs.fontFamily ?? "").split(",")[0]?.replace(/["']/g, "").trim() || null;
      const sizeRaw = parseFloat(cs.fontSize);
      const size = Number.isFinite(sizeRaw) ? Math.round(sizeRaw) : null;
      const color = hasText ? normColor(cs.color) : null;

      let src: string | null = null;
      let fit: "FILL" | "FIT" | null = null;
      const tag = el.tagName.toLowerCase();
      if (tag === "img") {
        src = (el as HTMLImageElement).src || null;
        fit = cs.objectFit === "contain" ? "FIT" : "FILL";
      } else if (tag === "video") {
        src = (el as HTMLVideoElement).poster || null;
        fit = cs.objectFit === "contain" ? "FIT" : "FILL";
      } else if (cs.backgroundImage && cs.backgroundImage !== "none") {
        src = bgUrl(cs.backgroundImage);
        fit = cs.backgroundSize === "contain" ? "FIT" : "FILL";
      }

      const borderWidth = parseFloat(cs.borderTopWidth);
      const borderColor = normColor(cs.borderTopColor);
      const border =
        Number.isFinite(borderWidth) && borderWidth > 0 && borderColor
          ? { w: Math.round(borderWidth), color: borderColor }
          : null;

      const childrenRaw: RawNode[] = [];
      const beforeNode = walkPseudo(el, "::before", r);
      if (beforeNode) childrenRaw.push(beforeNode);

      for (const child of Array.from(el.children)) {
        const sub = walk(child);
        if (sub) childrenRaw.push(sub);
        if (visitedCount >= MAX_NODES) break;
      }

      const afterNode = walkPseudo(el, "::after", r);
      if (afterNode) childrenRaw.push(afterNode);

      const isCustomElement = el.tagName.includes("-");
      if (hasShadowRoot) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (sr) {
          for (const child of Array.from(sr.children)) {
            const sub = walk(child);
            if (sub) childrenRaw.push(sub);
            if (visitedCount >= MAX_NODES) break;
          }
        }
      } else if (isCustomElement) {
        counters.shadow_dom_skipped++;
      }

      childrenRaw.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

      const isSvg = el.tagName.toLowerCase() === "svg";
      let svgOuter: string | null = null;
      if (isSvg) {
        const html = (el as Element & { outerHTML: string }).outerHTML ?? "";
        svgOuter = html.length > 20000 ? html.slice(0, 20000) + "<!--TRUNCATED-->" : html;
      }

      let gradientRaw: string | null = null;
      if (cs.backgroundImage && (cs.backgroundImage.startsWith("linear-gradient") || cs.backgroundImage.startsWith("radial-gradient"))) {
        gradientRaw = cs.backgroundImage.length > 2000 ? cs.backgroundImage.slice(0, 2000) : cs.backgroundImage;
      }

      const node: RawNode = {
        tag: bestType(el, cs, hasText, !!fill),
        role: pickRole(el),
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        fill,
        z,
        chars: hasText ? directText : null,
        family,
        weight: hasText ? cs.fontWeight || null : null,
        size: hasText ? size : null,
        color,
        src,
        fit,
        radius: parseRadius(cs),
        border,
        clip: cs.overflow !== "visible",
        svg: svgOuter,
        gradient: gradientRaw,
        hasShadowRoot,
        isIframe,
        hasGradient: cs.backgroundImage?.includes("gradient") ?? false,
        children: childrenRaw,
      };
      return node;
    }

    const root = walk(document.body);

    const spacingValues = new Set<number>();
    const allEls = Array.from(document.querySelectorAll("body *"));
    const cap = Math.min(allEls.length, 1500);
    for (let i = 0; i < cap; i++) {
      const el = allEls[i] as HTMLElement;
      const cs = getComputedStyle(el);
      const props = [
        cs.paddingTop,
        cs.paddingRight,
        cs.paddingBottom,
        cs.paddingLeft,
        cs.marginTop,
        cs.marginRight,
        cs.marginBottom,
        cs.marginLeft,
        cs.gap,
        cs.rowGap,
        cs.columnGap,
      ];
      for (const p of props) {
        const v = parseFloat(p);
        if (Number.isFinite(v) && v > 0 && v <= 200) spacingValues.add(Math.round(v));
      }
    }
    return { root, counters, visitedCount, spacingValues: [...spacingValues] };
  }, maxNodes);

  const colors: Record<string, string> = {};
  const fonts: Record<string, { family: string; weights: string[] }> = {};
  const spacingSet = new Set<number>(raw.spacingValues);
  const typeSet = new Set<number>();

  const colorCounts = new Map<string, number>();
  const fontWeights = new Map<string, Set<string>>();

  const idMap = { i: 0 };
  function tally(n: any): void {
    if (!n) return;
    if (n.fill) colorCounts.set(n.fill, (colorCounts.get(n.fill) ?? 0) + 1);
    if (n.color) colorCounts.set(n.color, (colorCounts.get(n.color) ?? 0) + 1);
    if (n.family) {
      const s = fontWeights.get(n.family) ?? new Set<string>();
      if (n.weight) s.add(n.weight);
      fontWeights.set(n.family, s);
    }
    if (n.size) typeSet.add(n.size);
    if (n.children) for (const c of n.children) tally(c);
  }
  tally(raw.root);

  const sortedColors = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  const colorRef = new Map<string, string>();
  sortedColors.forEach(([v], i) => {
    const ref = `c${i}`;
    colors[ref] = v;
    colorRef.set(v, ref);
  });

  const fontRef = new Map<string, string>();
  [...fontWeights.entries()].forEach(([family, weights], i) => {
    const ref = `f${i}`;
    fonts[ref] = { family, weights: [...weights].sort() };
    fontRef.set(family, ref);
  });

  const filteredTypeSet = new Set<number>();
  for (const v of typeSet) {
    if (v >= 8 && v <= 128) filteredTypeSet.add(v);
  }
  typeSet.clear();
  for (const v of filteredTypeSet) typeSet.add(v);

  function ref(n: any): ClaudeNode | null {
    if (!n) return null;
    const id = `n${idMap.i++}`;
    const out: ClaudeNode = { id, type: n.tag, box: n.box };
    if (n.role) out.role = n.role;
    if (n.fill) out.fill = colorRef.get(n.fill) ?? n.fill;
    if (n.z !== null && n.z !== 0) out.z = n.z;
    if (n.chars) out.chars = n.chars;
    if (n.family) out.font = fontRef.get(n.family) ?? n.family;
    if (n.size) out.size = n.size;
    if (n.weight && n.weight !== "400") out.weight = n.weight;
    if (n.color) out.color = colorRef.get(n.color) ?? n.color;
    if (n.src) out.src = n.src;
    if (n.fit) out.fit = n.fit;
    if (n.radius) out.radius = n.radius;
    if (n.border) {
      out.border = { w: n.border.w, color: colorRef.get(n.border.color) ?? n.border.color };
    }
    if (n.clip) out.clip = true;
    if (n.svg) out.svg = n.svg;
    if (n.gradient) out.gradient = n.gradient;
    if (n.children?.length) {
      out.children = n.children.map(ref).filter((x: ClaudeNode | null): x is ClaudeNode => !!x);
    }
    return out;
  }

  const built = raw.root ? [ref(raw.root)].filter((x): x is ClaudeNode => !!x) : [];

  const pruneStats = { dropped: 0, kept: 0 };
  function isEmptyGroup(n: ClaudeNode): boolean {
    if (n.type !== "GROUP") return false;
    if (n.fill || n.chars || n.role || n.src || n.border || n.radius || n.clip) return false;
    return true;
  }
  function prune(n: ClaudeNode): ClaudeNode | null {
    if (n.children?.length) {
      const kids = n.children
        .map(prune)
        .filter((x): x is ClaudeNode => !!x);
      if (kids.length) n.children = kids;
      else delete n.children;
    }
    if (isEmptyGroup(n) && !n.children?.length) {
      pruneStats.dropped++;
      return null;
    }
    pruneStats.kept++;
    return n;
  }
  const tree = built.map(prune).filter((x): x is ClaudeNode => !!x);

  const warnings: ClaudeWarning[] = [];
  if (pruneStats.dropped > 0) {
    warnings.push({
      kind: "pruned_empty_groups",
      count: pruneStats.dropped,
      hint: `Dropped ${pruneStats.dropped} empty GROUP nodes (no fill/chars/role/src/border/radius/clip and no kept descendants). Kept ${pruneStats.kept}.`,
    });
  }
  if (raw.counters.shadow_dom_skipped > 0) {
    warnings.push({
      kind: "shadow_dom_skipped",
      count: raw.counters.shadow_dom_skipped,
      hint: "Closed shadowRoot or unaccessible — Phase 2 deeper traversal",
    });
  }
  if (raw.counters.iframe_cross_origin > 0) {
    warnings.push({
      kind: "iframe_cross_origin",
      count: raw.counters.iframe_cross_origin,
      hint: "iframe contents not traversed (cross-origin or P2 same-origin recursion deferred)",
    });
  }
  if (raw.counters.bg_gradient_unmapped > 0) {
    warnings.push({
      kind: "bg_gradient_unmapped",
      count: raw.counters.bg_gradient_unmapped,
      hint: "CSS gradients flagged; Phase 3 GradientPaint mapping deferred",
    });
  }
  if (raw.counters.pseudo_extracted > 0) {
    warnings.push({
      kind: "pseudo_extracted",
      count: raw.counters.pseudo_extracted,
      hint: "CSS ::before/::after pseudo-elements captured as synthetic children (role=pseudo::before/::after)",
    });
  }

  function collectText(nodes: ClaudeNode[], out: string[]): void {
    for (const n of nodes) {
      if (n.chars) out.push(n.chars);
      if (n.children?.length) collectText(n.children, out);
    }
  }
  const text_dump: string[] = [];
  collectText(tree, text_dump);

  const partial: Omit<ClaudeBundle, "captured_at" | "metrics" | "url"> = {
    schema: "cbm/htmltoclaude/v0",
    viewport: { w: viewport.width, h: viewport.height },
    tokens: { colors, fonts, spacing: [...spacingSet].sort((a, b) => a - b), type: [...typeSet].sort((a, b) => a - b) },
    tree,
    text_dump,
    warnings,
    extract_duration_ms: Date.now() - started,
  };
  return partial;
}

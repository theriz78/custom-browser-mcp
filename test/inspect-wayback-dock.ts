import { chromium } from "playwright";

const URL = "https://web.archive.org/web/20240108214548/https://www.awwwards.com/";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });

const probe = await page.evaluate(() => {
  const dock = document.querySelector(".menu-float");
  if (!dock) return { err: "no .menu-float" };

  const queries = [
    ".menu-float__trigger",
    ".menu-float__top",
    ".menu-float__menu",
    ".menu-float__menu-content",
    ".menu-float__menu--main",
    ".menu-float__menu-col",
    ".menu-float .hamburger",
    "[data-toggle-menu]",
    "[data-menu-trigger]",
  ];
  const found: Record<string, { count: number; display?: string; visibility?: string; opacity?: string; height?: number } | null> = {};
  for (const q of queries) {
    const els = document.querySelectorAll(q);
    if (els.length === 0) { found[q] = null; continue; }
    const first = els[0] as HTMLElement;
    const cs = getComputedStyle(first);
    found[q] = {
      count: els.length,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      height: first.offsetHeight,
    };
  }

  const dockHtml = dock.outerHTML.slice(0, 2000);
  const dockChildren = Array.from(dock.children).map((c) => ({
    tag: c.tagName.toLowerCase(),
    cls: c.className,
    childCount: c.children.length,
  }));

  return { found, dockChildren, dockHtmlPreview: dockHtml };
});

console.log(JSON.stringify(probe, null, 2));

await browser.close();

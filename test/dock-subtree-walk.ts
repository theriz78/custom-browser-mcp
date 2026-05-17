import { chromium } from "playwright";

const URL = "https://web.archive.org/web/20240108214548/https://www.awwwards.com/";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const SCRIPT = `
  (() => {
    const css = \`
      .menu-float, .menu-float * { overflow: visible !important; }
      .menu-float__wrapper { min-width: 1200px !important; height: auto !important; width: auto !important; }
      .menu-float__top, .menu-float__menu, .menu-float__menu-content, .menu-float__menu--main {
        display: block !important; visibility: visible !important; opacity: 1 !important;
        height: auto !important; max-height: none !important; width: 100% !important; min-width: 800px !important;
      }
      .menu-float__menu-col { display: inline-block !important; vertical-align: top; padding: 12px; width: auto !important; }
      .menu-float { height: auto !important; min-height: 480px !important; bottom: 30px !important; width: 100% !important; }
    \`;
    const style = document.createElement('style'); style.id = 'force-dock-expand'; style.textContent = css;
    document.head.appendChild(style);
    return { injected: true };
  })()
`;

async function countDockOnly(scriptToRun: string | null): Promise<{ totalNodes: number; visibleNodes: number; capturedNodes: number }> {
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  if (scriptToRun) {
    await page.evaluate(scriptToRun);
    await page.waitForTimeout(500);
  }
  const counts = await page.evaluate(() => {
    function isHidden(el: Element): boolean {
      const cs = getComputedStyle(el as HTMLElement);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
      const op = parseFloat(cs.opacity);
      if (!Number.isNaN(op) && op === 0) return true;
      return false;
    }
    function walk(el: Element, mode: "all" | "filter" | "extractor"): number {
      if (mode !== "all" && isHidden(el)) return 0;
      if (mode === "extractor") {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return 0;
      }
      let n = 1;
      for (const c of Array.from(el.children)) n += walk(c, mode);
      return n;
    }
    const dock = document.querySelector(".menu-float") as Element;
    if (!dock) return { totalNodes: 0, visibleNodes: 0, capturedNodes: 0 };
    return {
      totalNodes: walk(dock, "all"),
      visibleNodes: walk(dock, "filter"),
      capturedNodes: walk(dock, "extractor"),
    };
  });
  await page.close();
  return counts;
}

console.log("=== FOLDED (no script) ===");
console.log(await countDockOnly(null));

console.log("\n=== EXPANDED (with CSS inject) ===");
console.log(await countDockOnly(SCRIPT));

await browser.close();

import { chromium } from "playwright";

const URL = "https://web.archive.org/web/20240108214548/https://www.awwwards.com/";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });

// Apply EBM-style pre_render_script (same as smoke-dock)
const SCRIPT = `
  (() => {
    const css = \`
      .menu-float, .menu-float * { overflow: visible !important; }
      .menu-float__wrapper { min-width: 1200px !important; height: auto !important; }
      .menu-float__top,
      .menu-float__menu,
      .menu-float__menu-content,
      .menu-float__menu--main {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: auto !important;
        max-height: none !important;
      }
      .menu-float__menu-col { display: inline-block !important; vertical-align: top; padding: 12px; }
      .menu-float { height: auto !important; min-height: 480px !important; bottom: 30px !important; }
    \`;
    const style = document.createElement('style');
    style.id = 'force-dock-expand';
    style.textContent = css;
    document.head.appendChild(style);
    return { injected: true, styleId: style.id };
  })()
`;

const injectResult = await page.evaluate(SCRIPT);
console.log("inject result:", injectResult);

await page.waitForTimeout(500);

// Probe AFTER injection
const probe = await page.evaluate(() => {
  const get = (sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      height: cs.height,
      computedH: r.height,
      computedW: r.width,
      childCount: el.children.length,
    };
  };
  const sheetInjected = !!document.getElementById('force-dock-expand');
  return {
    sheetInjected,
    menuFloat: get(".menu-float"),
    inner: get(".menu-float .inner"),
    innerInner: get(".menu-float__inner"),
    wrapper: get(".menu-float__wrapper"),
    top: get(".menu-float__top"),
    menu: get(".menu-float__menu"),
    menuMain: get("#menu-main"),
    menuContent: get(".menu-float__menu-content"),
    menuMainCls: get(".menu-float__menu--main"),
    menuCol: get(".menu-float__menu-col"),
    // Count menu-col elements visible (parents not display:none)
    menuColCountVisible: (() => {
      const cols = document.querySelectorAll(".menu-float__menu-col");
      let visible = 0;
      cols.forEach(c => {
        let cur: HTMLElement | null = c as HTMLElement;
        let hidden = false;
        while (cur) {
          const cs = getComputedStyle(cur);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) { hidden = true; break; }
          cur = cur.parentElement;
        }
        if (!hidden) visible++;
      });
      return { total: cols.length, visible };
    })(),
  };
});

console.log(JSON.stringify(probe, null, 2));

await browser.close();

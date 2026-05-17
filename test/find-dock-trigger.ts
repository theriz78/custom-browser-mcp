import { chromium } from "playwright";

const URL = "https://web.archive.org/web/20240108214548/https://www.awwwards.com/";

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });

// Capture initial state
const before = await page.evaluate(() => {
  const dock = document.querySelector(".menu-float");
  return {
    dockClass: dock?.className,
    bodyClass: document.body.className,
    htmlClass: document.documentElement.className,
    menuOpen: !!document.querySelector(".menu-float__menu[style*='display: block'], .menu-float__menu.is-active, .menu-float__menu.is-open, .menu-float__menu.active"),
  };
});

// Find clickable elements inside dock that might toggle the menu
const candidates = await page.evaluate(() => {
  const dock = document.querySelector(".menu-float");
  if (!dock) return [];
  const all = dock.querySelectorAll('a, button, [role="button"], [class*="btn"], [class*="trigger"], [class*="toggle"], [class*="hamburger"], [data-toggle], svg');
  const items: any[] = [];
  for (const el of Array.from(all)) {
    const r = el.getBoundingClientRect();
    items.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className?.toString().slice(0, 100),
      href: (el as HTMLAnchorElement).href ?? null,
      text: (el.textContent ?? "").trim().slice(0, 50),
      visible: r.width > 0 && r.height > 0,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  return items;
});

console.log("BEFORE click:", JSON.stringify(before, null, 2));
console.log("CANDIDATES:", JSON.stringify(candidates, null, 2));

// Try clicking each visible candidate, observe class changes
console.log("\n--- Probing clicks ---");
for (let i = 0; i < Math.min(candidates.length, 10); i++) {
  const c = candidates[i];
  if (!c.visible) continue;
  // Click at center
  await page.mouse.click(c.x + c.w / 2, c.y + c.h / 2);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const dock = document.querySelector(".menu-float");
    const menu = document.querySelector(".menu-float__menu");
    return {
      dockClass: dock?.className,
      menuClass: menu?.className,
      menuDisplay: menu ? getComputedStyle(menu).display : null,
      menuVisible: menu ? (menu as HTMLElement).offsetHeight > 0 : false,
    };
  });
  console.log(`Click #${i} (${c.cls.slice(0, 30)} | ${c.text}):`, JSON.stringify(after));
  if (after.menuVisible) {
    console.log(`>>> MENU OPENED by click #${i} <<<`);
    break;
  }
}

await page.waitForTimeout(2000);
await browser.close();

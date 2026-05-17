import { chromium } from "playwright";

const URL = "https://web.archive.org/web/20240108214548/https://www.awwwards.com/";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });

async function snap(label: string) {
  return await page.evaluate(() => {
    const dock = document.querySelector(".menu-float") as HTMLElement | null;
    const menu = document.querySelector(".menu-float__menu") as HTMLElement | null;
    const content = document.querySelector(".menu-float__menu-content") as HTMLElement | null;
    const cols = document.querySelectorAll(".menu-float__menu-col");
    let visibleCols = 0;
    cols.forEach(c => { if ((c as HTMLElement).offsetHeight > 0) visibleCols++; });
    return {
      dockClass: dock?.className ?? null,
      dockH: dock?.offsetHeight ?? null,
      menuClass: menu?.className ?? null,
      menuDisplay: menu ? getComputedStyle(menu).display : null,
      menuH: menu?.offsetHeight ?? null,
      contentClass: content?.className ?? null,
      contentOpacity: content ? getComputedStyle(content).opacity : null,
      contentH: content?.offsetHeight ?? null,
      cols: cols.length,
      visibleCols,
    };
  });
}

console.log("BEFORE:", await snap("before"));

// Click the hamburger
await page.evaluate(() => {
  const h = document.querySelector(".menu-float__hamburger") as HTMLElement;
  h?.click();
});
await page.waitForTimeout(500);
console.log("AFTER hamburger click:", await snap("after-hamburger"));

// Try also clicking SOTD / Home anchors
await page.evaluate(() => {
  const anchors = document.querySelectorAll(".menu-float__item.js-menu-anchor");
  anchors.forEach(a => console.log(a.textContent));
});

// Click the FIRST js-menu-anchor (likely 'Home')
await page.evaluate(() => {
  const first = document.querySelector(".menu-float__item.js-menu-anchor") as HTMLElement;
  first?.click();
});
await page.waitForTimeout(500);
console.log("AFTER first anchor click:", await snap("after-anchor"));

await browser.close();

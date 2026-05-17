import type { BrowserContext, Page } from "playwright";

const ACCEPT_SELECTORS = [
  'button:has-text("Accept all cookies")',
  'button:has-text("Allow all cookies")',
  'button:has-text("Accept all")',
  'button:has-text("Allow all")',
  'button:has-text("Accept cookies")',
  'button:has-text("Accept")',
  'button:has-text("Tout accepter")',
  'button:has-text("Autoriser tous les cookies")',
  'button:has-text("Autoriser tout")',
  'button:has-text("Autoriser")',
  'button:has-text("Tout accepter et fermer")',
  'button:has-text("J\'accepte")',
  'button:has-text("OK pour moi")',
  'button[id*="accept" i]:visible',
  'button[class*="accept" i]:visible',
  'button[data-testid*="accept" i]:visible',
  '[aria-label*="accept all" i]',
  '[aria-label*="accept cookies" i]',
  '[aria-label*="autoriser tous" i]',
  '#onetrust-accept-btn-handler',
  '#truste-consent-button',
  '#didomi-notice-agree-button',
  '.fc-button.fc-cta-consent',
];

export interface CookieConsentResult {
  attempted: boolean;
  accepted: boolean;
  selector_matched?: string;
  duration_ms: number;
}

export async function acceptCookieConsent(
  page: Page,
  timeoutMs = 2500
): Promise<CookieConsentResult> {
  const started = Date.now();
  for (const sel of ACCEPT_SELECTORS) {
    try {
      const locator = page.locator(sel).first();
      const count = await locator.count();
      if (count === 0) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      await locator.click({ timeout: 1000, force: false });
      await page.waitForTimeout(400);
      return {
        attempted: true,
        accepted: true,
        selector_matched: sel,
        duration_ms: Date.now() - started,
      };
    } catch {
      continue;
    }
    if (Date.now() - started > timeoutMs) break;
  }
  return { attempted: true, accepted: false, duration_ms: Date.now() - started };
}

export async function clearCookiesAndStorage(
  context: BrowserContext,
  page?: Page | null
): Promise<void> {
  try {
    await context.clearCookies();
  } catch {}
  if (page && !page.isClosed()) {
    try {
      await page.evaluate(() => {
        try {
          localStorage.clear();
        } catch {}
        try {
          sessionStorage.clear();
        } catch {}
      });
    } catch {}
  }
}

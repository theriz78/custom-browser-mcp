import type { BrowserContext, Page } from "playwright";

const CMP_ACCEPT_SELECTORS: string[] = [
  "#onetrust-accept-btn-handler",
  "#didomi-notice-agree-button",
  "#truste-consent-button",
  "#hs-eu-confirmation-button",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#cookiescript_accept",
  ".fc-button.fc-cta-consent",
  '[data-testid="uc-accept-all-button"]',
  '[data-cy="cookie-banner-accept-all"]',
  ".js-cookie-banner-accept-all",
  '[aria-label="Accept all" i]',
  '[aria-label="Allow all" i]',
  '[aria-label="Tout accepter" i]',
  '[aria-label="Autoriser tous les cookies" i]',
  '[id*="qc-cmp2"] button[mode="primary"]',
  ".tp-cm-allow-button",
];

const BANNER_ANCESTOR_HINTS = [
  "cookie",
  "consent",
  "gdpr",
  "ccpa",
  "privacy",
  "onetrust",
  "didomi",
  "truste",
  "cybot",
  "cookiebot",
  "cookiescript",
  "qc-cmp",
];

export interface CookieConsentResult {
  attempted: boolean;
  accepted: boolean;
  selector_matched?: string;
  duration_ms: number;
  errors?: string[];
}

async function clickIfBannerAncestor(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  if (count === 0) return false;
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) return false;
  const isInBanner = await locator
    .evaluate(
      (el: Element, hints: string[]) => {
        let cur: Element | null = el;
        for (let depth = 0; depth < 8 && cur; depth++) {
          const ident = `${cur.id ?? ""} ${cur.className ?? ""}`.toLowerCase();
          if (hints.some((h) => ident.includes(h))) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      BANNER_ANCESTOR_HINTS
    )
    .catch(() => false);
  if (!isInBanner) return false;
  await locator.click({ timeout: 800, force: false, trial: false });
  return true;
}

export async function acceptCookieConsent(
  page: Page,
  timeoutMs = 2500
): Promise<CookieConsentResult> {
  const started = Date.now();
  const errors: string[] = [];
  for (const sel of CMP_ACCEPT_SELECTORS) {
    if (Date.now() - started > timeoutMs) break;
    try {
      const clicked = await clickIfBannerAncestor(page, sel);
      if (clicked) {
        await page.waitForTimeout(400);
        return {
          attempted: true,
          accepted: true,
          selector_matched: sel,
          duration_ms: Date.now() - started,
          ...(errors.length ? { errors } : {}),
        };
      }
    } catch (e) {
      errors.push(`${sel}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return {
    attempted: true,
    accepted: false,
    duration_ms: Date.now() - started,
    ...(errors.length ? { errors } : {}),
  };
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
      await page.evaluate(async () => {
        try {
          localStorage.clear();
        } catch {}
        try {
          sessionStorage.clear();
        } catch {}
        try {
          if ("indexedDB" in window && indexedDB.databases) {
            const dbs = await indexedDB.databases();
            await Promise.all(
              dbs.map((d) => {
                if (!d.name) return Promise.resolve();
                return new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(d.name!);
                  req.onsuccess = () => resolve();
                  req.onerror = () => resolve();
                  req.onblocked = () => resolve();
                });
              })
            );
          }
        } catch {}
        try {
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {}
        try {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
          }
        } catch {}
      });
    } catch {}
  }
}

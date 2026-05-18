---
title: "PROBE — Feature #3 : Multi-viewport × Theme matrix"
session: S62
date: 2026-05-18
status: draft
chain_id: ebm-feature-steal
related: research/RFC-EBM-HYBRID-S61.md, research/HTMLTODESIGN-ECOSYSTEM-S60.md
---

# PROBE — Multi-viewport × Theme matrix (EBM v0.10 draft)

## 1. Goal

Permettre à un single call MCP de scraper un site sur N viewports × M themes simultanément, retourner un bundle multi-axis. Differentiator vs `html.to.design` (single-viewport, single-theme).

### Use cases

- **Responsive DS audit** : designer veut layouts mobile/tablet/desktop d'un coup pour cross-comparison breakpoints.
- **Dark mode parity check** : DS audit — verify tokens light vs dark sont coherent (count, scale, fonts) + flag drifts.
- **Awwwards competitive study** : capture matrix d'un ref site, extract tokens cross-axis, feed Brain/Figma.
- **Hub DA validation** : tokens 87C light + dark sur 3 breakpoints en 1 call avant push to Figma.

## 2. API shape — options A/B/C

**A) Nouveau tool `to_claude_matrix`** — explicit multi-axis. Pros: clean separation, single-shot tool reste rapide single-axis. Cons: duplique 80% logique.

**B) Extend `to_claude` + `analyze_page`** avec `viewports?: Viewport[]` + `themes?: Theme[]` optional. Si absent, behavior actuel. Pros: DRY, retro-compat. Cons: output shape branche conditionnel (Bundle vs Bundle[]).

**C) Wrapper tool `to_claude_matrix` qui orchestre N calls `to_claude` en interne** — sequentiel par défaut, opt-in parallel. Pros: zéro duplication, reuse extractors. Cons: overhead context-reset par axis (cf §4).

→ **Reco** : C (wrapper qui itère + collecte) — minimise drift, leverage code existant. Si Patchright hang persiste, fallback B (single context, emulate-only).

## 3. Theme detection strategy

3 strategies, classées par robustesse :

1. **`page.emulateMedia({ colorScheme: 'dark' })`** (Playwright native) — flips `prefers-color-scheme` media query browser-level. Marche pour ~70% des sites modernes (Tailwind `dark:` variant, CSS `@media`).
2. **`[data-theme="dark"]` html attribute injection** — `await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))`. Couvre sites avec toggle JS-driven (shadcn, Radix UI).
3. **CSS class `.dark` toggle** — `documentElement.classList.add('dark')`. Tailwind default config.

→ **Reco** : appliquer les 3 en cascade (1 d'abord, puis 2+3 best-effort), `pre_render_delay_ms` pour laisser le repaint. Log dans `bundle.theme_detection.strategy_used`.

## 4. Parallel vs sequential — Patchright caveat

**Connu (S62-d1)** : Patchright + viewport switch mid-session = hang sur le shared persistent context (cf `src/lib/browser.ts:67-89`, `getSharedContext` close+relaunch si viewport change).

3 strategies :

- **Sequential close-and-fresh-launch** (~6 × 30s = 180s wall worst case) — safe, leverage `closeSharedContext()` existant entre axes. RAM = 1× browser steady.
- **Parallel separate persistent contexts** (3× simultaneous browsers, themes en emulate sur chaque) — 30-45s wall, 3× RAM (~1.5GB). Bloqué par `USER_DATA_DIR` lock partagé (Patchright persistent = 1 lock par UDD).
- **Single context, emulate viewport via CDP** (`Emulation.setDeviceMetricsOverride`) — bypass Patchright `setViewportSize` hang. Wall ~10-15s × 6 = 60-90s. Risque : auth state preserved (good for §8), mais layout drift possible si site sniffe `window.matchMedia('(max-width:...)')` au lieu de width literal.

→ **Reco** : sequential close-and-fresh par viewport (outer loop) + `emulateMedia` par theme dans le même context (inner loop). 3 launches total, 6 page.goto. Wall ~90-120s budget.

## 5. Output schema proposal

### Option matrix-nested (verbose, explicit)

```yaml
schema_version: "1.3.0"
url: ...
matrix:
  mobile_375:
    light: { a11y, tokens, screenshot }
    dark:  { a11y, tokens, screenshot }
  tablet_768:
    light: { ... }
    dark:  { ... }
  desktop_1440:
    light: { ... }
    dark:  { ... }
theme_diff:
  tokens_light_vs_dark:
    colors_top_added: [...]
    colors_top_removed: [...]
    fonts_changed: false
    spacing_scale_drift: 0
viewport_diff:
  layout_breakpoint_signals: [...]
```

### Option collapsed-axis (`tokens.matrix.{viewport}.{theme}`)

Plus compact mais perd lisibilité a11y/screenshot par axis. Skip.

→ **Reco** : matrix-nested + `theme_diff` block computed post-extract. Bundle reste backward-compat (single `Bundle` returned si 1 viewport × 1 theme).

## 6. Token diff detection

Post-extract step `computeThemeDiff(light, dark)` :

- `colors_top` : set diff (additions/removals/count drift)
- `fonts` : family set diff (rare cross-theme)
- `spacing_scale` + `type_scale_px` : array equality check, drift signal si > 10% delta
- Flag `tokens.theme_diff.parity = "full" | "partial" | "absent"` — quick read for DS audit

Out of scope V1 : per-element color mapping (light→dark token pairing). Defer V1.1.

## 7. Open questions — A/B/C

- **Q1 API shape** : A) new tool, B) extend, C) wrapper → reco **C**.
- **Q2 Theme detection** : 3-strategy cascade — accept ou simplifier à `emulateMedia` only ?
- **Q3 Concurrency** : sequential outer-viewport / inner-emulate-theme (reco) vs parallel 3× UDD ?
- **Q4 Default viewports** : preset {375×667, 768×1024, 1440×900} ou demander chaque call ?
- **Q5 Theme diff** : ship V1 ou defer V1.1 ?
- **Q6 Timeout budget** : 30s × 6 = 180s default, ou 90s wall avec aggressive timeout per-axis ?

## 8. Auth state (`seed_auth_session`)

Sequential approach **preserve UDD cookies cross-axis** par défaut (même `USER_DATA_DIR`, `clear_cookies_after: false` requis). 6 page.goto réutilisent session. **Caveat** : si `clear_cookies_after: true` (default actuel), session sautée entre axes → forcer `false` quand matrix mode actif, ou injecter clear UNIQUEMENT après dernier axis.

## 9. Default viewports preset

```ts
const DEFAULT_MATRIX_VIEWPORTS = [
  { width: 375,  height: 667,  label: "mobile" },
  { width: 768,  height: 1024, label: "tablet" },
  { width: 1440, height: 900,  label: "desktop" },
];
const DEFAULT_THEMES = ["light", "dark"] as const;
```

Customizable via input. Hard cap N×M ≤ 12 (4 viewports × 3 themes max) pour éviter abuse.

## 10. Ship estimate (TP)

- API + schema bump 1.3.0 + zod : **0.5j**
- Wrapper sequential loop + theme cascade : **1j**
- Theme diff util : **0.5j**
- Tests bun:test (mock 1 site Tailwind dark) : **0.5j**
- Patchright hang workaround validation : **0.5j buffer**
- README + example : **0.25j**

**Total ~3-3.5 jours TP** si Q1=C accepté.

## 11. Risks

- **R1 Patchright hang** (S62-d1) : viewport switch mid-session crash. Mitigé par sequential close-relaunch, mais x3 launch cost (~3-5s per).
- **R2 Network load** : 6× page.goto sur même url = 6× full reload. Sites avec heavy CDN/analytics peuvent rate-limit. Mitigation : `wait_until: "domcontentloaded"` default matrix mode au lieu de `networkidle`.
- **R3 Auth state drift** : si session expire mid-matrix (15min budget). Mitigation : check cookies post-axis 3, warn si auth lost.
- **R4 Site detects rapid-fire reloads** : Cloudflare/DataDome flag. Mitigation : random `pre_render_delay_ms` 500-1500ms entre axes.
- **R5 Theme detect false-negative** : site avec custom JS toggle non-standard. Mitigation : warning bundle si emulateMedia + data-theme + .dark tous échouent à muter `getComputedStyle(body).backgroundColor`.
- **R6 Memory blow-up screenshots** : 6 full-page PNG × 2-5MB = 30MB par call. Mitigation : screenshot opt-out per-axis ou `viewport`-only screenshots default matrix mode.

## 12. Sources

- [Playwright emulateMedia colorScheme](https://playwright.dev/docs/api/class-page#page-emulate-media)
- [Playwright Emulation guide](https://playwright.dev/docs/emulation)
- [Mid-test colorScheme switch](https://playwrightsolutions.com/is-it-possible-to-change-colorscheme-in-the-middle-of-a-playwright-tests/)
- [Force dark-mode issue #15345](https://github.com/microsoft/playwright/issues/15345)
- [Visual regression small screens](https://sergeipetrukhin.vercel.app/playwright-visual-small-screens)
- [Playwright multi-viewport visual testing 2026](https://testdino.com/blog/playwright-visual-testing)
- EBM internal: `src/lib/browser.ts`, `src/tools/to_claude.ts`, `src/schemas/output.ts`
- Related: `research/RFC-EBM-HYBRID-S61.md`, `research/HTMLTODESIGN-ECOSYSTEM-S60.md`

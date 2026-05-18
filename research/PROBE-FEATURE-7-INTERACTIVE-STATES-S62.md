# PROBE — Feature #7 : Interactive-State Recorder

> S62 spec brouillon read-only — pas de code. Décision A/B/C en fin.
> EBM v0.9.0 → v0.10.0 candidate. Compete vs html.to.design (capture hover only, technique non documentée).

## 1. Goal

Capturer les **variants d'état interactif** des composants UI clés (buttons, links, inputs) et les exposer dans le bundle EBM. États ciblés : `default` / `hover` / `focus-visible` / `active` / `disabled`. Output utilisable comme matière pour Figma component variants (Phase 3+) ou audit de design system.

### Use cases concrets

- **DS audit interne (Eclectique hub)** : extraire les variants du bouton `<Button>` avec leurs tokens diffs (fill, color, border, shadow par state). Vérifier cohérence cross-pages.
- **Veille Awwwards** : comprendre comment Vivien / Heredesign / Peakline traitent leurs micro-interactions (couleur, scale, glow). Récupérer les tokens diff par state.
- **Figma component generation (Phase 3+)** : multi-state snapshot → ComponentSet avec variants `state=default|hover|focus|active|disabled`.
- **Audit accessibilité** : `focus-visible` respecté (outline visible, contrast WCAG) ? Détection automatique des composants sans focus state distinct.

## 2. API shape — 2 options

### Option A : New dedicated tool `record_interactive_states`
```ts
{
  url: string,
  selectors?: string[],            // override auto-detect
  states?: ("hover"|"focus"|"active"|"disabled")[],
  max_elements?: number,            // default 10
  capture_screenshot?: boolean,     // per state mini-crop
  // + standard EBM params (viewport, cookies, pre_render_script, ...)
}
```
**Pour** : isolation cognitive, tool spécialisé, output schema dédié, opt-in coût.
**Contre** : 5e tool (4 existants), ajoute surface MCP.

### Option B : Extend `to_claude` + `analyze_page` avec flag
```ts
{ ..., interactive_states?: boolean | { selectors?, states?, cap? } }
```
**Pour** : 0 nouveau tool, intégré au bundle existant, user familier.
**Contre** : pollue le bundle "static" avec données coûteuses, time budget explose silencieusement.

**Reco** : **A** — feature payante (en latence), opt-in explicite. Reuse 100% du pipeline `getSharedContext` + cookie consent + `pre_render_script` via factor commun `src/lib/page-prepare.ts`.

## 3. State trigger strategies

| Strategy | Pros | Cons | Reliability headless |
|---|---|---|---|
| **A. Native Playwright** (`page.hover()`, `locator.focus()`, `mouse.down()` + screenshot) | Comportement exact, respecte `:focus-visible` heuristic réelle | 1 trigger ≈ 200-400ms (mousemove + paint). 10 elem × 4 states ≈ 12-16s | Variable (`:focus-visible` peut échouer headless, Issue #29575) |
| **B. CDP `CSS.forcePseudoState`** | Atomique, ~5ms, déterministe, supporte `hover/active/focus/visited` simultanément | `:focus-visible` non listé dans CDP — fallback `focus` only. Patchright expose `CDPSession` ? À vérifier | Excellent (mais focus-visible gap) |
| **C. CSS injection fake-class** (`document.body.classList.add(...)` + rule `[data-ebm-hover] :hover { ... }`) | 0 dépendance browser API, portable | Re-écrit CSS du site (fragile sur `:hover` chained selectors), n'attrape pas pseudo-elements `::before:hover`. **Pas recommandé.** | Médiocre |

**Reco** : **Hybrid B-first / A-fallback** — CDP `forcePseudoState` pour hover/active (rapide, fiable). Native Playwright `locator.focus()` pour focus-visible (CDP gap). `disabled` → pas un trigger, lecture attribut `[disabled]` / `[aria-disabled="true"]`. Patchright = fork Playwright avec stealth → CDPSession exposé via `context.newCDPSession(page)` (à confirmer).

## 4. Element selection heuristic

Auto-detect default selector list (override possible via `selectors[]`) :
```
button, a[href], input:not([type=hidden]), select, textarea,
[role="button"], [role="link"], [role="menuitem"], [role="tab"],
[tabindex]:not([tabindex="-1"])
```

**Filtres post-selection** :
- visible (déjà testé via `isHidden` dans `htmltoclaude.ts`)
- bounding box ≥ 16×16px (ignore micro-icons)
- **dedupe par signature visuelle** : hash (`tag + classList + computed-fill + computed-color`) → garde 1 sample par classe. Empêche capture des 30 `<a>` du nav identiques.
- cap default **10 éléments** post-dedupe. User override possible.

Risk : sites Awwwards avec composants tous "uniques" → cap saturé sur le 1er fold, perd compos hero. Mitigation : `scroll_strategy: "viewport"|"full_page_sample"` (sample 1 par section ?). Hors scope V1.

## 5. Output schema proposal

Ajout au bundle existant (ou réponse dédiée si Option A) :
```yaml
interactive_states:
  schema: "cbm/states/v0"
  elements:
    - selector: "button.cta-primary"          # CSS path stable
      label: "Réserver un appel"              # innerText short
      role: "button"
      box: [120, 480, 200, 48]
      states:
        default:
          tokens: { fill: "c0", color: "c2", border: null, radius: [8,8,8,8] }
          screenshot: "out/states/abc-default.png"     # optional
        hover:
          tokens: { fill: "c1", color: "c2", border: {w:1,color:"c0"}, transform: "scale(1.02)" }
          diff_from_default: ["fill", "border", "transform"]
          screenshot: "out/states/abc-hover.png"
        focus:
          tokens: { outline: { w:2, color:"c3", offset:2 } }
          diff_from_default: ["outline"]
          wcag_contrast_pass: true              # bonus accessibility
        active:
          tokens: { fill: "c4", transform: "scale(0.98)" }
          diff_from_default: ["fill", "transform"]
        disabled:
          available: false                      # element not [disabled]-able
  metrics:
    elements_attempted: 10
    elements_captured: 9
    states_captured: 32          # 9 elem × ~3.5 states avg
    duration_ms: 4200
```

`diff_from_default` = liste des keys qui ont changé vs `default` → Figma variant property generation directe (`Phase 3+`).

## 6. Time budget + cap defaults

| Scenario | Elements | States | Per-state cost | Total |
|---|---|---|---|---|
| Default V1 | 10 (post-dedupe) | 4 (default + 3) | ~150ms (CDP) | ~6s |
| Heavy site override | 30 | 5 | ~200ms | ~30s |
| Screenshot per state ON | 10 | 4 | ~600ms | ~24s |

Hard cap proposed : `max_elements: 20`, `max_states_per_element: 5`, total duration ceiling **45s** avant abort + warning.

## 7. Open questions A/B/C

### Q1 — API surface
- A) New tool `record_interactive_states` (reco)
- B) Flag `interactive_states` sur `to_claude` + `analyze_page`
- C) Les deux (tool dédié + flag léger 2-state pour `to_claude`)

### Q2 — Trigger strategy default
- A) CDP-first + native fallback (reco)
- B) Native-only (plus simple, ~3× plus lent)
- C) CSS injection fake-class (NE PAS — fragile)

### Q3 — Screenshot per state
- A) OFF default, opt-in via `capture_screenshot: true` (reco — économise temps + disque)
- B) ON default (UX immédiat mais 24s vs 6s)
- C) Tokens-diff only, jamais screenshot (Phase 3 Figma fait le rendu)

### Q4 — focus-visible quirk Patchright
- A) Documenter limite + livrer focus standard (reco — ship V1)
- B) Block ship jusqu'à fix upstream (peut prendre des mois)
- C) Heuristic JS : injecter `:focus-visible { outline: ... }` polyfill + lire computed (hack)

## 8. Ship estimate

- **V1 minimal (Option A + Q2-A + Q3-A)** : 1.5-2 jours TP
  - factor commun `lib/page-prepare.ts` (extract from `to_claude.ts` + `analyze_page.ts`) : 3h
  - CDP `forcePseudoState` wrapper + fallback native : 3h
  - element auto-detect + dedupe : 2h
  - tokens diff extractor (reuse `htmltoclaude.ts` walk on single element) : 3h
  - output schema + tests sample sites (3 fixtures) : 3h
  - README + examples/states-sample.yaml : 1h
- **V2 enrichissements (screenshot, scroll sampling, Figma variant emit)** : +2 jours

## 9. Risks

1. **Patchright headless `:focus-visible`** (Playwright Issue #29575) : keyboard-induced focus declenche focus-visible, programmatic `focus()` souvent non. Mitigation : tester pre-merge sur 5 sites, documenter dans README.
2. **Time explosion sites lourds** : 100+ buttons, dedupe inefficace. Mitigation : hard cap 20, warning `elements_dropped_capped: N`.
3. **CDP exposure Patchright** : Patchright = fork stealth de Playwright. `context.newCDPSession()` exposé ? **À valider en spike avant ship.** Si non → fallback native-only (Q2-B), ship plus lent mais ship.
4. **States impossibles à observer** : `disabled` only via attribute read (pas trigger). `loading` skip V1 (nécessite simulated network throttle + spinner detection — V2+).
5. **Animations transitions** : trigger hover déclenche `transition: 300ms`. Capture juste après = état intermédiaire. Mitigation : `await page.waitForTimeout(transition-duration parsed)` ou hard 400ms wait post-trigger.
6. **CSS variables / dark mode** : si site lit `prefers-color-scheme`, on capture le mode actif au moment de l'extraction. Pas un risk net mais documenter.

## 10. Sources

- Playwright Issue #9450 — Feature request emulate element state : https://github.com/microsoft/playwright/issues/9450
- Playwright Issue #29575 — Hover triggers focus-visible bug : https://github.com/microsoft/playwright/issues/29575
- Playwright Issue #3347 — CSS.forcePseudoState request : https://github.com/microsoft/playwright/issues/3347
- CDP CSS domain (forcePseudoState) : https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-forcePseudoState
- html.to.design — Import hover effects (competitor feature) : https://html.to.design/blog/new-feature-import-hover-effects/
- Chromatic — Hover and focus states (reference doc) : https://www.chromatic.com/docs/hoverfocus/
- Figma Variants doc : https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants

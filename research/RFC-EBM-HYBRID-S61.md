# RFC EBM Hybrid-Stack S61 — Anti-Detect Browser Layer

**Status** : Draft v1 — research-only, no code touch
**Date** : 2026-05-18 (S61)
**Author** : Claude research session, dispatched par Thierry
**Scope** : Hybrid stack option B pour eclectique-browser-mcp v0.6.0 (Bun + TS + Playwright 1.60)
**Decision target** : Option A (status quo Playwright vanilla + UDD persistent) vs Option B (hybrid anti-detect layer)

---

## Section 1 — Stack Matrix

| Tool | Language / TS-Node compat | Last release | Anti-detect coverage | MCP integration cost | License | Killer feature |
|---|---|---|---|---|---|---|
| **Patchright (Node.js)** | Native Node.js + TS, Bun-compat (drop-in `playwright` swap) | v1.59.1 — Apr 2026 | CF ⭐⭐⭐ / DataDome ⭐⭐⭐ / Akamai ⭐⭐⭐ / PerimeterX ⭐⭐ (variable, behavioral leak possible) | **LOW** — `npm i patchright` + `npx patchright install chromium` + rename import | Apache-2.0 | Patches `Runtime.enable` CDP leak + `--disable-blink-features=AutomationControlled` + isolated ExecutionContexts. Closed Shadow Root interaction. Chromium-only. |
| **rebrowser-playwright** | Native Node.js + TS, drop-in | v1.0.19 patches (May 2025) + rebrowser-playwright 1.52.0 | CF ⭐⭐⭐ / DataDome ⭐⭐⭐ / Akamai ⭐ (silent) / PerimeterX ⭐⭐ | **LOW** — drop-in `rebrowser-playwright` package | MIT-style (verify) | Runtime.enable fix preserves main + worker context access. Toggle on/off. Most surgical patch set. Chromium-only. |
| **Camoufox (Python)** | **Python-only core**. C++ Firefox fork. | v150.0.2 — May 2026 (active again post 1-yr gap) | CF ⭐⭐⭐⭐ / DataDome ⭐⭐⭐⭐ / Akamai ⭐⭐⭐⭐ / PerimeterX ⭐⭐⭐⭐ | **HIGH** — either Python sidecar OR WebSocket remote server bridge | MPL-2.0 | C++ injection level (impossible to detect via JS). 0% headless detection rate sannysoft. Firefox Juggler protocol (not CDP). 200MB+ RAM, ~42s/Cloudflare Turnstile. |
| **camoufox-js (apify port)** | TS / Node.js native, **experimental** | **No formal release**, 219 commits master (S60-S61) | Inherits Camoufox C++ stealth IF binary present | **MEDIUM** — `npm i camoufox-js` + Camoufox binary download separately, `firefox.launch()` w/ launchOptions | MPL-2.0 | Brings Camoufox bypass power to Node/TS ecosystem. Bun compat unverified. Apify maintains. |
| **playwright-extra + stealth** | Node.js + TS | core not meaningfully updated since Mar 2023 | CF ❌ / DataDome ❌ / Akamai ❌ / PerimeterX ❌ — **patches era Chrome 109-112** | LOW but obsolete | MIT | Easy. Useful only against `sannysoft` / `webdriver` flag / dated detection. |
| **CDP raw (chrome-remote-interface)** | Node.js + TS native | actively maintained (devtools-protocol typed) | None inherent — you build stealth yourself | **VERY HIGH** — rewrite MCP browser layer | MIT | Total control. Can selectively avoid `Runtime.enable`. Heavy lift = reinventing Patchright. |

### Quick reads

- **Patchright Node.js** = lowest-friction upgrade pour EBM. Stack already Playwright + TS + Bun → drop `playwright` ↔ `patchright`. Maintainer (Vinyzu) actif. 688⭐ moderate, mais Apache 2.0 + clean patches.
- **rebrowser-playwright** = competing surgical patch. Toggleable (rebrowser-patches). Closer to Playwright upstream. Lower brand recognition mais respect technique du repo `pim97/anti-detect-browser-tools-tech-comparison`.
- **Camoufox** = nuclear option. Effective but Python-locked. Bridge cost = Python sidecar OR WS remote server (kills EBM single-binary story). camoufox-js apify port = unproven (no release tag), but TS-native.
- **playwright-extra** = obsolete, skip.
- **CDP raw** = NIH (not-invented-here) trap. Don't.

---

## Section 7 — Open Questions to User (A/B/C numéroté)

### Q1 — Anti-detect target priority

Quel niveau de sites EBM doit scraper en priorité ?

A) Marketing sites / blogs / awwwards refs (no anti-bot OR Cloudflare niveau 1) — patchright optionnel
B) Mid-tier e-commerce / SaaS marketing (Cloudflare Bot Fight Mode + DataDome basique) — patchright OR rebrowser nécessaire
C) Enterprise / luxe / fintech (DataDome behavioral + Akamai v4 + PerimeterX) — Camoufox-class requis
D) Mix tier-1+2+3 avec fallback ladder — escalation auto

→ Recommandation : **D** parce que EBM compete face html.to.design + scrape varié + bundles a11y/tokens demande site portfolio diversifié

### Q2 — Stack swap appetite

Cost/risk tolerance pour bouger off vanilla Playwright ?

A) Drop-in seulement (import rename, zero refactor) → Patchright OU rebrowser-playwright
B) Sidecar accepté (Python Camoufox WS server + EBM TS client) → keeps Bun mais 2nd process
C) Full hybrid (Patchright default + Camoufox sidecar fallback when blocked)
D) Stay vanilla, accept ~30-40% block rate

→ Recommandation : **A puis C** — ship Patchright drop-in S62 (3-5 jours), évalue, layer Camoufox sidecar S64+ si tier-3 sites bloquent encore

### Q3 — Persistent context (UDD auth-ready S50) preservation

Patchright + UDD compatible ?

A) Patchright supporte `launchPersistentContext` same signature → garde UDD doctrine
B) Switch contextes éphémères + cookie injection
C) Hybrid : UDD pour Patchright path, ephemeral pour Camoufox path

→ Recommandation : **A** (confirmer via smoke test S62-jour1) — Patchright = drop-in donc API parity y compris launchPersistentContext

### Q4 — Firefox engine acceptance

EBM peut tolérer Firefox engine partiel (Camoufox = Firefox fork) ?

A) Chromium-only (Playwright/Patchright/rebrowser, render parity ↔ Claude DSL htmltoclaude qui targets Chromium snapshot)
B) Firefox accepted pour scrape tier-3 ONLY (bundles peuvent diverger sur render)
C) Dual-engine MCP (Chromium primary + Firefox fallback transparent)

→ Recommandation : **B** — Firefox render slight diff acceptable pour scrape-only, mais NOT pour visual bundles a11y/screenshot. Firefox path = data extraction only.

### Q5 — Bun compat constraint

Bun runtime requirement pour camoufox-js / patchright ?

A) Patchright = standard npm package, Bun fully compat (already tested in EBM ecosystem)
B) camoufox-js Bun status = unverified (apify experimental) → need smoke test
C) Si camoufox-js bun-incompatible, fallback Python sidecar acceptable

→ Recommandation : **A confirmé, B test S62, C if B fails** — Bun compat = preserve EBM single-runtime story

### Q6 — Maintenance / sustainability risk

Tolérance projet experimental / under-active maintenance ?

A) Patchright (Apache 2.0, 1 maintainer actif Vinyzu) → acceptable risk, fork-able si abandoned
B) rebrowser (small repo, 1-yr-old patches, sustainable mais slow) → acceptable
C) Camoufox (1-yr gap 2024-2025, resumed late 2025 "experimental beta") → high risk
D) camoufox-js (no release tag, apify experimental) → high risk

→ Recommandation : **A primary, B backup ; C/D only if A fails on real-world tier-3 site**

### Q7 — Test gating before adopt

Validation strategy avant merger ?

A) Smoke test 10 sites tier-1+2+3 known (awwwards.com, shopify.com store, vercel.com, plus 3 luxury FR Cloudflare-enterprise) → pass rate ≥ 70% = merge
B) A/B benchmark vs html.to.design (extract same site, compare bundle parity)
C) Both A + B + perf budget check (< 2x slowdown vs current)

→ Recommandation : **C** (gros chantier = Default option C per user pref Brain S61)

---

## Section 8 — Decision Recommendation

**Verdict** : **Option B (hybrid stack) — adopter Patchright NodeJS drop-in en primary, layer Camoufox sidecar S64+ si tier-3 sites bloquent**. Confidence : **MED-HIGH**.

**Rationale 3 bullets** :

- **Drop-in cost = quasi-nul** : Patchright preserve Playwright API surface (launchPersistentContext, BrowserContext, Page, locators tous identiques). EBM v0.6.0 stack swap = `pnpm rm playwright && pnpm i patchright` + 1 import rename. Préserve UDD auth-ready S50 + Bun runtime.
- **Anti-detect uplift réel et mesuré** : Patchright passe Cloudflare basic + DataDome basic + sannysoft tests vs Playwright vanilla fail. Pim97 comparison repo + scrapewise 2026 benchmark concordent : Patchright = best Node.js option 2026. ~70-85% coverage tier-1+2, partial tier-3.
- **Compete vs html.to.design** : EBM differentiator = bundles a11y + tokens + Claude DSL + Figma JSON, MAIS only si EBM peut actually scrape les sites. Vanilla Playwright bloqué ~30-40% sites = lose battle avant feature differentiation. Patchright restaure terrain de jeu.

**Ship-time MVP estimé** : **5-7 jours** (jours TP, pas calendaires)

- J1 : Smoke test Patchright drop-in sur 5 sites EBM golden set (vanilla blocked sample) — validate API parity launchPersistentContext + UDD
- J2 : Swap dependency + import rename + run full EBM smoke suite (`bun smoke`, `bun smoke:claude`, `bun smoke:figma`) — zero regression check
- J3 : Add Patchright config flags (`channel: 'chrome'` recommended over chromium-headless-shell per Patchright docs) + bot eval test page integration (sannysoft + creepjs)
- J4 : Tier-2+3 benchmark — 10 sites known-protected, measure pass rate vs vanilla baseline
- J5 : Documentation update (CLAUDE.md + README) + RFC closure decision note `.brain/decisions.jsonl`
- J6-J7 (buffer) : Address gaps from J4 — if tier-3 fail rate > 30%, scope Camoufox sidecar S64 ; if ≤ 30%, ship v0.7.0

**Out of scope this RFC (defer S64+)** :

- Camoufox sidecar architecture (Python WS server + TS client bridge) — only if Patchright tier-3 coverage insufficient
- TLS fingerprint (curl-impersonate / cycletls) — orthogonal layer, ship separately
- Residential proxy integration — orthogonal layer, infra cost decision
- Behavioral simulation (mouse curves, scroll patterns) — Patchright already handles `Closed Shadow Root` + cursor basics

---

## Gaps / Known unknowns

- **Patchright + launchPersistentContext + UDD doctrine S50** = pas testé in EBM, faut J1 smoke validate. Risk : LOW (API parity claimed) mais blast radius non-zéro.
- **Patchright + Bun** = pas explicitement testé dans repo Patchright. Risk : LOW (standard Node npm pkg, Bun ~98% Node compat). Plan B = `bun --bun` flag OR fallback to node runtime for browser ops only.
- **chromium-headless-shell** : Patchright recommande `channel: 'chrome'` (full Chrome) over chromium-headless-shell pour stealth. EBM v0.6.0 utilise chromium-headless-shell → eval impact rendering parity sur bundles screenshot/a11y/tokens.
- **rebrowser-playwright not deeply compared** : si Patchright a license/maintenance issue, rebrowser-playwright = solid backup même cost profile. Worth quick spike J3.
- **camoufox-js Bun + actual stealth parity** with Python Camoufox : unproven. Defer to S64 spike if needed.

---

## Sources (8-15 URLs)

- [Patchright NodeJS GitHub (Kaliiiiiiiiii-Vinyzu)](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs)
- [Camoufox GitHub (daijro)](https://github.com/daijro/camoufox)
- [camoufox-js port (apify experimental)](https://github.com/apify/camoufox-js)
- [rebrowser-patches GitHub](https://github.com/rebrowser/rebrowser-patches)
- [rebrowser-playwright GitHub](https://github.com/rebrowser/rebrowser-playwright)
- [Anti-detect tools tech comparison (pim97)](https://github.com/pim97/anti-detect-browser-tools-tech-comparison)
- [Best Playwright Stealth 2026 benchmark (scrapewise)](https://scrapewise.ai/blogs/playwright-stealth-2026)
- [Playwright Stealth 2026 — 7 patches that matter (dev.to)](https://dev.to/vhub_systems_ed5641f65d59/playwright-stealth-mode-in-2026-the-7-patches-that-actually-matter-46bp)
- [Camoufox stealth overview docs](https://camoufox.com/stealth/)
- [Camoufox Juggler system (DeepWiki)](https://deepwiki.com/daijro/camoufox/6.1-juggler-system)
- [DataDome on CDP / headless Chrome detection](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/)
- [ScrapingBee Camoufox tutorial](https://www.scrapingbee.com/blog/how-to-scrape-with-camoufox-to-bypass-antibot-technology/)
- [Patchright vs Playwright Cloudflare guide (BrowserStack)](https://www.browserstack.com/guide/playwright-cloudflare)
- [Chrome DevTools Protocol official docs](https://chromedevtools.github.io/devtools-protocol/)
- [Playwright stealth Scrapfly analysis](https://scrapfly.io/blog/posts/playwright-stealth-bypass-bot-detection)

---

## Next actions (post-decision)

1. User repond Q1-Q7 (A/B/C choix)
2. Si Q2=A confirmed → spike branch `s62/patchright-dropin` jour 1
3. Decision card Obsidian `~/Vault/Obsidian-Brain/30-Decisions/s61-d1-ebm-patchright-adopt.md` après spike validation
4. Update `.brain/decisions.jsonl` Nygard 5-field
5. If tier-3 fail rate > 30% post-spike → ouvrir RFC-EBM-CAMOUFOX-SIDECAR-S64

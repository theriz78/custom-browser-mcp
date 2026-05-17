---
session: S61
date: 2026-05-18
theme: ebm-fork-browser-rfc
project: eclectique-browser-mcp
status: rfc-partial-sections-1-7-8
type: architecture-decision
tags: [ebm, browser-fork, chromium, gecko, servo, ladybird, camoufox, ai-native]
scope: feasibility-matrix + open-questions + recommend
sources: 11
---

# RFC EBM Fork-a-Browser — Option A Deep-Dive (S61)

**Goal**: décider si EBM forke un browser custom (Option A) vs stack hybride Camoufox/Playwright++ (Option B). Scope token-frugal : Sections 1, 7, 8 only. Sections 2-6 (build pipeline, AI primitives spec, cost model, RACI timeline, risk matrix) deferred next pass.

**TL;DR** : **Option A pur = death march pour indie dev**. Chromium fork (30M LOC) hors-scope, Gecko embedding mort 2011, Ladybird trop précoce (alpha été 2026, beta 2027). Seul **Servo crate 0.1.0** (avril 2026) ouvre une porte réaliste mais incomplet. Verdict : **Option B hybride (Camoufox Playwright primary + Servo crate R&D track parallèle)** > Option A pur. Confidence : MED-HIGH.

---

## Section 1 — Feasibility Matrix

| Critère | Chromium | Gecko (Firefox) | Servo | Ladybird |
|---|---|---|---|---|
| **License** | BSD-3 + LGPL bits | MPL 2.0 | MPL 2.0 | BSD-2 |
| **LOC base** | ~30M (broad ~20-60M) | ~25M C++/Rust mix | ~500k-1M Rust (est) | ~425k C++ |
| **Lang** | C++ + JS + Rust pockets | C++ + Rust (Stylo, WebRender) | Rust pur | C++ (SerenityOS libs) |
| **Build fresh time** | 60-120 min sur 16-cores, 64GB RAM, SSD ; 8h+ low-end | 30-90 min | <10 min ? (crate cargo build) | 13 min M1 Mac ; 1-2h first-time low-end |
| **Disk required** | 200-500GB | ~50GB | ~5-10GB | ~5GB |
| **Fork ergonomics** | **HELL**. Brave/Vivaldi confirment : 10% patches merge-conflict every Chrome release (~2-3 wk cycle). Indie = full-time merge tax | **MORT**. Mozilla killed embedding API 2011 ; Camoufox = patch Firefox direct (pas embedding) | **GOOD**. `cargo add servo` depuis 0.1.0 avril 2026. ServoBuilder API stable Rust | **N/A en 2026**. Pas d'API embedding publique ; alpha cible été 2026, beta 2027, stable 2028 |
| **AI-native primitives feasibility** | Théorique oui (full source control) mais maintenance tax mange tout le temps R&D | Mort sauf via Camoufox patch (C++ niveau navigator spoofing) | **EXCELLENT** : Rust pur, embedding-first design, headless trivial, ServoBuilder + WebView + pixel readback déjà API. Inject LLM tooling = OK. WebGPU natif | Précoce. Multi-process arch (UI / WebContent / ImageDecoder / RequestServer) good fit AI but pas d'embedding API encore |
| **Headless / stealth out-of-box** | Headless oui, stealth NON (navigator.webdriver, CDP fingerprint, JA3 TLS leak) | NON natif ; Camoufox patch C++ niveau intercept = undetectable JS | Software-rendering OK pour headless ; stealth = greenfield (pas de CDP donc pas de CDP-detect) | Pas testé bot-detection ; trop précoce |
| **Automation API** | CDP (Chrome DevTools Protocol) ; détecté par anti-bot | Juggler (Camoufox) — meilleur car non-standard, peu de detect | **AUCUNE** standard ; greenfield à builder | Aucune publique |
| **Performance vs Chromium** | 100% baseline | ~90% | Software-rendering only en 0.1.0 ; GPU pipeline R&D | Slow (parsing/rendering immature) |
| **Time-to-MVP indie 6-12 mo** | **IMPOSSIBLE**. Brave a 100+ devs full-time juste pour follow upstream | **IMPOSSIBLE** sauf clone Camoufox approach (mais Camoufox déjà existe) | **POSSIBLE 6-9 mo** : wrap Servo crate + MCP layer + AI tool injection + DSL bridge. Risque = standards-compliance gaps Servo (CSS/JS edge cases) | **NON 2026**. Wait alpha été 2026, re-evaluate 2027 |
| **Killer differentiator (vs Camoufox-Playwright stack)** | Aucun (Brave/Vivaldi déjà occupent niche) | Aucun (Camoufox déjà optimal Gecko-fork) | **OUI** : "premier MCP browser AI-native Rust embeddable" + inject LLM calls in-process (zero IPC overhead) + WebGPU agentic UI hooks | **OUI futur** : "indie BSD browser, zero Google/Mozilla deps", AI-native built-from-scratch — mais 2028 stable |
| **Maintenance burden ongoing** | 100+ devs needed | High (Camoufox proves 1-2 devs OK mais maintainer burnout : daijro hospitalized Mar 2025) | LOW-MED : suit Servo upstream crate releases, pas de patch tax | LOW eventually mais pas pour 2026 |
| **Verdict EBM 2026** | ❌ NO-GO | ❌ NO-GO (use Camoufox direct) | ✅ R&D TRACK | ⏸️ WAIT 2027 re-evaluate |

### Key insights

- **Chromium = death march**. 30M LOC + 2-week Chrome release cycle + 10% merge-conflict rate confirmé par Vivaldi maintainer (Yngve). Indie sans 50-dev team = lag derrière sécurité = arme à feu.
- **Gecko = mort solo-fork**. Mozilla killed embedding API 2011. Camoufox réussit par patch direct Firefox source (C++ niveau navigator), pas embedding. Refaire Camoufox = pas killer differentiator (already done).
- **Servo crate 0.1.0 (avril 2026) = window opens**. Première fois embeddable Rust browser `cargo add`-able. Stable Rust. ServoBuilder + WebView + pixel readback API. Gaps : standards-compliance Web Platform Tests << Chrome, no GPU pipeline mature, no automation protocol natif. Mais ces gaps = differentiator opportunity (build AI-native automation from scratch, no CDP-detect surface).
- **Ladybird = trop tôt mais à surveiller**. 425k LOC vs Chromium 30M = 70× plus petit. BSD = totally fork-friendly. Alpha été 2026 — re-evaluate S70+ pour Phase 2 EBM v1.0 2027.

---

## Section 7 — Open Questions to User

À résoudre avant commit Option A vs hybride. Format A/B/C numéroté (Règle 1).

### Q1 — Horizon temps EBM

Quel est ton horizon réaliste pour EBM v1.0 vs v2.0 ?

- **A)** v1.0 = ship Q4 2026 (6 mois), Option B hybride : Camoufox Playwright primary + petits hacks AI-native
- **B)** v1.0 = ship S1 2027 (10-12 mois), Option A pur via Servo crate, accept Servo standards gaps
- **C)** v1.0 = ship Q4 2026 hybride, v2.0 = Servo R&D track parallèle ship S2 2027, v3.0 = Ladybird re-eval 2028

→ Recommandation : **C** (cap downside, optionality preserved)

### Q2 — Killer differentiator priority

Quel killer feature te tient le plus à cœur pour EBM vs Camoufox/Playwright/html.to.design ?

- **A)** Stealth/anti-bot 99% bypass DataDome+Cloudflare (= Camoufox extended)
- **B)** AI-native primitives in-browser : LLM calls in-process, agentic DOM tooling, WebGPU hooks
- **C)** Fidelity scrape : flexbox/grid/shadow-DOM/web-components/iframes/animations bulletproof
- **D)** All-in-one MCP : Figma/Claude DSL/tokens/a11y bundles best-in-class

→ Recommandation : **D + B** (D = market gap confirmé par S60 recon, B = moat technique future-proof)

### Q3 — Risk appetite indie

Niveau risque acceptable côté maintenance burden ?

- **A)** ZERO : stay 100% Playwright officiel, juste plug stealth plugin
- **B)** LOW : Camoufox primary (patch Firefox maintained by external maintainer)
- **C)** MED : Servo crate (upstream stable Rust, indie crate consumer)
- **D)** HIGH : Custom Chromium fork (death march, NO-GO confirmé Section 1)

→ Recommandation : **B + C parallèle** (B = ship 2026, C = differentiator track)

### Q4 — Audience EBM cible

Qui utilise EBM ?

- **A)** Solo agence Eclectique seulement (toi + clients via Hub)
- **B)** Open-source community + Eclectique
- **C)** SaaS commercial (compete html.to.design directement, $50-200/mo plans)

→ Recommandation : **B** (open-source = recruit Servo/Ladybird community help, monetize via Eclectique services side)

### Q5 — Servo standards-compliance acceptable threshold

Servo Web Platform Tests << Chrome. Si Servo rate 15-20% sites Awwwards top200 (vs Chromium 99%+), tu acceptes ?

- **A)** OUI si Camoufox handles fallback (dual-engine routing : Servo first, Camoufox fallback)
- **B)** NON, deal-breaker, stay Camoufox-only
- **C)** OUI si 80%+ sites pass et Servo gaps documentés explicitement

→ Recommandation : **A** (dual-engine = best of both, +AI primitives only Servo path)

### Q6 — Investment $/mois R&D track Servo

Budget mensuel acceptable pour Servo R&D parallèle (compute, contributions upstream, doc) ?

- **A)** $0 : pure side-project nights/weekends
- **B)** ~$200-500/mo : modest compute + OpenRouter LLM calls test harness
- **C)** ~$1-2k/mo : sponsor Servo upstream + dedicated CI + benchmark farm

→ Recommandation : **B** (proportional to Eclectique current burn S58 ~$200/mo Anthropic)

### Q7 — Brain memory integration deep ?

EBM v1.0 doit-il intégrer Brain MCP comme contexte runtime (recall designs précédents, pheromone trails sur sites scrapés) ?

- **A)** OUI v1.0 dès Q4 2026 — différenciateur AI-native fort
- **B)** OUI v2.0 seulement — keep v1.0 lean
- **C)** NON — Brain reste séparé, EBM stateless output

→ Recommandation : **A** (already a Brain user, leverage existing infra, killer demo)

---

## Section 8 — Decision Recommend

**Verdict** : **Option B hybride > Option A pur**. Confidence : **MED-HIGH**.

**Path concret recommandé** :

1. **EBM v0.7-v1.0 (Q3-Q4 2026)** : Camoufox-Playwright primary stack. Patch existing EBM (Bun+TS+Playwright+Chromium) → swap browser layer pour Camoufox Python interop OR rewrite Bun bridge to Camoufox WebDriver. Solves DataDome/Cloudflare immediately (~70-80% bypass per Camoufox README). Ship feature parity vs html.to.design + 10 of 12 features-to-steal from S60 recon.
2. **EBM v2.0 R&D track (S1 2027)** : `cargo add servo` parallel project. Wrap Servo WebView in MCP-compatible layer. Build AI-native primitives (LLM in-process, WebGPU agentic hooks, Brain MCP runtime context). Dual-engine routing in EBM v1.5 : Camoufox handle 99% sites, Servo path for AI-native demos + future-proof.
3. **EBM v3.0 watchpoint (2028)** : re-evaluate Ladybird once stable releases (per Wikipedia roadmap). 425k LOC BSD = realistic fork target THEN, not now.

**Rationale (3 bullets)** :

- **Chromium fork = financial suicide indie**. Brave/Vivaldi proof : 10% patches conflict every release, ~100+ devs needed maintain pace. Confirmed by Vivaldi maintainer Yngve and Brave wiki "Patching Chromium".
- **Servo crate 0.1.0 (avril 2026) = first realistic embeddable Rust browser ever**. Simon Willison's exploration confirms API works (servo-shot CLI demo). Stable Rust, ServoBuilder pattern, WebView abstraction, pixel readback for headless. Indie-feasible (cargo dependency, not source tree to maintain).
- **Camoufox already solved Gecko-fork problem**. Re-doing would be parallel work with no moat. Better to consume Camoufox as primary (with awareness of maintainer health risk — daijro hospitalized Mar 2025, fork by coryking exists) and direct R&D toward unique Servo+AI angle.

**Failure modes prevented** :

- Spending 12 months on Chromium fork = stall EBM behind competitors (html.to.design ships features quarterly).
- Locking-in Camoufox-only = ceiling at "Camoufox + custom MCP wrapper" (no real moat vs scrapfly/scrapeless commercial offerings).
- Waiting for Ladybird stable 2028 = 2-year market window loss.

---

## Gaps in this research (deferred to next RFC pass)

- **Section 2 — Build pipeline** : concrete Servo crate integration with Bun+TS bridge (FFI? subprocess? WASM?). Unknown : Servo headless rendering latency vs Camoufox.
- **Section 3 — AI primitives spec** : exact MCP tools to expose (`browser.askLLM`, `browser.recallBrain`, `browser.agenticClick`). Need design doc.
- **Section 4 — Cost model** : compute infra for dual-engine routing (Camoufox containers vs Servo embedded), CDN, Brain MCP IO.
- **Section 5 — RACI timeline** : milestone breakdown per phase v0.7 / v1.0 / v2.0.
- **Section 6 — Risk matrix** : Camoufox maintainer burnout (daijro health), Servo upstream velocity, Ladybird timeline slip, Chrome upstream changing CDP detection.

---

## Sources

- [Chromium build instructions — chromium.org](https://www.chromium.org/developers/how-tos/get-the-code/)
- [Big Project Build Times — Chromium, Random ASCII (Bruce Dawson)](https://randomascii.wordpress.com/2020/03/30/big-project-build-times-chromium/)
- [Yngve's corner — So, you want to maintain a Chromium fork? (Vivaldi)](https://yngve.vivaldi.net/sooo-you-say-you-want-to-maintain-a-chromium-fork/)
- [Brave wiki — Patching Chromium](https://github.com/brave/brave-browser/wiki/Patching-Chromium)
- [Servo project home](https://servo.org/)
- [Servo 0.1.0 crates.io release — byteiota](https://byteiota.com/servo-0-1-0-ships-on-crates-io-embeddable-rust-browser/)
- [Servo crate exploration — Simon Willison, Apr 2026](https://simonwillison.net/2026/Apr/13/servo-crate-exploration/)
- [Ladybird GitHub](https://github.com/LadybirdBrowser/ladybird)
- [Ladybird Wikipedia](https://en.wikipedia.org/wiki/Ladybird_(web_browser))
- [Camoufox GitHub (daijro)](https://github.com/daijro/camoufox)
- [Camoufox official docs](https://camoufox.com/)
- [Mozilla kills embedding support for Gecko — LWN.net](https://lwn.net/Articles/436412/)
- [Playwright Anti-Bot Detection: What Works 2026 — AlterLab](https://alterlab.io/blog/playwright-bot-detection-what-actually-works-in-2026)

---

**Next session prompt** :

```
Reprendre RFC EBM Fork-a-Browser S61. Sections 1+7+8 livrées (~200 lignes).
NEXT : Sections 2-6 (build pipeline Servo+Bun bridge, AI primitives MCP tool spec,
cost model dual-engine, RACI timeline v0.7/v1.0/v2.0, risk matrix).
Décision A/B/C Q1-Q7 user attendue avant Section 2.
File : research/RFC-EBM-FORK-S61.md
```

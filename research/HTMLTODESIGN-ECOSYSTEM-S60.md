---
session: S60
date: 2026-05-17
theme: htmltodesign-ecosystem-recon
project: eclectique-browser-mcp
status: research-complete
type: competitor-intel
tags: [figma, html-to-figma, divriots, competitor-analysis, ebm-upgrade]
---

# html.to.design Ecosystem Recon — S60

**Goal**: gap-hunt for our `eclectique-browser-mcp` (EBM). Where does html.to.design (divRIOTS) fall short, what do competitors do better, what should we steal.

**TL;DR — Top gaps html.to.design has** (confirmed across multiple sources):
1. **No localhost / auth-gated / staging support** — URL import requires public URL. Chrome ext partially workarounds but adds friction.
2. **Complex CSS animations don't transfer** — explicitly acknowledged by divRIOTS in their own docs ("Figma doesn't support CSS animations").
3. **Full-page capture flaky** — sites with custom body-height handling capture only viewport. Workaround = manual DevTools-resize trick (4-step recipe).
4. **Flexbox fidelity rated "No"** by html2design head-to-head (vs html2design "Yes"). Layout fidelity "Partial".
5. **SVG handling "Varies"** — sometimes rasterized vs native vector paths.
6. **Free tier capped 10 imports / 30 days**. PRO cap 1,000/mo "fair use."
7. **Bot-protected sites (Cloudflare/CAPTCHA) fail via URL** — recommended fallback is Chrome ext.
8. **Font detection brittle** — uses internal font-file name not CSS `font-family`, false positives common.
9. **Layer nesting historically bad** — they admitted "too many layers, often nested under several levels" in 2025 blog announcing fix.
10. **No mention of**: web components / shadow DOM / iframes / WebGL / canvas / video. Silence = likely unsupported.

---

## Section 1 — Top User Complaints (with source + quote)

### 1.1 File corruption — Figma Forum (June 2023)
> "Backgrounds and images are missing. Elements cannot be moved to the background layer."
> — Anja_Wagner, Pro user, macOS Chrome
- Source: https://forum.figma.com/report-a-problem-6/html-to-design-does-not-export-import-correctly-20827
- Outcome: thread closed, no resolution. User had to contact devs out-of-band. Use-case = creating A/B test variants for dev handoff.

### 1.2 Slow loading + page overflow — Product Hunt (Naomi Chao)
> "Took a while to load."
> "Some launches spilled over past page border."
- Source: https://www.producthunt.com/products/html-to-design/reviews
- Implication: Figma frame sizing miscalculation on launch; perf issue on heavier sites.

### 1.3 Complex animations don't transfer — Product Hunt (Julia Scheffer) + divRIOTS docs
> "Room for improvement with exporting sites that have complex animations."
> — Product Hunt review

> "Complex animations don't transfer (Figma doesn't support CSS animations)."
> — divRIOTS' own docs, /docs/from-claude-ai-to-figma/
- Source: https://html.to.design/docs/from-claude-ai-to-figma/
- This is a structural limit (Figma API), not a bug — but EBM should still flag/serialize transitions as comments or notes.

### 1.4 Post-import cleanup required
> "Import accuracy is very high, though not flawless, and some finessing is still needed afterward."
> — multiple reviewers, paraphrased across PH reviews
- Pattern: even fans say there's manual cleanup. 97% accuracy is the upper bound brag; 3% delta = real labor for production teams.

### 1.5 Full-page capture fails on some sites — html.to.design own troubleshooting
> "Some sites have different ways of handling the body height, scrolling and item display [which causes the plugin to] only capture what you see, as opposed to the full length of the page."
- Source: https://html.to.design/docs/capturing-full-page-length/
- Workaround = 4 manual steps: install Chrome ext + DevTools device mode + set huge viewport height + capture. High friction.

### 1.6 Bot-protected sites fail via URL
> "Some websites are protected against bots and might show a human verification popup before allowing you to access it... we recommend capturing these bot-protected websites with our Chrome extension."
- Source: https://html.to.design/docs/bot-protected-sites/
- Doesn't name Cloudflare/PerimeterX/DataDome but covers all of them. URL import only works on unprotected sites.

### 1.7 Local HTML imports drop external resources
> "Your HTML files may contain references to external resources like images, CSS or JavaScript [and the plugin] may not always be successful if they are not available publicly."
- Source: https://html.to.design/docs/file-tab
- Zip size cap = 32MB. No reliable way to pull non-public CDN resources.

### 1.8 Font detection — false-positive missing fonts
> "Figma is not aware of font-family mappings used on the page and uses font names which appear inside font files... false positive occurs when the font is installed locally but Figma doesn't recognize it, or the internal font name differs from what you expect."
- Source: https://html.to.design/docs/missing-fonts/
- Detection method: PostScript / internal name in OTF/TTF, not CSS font-family string. Mismatch = false "missing".

### 1.9 Layer hierarchy historically a mess (their own admission)
> "Some imports came with too many layers, often nested under several levels, making it hard to find what you're looking for."
> — html.to.design blog announcing fix
- Source: https://html.to.design/blog/new-features-better-autolayout/
- Fixed only for "websites imported without auto layout". Auto-layout path may still bloat.

### 1.10 Builder.io's competing plugin admits same problem
> "Imports are typically 80-90% accurate but we're constantly improving our engine to handle even complex layouts and visual effects."
> — Builder.io blog on Visual Copilot
- Source: https://www.builder.io/blog/website-to-figma
- Pain points they still call out: "complex animations, solutions for missing fonts, and more granular import controls."

---

## Section 2 — Changelog Highlights + Official Limitations

### Pricing (current)
- Free: **10 imports / 30 days** (single-user). No card.
- PRO: **$12/mo annual or $18/mo monthly**. Cap "1,000 imports / month" fair-use. Bulk imports, hi-res image detection, re-import shortcut, premium Discord support.
- Source: https://html.to.design/docs/pro-plan/

### Free vs PRO feature breakdown
**Free includes**: URL import, browser ext (Chrome/Edge/Arc/Brave), multi-viewport (desktop/tablet/mobile), dark+light theme captures, local Figma style mapping, auto-layout setup, font mapping/replacement, complex gradient support, multilingual imports, code editor (HTML/CSS paste), local file upload (.html/.htm/.zip), prototype link detection, overflow scroll, fixed+sticky elements, hover→variant.
**PRO-only**: unlimited (with 1k/mo cap), hi-res image detection, bulk URL/file imports, re-import shortcut, premium support.
- Source: https://html.to.design/docs/free-features/

### Supported file formats (local import)
- `.h2d` (their proprietary capture from ext) — recommended
- `.html`, `.htm`, `.zip` (≤32MB), `.mhtml`, `.mht`
- Email files: `.eml`, `.emlx`, `.msg`
- Source: https://html.to.design/docs/file-tab

### Version + cadence
- Chrome ext **v0.0.201** dated **2026-05-05**. ~200 patch versions. No public detailed changelog. Discord-first community.

### Implied / silent limitations (gaps in their own docs)
- **No mention of**: shadow DOM, web components, custom elements, iframes, video, canvas, WebGL, Lottie, JS-rendered SPAs (only "live URL" implies post-paint snapshot but they don't discuss state).
- **No max page-size doc** — but the 32MB zip cap + "capture what you see" full-page issue suggests practical ceiling on large pages.
- **No "interactive state" capture** — hover→variant works, but click/focus/multi-step states not.
- **Animations confirmed unsupported** by their own Claude-AI-to-Figma doc.

### Recently announced fixes (2025–2026)
- Auto-layout engine overhaul (date unclear) — "superior and more powerful."
- Layer organization — reduced nesting "for websites imported without auto layout."
- Font mapping — added "select existing font as replacement" with persistent mapping per URL.
- HTML code paste — added inside-Figma tab, sister API code.to.design.
- Multi-HTML endpoint on code.to.design API (recent).
- Sources: https://html.to.design/blog/new-features-better-autolayout/, https://html.to.design/blog/new-feature-import-code-in-figma/, https://divriots.com/blog/multi-html-endpoint-in-code-to-design

### Companion / sister tools by divRIOTS
- **code.to.design** = the engine + JS SDK + REST API (`API_KEY`, 100 free calls). Sells to other plugin devs.
- **story.to.design** = Storybook → Figma sync (same engine).
- **figma.to.website** = reverse direction (Figma → HTML/CSS/JS, publish or export).
- **html.tomake.design (Llama)** = AI variant.

---

## Section 3 — Competitor Matrix

Rows = tools / Cols = capability. `Y` = supported, `N` = not supported, `P` = partial / "varies", `?` = undocumented (assume no), `R` = reverse direction only (Figma→code, not what we want).

| Tool | Input method | Localhost / auth pages | JS-rendered (SPA) state | SVG → native vector | Gradients (complex) | Auto-layout output | Components / variants detection | Multi-page Figma output | Font handling | Video / iframe / canvas | Pseudo-elements (::before/::after) | Shadow DOM / web components | Pricing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **html.to.design** (divRIOTS) | URL + Chrome ext + paste HTML + .h2d/.zip | N (URL) / P (ext) | P (DOM snapshot after paint, no interactions) | P (varies — sometimes rasterized) | Y | Y | hover→variant only; no full component detect | Y (multi-viewport, dark/light) | P (false-positive missing) | ? (no docs, likely rasterized) | ? (no docs) | ? (no docs) | $0 (10/mo) / $12-18/mo |
| **html2design** (paste-only) | Paste HTML/CSS in-Figma | Y | N (whatever DOM you paste) | Y | Y | Y (Auto Layout output emphasized) | P | P | Y | ? | P | P (cleanup needed for complex) | $12/mo · $96/yr |
| **Builder.io Visual Copilot** | URL + Chrome ext (section pick) + AI redesign | P (ext for private/admin) | P | Y | Y | Y (beta) | P (AI infer) | Y | P | ? | ? | ? | Free + paid |
| **Magic Patterns → Figma** | AI prompt or HTML, then export-to-Figma button | N (their hosted) | N/A | Y | Y | Y | Y (uses their own design system) | N | P | N | N | N | Free + paid |
| **Web to Figma** (Figma plugin) | URL or paste HTML | N (URL) | N | P | P | P | N | P | P | ? | ? | ? | Free |
| **HTML to Figma** (Yashitech) | URL / paste | N | N | P | P | P | N | N | P | ? | ? | ? | Free |
| **html.tomake.design (Llama)** (divRIOTS AI) | URL / HTML / AI | N | P | P | Y | Y | N | P | P | ? | ? | ? | Free + paid |
| **Anima** | **R only** (Figma→React/Vue/HTML) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | $0–$31/mo |
| **Locofy.ai** | **R only** (Figma→React/Next/RN) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Free + paid |
| **TeleportHQ** | **R only** + visual builder | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Free + paid |
| **Penpot** (alt platform) | Open-source Figma alt, has SVG import | Y (self-host) | N | Y | Y | Y | Y | Y | Y | P | Y (it's HTML/SVG-native) | Y | Free (OSS) |
| **Manual recreation** | — | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | 2-4h/page |

**Key matrix takeaways for EBM positioning:**
- The big winnable gap: **localhost / auth / staging support** + **interactive state capture** (click, focus, scroll position, multi-step forms). Only paste-based tools (html2design) hit localhost; nobody handles interactive states well.
- **Web components / shadow DOM / iframes**: silent across the board. EBM playwright/CDP approach can crack these natively — moat.
- **Video / canvas / WebGL**: nobody handles. EBM could at least capture poster frames + raster snapshot fallback with metadata note.
- **Multi-page crawl into one Figma file**: html.to.design has prototype link detection but no full sitemap-to-pages mapping. Gap.
- **Component detection** (repeating cards = component instances): everyone fails. AI-assisted dedup = clear winnable space.

---

## Section 4 — Top 10 Features to Steal for EBM

Each prioritized by **who does it best** + **what we should improve on**.

### 1. **Paste-HTML-in-Figma sister tab** (html2design + html.to.design code tab)
- Why: Localhost / auth-gated / staging works. URL-only loses entire segments of users (internal tools, dashboards behind SSO).
- Steal: Offer EBM both a Playwright/CDP URL-grab path AND an HTML-paste path that runs entirely in the plugin sandbox (zero network for IP-sensitive teams).

### 2. **`.h2d`-style capture artifact** (html.to.design)
- Why: Decouples capture from import — the browser captures full DOM+CSSOM+assets into a single sidecar file, then the plugin consumes offline. Avoids re-render drift, makes re-imports cheap, debuggable.
- Steal: Define an `.ebm` capture format (DOM JSON + computed styles + asset manifest + screenshot). Versioned. Diffable. Re-importable. Future-proof.

### 3. **Multi-viewport + theme matrix capture in one shot** (html.to.design free feature)
- Why: Users save hours capturing desktop/tablet/mobile × light/dark = 6 frames. Already a price-anchor expectation.
- Steal: EBM should output a "frame group per viewport per theme" in one capture. Use Playwright `emulate()` for device matrix + `prefers-color-scheme` toggle.

### 4. **Bot-protection fallback (browser-ext bypass)** (html.to.design)
- Why: Their own docs admit URL import fails on Cloudflare / hCaptcha sites. Fallback = Chrome ext that runs in user's authenticated session.
- Steal: EBM should support **persistent user-data-dir Playwright sessions** so the user can log in once and re-capture without re-auth. Also a "skip URL, use my browser tab" mode via CDP attach.

### 5. **Font name mapping persistence + dual download/replace** (html.to.design)
- Why: Their font UX, while imperfect, is the most thoughtful in the space. Persistent mapping per origin = no re-prompt.
- Steal: Detect via DevTools `getMatchedCSSRules` + `document.fonts` API. Surface BOTH detected family + PostScript name. Offer (a) download web-font file to install locally, (b) map to existing Figma font, (c) **save mapping to project** keyed on origin+family. Win over divRIOTS by using `font-family` strings as primary key (CSS-correct), with PostScript as fallback.

### 6. **Aggressive layer dedup + component detection** (gap nobody solves)
- Why: Even html.to.design admits they had "too many layers, often nested several levels deep." Output bloat = unusable Figma file.
- Steal: Pre-write pass: detect repeating DOM subtrees (cards in lists, nav items, list rows) → emit a **single Figma Component + Instances**, not 12 copies. Use structural hash (tag-class-style fingerprint) over rendered children.

### 7. **Interactive-state capture loop** (gap)
- Why: html.to.design captures hover-as-variant only. Modal-open, form-error, accordion-expanded, multi-step wizard — all manual today.
- Steal: EBM "Recorder mode": user clicks through 3 states, EBM captures DOM snapshot per state, emits **one Figma Component with 3 variants** (default/hover/active or step-1/2/3). Playwright scripting makes this trivial.

### 8. **SVG fidelity guarantee — vector path, never raster** (html.to.design "varies")
- Why: html2design explicitly markets "SVG as native vector paths" as a win row vs html.to.design "varies." Designers HATE rasterized icons.
- Steal: EBM should detect inline SVG and serialize each `<path>` → Figma Vector node directly via plugin API. Even `<img src="*.svg">` should be fetched + parsed inline, never screenshotted. Document this as a hard promise.

### 9. **CSS Grid + Flexbox → Auto-Layout mapper** (html.to.design "No" on flexbox fidelity)
- Why: html2design comparison gave html.to.design "No" on flexbox fidelity. Real gap. Modern sites use grid heavily.
- Steal: Walk computed `display: flex/grid` + `justify-content` + `align-items` + `gap` → emit Figma auto-layout with matching primary-axis, counter-axis, gap, padding. CSS Grid → nested auto-layout columns/rows. Bonus: detect `grid-template-areas` and preserve named regions as Figma layer names.

### 10. **Animation/transition metadata as Figma annotations** (gap — divRIOTS gave up)
- Why: divRIOTS explicit: "Complex animations don't transfer (Figma doesn't support CSS animations)." True — but the metadata is lost forever. Designers re-spec animations from scratch.
- Steal: EBM should detect `transition`, `@keyframes`, `animation-*` CSS and emit them as **Figma comments or Dev Mode annotations** on the layer ("hover transitions opacity 200ms ease-out"). Could also export a parallel `animations.json` sidecar for dev handoff. **No competitor does this.**

### Bonus #11 — Multi-page sitemap crawl into one Figma file
- html.to.design has "automatic link detection" for prototype but no full multi-page batch. Bulk imports (PRO) just queue separate captures.
- Steal: "Crawl my site" mode — accept a sitemap.xml or seed URL + depth N, generate one Figma file with one page-per-route + working prototype links between them.

### Bonus #12 — `code.to.design` API parity (developer leverage)
- divRIOTS monetizes the engine separately. We could too.
- Steal: Ship `npm i @ebm/sdk` early. Lets third-party tools (Magic Patterns clones, AI design generators, Storybook integrations) feed into EBM. Network effect.

---

## Section 5 — Direct Quotes Signaling Pain Worth Solving

### On their own structural limits
> "Complex animations don't transfer (Figma doesn't support CSS animations)."
> — html.to.design official docs. https://html.to.design/docs/from-claude-ai-to-figma/

> "Some sites have different ways of handling the body height, scrolling and item display [which causes the plugin to] only capture what you see, as opposed to the full length of the page."
> — html.to.design troubleshooting. https://html.to.design/docs/capturing-full-page-length/

> "Some websites are protected against bots and might show a human verification popup before allowing you to access it... we recommend capturing these bot-protected websites with our Chrome extension."
> — html.to.design troubleshooting. https://html.to.design/docs/bot-protected-sites/

> "Your HTML files may contain references to external resources like images, CSS or JavaScript [and the plugin] may not always be successful if they are not available publicly."
> — html.to.design file-tab docs. https://html.to.design/docs/file-tab

> "Figma is not aware of font-family mappings used on the page and uses font names which appear inside font files."
> — html.to.design missing-fonts docs. https://html.to.design/docs/missing-fonts/

> "Some imports came with too many layers, often nested under several levels, making it hard to find what you're looking for."
> — html.to.design's own blog post announcing the fix. https://html.to.design/blog/new-features-better-autolayout/

### On accuracy ceiling
> "Imports are typically 80-90% accurate but we're constantly improving our engine to handle even complex layouts and visual effects."
> — Builder.io Visual Copilot blog (the competing engine). https://www.builder.io/blog/website-to-figma

> "Import accuracy is spot-on about 97% of the time."
> — siva madhubakkiyam, Product Hunt review

> "Imports are perfect in about 97% of cases."
> — Toma Stefan Daniel, Product Hunt review

(Note the gap: html.to.design fans say 97%, competing Builder.io says 80-90%. Real number is probably 85-95% depending on site complexity. 5-15% gap = manual cleanup hours.)

### On real bugs hit in production
> "Backgrounds and images are missing. Elements cannot be moved to the background layer."
> — Anja_Wagner, PRO user, file corruption report. https://forum.figma.com/report-a-problem-6/html-to-design-does-not-export-import-correctly-20827

> "Took a while to load... some launches spilled over past page border."
> — Naomi Chao, Product Hunt review. https://www.producthunt.com/products/html-to-design/reviews

### On the localhost / auth gap (the structural moat)
> "html.to.design works as a Chrome extension... you cannot use it on localhost without extra tunneling setup (ngrok, etc.), and you cannot use it on internal tools, staging environments behind auth, or unreleased features."
> — html2design comparison page. https://html2design.com/compare

> "Code-paste is the only method that consistently works for internal tools, staging environments, and localhost development."
> — html2design blog. https://www.html2design.com/blog/import-website-into-figma

### On animations + fonts as ongoing dev priorities
> "Support for complex animations, solutions for missing fonts, and more granular import controls."
> — Builder.io blog listing what's still hard. https://www.builder.io/blog/website-to-figma

---

## Sources Index

### Primary (html.to.design official)
- https://html.to.design/home/
- https://html.to.design/docs/what-is-html-to-design/
- https://html.to.design/docs/free-features/
- https://html.to.design/docs/pro-plan/
- https://html.to.design/docs/file-tab
- https://html.to.design/docs/launch-figma-plugin/
- https://html.to.design/docs/install-browser-extension/
- https://html.to.design/docs/missing-fonts/
- https://html.to.design/docs/bot-protected-sites/
- https://html.to.design/docs/capturing-full-page-length/
- https://html.to.design/docs/from-claude-ai-to-figma/
- https://html.to.design/blog/new-features-better-autolayout/
- https://html.to.design/blog/new-feature-import-code-in-figma/
- https://html.to.design/blog/best-figma-plugins-for-ux-writing/
- https://divriots.com/blog/introducing-html-to-design/
- https://divriots.com/blog/presenting-code-to-design-api/
- https://divriots.com/blog/multi-html-endpoint-in-code-to-design
- https://code.to.design/
- https://www.figma.com/community/plugin/1159123024924461424/html-to-design-by-divriots-import-websites-to-figma-designs-web-html-css

### User feedback
- https://www.producthunt.com/products/html-to-design/reviews
- https://forum.figma.com/report-a-problem-6/html-to-design-does-not-export-import-correctly-20827
- https://chromewebstore.google.com/detail/htmltodesign/ldnheaepmnmbjjjahokphckbpgciiaed

### Competitor pages
- https://www.builder.io/blog/html-to-design
- https://www.builder.io/blog/website-to-figma
- https://www.builder.io/blog/best-figma-plugins
- https://www.builder.io/blog/figma-to-code-visual-copilot
- https://www.builder.io/c/docs/builder-figma-plugin
- https://www.magicpatterns.com/docs/documentation/get-started/figma-plugin
- https://www.locofy.ai/figma-to-code-tool-comparison
- https://www.animaapp.com/figma
- https://html2design.com/alternatives
- https://html2design.com/compare
- https://www.html2design.com/blog/import-website-into-figma
- https://alternativeto.net/software/html-to-design/
- https://www.producthunt.com/products/html-to-design/alternatives
- https://www.figma.com/community/plugin/1297530151115228662/web-to-figma-convert-any-website-or-html-code-to-design
- https://www.figma.com/community/plugin/1595718080286284682/html-to-figma
- https://www.figma.com/community/plugin/1557932447766289380/html-tomake-design-llama-import-websites-to-figma-designs-web-html-css-ai
- https://www.figma.com/community/plugin/1459487250118622106/html-to-figma-converts-any-websites-into-fully-editable-figma-designs-by-yashitech-solutions
- https://www.figma.com/community/plugin/1227240932226133468/magicpattern-toolbox
- https://www.figma.com/community/plugin/1304255855834420274/magic-patterns
- https://www.figma.com/community/plugin/1329237288766226289/figma-to-website-by-divriots-make-websites-from-figma-publish-or-export-web-html-css-js

### Comparison analysis
- https://www.sixtythirtyten.co/blog/from-figma-to-code-ai-design-to-dev-workflows-in-2026
- https://www.aidesigner.ai/blog/figma-to-code-tools
- https://www.dhiwise.com/post/figma-to-code-tools-comparison
- https://www.dhiwise.com/post/10-best-figma-plugins-to-streamline-design-to-code-process-in-2023
- https://www.ics.com/blog/6-figma-code-generator-plugins-try
- https://www.bostonux.com/blog/6-figma-code-generator-plugins-try
- https://www.pixelperfecthtml.com/figma-to-code-plugins-anima-vs-locofy-vs-hand-coding/
- https://medium.com/@mehrnooshakbarizadeh/generative-ai-for-front-end-development-comparing-anima-locofy-ai-and-vercel-v0-c2feb4c2eeea
- https://altersquare.medium.com/figma-to-code-in-5-minutes-tools-that-actually-work-15fc5ef62e0c

---

## Caveats on this research

1. **Reddit / Twitter / HN signal was thin** — `site:reddit.com html.to.design` returned no relevant threads, X account exists but no scrapeable complaint corpus. html.to.design is niche enough that complaints concentrate on Product Hunt + Figma Forum + Discord (which I cannot scrape).
2. **GitHub issues** — divRIOTS does not appear to have a public issue tracker for html.to.design (commercial closed-source). code.to.design has a GitHub presence but as an SDK distribution, not bug tracker.
3. **Chrome Web Store** redirect-blocked on EU consent screen — couldn't pull review counts directly. Earlier search found "average 4.5/5" Chrome Web Store rating.
4. **Discord-locked complaints** — divRIOTS funnels support to Discord, which means most real bug reports never become public web text. This skews the public sentiment upward (positive PH reviews + Discord-hidden bug noise).
5. **Trust math**: PH average 4.9/5 with 16 reviews = small sample, marketing-cultivated. Real-world cleanup-time gap (3-15%) is more telling than star ratings.

# PROBE — Phase 3 Figma Importer (EBM v0.10) — S62

**Status** : Draft v1 — research-only, no code touch
**Date** : 2026-05-18 (S62)
**Author** : Claude research subagent (dispatched par Thierry)
**Scope** : Move EBM from "Figma JSON bundle output" → "real Figma file imported, frames visible, drag-drop reorg ready"
**Companion docs** : `RFC-EBM-FORK-S61.md`, `RFC-EBM-HYBRID-S61.md`, `HTMLTODESIGN-ECOSYSTEM-S60.md`

---

## 1. Goal + Scope

**Goal** : `to_figma` bundle JSON (current Phase 2 output, schema `cbm/htmltofigma/v0`, `out/htmltofigma-181n.json` 96-190KB, ~137-257 nodes) gets *materialized* as a Figma design file the user can open in desktop, see frames immediately, reorganize 1-page-per-site, and copy components to a master DS.

**Out-of-scope Phase 3** : Variables binding, Code Connect, auto-component-detection, multi-site library merging (Phase 4+).

**In-scope Phase 3** : One captured site → one Figma file (or one page within shared "Awwwards Captures" file) with all FRAME/TEXT/RECT/VECTOR/IMAGE nodes laid out at their absolute positions.

---

## 2. Decision Matrix — Importer Path

| Approach | Write Capability | Setup Cost | Throughput (137 nodes) | Image Support | Recommend |
|---|---|---|---|---|---|
| **Figma REST API direct write** | ❌ READ-ONLY for file content. `POST /v1/files/:key/variables` exists but only for Variables (not nodes). No `createNode` REST endpoint exists 2026. | — | N/A | N/A | **REJECT** |
| **use_figma plugin MCP (Claude.ai Figma)** | ✅ Full Plugin API JS sandbox. Auto-wrapped async. Atomic on error. | LOW (skill `figma-use` MANDATORY pre-load already in plugin cache) | 10 logical ops / call recommended → 14-26 calls for 137-257 nodes ; ~30-60s end-to-end | `figma.createImageAsync(url)` works with allowedDomains config ; for use_figma sandbox, `imageHash` from rasterized capture preferred | **PRIMARY** |
| **Figma plugin published .zip + manifest** | ✅ Same Plugin API as use_figma, but user runs locally in Figma desktop | HIGH (manifest, dev URL, distribute) | Same | Same + own allowedDomains | **DEFERRED** — only if use_figma rate limits hurt |
| **html.to.design competing import** | ✅ Production-grade ; converts URL → Figma natively | LOW (paid SaaS) | High | Strong | **Out-of-scope** — EBM differentiator IS this layer |

→ **Recommendation : use_figma plugin (Claude.ai Figma MCP) as Phase 3 primary**. REST API ruled out by Figma docs ("Plugins API to edit files programmatically, there is no information on this becoming available in the near future for the REST API").

---

## 3. Probe Questions Answered

### Q1 — Can use_figma create a file from scratch ?
**No, but adjacent skill `figma-create-new-file` does** via `create_new_file` MCP tool (`planKey` + `fileName` + `editorType`). Returns `file_key` + `file_url`. Then `use_figma` operates inside that file. Two-step : (1) `create_new_file` → blank file, (2) `use_figma` → populate. *Source : `~/.claude/plugins/cache/temp_git_1778454861062_8oq2w7/skills/figma-create-new-file/SKILL.md`.*

### Q2 — Can use_figma batch-create 137 frames Y-clustered then reorg 1-page-per-site ?
**Yes, with discipline.** Skill rule #5 : "At most 10 logical operations per use_figma call". 137 frames → ~14 calls. Y-cluster current bundle = absolute coords already (`absoluteBoundingBox.x/y/w/h`) → straight render. Reorg = subsequent `use_figma` traverses + groups by `name` prefix or `source_url` metadata, calls `setCurrentPageAsync` + `appendChild` per page.

### Q3 — Plugin API parity for EBM bundle features ?
| EBM Schema (`FigmaNode`) | Plugin API equivalent | Status |
|---|---|---|
| `FRAME` + `clipsContent` | `figma.createFrame()` + `clipsContent = true` | ✅ |
| `GROUP` | `figma.group([nodes], parent)` | ✅ (needs children first) |
| `TEXT` + `characters` + `style` | `figma.createText()` + `loadFontAsync` + `characters`/`fontSize`/`fontWeight` | ✅ ; font load gate critical (rule #8) |
| `RECTANGLE` + `cornerRadius`/`rectangleCornerRadii` | `figma.createRectangle()` + `cornerRadius` or `topLeftRadius`/etc | ✅ |
| `VECTOR` + `svgOuterHtml` | `figma.createNodeFromSvg(svgString)` ⭐ | ✅ — direct SVG paste, paths preserved |
| `fills[]` SOLID/IMAGE/GRADIENT_LINEAR/RADIAL | Paint array reassign (rule #7), `createImageAsync` for IMAGE, gradient stops 0-1 range | ✅ ; **color 0-1 not 0-255** (already EBM convention) |
| `effects[]` DROP_SHADOW etc | `effects = [{type:'DROP_SHADOW',...}]` reassign | ✅ |
| `absoluteBoundingBox` | `x`, `y` after append + `resize(w,h)` BEFORE sizing modes (rule about resize resetting) | ⚠️ Order matters |

### Q4 — Plugin sandbox limits ?
- **Atomic on error** : failed script = zero changes, retry safe (rule #14).
- **Page context resets** between calls → `setCurrentPageAsync` at start of each call (rule #2).
- **No `figma.notify()`**, no `console.log` returns, only `return` payload visible (rule #3, #4).
- **Plugins API timeouts** : no hard public limit found in 2026 docs ; community guidance = keep response payload < 500KB. Our 137-node bundle ≈ 190KB JSON input but progressive (not single response) → safe.
- **Image fetch** : `createImageAsync(url)` requires `allowedDomains` in plugin manifest ; **use_figma sandbox cannot reach arbitrary URLs**. Workaround = bundle already inlines image URLs as `imageRef`, but we'll need `generate_figma_design` parallel capture to rasterize (its imageHashes), OR pre-bake hashes EBM-side (Phase 3.5).

### Q5 — Hybrid create-empty + populate-from-JSON ?
**Yes — recommended pattern.**
```
Step A : create_new_file (design, "Awwwards SOTD 2026-05-17") → file_key
Step B : use_figma — inspect, prep page name "main"
Step C-N : use_figma × ~14 — populate 10 nodes per call, return createdNodeIds
Step Z : use_figma — verify with figma.currentPage.query('FRAME').length === expected
```

### Q6 — EBM `FigmaNode.type` → Plugin Node type mapping ?
EBM already does this in `src/extractors/figma.ts:mapType` (`IMAGE→RECTANGLE`, `INPUT→FRAME`, `SVG→VECTOR`). Plugin API mapping is 1:1 except :
- `VECTOR` with `svgOuterHtml` → use `createNodeFromSvg`, NOT `createVector` (the latter needs vectorPaths array, too complex).
- `RECTANGLE` with `fills[IMAGE]` → need imageHash, blocked without pre-bake or parallel capture.

### Q7 — Throughput estimate ?
- Per-`use_figma`-call latency (observed in figma-use docs examples) : 2-5s.
- 137 nodes / 10 ops per call = 14 calls × 3s ≈ **42s wall clock for one site**.
- 257-node site (heaviest sample) = 26 calls × 3s ≈ **78s**.
- Pre-allocation : send all `absoluteBoundingBox` data upfront in 1 call, child relations as IDs in subsequent calls.
- **Bottleneck** = font loading (`loadFontAsync` per unique family). EBM bundles see ~5-15 unique fonts ; preload once batch in call #1.

### Q8 — Variables / DS components reuse ?
**Phase 3 skip**, **Phase 4 scope**. Variables write API mature 2026 (`POST /v1/files/:key/variables` Tier-3 endpoint, `file_variables:write` scope), but coupling Awwwards capture nodes to Eclectique DS variables = separate design problem (mapping captured colors to brand tokens). Phase 3 leaves nodes as raw SOLID/IMAGE paints.

---

## 4. Recommended Architecture (high-level pseudo-code)

```ts
// New EBM MCP tool : to_figma_live (Phase 3)
// Input  : bundle (existing to_figma output) + opts {planKey, fileName, mode: "new_file" | "append_page"}
// Output : { file_key, file_url, page_id, nodes_created, warnings[] }

async function to_figma_live(bundle: FigmaDocument, opts) {
  // 1. Create or target file
  const { file_key, file_url } = await create_new_file({
    planKey: opts.planKey, // Eclectique team key (memory: team::1106776370504962855)
    fileName: opts.fileName ?? `EBM-${bundle.source_url}-${bundle.captured_at}`,
    editorType: "design",
  });

  // 2. Plan node creation in chunks of ~10 logical ops
  const flatNodes = flatten(bundle.document.children[0].children); // depth-first
  const chunks = chunk(flatNodes, 10);

  // 3. Preload fonts (call #0)
  const fonts = collectUniqueFonts(flatNodes); // from style.fontFamily
  await use_figma({ skillNames: "figma-use", code: preloadFontsScript(fonts) });

  // 4. Create page + skeleton (call #1)
  await use_figma({ code: skeletonScript(bundle.source_url) });

  // 5. For each chunk, generate JS that creates 10 nodes + returns IDs
  const idMap = new Map<EbmNodeId, FigmaNodeId>();
  for (const chunk of chunks) {
    const script = generateChunkScript(chunk, idMap);
    const { createdNodeIds } = await use_figma({ code: script });
    mergeIds(idMap, createdNodeIds);
  }

  // 6. Re-parent pass (call N+1) — apply children[] relationships using idMap
  await use_figma({ code: reparentingScript(bundle, idMap) });

  // 7. Verification (call N+2)
  const result = await use_figma({ code: `return figma.currentPage.query("*").length` });

  return { file_key, file_url, ... };
}
```

**Key transforms** :
- EBM `n0`, `n1`, ... IDs → Figma assigned IDs (collected from `createdNodeIds` returns).
- Skip `bundle.warnings` already handled upstream (gradient_skipped etc) — surface in tool output.
- For `IMAGE` fills with external URL : Phase 3.0 = skip with `warnings.images_deferred`, Phase 3.1 = parallel `generate_figma_design` capture for imageHashes, Phase 3.5 = EBM-side rasterize + bundle imageBytes inline (b64).

---

## 5. Open Questions (A/B/C — REGLE #1)

### Q1 — File granularity
Une site capture = un fichier OR une page dans fichier partagé ?

A) **1 fichier par site** — clean isolation, easy to drag-drop reorg, but file proliferation (137 SOTD/yr × N years)
B) **1 page par site dans fichier "EBM Captures YYYY"** — keeps Awwwards portfolio cohérent, easier cross-site search dans Figma desktop
C) **Hybrid** — temporary file per capture + auto-merge nightly to monthly "EBM-YYYY-MM" file

→ Recommandation : **B** parce que Thierry workflow = compare-then-pick refs, single-file = better Figma search/navigation. ~50-100 pages/file before Figma slowdown (community lore).

### Q2 — Image strategy Phase 3.0
Comment gérer images Awwwards (cover thumbnails, screenshots) ?

A) **Skip images** Phase 3.0 — render RECT shells with `name=IMAGE:src=...` for manual fill later
B) **Pre-bake EBM-side** — Patchright fetches image bytes during scrape, bundle inlines b64, use_figma `createImage(Uint8Array)` paths
C) **Parallel `generate_figma_design`** — Claude.ai Figma MCP rasterizes capture screenshot, harvest imageHashes (figma-generate-design SKILL.md parallel workflow pattern)

→ Recommandation : **C** parce que `generate_figma_design` already plumbed in Figma MCP, pixel-perfect, and skill explicitly designed for this hybrid. B = revisit Phase 3.5 if bandwidth/cost issue.

### Q3 — Ship horizon
Combien de jours TP pour Phase 3 v1 ?

A) **3 jours** — MVP single-site, no images, manual planKey, hard-coded chunking
B) **5 jours** — multi-site batch, images via option C above, smart chunking by depth-first slice
C) **8 jours** — adds page-per-site multiplexing, parallel chunks, retry-on-error wrapper

→ Recommandation : **B** parce que matches Patchright drop-in 3-5j horizon S62 plan ; ship Phase 3 v1 + Patchright v0.10 ensemble.

---

## 6. Estimated Ship Time

**3-5 TP days** (1 dev TP = ~6 focused hours).

Day 1 — Plumb `to_figma_live` MCP tool skeleton + `create_new_file` integration + planKey resolution.
Day 2 — Chunking + script generation for FRAME/TEXT/RECT.
Day 3 — VECTOR via `createNodeFromSvg` + gradient/effect mapping.
Day 4 — Re-parenting pass + verification + warnings surface.
Day 5 — Image hybrid (option Q2-C above) + 1 end-to-end Awwwards SOTD acceptance test.

---

## 7. Caveats / Known Unknowns

- **use_figma rate limit** : not documented publicly 2026. If hit → retry/back-off ; if persistent → Phase 4 publish own plugin.
- **Font availability** : EBM resolves fontFamily from tokens but Figma desktop must have font installed. Fallback to closest-Inter (skill rule : verify via `listAvailableFontsAsync` first).
- **SVG fidelity** : `createNodeFromSvg` parses well-formed SVG but Awwwards-class sites use complex defs/clipPaths ; expect 5-15% degradation.
- **Image domain whitelist** : `createImageAsync` blocked outside use_figma sandbox if no manifest allowedDomains ; lean on option Q2-C.
- **planKey discovery** : `whoami` MCP tool must be plumbed once ; Eclectique team key already in memory (`team::1106776370504962855`).
- **Atomic re-parent** : if re-parent pass fails, orphan nodes remain on canvas. Mitigation : track createdNodeIds in EBM-side state, cleanup script on error.

---

## 8. Sources

- [Figma REST API — Compare APIs (write-vs-read)](https://developers.figma.com/compare-apis/)
- [Figma REST API Endpoints (file endpoints read-only)](https://developers.figma.com/docs/rest-api/file-endpoints/)
- [Figma REST API Variables Endpoints (only writable surface)](https://developers.figma.com/docs/rest-api/variables-endpoints/)
- [Figma Plugin API — figma.createFrame](https://www.figma.com/plugin-docs/api/properties/figma-createframe/)
- [Figma Plugin API — createImageAsync](https://www.figma.com/plugin-docs/api/properties/figma-createimageasync/)
- [Figma Plugin API — Working with Images](https://www.figma.com/plugin-docs/working-with-images/)
- [Figma Plugin API — Making Network Requests (allowedDomains)](https://www.figma.com/plugin-docs/making-network-requests/)
- [Figma Plugin API Reference (full surface)](https://developers.figma.com/docs/plugins/api/api-reference/)
- [Figma REST API Changelog (Variables typography scopes 2026)](https://developers.figma.com/docs/rest-api/changelog/)
- Local skills : `~/.claude/plugins/cache/temp_git_1778454861062_8oq2w7/skills/figma-use/SKILL.md` + `figma-create-new-file/SKILL.md` + `figma-generate-design/SKILL.md`
- EBM source : `src/extractors/figma.ts` (lines 232-249 `mapType`, 339-413 `bundleToFigma`)
- EBM sample bundle : `out/htmltofigma-181n.json` (Awwwards SOTD 2026-05-17, 181 nodes, 190KB)

---

**Next action** : User picks Q1/Q2/Q3 A/B/C → Claude scaffolds `to_figma_live` MCP tool S62 sprint.

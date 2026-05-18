---
session: S62
date: 2026-05-18
theme: probe-feature-2-h2d-portable
project: eclectique-browser-mcp
status: draft-v0.1
type: feature-spec-probe
tags: [ebm, portable-bundle, h2d-compete, archive-format, mcp-tool-design]
---

# PROBE Feature-to-steal #2 — `.h2d` Portable Artifact (S62)

**Status** : probe draft, read-only, no code touch. Decision target = ship plan EBM v0.10.0 OR defer.
**Compete** : html.to.design `.h2d` file format (divRIOTS, opaque, Figma-only consumer).
**Author** : Research agent S62 dispatched by Thierry.

---

## 1. Goal + Use Cases

Build a portable single-file archive format `.ebm` (working name, alt: `.h2d` for interop tease) that wraps a full EBM capture into one shareable artifact. Superset of html.to.design `.h2d` : adds a11y YAML + design tokens + Claude DSL + Figma JSON + font face URLs.

**Use cases** :
- **Auth corpus archive** : user runs `seed_auth_session` → captures gated SaaS page → packs `.ebm` → drops in shared drive / Slack. Internal team re-analyzes offline without re-auth.
- **Re-import offline** : `.ebm` fed back via existing `html_path` → re-render in browser + re-extract (deterministic, no network). Useful for regression bench / A/B doctrine compare.
- **Read-only re-analyse** : `unpack_ebm` reads bundle.json without launching Patchright → cheap recall of past captures (Brain V2 episodic Tier 1 candidate).
- **Compete .h2d** : same drop-zone UX inside Figma plugin (if EBM ever ships Figma plugin), plus Claude-readable side artifacts (DSL, a11y).
- **Long-term provenance** : `.ebm` = signed snapshot artifact. Ties into Brain V2 + Vault Obsidian episodic notes (link `[[capture-{snapshot_id}]]`).

---

## 2. Format Structure Proposal

Zip archive, extension `.ebm` (or `.h2d` alias accepted on import). Contents :

```
{snapshot_id}.ebm  (zip, 1-5MB realistic)
├── manifest.json           # required, schema_version + file_index
├── page.html               # required, rendered DOM snapshot (outerHTML)
├── bundle.json             # required, full Bundle schema v1.2.0 payload
├── claude.yaml             # optional, ToClaudeBundle render
├── figma.json              # optional, ToFigma render
├── screenshot.png          # optional, captured screenshot (full or viewport)
├── fonts/                  # optional, captured @font-face files
│   ├── inter-regular.woff2
│   └── inter-bold.woff2
├── assets/                 # optional, inlined images (if --inline-assets)
│   └── hero.jpg
└── meta/
    ├── seed_auth.txt       # optional, redacted log of auth session used
    └── warnings.log        # optional, run warnings concat
```

Why zip : already supported by `src/lib/source.ts` (`ZIP_MAX_BYTES = 32 * 1024 * 1024`, unzip via spawn). Zero new dep. Bun has `Bun.file` for read, can use `bunx zip` or native `node:fs` + `archiver` for write — but spec defers tool choice to ship phase.

---

## 3. Manifest Schema v1.0 (JSON example)

```json
{
  "manifest_schema": "1.0",
  "format": "ebm",
  "ebm_version": "0.10.0",
  "bundle_schema_version": "1.2.0",
  "captured_at": "2026-05-18T14:32:11.123Z",
  "source_url": "https://example.com/protected/page",
  "source_kind": "url",
  "viewport": { "width": 1440, "height": 900 },
  "snapshot_id": "cbm-1716042731123-a8f3e2c1b9d4",
  "files": {
    "page.html": { "bytes": 487293, "sha256": "ab12..." },
    "bundle.json": { "bytes": 18472, "sha256": "cd34..." },
    "claude.yaml": { "bytes": 12048, "sha256": "ef56..." },
    "screenshot.png": { "bytes": 421337, "sha256": "78ab..." },
    "fonts/inter-regular.woff2": { "bytes": 124583, "sha256": "9cde..." }
  },
  "outputs_included": ["a11y", "tokens", "screenshot", "claude", "fonts"],
  "auth_session_used": false,
  "patchright_version": "1.59.4",
  "warnings_count": 0
}
```

Fields rationale : `manifest_schema` = forward-compat probe ; `bundle_schema_version` = link Bundle.zod ; `files.*.sha256` = integrity check on unpack (reject tampered) ; `outputs_included` = quick filter pre-unpack.

---

## 4. New Tools vs Extend Existing — Decision Matrix

| Option | Tool surface | Pro | Con |
|---|---|---|---|
| **A** — Extend `html_path` to accept `.ebm` (alias .zip) | 0 new MCP tools. `to_claude({ html_path: "x.ebm" })` works | Smallest API surface. Re-uses existing unzip + entry-html walk. | No way to *create* `.ebm`. Asymmetric. User pipes manually via shell zip. |
| **B** — New `pack_ebm({ url\|html\|html_path, output_path, outputs })` MCP tool | +1 tool. Symmetric pack/unpack. | Self-contained UX. Returns archive path + size. Composable with `analyze_page`. | Tool count 4 → 5. Doc surface grows. |
| **C** — `pack_ebm` + `unpack_ebm({ path })` (read-only bundle restore, no browser) | +2 tools. Full symmetry. | Read-only recall = cheap (no Patchright launch). Brain V2 episodic recall friendly. | Tool count 4 → 6. Risk feature bloat pre-fork OSS push (RFC-EBM-FORK-S61 context). |
| **D** — Option A + `pack_ebm` only (skip unpack tool, use html_path) | +1 tool. Hybrid. | `html_path: x.ebm` covers re-render case. `pack_ebm` covers create. `unpack_ebm` deferred. | Read-only no-browser recall not first-class. Workaround = manual unzip + read bundle.json. |

→ Recommendation : **D** (S62 ship) puis **C** si user demande read-only recall (S64+). Matches RFC-EBM-FORK-S61 fork-OSS doctrine = minimize new tools pre-v1.0.

---

## 5. Open Questions (A/B/C) — to user

### Q1 — Extension name
A) `.ebm` (own brand, no interop tease)
B) `.h2d` (compete-mimic, can be dropped in html.to.design IF format reverse-compat — UNVERIFIED)
C) Dual : accept `.h2d` + `.ebm` on import, write `.ebm` on pack

→ Reco : **C**. Defensive. We don't know `.h2d` internals (divRIOTS opaque, see Section 8).

### Q2 — Asset inlining
A) Always inline screenshot + fonts in archive (heavier, full portability)
B) URLs only in manifest, fetch lazily on unpack (lighter, network-dependent)
C) Flag `inline_assets: true|false`, default true

→ Reco : **C**. Lets corpus archive use case work (true), and CI/cheap use stay lean (false).

### Q3 — Tool surface (pack/unpack)
A) Option D — `pack_ebm` only + extend `html_path` accept `.ebm`
B) Option C — `pack_ebm` + `unpack_ebm` both
C) Option A — extend `html_path` only, packing via shell zip out-of-band

→ Reco : **A** (Option D). Ship S62 v0.10.0. Defer unpack to S64+ if demand.

### Q4 — Auth session embed
A) Never embed `seed_auth_session` storage state in `.ebm` (security default)
B) Embed redacted summary (cookies count, domains, no values) in `meta/seed_auth.txt`
C) Embed encrypted storage_state.json with passphrase (high-friction, opt-in)

→ Reco : **B**. Provenance signal without leakage risk.

---

## 6. Ship Estimate

**Option D (recommended)** :
- Day 1 : `pack_ebm` tool scaffold + manifest schema v1.0 zod + zip writer (Bun + `bun:fs` + `bunx zip` or `archiver`).
- Day 2 : Wire `pack_ebm` into existing `analyze_page` + `to_claude` pipelines (run all, collect into temp dir, zip).
- Day 3 : Extend `src/lib/source.ts` to recognize `.ebm` ext (alias `.zip` path), read `manifest.json` + `page.html` entry first instead of walk.
- Day 4 : Smoke test (`test/smoke-pack-ebm.ts`) + README section + bump v0.10.0.
- Day 5 : Buffer + handoff S62.

**Total** : **3-5 jours TP**. Single dev. No new external dep (Bun built-in + spawn `zip`/`unzip`).

---

## 7. Caveats / Risks

1. **`.h2d` reverse-engineering UNVERIFIED** — divRIOTS docs (see Section 8 sources) describe `.h2d` only at UX level, never structural. Q1-B (drop-in interop) requires obtaining a sample `.h2d` + unzipping + inspecting. Probe action : capture awwwards.com via html.to.design extension trial, download `.h2d`, `unzip -l` it. Out of S62 scope, parking for S63.
2. **Zip cap collision** — current `ZIP_MAX_BYTES = 32MB` in `source.ts`. Fonts + full-page screenshot 4K could push 10-15MB realistic, OK. But large SPA + 50+ font faces could exceed. Need cap bump probe + maybe `.ebm` extension specific cap.
3. **Schema versioning trap** — `bundle_schema_version` evolves (v1.2.0 → v1.3.0 likely). Unpack must tolerate older versions (Zod `.passthrough()` or version-router). Doctrine = forward-compat readers always.
4. **Symlink / zip-slip security** — `unzip` spawn currently doesn't sanitize entry paths. Malicious `.ebm` could write outside tempDir via `../../etc/passwd`. Fix : add `-o` (already there) + validate extracted file paths post-unzip stay inside tempDir.
5. **Bun zip ergonomics** — Bun has no native zip writer in stdlib as of v1.x. Either spawn `zip` (mac/linux ubiquitous, ship blocker on Windows IF EBM ever ports) OR add `archiver` npm dep (~120KB). Recommend spawn for now, matches existing `unzip` spawn pattern.
6. **Compete moat thin** — `.h2d` is *just a zip + opaque format*. EBM `.ebm` only wins if (a) richer (a11y + tokens + claude DSL ✓), (b) signed/verifiable (sha256 manifest ✓), (c) toolable outside Figma (CLI + MCP ✓). If divRIOTS publishes `.h2d` spec mid-2026, moat collapses to a11y/tokens delta.

---

## 8. Sources

- html.to.design `.h2d` UX docs : https://html.to.design/docs/open-h2d-file/
- html.to.design browser ext capture : https://html.to.design/docs/extension-tab/
- html.to.design private webpage : https://html.to.design/docs/import-private-page/
- html.to.design local file tab (zip cap 32MB) : https://html.to.design/docs/file-tab
- H2D filext speculative page : https://filext.com/file-extension/H2D
- MCP Bundle `.mcpb` ref (zip + manifest.json doctrine 2025) : https://www.mcpbundles.com/docs/concepts/mcpb-files
- MCP Bundle adoption blog (model precedent) : https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/
- MDZip `.mdz` portable Markdown bundle ref : https://mdzip.org/
- RO Bundle research object zip+manifest spec : https://www.researchobject.org/initiative/ro-bundle-zip/
- Internal context : `research/HTMLTODESIGN-ECOSYSTEM-S60.md` (gaps inventory)
- Internal context : `research/RFC-EBM-FORK-S61.md` (OSS fork doctrine, tool count discipline)
- Code refs : `src/lib/source.ts` (unzip pipeline existing), `src/schemas/output.ts` (Bundle v1.2.0), `src/tools/to_claude.ts`, `src/tools/analyze_page.ts`.

---

**Next action** (post Thierry validation) : `AskUserQuestion` A/B/C on Q1-Q4 → if D ratified → file `RFC-EBM-V0.10.0-PACK-EBM-S63.md` + ship plan.

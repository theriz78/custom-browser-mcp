# eclectique-browser-mcp

> Eclectique Browser MCP — turns any live URL into a multi-output design bundle: a11y tree, design tokens, screenshot, Claude-consumable DSL, Figma REST JSON. Zero LLM API cost. Persistent Chromium context.

[![MCP](https://img.shields.io/badge/MCP-1.29-blue)](https://modelcontextprotocol.io)
[![Bun](https://img.shields.io/badge/Bun-1.3-fbf0df)](https://bun.sh)
[![Playwright](https://img.shields.io/badge/Playwright-1.60-2ead33)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## Tools (3)

### `analyze_page`

Multi-output bundle. Pick any subset of {a11y, tokens, screenshot}.

```jsonc
// input
{
  "url": "https://example.com",
  "outputs": ["a11y", "tokens", "screenshot"],
  "viewport": { "width": 1440, "height": 900 },
  "full_page_screenshot": true,
  "wait_until": "networkidle",
  "timeout_ms": 30000
}
```

Output: `Bundle` v1.0.0 ([schema](src/schemas/output.ts)). Versioned `snapshot_id` (sha256 url+ts).

| Field | Type | Notes |
|---|---|---|
| `a11y.yaml` | string | Playwright `ariaSnapshot()` YAML |
| `a11y.node_count` / `approx_tokens` | int | metrics |
| `tokens.colors_top` | array | top 16 frequencies with `confidence: high\|medium\|low` |
| `tokens.fonts` | array | family + weights + sample_count |
| `tokens.spacing_scale` / `type_scale_px` | number[] | distinct values |
| `screenshot.path` / `bytes` | string / int | PNG full-page on disk |
| `warnings` | string[] | per-extractor failures (non-fatal) |

### `to_claude`

`cbm/htmltoclaude/v0` — compact YAML DSL. Token-economical for Claude ingestion.

```jsonc
// input
{ "url": "https://example.com", "format": "yaml" }
```

Output: YAML with hoisted token refs (`c0..cN` colors, `f0..fN` fonts), 4-tuple boxes, node types `FRAME|TEXT|IMAGE|SVG|GROUP|INPUT`, conservative pruning of empty GROUPs, shadowRoot recursion, warnings for `iframe_cross_origin` / `bg_gradient_unmapped` / `shadow_dom_skipped`.

Sample: [`examples/awwwards-sotd.htmltoclaude.yaml`](examples/awwwards-sotd.htmltoclaude.yaml) (180 nodes, ~19.5K tokens).

### `to_figma`

`cbm/htmltofigma/v0` — Figma REST node JSON. Custom adapter (no proprietary API).

```jsonc
// input
{ "url": "https://example.com" }
```

Output: `{ document: { children: [{ type: "CANVAS", children: [FigmaNode...] }] }, warnings, metrics }`. Mapping table:

| ClaudeNode | FigmaNode | Coverage v0 |
|---|---|---|
| FRAME | FRAME | fill SOLID + corner radius + border + clip |
| TEXT | TEXT | characters + style (fontFamily/Size/Weight) |
| IMAGE | RECTANGLE | fill IMAGE (imageRef = src, scaleMode) |
| SVG | VECTOR | shell only — path data deferred Phase 3 |
| GROUP | GROUP | container |
| INPUT | FRAME | placeholder |

Sample: [`examples/awwwards-sotd.htmltofigma.json`](examples/awwwards-sotd.htmltofigma.json) (180 nodes, ~174 KB JSON).

Deferred Phase 3+: SVG paths, gradients (`GRADIENT_LINEAR`), box shadows (`DROP_SHADOW`), auto-layout, COMPONENT/INSTANCE detection.

---

## Install

```bash
bun install
bunx playwright install chromium-headless-shell
```

## Run

```bash
bun run serve              # stdio MCP server
bun run smoke [url]        # analyze_page smoke
bun run smoke:claude [url] # to_claude smoke (writes out/htmltoclaude-{N}n.yaml)
bun run smoke:figma [url]  # to_figma smoke   (writes out/htmltofigma-{N}n.json)
bun run consolidate [url]  # sequential 3-tool + assert htmltoclaude↔figma node parity
bun run typecheck          # tsc --noEmit
```

## Wire into Claude Code (`.mcp.json`)

```jsonc
{
  "mcpServers": {
    "eclectique-browser": {
      "command": "bun",
      "args": ["run", "serve"],
      "cwd": "/absolute/path/to/eclectique-browser-mcp"
    }
  }
}
```

Restart Claude Code. Verify with `/mcp` — should list `eclectique-browser` with 3 tools.

## Stack

- [Bun](https://bun.sh) 1.3 — runtime + package manager
- [TypeScript](https://typescriptlang.org) 5
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) 1.29 — stdio transport
- [Playwright](https://playwright.dev) 1.60 — Chromium headless persistent context
- [Zod](https://zod.dev) 4 — input/output schema validation
- [yaml](https://eemeli.org/yaml/) 2.9 — YAML serialization (`to_claude`)

---

## Architecture

```
src/
├── lib/
│   └── browser.ts          ← shared Chromium persistent context (singleton, viewport-aware)
├── extractors/
│   ├── a11y.ts             ← page.locator(':root').ariaSnapshot() YAML
│   ├── tokens.ts           ← getComputedStyle walk → colors/fonts/spacing/type
│   ├── screenshot.ts       ← page.screenshot({ fullPage })
│   ├── htmltoclaude.ts     ← in-browser walker + token hoist + conservative pruning
│   └── figma.ts            ← ClaudeBundle → FigmaDocument pure transform
├── tools/
│   ├── analyze_page.ts
│   ├── to_claude.ts
│   └── to_figma.ts
├── schemas/
│   └── output.ts           ← Zod Bundle v1.0.0
└── server.ts               ← MCP stdio + 3 tool registrations
```

Single Chromium persistent context shared across all 3 tools (factory in [`src/lib/browser.ts`](src/lib/browser.ts)). Profile: `out/.chromium-profile/` (override via `CBM_USER_DATA_DIR` env). Warm context ≈ 25% speedup vs cold launch.

### Browser mode (3 options)

Set via `CBM_BROWSER_MODE` env var. Defaults to `chromium`.

| Mode | What | Pre-req | Use when |
|---|---|---|---|
| `chromium` (default) | Playwright-managed Chromium download (~92 MB once) | none | First install, CI, reproducible runs |
| `chrome` | Use Google Chrome stable installed on machine | Chrome installed | Skip 92 MB download, auto-update via Chrome |
| `cdp` | Connect to running Chrome via DevTools Protocol | Launch Chrome with `--remote-debugging-port=9222` | Share user cookies/sessions (logged-in IG/Gmail), anti-bot maximal |

```bash
# Mode chromium (default — managed download)
bun run smoke https://example.com

# Mode chrome (use system Chrome)
CBM_BROWSER_MODE=chrome bun run smoke https://example.com

# Mode cdp (connect to running Chrome with debug port)
# Step 1: launch Chrome with debug port
google-chrome --remote-debugging-port=9222
# Step 2: run with CDP mode
CBM_BROWSER_MODE=cdp CBM_CDP_URL=http://localhost:9222 bun run smoke https://example.com
```

CDP mode shares ALL browser state (cookies, localStorage, logged-in accounts) — useful for scraping behind login walls, but **privacy risk** : MCP sees all your tabs and sessions.

## Cost & performance

Measured smoke baseline against Awwwards SOTD (1440×900, networkidle), Mac arm64:

| Tool | Cold | Warm | Output | LLM cost |
|---|---|---|---|---|
| `analyze_page` (all outputs) | ~6.5s | ~2.3s | 159 a11y nodes + 5 colors + 453 KB PNG | $0 |
| `to_claude` | ~1.9s | ~1.3s | 180 nodes / 19.5K YAML tokens | $0 |
| `to_figma` | ~1.9s | ~1.3s | 180 nodes / 174 KB JSON / 43K tokens | $0 |
| **Consolidate (all 3)** | — | **~4.9s** | shared context warm | **$0** |

Phase 1 + 2 are 100% local Chromium. Optional LLM augmentation (vision tagging, code emit) gated Phase 3+.

---

## License

[MIT](LICENSE)

## Status

**v0.4.2** — Phase 1 (analyze_page) + Phase 1b (to_claude) + Phase 2 v0 (to_figma) + cookie consent lifecycle shipped.

Deferred coverage (Phase 3+): SVG path traversal, gradient parser (`GRADIENT_LINEAR`), box-shadow effects (`DROP_SHADOW`), auto-layout heuristic detection (flex/grid), COMPONENT/INSTANCE detection, multi-tab, vision-LLM augmentation.

Issues / PRs welcome.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { analyzePage } from "./tools/analyze_page.js";
import { toClaude } from "./tools/to_claude.js";
import { toFigma } from "./tools/to_figma.js";
import { seedAuthSession } from "./tools/seed_auth.js";
import { closeSharedContext } from "./lib/browser.js";
import { wrapUntrusted } from "./lib/untrusted.js";

const SERVER_NAME = "eclectique-browser-mcp";
const SERVER_VERSION = "0.8.0";

const SOURCE_SCHEMA_PROPS = {
  url: { type: "string", description: "Public http(s):// URL to load. XOR with `html` / `html_path`." },
  html: {
    type: "string",
    description: "Inline raw HTML string. Rendered via page.setContent(). XOR with `url` / `html_path`. Cap 8MB. External resources (img/css) only resolve if absolute URL or if `base_url` supplied.",
  },
  html_path: {
    type: "string",
    description: "Absolute filesystem path to a local .html / .htm / .zip / .mhtml file. .zip unpacked to temp dir (cap 32MB), then entry index.html|{zipname}.html|first-html loaded via file://. XOR with `url` / `html`. Cleanup automatic.",
  },
  base_url: {
    type: "string",
    description: "Optional absolute URL used to resolve relative refs when using `html` inline mode (no effect with `url` or `html_path`).",
  },
} as const;

const ANALYZE_PAGE_TOOL = {
  name: "analyze_page",
  description:
    "Multi-output bundle MVP: load a source (URL OR inline HTML OR local file/zip) with Playwright (persistent Chromium context) and return any subset of {a11y tree, basic design tokens, full-page screenshot}. v0.7.0 adds paste-HTML inputs (`html` / `html_path`) for localhost/auth-gated/staging/email content bypass. Supports pre_render_script for JS injection before capture.",
  inputSchema: {
    type: "object",
    properties: {
      ...SOURCE_SCHEMA_PROPS,
      outputs: {
        type: "array",
        items: { enum: ["a11y", "tokens", "screenshot"] },
        default: ["a11y", "tokens", "screenshot"],
      },
      viewport: {
        type: "object",
        properties: {
          width: { type: "integer", default: 1440 },
          height: { type: "integer", default: 900 },
        },
      },
      full_page_screenshot: { type: "boolean", default: true },
      wait_until: { enum: ["load", "domcontentloaded", "networkidle"], default: "networkidle" },
      timeout_ms: { type: "integer", default: 30000 },
      pre_render_script: {
        type: "string",
        description: "JavaScript snippet evaluated via page.evaluate() AFTER load but BEFORE extraction. Use to force interactive states (expand docks, open menus, dismiss popups, scroll). Function form `() => { /* ... */ }` or plain statements. Errors logged as warnings.",
      },
      pre_render_delay_ms: {
        type: "integer",
        default: 0,
        description: "Optional wait in ms AFTER pre_render_script runs (e.g. to let CSS transitions complete).",
      },
    },
  },
} as const;

const TO_CLAUDE_TOOL = {
  name: "to_claude",
  description:
    "htmltoclaude v0.1: convert a source (URL OR inline HTML OR local file/zip) to a compact YAML DSL (cbm/htmltoclaude/v0) Claude-consumable representation. Hoists colors+fonts to tokens, captures box/role/style per node, walks shadowRoot, captures CSS pseudo-elements (::before/::after), preserves SVG outerHTML, captures raw gradient strings. v0.7.0 adds paste-HTML inputs (`html` / `html_path`). Supports pre_render_script for JS injection + max_nodes override.",
  inputSchema: {
    type: "object",
    properties: {
      ...SOURCE_SCHEMA_PROPS,
      viewport: {
        type: "object",
        properties: {
          width: { type: "integer", default: 1440 },
          height: { type: "integer", default: 900 },
        },
      },
      wait_until: { enum: ["load", "domcontentloaded", "networkidle"], default: "networkidle" },
      timeout_ms: { type: "integer", default: 30000 },
      format: { enum: ["yaml", "json"], default: "yaml" },
      pre_render_script: {
        type: "string",
        description: "JavaScript snippet evaluated via page.evaluate() AFTER load but BEFORE extraction. Use to force interactive states. Prefer native element.click() over CSS overrides when page uses JS toggles (real class transitions, e.g. .is-active/.is-show).",
      },
      pre_render_delay_ms: {
        type: "integer",
        default: 0,
        description: "Optional wait in ms AFTER pre_render_script runs.",
      },
      max_nodes: {
        type: "integer",
        default: 800,
        description: "Cap on DOM nodes walked (depth-first from body). Bump to 1500-3000 for rich pages. Max 10000.",
      },
    },
  },
} as const;

const TO_FIGMA_TOOL = {
  name: "to_figma",
  description:
    "Phase 2 v0.1 DOM→Figma JSON adapter (cbm/htmltofigma/v0). Reuses htmltoclaude walker then maps to Figma REST node format (FRAME/TEXT/RECTANGLE/VECTOR/GROUP). v0.6.0 SVG outerHTML + GRADIENT_LINEAR/RADIAL + pseudo + max_nodes. v0.7.0 adds paste-HTML inputs (`html` / `html_path`) for localhost/auth/staging/email content bypass. Supports pre_render_script for JS injection before capture.",
  inputSchema: {
    type: "object",
    properties: {
      ...SOURCE_SCHEMA_PROPS,
      viewport: {
        type: "object",
        properties: {
          width: { type: "integer", default: 1440 },
          height: { type: "integer", default: 900 },
        },
      },
      wait_until: { enum: ["load", "domcontentloaded", "networkidle"], default: "networkidle" },
      timeout_ms: { type: "integer", default: 30000 },
      pre_render_script: {
        type: "string",
        description: "JavaScript snippet evaluated via page.evaluate() AFTER load but BEFORE extraction. Use native element.click() over CSS overrides when JS handlers toggle real classes (is-active/is-show).",
      },
      pre_render_delay_ms: {
        type: "integer",
        default: 0,
        description: "Optional wait in ms AFTER pre_render_script runs.",
      },
      max_nodes: {
        type: "integer",
        default: 800,
        description: "Cap on DOM nodes walked. Bump 1500-3000 for rich pages. Max 10000.",
      },
    },
  },
} as const;

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

const SEED_AUTH_TOOL = {
  name: "seed_auth_session",
  description:
    "v0.8.0: opens a headed Chromium tab on `url`, lets the operator log in manually, and persists cookies + localStorage to the user-data-dir profile. Subsequent analyze_page / to_claude / to_figma calls reuse that auth IF caller passes `clear_cookies_after: false`. Closes when the user closes the window OR after `idle_timeout_ms` (default 5min, max 30min). Closes the shared headless context first (single-process lock on profile dir).",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Login or session-bootstrap URL to open in the headed browser." },
      viewport: {
        type: "object",
        properties: {
          width: { type: "integer", default: 1440 },
          height: { type: "integer", default: 900 },
        },
      },
      channel: {
        enum: ["chromium", "chrome"],
        default: "chromium",
        description: "Use `chrome` for Google Chrome (better anti-bot signal). Requires Chrome installed.",
      },
      idle_timeout_ms: {
        type: "integer",
        default: 300000,
        description: "Auto-close timeout in ms if user does not close window (max 1800000 = 30min).",
      },
      allow_private_urls: { type: "boolean", default: false },
    },
    required: ["url"],
  },
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [ANALYZE_PAGE_TOOL, TO_CLAUDE_TOOL, TO_FIGMA_TOOL, SEED_AUTH_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "analyze_page") {
    const bundle = await analyzePage(req.params.arguments);
    return {
      content: [{ type: "text", text: wrapUntrusted(bundle.url, JSON.stringify(bundle, null, 2)) }],
    };
  }
  if (req.params.name === "to_claude") {
    const result = await toClaude(req.params.arguments);
    return {
      content: [{ type: "text", text: wrapUntrusted(result.bundle.url, result.rendered) }],
    };
  }
  if (req.params.name === "to_figma") {
    const result = await toFigma(req.params.arguments);
    return {
      content: [{ type: "text", text: wrapUntrusted(result.document.source_url, result.rendered) }],
    };
  }
  if (req.params.name === "seed_auth_session") {
    const result = await seedAuthSession(req.params.arguments);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
  throw new Error(`Unknown tool: ${req.params.name}`);
});

const cleanup = async () => {
  try {
    await closeSharedContext();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

const transport = new StdioServerTransport();
await server.connect(transport);

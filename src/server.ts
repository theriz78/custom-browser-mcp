import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { analyzePage } from "./tools/analyze_page.js";
import { toClaude } from "./tools/to_claude.js";
import { toFigma } from "./tools/to_figma.js";
import { closeSharedContext } from "./lib/browser.js";
import { wrapUntrusted } from "./lib/untrusted.js";

const SERVER_NAME = "eclectique-browser-mcp";
const SERVER_VERSION = "0.6.0";

const ANALYZE_PAGE_TOOL = {
  name: "analyze_page",
  description:
    "Multi-output bundle MVP: load a URL with Playwright (persistent Chromium context) and return any subset of {a11y tree, basic design tokens, full-page screenshot}. Supports pre_render_script for JS injection (force-expand dropdowns, dismiss banners, scroll-trigger lazy content) before capture.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
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
        description: "JavaScript snippet evaluated via page.evaluate() AFTER navigation+cookie consent but BEFORE extraction. Use to force interactive states (expand docks, open menus, dismiss popups, scroll). Function form `() => { /* ... */ }` or plain statements. Errors logged as warnings.",
      },
      pre_render_delay_ms: {
        type: "integer",
        default: 0,
        description: "Optional wait in ms AFTER pre_render_script runs (e.g. to let CSS transitions complete).",
      },
    },
    required: ["url"],
  },
} as const;

const TO_CLAUDE_TOOL = {
  name: "to_claude",
  description:
    "htmltoclaude v0.1: convert a live webpage to a compact YAML DSL (cbm/htmltoclaude/v0) Claude-consumable representation. Hoists colors+fonts to tokens, captures box/role/style per node, walks shadowRoot, captures CSS pseudo-elements (::before/::after), preserves SVG outerHTML, captures raw gradient strings. Supports pre_render_script for JS injection + max_nodes override.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
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
        description: "JavaScript snippet evaluated via page.evaluate() AFTER navigation+cookie consent but BEFORE extraction. Use to force interactive states (expand docks, open menus, dismiss popups, scroll). Prefer native element.click() over CSS overrides when the page uses JS toggles (real class transitions, e.g. .is-active/.is-show).",
      },
      pre_render_delay_ms: {
        type: "integer",
        default: 0,
        description: "Optional wait in ms AFTER pre_render_script runs (let CSS transitions + JS-rendered DOM mutations settle).",
      },
      max_nodes: {
        type: "integer",
        default: 800,
        description: "Cap on DOM nodes walked (depth-first from body). Bump to 1500-3000 for sites with rich content where the target subtree is positioned late in the body (e.g. fixed docks at bottom). Max 10000.",
      },
    },
    required: ["url"],
  },
} as const;

const TO_FIGMA_TOOL = {
  name: "to_figma",
  description:
    "Phase 2 v0.1 DOM→Figma JSON adapter (cbm/htmltofigma/v0). Reuses htmltoclaude walker then maps to Figma REST node format (FRAME/TEXT/RECTANGLE/VECTOR/GROUP). v0.6.0 adds: SVG outerHTML preserved (svgOuterHtml field on VECTOR), GRADIENT_LINEAR/GRADIENT_RADIAL paints with stops + handlePositions, CSS pseudo-elements (::before/::after) as synthetic children, max_nodes override. Supports pre_render_script for JS injection before capture.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
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
        description: "JavaScript snippet evaluated via page.evaluate() AFTER navigation+cookie consent but BEFORE extraction. Use native element.click() (e.g. document.querySelector('.hamburger').click()) over CSS overrides when JS handlers toggle real classes (is-active/is-show).",
      },
      pre_render_delay_ms: {
        type: "integer",
        default: 0,
        description: "Optional wait in ms AFTER pre_render_script runs (let CSS transitions + JS DOM mutations settle).",
      },
      max_nodes: {
        type: "integer",
        default: 800,
        description: "Cap on DOM nodes walked. Bump to 1500-3000 for sites with rich content where target subtree positioned late in body. Max 10000.",
      },
    },
    required: ["url"],
  },
} as const;

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [ANALYZE_PAGE_TOOL, TO_CLAUDE_TOOL, TO_FIGMA_TOOL],
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

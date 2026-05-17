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

const SERVER_NAME = "custom-browser-mcp";
const SERVER_VERSION = "0.3.0";

const ANALYZE_PAGE_TOOL = {
  name: "analyze_page",
  description:
    "Multi-output bundle MVP: load a URL with Playwright (persistent Chromium context) and return any subset of {a11y tree, basic design tokens, full-page screenshot}.",
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
    },
    required: ["url"],
  },
} as const;

const TO_CLAUDE_TOOL = {
  name: "to_claude",
  description:
    "htmltoclaude v0: convert a live webpage to a compact YAML DSL (cbm/htmltoclaude/v0) Claude-consumable representation. Hoists colors+fonts to tokens, captures box/role/style per node, walks shadowRoot, surfaces iframe/gradient/CSS-filter gaps as warnings.",
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
    },
    required: ["url"],
  },
} as const;

const TO_FIGMA_TOOL = {
  name: "to_figma",
  description:
    "Phase 2 v0 DOM→Figma JSON adapter (cbm/htmltofigma/v0). Reuses htmltoclaude walker then maps to Figma REST node format (FRAME/TEXT/RECTANGLE/VECTOR/GROUP). Solid fills + corner radius + borders + clip + text style emitted. SVG paths/gradients/iframes deferred (warnings).",
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
    return { content: [{ type: "text", text: JSON.stringify(bundle, null, 2) }] };
  }
  if (req.params.name === "to_claude") {
    const result = await toClaude(req.params.arguments as any);
    return { content: [{ type: "text", text: result.rendered }] };
  }
  if (req.params.name === "to_figma") {
    const result = await toFigma(req.params.arguments as any);
    return { content: [{ type: "text", text: result.rendered }] };
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

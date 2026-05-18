/**
 * Phase 3 v0.1 MCP tool — `to_figma_script`
 *
 * Wraps `to_figma` (bundle generation) + `emitFigmaPluginCode` (code emit).
 * Returns ready-to-paste Plugin API JS string for use_figma client-side call.
 *
 * Client-side dance (Claude main thread or any MCP orchestrator) :
 *   1. mcp call eclectique-browser-mcp.to_figma_script({ url })
 *      → returns { code, page_name, estimated_ops, warnings, recipe_md }
 *   2. mcp call claude_ai_Figma.create_new_file({ plan_key, file_name })
 *      → returns { file_key, file_url }
 *   3. mcp call claude_ai_Figma.use_figma({ skillNames: "figma-use", code })
 *      → executes Plugin API inside the new file
 *   4. User opens file_url, sees frames imported.
 *
 * Architecture rationale : EBM is a MCP server, not a client. use_figma +
 * create_new_file live in the Claude.ai Figma MCP (separate server).
 * EBM provides the bundle + the emitted script ; orchestration is consumer-side.
 */
import { z } from "zod";
import { toFigma, type ToFigmaResult } from "./to_figma.js";
import { emitFigmaPluginCode, type EmitResult } from "../lib/figma_emit.js";

const PASTE_HTML_MAX_BYTES = 8 * 1024 * 1024;

export const ToFigmaScriptInput = z
  .object({
    url: z.string().min(1).optional(),
    html: z.string().min(1).max(PASTE_HTML_MAX_BYTES).optional(),
    html_path: z.string().min(1).optional(),
    base_url: z.string().url().optional(),
    viewport: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .default({ width: 1440, height: 900 }),
    wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
    timeout_ms: z.number().int().positive().default(30000),
    clear_cookies_after: z.boolean().default(true),
    allow_private_urls: z.boolean().default(false),
    pre_render_script: z.string().optional(),
    pre_render_delay_ms: z.number().int().nonnegative().default(0),
    max_nodes: z.number().int().positive().max(10000).default(800),
    page_name: z.string().min(1).max(200).optional(),
    emit_notify: z.boolean().default(true),
    include_recipe: z.boolean().default(true),
  })
  .refine(
    (d) => [d.url, d.html, d.html_path].filter((v) => typeof v === "string" && v.length > 0).length === 1,
    { message: "provide exactly one of `url` | `html` | `html_path` (mutually exclusive)" }
  );
export type ToFigmaScriptInput = z.infer<typeof ToFigmaScriptInput>;

export interface ToFigmaScriptResult {
  schema: "cbm/figma-script/v0";
  source_url: string;
  page_name: string;
  code: string;
  estimated_ops: number;
  bundle_warnings: ToFigmaResult["document"]["warnings"];
  emit_warnings: EmitResult["warnings"];
  metrics: ToFigmaResult["document"]["metrics"];
  recipe_md?: string;
}

const RECIPE_TEMPLATE = (pageName: string, ops: number, codeLen: number) => `# Phase 3 v0.1 import recipe — \`to_figma_script\`

EBM produced a Plugin API script. Run it inside a Figma file via the Claude.ai Figma MCP.

## Step 1 — Create file
\`\`\`
claude_ai_Figma.create_new_file({
  plan_key: "team::1106776370504962855",
  file_name: ${JSON.stringify(pageName)},
  editor_type: "design"
})
\`\`\`

## Step 2 — Run emitter script
Paste the \`code\` field (length: ${codeLen} chars, ~${ops} logical ops) into use_figma :

\`\`\`
claude_ai_Figma.use_figma({
  skillNames: "figma-use",
  code: <the code field from this tool's response>
})
\`\`\`

> **figma-use skill is MANDATORY before any use_figma call** — load it via Skill tool.

## Caveats v0.1
- Image fills SKIPPED (Brain Q2=A) — emitted RECT placeholders named \`IMAGE:...\`.
- No multi-call chunking — if ops > 30, client should split the script per Figma's 10-op recommendation (split at \`page.appendChild\` boundaries).
- Font fallback to Inter if requested family unavailable on Figma desktop.
- VECTOR fallback to RECT if \`svgOuterHtml\` missing.

## Verification
After step 2, open \`file_url\` returned by step 1 in Figma desktop. Frames should appear at absolute coords matching capture viewport.
`;

export async function toFigmaScript(rawInput: unknown): Promise<ToFigmaScriptResult> {
  const input = ToFigmaScriptInput.parse(rawInput);
  const figmaResult = await toFigma({
    url: input.url,
    html: input.html,
    html_path: input.html_path,
    base_url: input.base_url,
    viewport: input.viewport,
    wait_until: input.wait_until,
    timeout_ms: input.timeout_ms,
    clear_cookies_after: input.clear_cookies_after,
    allow_private_urls: input.allow_private_urls,
    pre_render_script: input.pre_render_script,
    pre_render_delay_ms: input.pre_render_delay_ms,
    max_nodes: input.max_nodes,
  });
  const bundle = figmaResult.document;
  const pageName = input.page_name ?? bundle.source_url.slice(0, 80);
  const emit = emitFigmaPluginCode(bundle, {
    pageName,
    emitNotify: input.emit_notify,
  });

  return {
    schema: "cbm/figma-script/v0",
    source_url: bundle.source_url,
    page_name: pageName,
    code: emit.code,
    estimated_ops: emit.estimatedOps,
    bundle_warnings: bundle.warnings,
    emit_warnings: emit.warnings,
    metrics: bundle.metrics,
    ...(input.include_recipe ? { recipe_md: RECIPE_TEMPLATE(pageName, emit.estimatedOps, emit.code.length) } : {}),
  };
}

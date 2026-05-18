/**
 * Phase 3 v0.2 MCP tool — `to_figma_script` (chunked + image hybrid).
 *
 * Wraps `to_figma` (bundle generation) + `emitFigmaPluginCode` (code emit).
 * Returns chunks[] of self-contained Plugin API JS strings for use_figma client-side calls.
 *
 * Client-side dance (v0.2) :
 *   1. mcp call eclectique-browser-mcp.to_figma_script({ url })
 *      → returns { chunks: [{code, needs_page_id, ...}], code (back-compat = chunks[0].code), ... }
 *   2. mcp call claude_ai_Figma.create_new_file({ plan_key, file_name })
 *      → returns { file_key, file_url }
 *   3. mcp call claude_ai_Figma.use_figma({ skillNames: "figma-use", code: chunks[0].code })
 *      → executes chunk 0, returns { page_id, node_count, createdNodeIds }
 *   4. For i in 1..chunks.length-1 :
 *        code_i = chunks[i].code.replaceAll("__EBM_PAGE_ID__", page_id)
 *        mcp call claude_ai_Figma.use_figma({ skillNames: "figma-use", code: code_i })
 *   5. User opens file_url, sees all frames imported (text + SVG + images).
 *
 * Architecture rationale : EBM is a MCP server, not a client. use_figma +
 * create_new_file live in the Claude.ai Figma MCP (separate server).
 * EBM provides the bundle + the emitted chunks ; orchestration is consumer-side.
 */
import { z } from "zod";
import { toFigma, type ToFigmaResult } from "./to_figma.js";
import { emitFigmaPluginCode, type EmitResult, type EmitChunk, type ImageTarget } from "../lib/figma_emit.js";

const PASTE_HTML_MAX_BYTES = 8 * 1024 * 1024;
const PAGE_ID_PLACEHOLDER = "__EBM_PAGE_ID__";
const ID_MAP_PLACEHOLDER = "__EBM_ID_MAP_JSON__";

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
    max_bytes_per_chunk: z.number().int().positive().max(50 * 1024).default(40 * 1024),
    emit_notify: z.boolean().default(true),
    include_recipe: z.boolean().default(true),
  })
  .refine(
    (d) => [d.url, d.html, d.html_path].filter((v) => typeof v === "string" && v.length > 0).length === 1,
    { message: "provide exactly one of `url` | `html` | `html_path` (mutually exclusive)" },
  );
export type ToFigmaScriptInput = z.infer<typeof ToFigmaScriptInput>;

export interface ToFigmaScriptResult {
  schema: "cbm/figma-script/v0";
  source_url: string;
  page_name: string;
  /** Self-contained chunks — chunks[0] runs first ; chunks[i>0] need __EBM_PAGE_ID__ substituted. */
  chunks: EmitChunk[];
  /** Back-compat shortcut. Always equals chunks[0].code. For 1-chunk bundles, single use_figma call suffices. */
  code: string;
  /** Sentinel placeholder for page_id substitution in chunks[i>0]. */
  page_id_placeholder: typeof PAGE_ID_PLACEHOLDER;
  /** Sentinel placeholder for idMap JSON substitution in chunks[i>0]. */
  id_map_placeholder: typeof ID_MAP_PLACEHOLDER;
  estimated_ops: number;
  /** Image fill targets (v0.3) — client iterates post-chunks via upload_assets MCP. */
  image_targets: ImageTarget[];
  bundle_warnings: ToFigmaResult["document"]["warnings"];
  emit_warnings: EmitResult["warnings"];
  metrics: ToFigmaResult["document"]["metrics"];
  recipe_md?: string;
}

const RECIPE_TEMPLATE = (pageName: string, chunks: EmitChunk[], imageTargets: ImageTarget[]) => {
  const totalOps = chunks.reduce((s, c) => s + c.ops, 0);
  const totalImages = imageTargets.length;
  const isMulti = chunks.length > 1;
  return `# Phase 3 v0.3 import recipe — \`to_figma_script\` (chunked + upload_assets)

EBM produced **${chunks.length} chunk${chunks.length === 1 ? "" : "s"}** of Plugin API code (total: ~${totalOps} ops, ${totalImages} image fill target${totalImages === 1 ? "" : "s"} deferred to upload_assets).

## Step 1 — Create file

\`\`\`
claude_ai_Figma.create_new_file({
  plan_key: "team::1106776370504962855",
  file_name: ${JSON.stringify(pageName)},
  editor_type: "design"
})
\`\`\`

## Step 2 — Run chunk 0 (creates page)

\`\`\`
claude_ai_Figma.use_figma({
  skillNames: "figma-use",
  code: <chunks[0].code from this tool's response>
})
\`\`\`

→ returns \`{ page_id, node_count, createdNodeIds, id_map }\`. **Capture \`page_id\` AND \`id_map\`** for next steps.
${
  isMulti
    ? `
## Step 3 — Run chunks 1..${chunks.length - 1} (re-attach page + idMap)

Maintain a rolling \`id_map_accumulated\` (initialize from chunks[0].id_map). For each chunk \`i\` in 1..${chunks.length - 1} :

\`\`\`
const code_i = chunks[i].code
  .replaceAll("${PAGE_ID_PLACEHOLDER}", page_id)
  .replaceAll("${ID_MAP_PLACEHOLDER}", JSON.stringify(id_map_accumulated));
const result_i = await claude_ai_Figma.use_figma({
  skillNames: "figma-use",
  code: code_i
});
Object.assign(id_map_accumulated, result_i.id_map_additions);
\`\`\`

Each chunk[i>0] starts by re-attaching the existing page via \`figma.getNodeByIdAsync(page_id)\` and re-grabbing any parent nodes created in earlier chunks via the idMap. Run chunks sequentially.
`
    : `
## (Single chunk — no further steps)

This bundle fits in one chunk (~${chunks[0]?.bytes ?? 0} bytes ≤ 50KB use_figma cap). The back-compat \`code\` field equals \`chunks[0].code\`.
`
}
> **figma-use skill is MANDATORY before any use_figma call** — load it via Skill tool.

## Step ${isMulti ? "4" : "3"} — Image fills via \`upload_assets\` (v0.3)

${
  totalImages === 0
    ? `No image fill targets in this bundle. Skip.`
    : `EBM emitted **${totalImages} image fill target${totalImages === 1 ? "" : "s"}** as RECT placeholders (name prefix \`IMAGE:\`). For each target in \`result.image_targets\`, resolve the var to its real Figma node id via the accumulated idMap, then upload the bitmap :

\`\`\`
for (const target of image_targets) {
  const real_id = id_map_accumulated[target.var];
  if (!real_id) continue; // skip if var unmapped (defensive)

  // 1. Get a single-use upload URL bound to this node.
  const upload = await claude_ai_Figma.upload_assets({
    fileKey: file_key,
    nodeId: real_id,
    count: 1,
    scaleMode: target.scaleMode,
  });
  const submit_url = upload.uploads[0].submitUrl;

  // 2. Fetch the source bytes (CORS handled server-side by the fetch runtime).
  const res = await fetch(target.src);
  if (!res.ok) continue; // skip 404 / hot-link-protected
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") ?? guessMime(target.src) ?? "image/jpeg";

  // 3. POST raw bytes to submitUrl (multipart/form-data also accepted with 'file' field).
  await fetch(submit_url, {
    method: "POST",
    body: bytes,
    headers: { "Content-Type": mime },
  });
}
\`\`\`

\`submitUrl\` is **single-use, expires after 10 minutes**. \`upload_assets\` returns \`{ uploads: [{ submitUrl }], instructions }\`. With \`nodeId\` + \`count: 1\`, the resulting imageHash is bound as a fill on the existing node automatically — no further use_figma call needed.

Supported MIME : \`image/png\`, \`image/jpeg\`, \`image/gif\`, \`image/webp\`. Max 10 MB per asset.
`
}

## Caveats v0.3
- VECTOR fallback to RECT if \`svgOuterHtml\` missing.
- Font fallback to Inter if requested family unavailable on Figma desktop.
- chunks[i>0] require BOTH literal \`${PAGE_ID_PLACEHOLDER}\` (page id) AND \`${ID_MAP_PLACEHOLDER}\` (JSON of accumulated idMap) substitution — do NOT skip either (will throw at runtime).
- Image upload failures (network, CORS, 404, unsupported MIME) leave the RECT placeholder with name \`IMAGE:\` — non-fatal, atomic per-target.

## figma-use compat (v0.1.1+, S65 baseline)
- No IIFE wrap (use_figma auto-wraps + captures \`return\`).
- \`await figma.setCurrentPageAsync(page)\` (sync setter throws).
- No \`figma.notify(...)\` (throws "not implemented").
- SOLID paint color is \`{r,g,b}\` only ; alpha as paint-level \`opacity\` field.
- Result includes \`createdNodeIds\` array per figma-use rule #15.

## Verification

After all chunks executed, open \`file_url\` returned by step 1 in Figma desktop. Frames at absolute coords matching capture viewport ; images rendered as bitmaps (or RECT placeholders named \`IMAGE:\` if URL failed).
`;
};

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
    maxBytesPerChunk: input.max_bytes_per_chunk,
    emitNotify: input.emit_notify,
  });

  return {
    schema: "cbm/figma-script/v0",
    source_url: bundle.source_url,
    page_name: pageName,
    chunks: emit.chunks,
    code: emit.code,
    page_id_placeholder: PAGE_ID_PLACEHOLDER,
    id_map_placeholder: ID_MAP_PLACEHOLDER,
    estimated_ops: emit.estimatedOps,
    image_targets: emit.image_targets,
    bundle_warnings: bundle.warnings,
    emit_warnings: emit.warnings,
    metrics: bundle.metrics,
    ...(input.include_recipe ? { recipe_md: RECIPE_TEMPLATE(pageName, emit.chunks, emit.image_targets) } : {}),
  };
}

import { analyzePage, closeShared } from "../src/tools/analyze_page.js";

const url = process.argv[2] ?? "https://www.awwwards.com/sites_of_the_day";

try {
  const bundle = await analyzePage({ url, outputs: ["a11y", "tokens", "screenshot"] });
  const summary = {
    schema_version: bundle.schema_version,
    url: bundle.url,
    snapshot_id: bundle.snapshot_id,
    duration_ms: bundle.duration_ms,
    a11y_nodes: bundle.a11y?.node_count,
    a11y_approx_tokens: bundle.a11y?.approx_tokens,
    colors_top_count: bundle.tokens?.colors_top.length,
    colors_top_sample: bundle.tokens?.colors_top.slice(0, 3),
    fonts_count: bundle.tokens?.fonts.length,
    fonts_sample: bundle.tokens?.fonts.map((f) => f.family),
    spacing_scale_sample: bundle.tokens?.spacing_scale.slice(0, 6),
    type_scale_count: bundle.tokens?.type_scale_px.length,
    screenshot_path: bundle.screenshot?.path,
    screenshot_bytes: bundle.screenshot?.bytes,
    warnings: bundle.warnings,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await closeShared();
}

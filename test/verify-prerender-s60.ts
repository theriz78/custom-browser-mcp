import { toClaude, closeShared } from "../src/tools/to_claude.js";

const MARKER = "EBM_VERIFY_S60_MARKER_" + Date.now();

const INJECT_SCRIPT = `
  (() => {
    const div = document.createElement('div');
    div.id = 'ebm-verify';
    div.setAttribute('role', 'note');
    div.textContent = '${MARKER}';
    document.body.appendChild(div);
    return { injected: true, marker: '${MARKER}' };
  })()
`;

try {
  console.log("=== Baseline (no pre_render_script) ===");
  const baseline = await toClaude({
    url: "https://example.com/",
    viewport: { width: 1280, height: 800 },
  });
  const baselineHasMarker = baseline.rendered.includes(MARKER);
  console.log({
    nodes: baseline.bundle.metrics.nodes,
    yaml_chars: baseline.rendered.length,
    marker_present: baselineHasMarker,
  });

  console.log("\n=== With pre_render_script injecting marker ===");
  const injected = await toClaude({
    url: "https://example.com/",
    viewport: { width: 1280, height: 800 },
    pre_render_script: INJECT_SCRIPT,
    pre_render_delay_ms: 200,
  });
  const injectedHasMarker = injected.rendered.includes(MARKER);
  console.log({
    nodes: injected.bundle.metrics.nodes,
    yaml_chars: injected.rendered.length,
    marker_present: injectedHasMarker,
    marker: MARKER,
  });

  console.log("\n=== VERDICT ===");
  if (!baselineHasMarker && injectedHasMarker) {
    console.log("PASS: pre_render_script executed + DOM mutation captured downstream");
  } else if (baselineHasMarker) {
    console.log("INCONCLUSIVE: marker present in baseline (unexpected)");
  } else {
    console.log("FAIL: pre_render_script did not inject marker into captured DOM");
  }
} finally {
  await closeShared();
}

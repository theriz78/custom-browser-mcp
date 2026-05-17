import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const KEY_FILE = "/Users/pare/Projects/Eclectique/orchestrator/.env";
const envText = await readFile(KEY_FILE, "utf-8");
const keyMatch = envText.match(/OPENROUTER_API_KEY=(.+)/);
if (!keyMatch) throw new Error("OPENROUTER_API_KEY not found");
const apiKey = keyMatch[1]!.trim();

const OUT = resolve(import.meta.dir, "..", "out");

const analyze = JSON.parse(await readFile(resolve(OUT, "analyze-instagram-full.json"), "utf-8"));
const claudeYaml = await readFile(resolve(OUT, "htmltoclaude-167n.yaml"), "utf-8");
const figmaJson = await readFile(resolve(OUT, "htmltofigma-134n.json"), "utf-8");

const CAP = 12000;
const analyzeStr = JSON.stringify(analyze).slice(0, CAP);
const claudeStr = claudeYaml.slice(0, CAP);
const figmaStr = figmaJson.slice(0, CAP);

const prompt = `You are evaluating 3 different outputs of the SAME webpage (Instagram homepage cookie modal capture). Each output comes from a different extraction strategy. Your job: which output is MOST USEFUL for an LLM to understand the page structure, layout, and visible content WITHOUT seeing the actual page?

Rate each on a 1-10 scale across 4 dimensions: (a) layout reconstruction, (b) text content accessibility, (c) design tokens (colors/fonts), (d) compactness vs information density. Then declare an overall winner.

Be objective. Reply in this exact format (no markdown headers):

OUTPUT_A (analyze_page bundle JSON): layout=X/10 text=X/10 tokens=X/10 compact=X/10 — one_line_summary
OUTPUT_B (to_claude DSL YAML): layout=X/10 text=X/10 tokens=X/10 compact=X/10 — one_line_summary
OUTPUT_C (to_figma JSON): layout=X/10 text=X/10 tokens=X/10 compact=X/10 — one_line_summary

WINNER: [A|B|C]
WHY: 2-3 sentences max.

==== OUTPUT_A (analyze_page bundle JSON, truncated ${CAP} chars) ====
${analyzeStr}

==== OUTPUT_B (to_claude DSL YAML, truncated ${CAP} chars) ====
${claudeStr}

==== OUTPUT_C (to_figma JSON, truncated ${CAP} chars) ====
${figmaStr}
`;

console.error(`Prompt size: ${prompt.length} chars`);

const startTime = Date.now();
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/theriz78/eclectique-browser-mcp",
    "X-Title": "eclectique-browser-mcp-comparison",
  },
  body: JSON.stringify({
    model: "google/gemini-2.0-flash-001",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 800,
  }),
});

const data = await response.json() as any;
const elapsed = Date.now() - startTime;

if (!response.ok) {
  console.error("ERROR:", JSON.stringify(data, null, 2));
  process.exit(1);
}

const text = data.choices?.[0]?.message?.content;
const usage = data.usage;

console.log(JSON.stringify({
  model: data.model,
  duration_ms: elapsed,
  usage,
  response: text,
}, null, 2));

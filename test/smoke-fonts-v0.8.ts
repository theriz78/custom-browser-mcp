import { analyzePage } from "../src/tools/analyze_page.js";
import { closeShared } from "../src/tools/to_claude.js";
import { SeedAuthInput } from "../src/tools/seed_auth.js";

const HTML_WITH_FONTS = `<!doctype html>
<html>
<head>
<link rel="preconnect" href="https://fonts.gstatic.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;700&family=Playfair+Display&display=swap" rel="stylesheet" />
<style>
@font-face {
  font-family: 'CustomBrand';
  src: url('/fonts/CustomBrand.woff2') format('woff2'),
       url('/fonts/CustomBrand.woff') format('woff');
  font-weight: 400;
  font-style: normal;
}
body { font-family: 'Inter Tight', 'Helvetica Neue', Arial, sans-serif; font-weight: 400; }
h1 { font-family: 'Playfair Display', Georgia, serif; font-weight: 700; font-style: italic; }
.brand { font-family: 'CustomBrand', sans-serif; }
.mono { font-family: 'JetBrains Mono', Menlo, monospace; }
</style>
</head>
<body>
<h1>Italic Display Heading</h1>
<p>Body text in Inter Tight regular.</p>
<span class="brand">Custom @font-face brand</span>
<code class="mono">unknown system mono</code>
</body>
</html>`;

async function smokeFonts() {
  console.log("\n[1/2] tokens font extraction CSS-first + stack + source");
  const b = await analyzePage({ html: HTML_WITH_FONTS, outputs: ["tokens"] });
  if (!b.tokens) throw new Error("expected tokens payload");
  const fonts = b.tokens.fonts;
  console.log(`  fonts captured: ${fonts.length}`);
  for (const f of fonts) {
    console.log(
      `    ${f.family.padEnd(22)} weights=${f.weights.join(",")} styles=${f.styles.join(",")} source=${f.source} stack=[${f.stack.slice(0, 3).join("|")}] face_urls=${f.face_urls?.length ?? 0}`
    );
  }

  const inter = fonts.find((f) => f.family === "Inter Tight");
  if (!inter) throw new Error("expected Inter Tight in fonts (Google webfont)");
  if (inter.source !== "webfont") throw new Error(`Inter Tight should be webfont, got ${inter.source}`);
  if (!inter.stack.includes("Helvetica Neue") || !inter.stack.includes("Arial")) {
    throw new Error(`Inter Tight stack incomplete: ${JSON.stringify(inter.stack)}`);
  }

  const playfair = fonts.find((f) => f.family === "Playfair Display");
  if (!playfair) throw new Error("expected Playfair Display");
  if (!playfair.styles.includes("italic")) throw new Error(`Playfair should detect italic, got ${playfair.styles.join(",")}`);
  if (!playfair.weights.includes("700")) throw new Error(`Playfair should have weight 700, got ${playfair.weights.join(",")}`);

  const custom = fonts.find((f) => f.family === "CustomBrand");
  if (!custom) throw new Error("expected CustomBrand from @font-face");
  if (custom.source !== "webfont") throw new Error(`CustomBrand should be webfont via @font-face, got ${custom.source}`);
  if (!custom.face_urls || custom.face_urls.length < 1) {
    throw new Error(`CustomBrand should have face_urls, got ${JSON.stringify(custom.face_urls)}`);
  }

  console.log("  ✓ Inter Tight webfont + stack ✓ Playfair italic ✓ CustomBrand @font-face URLs");
}

async function smokeSeedAuthSchema() {
  console.log("\n[2/2] seed_auth_session zod schema validation (no E2E browser)");
  const parsed = SeedAuthInput.parse({ url: "https://example.com/login" });
  if (parsed.idle_timeout_ms !== 5 * 60 * 1000) throw new Error("default idle_timeout_ms wrong");
  if (parsed.channel !== "chromium") throw new Error("default channel wrong");
  console.log(`  defaults ok: idle=${parsed.idle_timeout_ms}ms channel=${parsed.channel}`);

  let threw = false;
  try {
    SeedAuthInput.parse({ url: "https://example.com", idle_timeout_ms: 99999999 });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected idle_timeout_ms max cap to reject 99999999");
  console.log("  ✓ idle_timeout_ms max cap enforced");
}

try {
  await smokeFonts();
  await smokeSeedAuthSchema();
  console.log("\n✅ fonts + seed_auth schema smoke PASS v0.8.0");
} finally {
  await closeShared();
}

/**
 * E2E manual : seed_auth_session → Linear inbox login → cookie persist verify.
 *
 * Procédure :
 * 1. `bun test/e2e-seed-auth-linear.ts seed`
 *    → Headed Chromium opens linear.app/inbox
 *    → User logs in manually (Google SSO ou magic link).
 *    → Once logged in & inbox loaded → close browser window.
 *
 * 2. `bun test/e2e-seed-auth-linear.ts verify`
 *    → Headless to_claude on linear.app/inbox with clear_cookies_after=false
 *    → Bundle prints — should contain inbox content (logged-in HTML).
 *    → If redirected to login page : auth NOT persisted (FAIL).
 *    → If shows inbox UI elements : PASS.
 *
 * Profile dir : ./out/.chromium-profile (default UDD per browser.ts).
 */
import { seedAuthSession } from "../src/tools/seed_auth.js";
import { toClaude, closeShared } from "../src/tools/to_claude.js";

const URL = "https://linear.app/inbox";

const cmd = process.argv[2];

if (cmd === "seed") {
  console.log("→ Opening headed Chromium on Linear inbox...");
  console.log("  Login manually, then close the browser window.\n");
  const r = await seedAuthSession({
    url: URL,
    idle_timeout_ms: 15 * 60 * 1000,
    viewport: { width: 1440, height: 900 },
  });
  console.log("\nseed_auth result :");
  console.log(JSON.stringify(r, null, 2));
} else if (cmd === "verify") {
  console.log("→ Headless raw page check (redirect + cookies + title signature)...\n");
  const { getSharedContext, closeSharedContext } = await import("../src/lib/browser.js");
  const ctx = await getSharedContext({ width: 1440, height: 900 });
  const page = await ctx.newPage();
  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000);
    const finalUrl = page.url();
    const title = await page.title();
    const cookies = await ctx.cookies();
    const linearCookies = cookies.filter((c) => c.domain.includes("linear"));
    const hasSession = linearCookies.some((c) => c.name.startsWith("session:"));
    const hasLoggedIn = linearCookies.some((c) => c.name === "loggedIn");
    const redirectedToWorkspace =
      finalUrl !== URL && finalUrl.startsWith("https://linear.app/") && !finalUrl.includes("/login");
    const sig = {
      requested_url: URL,
      final_url: finalUrl,
      title,
      cookie_count_total: cookies.length,
      linear_cookies: linearCookies.map((c) => c.name),
      has_session_cookie: hasSession,
      has_loggedIn_cookie: hasLoggedIn,
      redirected_to_workspace: redirectedToWorkspace,
    };
    console.log(JSON.stringify(sig, null, 2));
    const verdict = hasSession && hasLoggedIn && redirectedToWorkspace;
    console.log(`\n${verdict ? "✅" : "❌"} seed_auth PASS = ${verdict}`);
    if (!verdict) {
      console.log("  → diagnose: rerun seed step; cookies may have expired or seed never persisted.");
    }
  } finally {
    await page.close().catch(() => {});
    await closeSharedContext();
    await closeShared();
  }
} else {
  console.log("usage: bun test/e2e-seed-auth-linear.ts <seed|verify>");
  process.exit(1);
}

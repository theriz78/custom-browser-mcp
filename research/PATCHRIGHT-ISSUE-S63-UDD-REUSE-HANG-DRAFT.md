# Patchright GitHub issue — FILED S63

**Filed** : https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/issues/201 (2026-05-18)
**Repository** : Kaliiiiiiiiii-Vinyzu/patchright
**Title** : `[Bug]: launchPersistentContext hangs on 3rd+ consecutive reuse of same user_data_dir (NodeJS 1.59.4)`

---

## Body

### Summary

Calling `chromium.launchPersistentContext(USER_DATA_DIR, {...})` N times sequentially against the same `USER_DATA_DIR` causes the 3rd+ relaunch's page operations (`page.title()`, `page.goto()`) to hang indefinitely. First 2 relaunches succeed normally.

Tested on `patchright@1.59.4` (NodeJS), Bun 1.x, macOS 14 (Darwin 25.4.0), headless. Issue does **not** occur with `playwright@1.60.0` under the same harness (Playwright Chromium not installed locally to fully confirm, but our wrapper used Playwright pre-Patchright migration without hitting this).

### Steps to reproduce

```ts
import { chromium } from "patchright";

const UDD = "/tmp/patchright-udd-repro";
const HTML_URL = "file:///tmp/sample.html"; // any minimal file://

for (let i = 0; i < 5; i++) {
  const ctx = await chromium.launchPersistentContext(UDD, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(HTML_URL, { waitUntil: "networkidle", timeout: 15000 });
  await page.title(); // ← hangs here on iter 3+
  await ctx.close();
  console.log(`iter ${i+1} ok`);
}
```

### Expected

All 5 iterations complete in <2s each.

### Actual

```
iter 1 ok     (~400ms)
iter 2 ok     (~120ms)
[iter 3 hangs at page.title() until 30s test wall timeout]
```

Granular instrumentation shows:
- `launchPersistentContext` returns normally on iter 3 (~120ms)
- `page.goto(file://, networkidle)` returns normally (~500ms)
- `page.title()` never resolves → hits timeout

### Environment

- patchright NodeJS v1.59.4
- Chromium 1217 (installed via `bunx patchright install chromium-1217`)
- Bun 1.x runtime
- macOS Darwin 25.4.0 (M-series arm64)
- USER_DATA_DIR is a fresh empty directory before iter 1; reused across iterations.

### Hypothesis

Some persistent state in the UDD (Chrome subprocess lock file / `SingletonLock` / DevToolsActivePort) is not being released cleanly on `ctx.close()`. After 2 close+relaunch cycles, the new Chromium subprocess either fails to detach from previous lock OR opens a CDP session that's already considered stale by the parent driver process, causing the WebSocket round-trip for `page.title()` to silently never receive a response.

### Workaround (consumer-side)

In our project ([eclectique-browser-mcp](https://github.com/...) — internal at the moment) we switched to keeping `launchPersistentContext` alive across calls and applying viewport changes via `page.setViewportSize(vp)` per-page instead of close+relaunch on viewport mismatch. This avoids the hang entirely in our use-case but doesn't address the underlying upstream behavior.

### What we'd like to verify

- Is this expected (UDD reuse not officially supported across N close+relaunch cycles) ?
- Or is the lock-release path in Patchright's stealth patches more strict than upstream Playwright ?
- Does the issue reproduce on Linux / Patchright Python ?

Happy to provide additional logs / strace output / reduced repro if useful.

---

## Notes for filing (S63 internal)

- File **after** Thierry approval (REGLE #1 V2.3 + visible-to-others gating).
- After filing, link the issue # in this draft + the S63 handoff Caveats section.
- Cross-link probe scripts that demonstrate the hang :
  - `test/probe-patchright-caveats-s63.ts` (variants A-G)
  - `test/probe-patchright-caveats-s63-v2.ts` (H1-H3 heavier load)
  - `test/probe-caveat1-granular.ts` (per-step timing)
- Optional follow-up issue for **caveat #2** (ctx.on('close') silent on user-close-window-headed) — NOT REPRO programmatic (PASS), only manifests under interactive user-close. Defer until reliable repro.

import { z } from "zod";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { closeSharedContext } from "../lib/browser.js";
import { assertSafeUrl } from "../lib/urlGuard.js";

const OUT_DIR = resolve(import.meta.dir, "..", "..", "out");
const USER_DATA_DIR = process.env.CBM_USER_DATA_DIR ?? resolve(OUT_DIR, ".chromium-profile");

export const SeedAuthInput = z.object({
  url: z.string().min(1),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1440, height: 900 }),
  channel: z.enum(["chromium", "chrome"]).default("chromium"),
  idle_timeout_ms: z.number().int().positive().max(30 * 60 * 1000).default(5 * 60 * 1000),
  allow_private_urls: z.boolean().default(false),
});
export type SeedAuthInput = z.infer<typeof SeedAuthInput>;

export interface SeedAuthResult {
  ok: boolean;
  url: string;
  profile_dir: string;
  closed_by: "user" | "timeout";
  duration_ms: number;
}

export async function seedAuthSession(rawInput: unknown): Promise<SeedAuthResult> {
  const input = SeedAuthInput.parse(rawInput);
  assertSafeUrl(input.url, { allowPrivate: input.allow_private_urls });

  await closeSharedContext();

  const started = Date.now();
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: input.viewport,
    ...(input.channel === "chrome" ? { channel: "chrome" as const } : {}),
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(input.url);

  let closedBy: "user" | "timeout" = "timeout";
  await new Promise<void>((resolveProm) => {
    let done = false;
    const finish = (reason: "user" | "timeout") => {
      if (done) return;
      done = true;
      closedBy = reason;
      resolveProm();
    };
    ctx.on("close", () => finish("user"));
    page.on("close", () => finish("user"));
    const t = setTimeout(() => finish("timeout"), input.idle_timeout_ms);
    if (typeof t === "object" && t && "unref" in t) (t as { unref: () => void }).unref();
  });

  try {
    await ctx.close();
  } catch {}

  return {
    ok: true,
    url: input.url,
    profile_dir: USER_DATA_DIR,
    closed_by: closedBy,
    duration_ms: Date.now() - started,
  };
}

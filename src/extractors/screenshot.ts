import type { Page } from "patchright";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

export async function captureScreenshot(
  page: Page,
  outPath: string,
  opts: { fullPage: boolean }
): Promise<{ path: string; bytes: number; full_page: boolean }> {
  await mkdir(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, fullPage: opts.fullPage, type: "png" });
  const st = await stat(outPath);
  return { path: outPath, bytes: st.size, full_page: opts.fullPage };
}

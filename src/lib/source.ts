import { mkdtemp, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename, dirname } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Page } from "playwright";
import { assertSafeUrl } from "./urlGuard.js";

const ZIP_MAX_BYTES = 32 * 1024 * 1024;
const HTML_MAX_BYTES = 8 * 1024 * 1024;

export const SourceInputShape = {
  url: z.string().min(1).optional(),
  html: z.string().min(1).max(HTML_MAX_BYTES).optional(),
  html_path: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  allow_private_urls: z.boolean().default(false),
} as const;

export type SourceInput = {
  url?: string;
  html?: string;
  html_path?: string;
  base_url?: string;
  allow_private_urls?: boolean;
};

export type ResolvedSource =
  | { kind: "url"; url: string; label: string; baseUrl?: string }
  | { kind: "inline"; html: string; label: string; baseUrl?: string }
  | { kind: "file"; filePath: string; label: string; baseUrl?: string; tempDir?: string };

export function assertExactlyOneSource(input: SourceInput): void {
  const provided = [input.url, input.html, input.html_path].filter(
    (v) => typeof v === "string" && v.length > 0
  ).length;
  if (provided === 0) {
    throw new Error(
      "source: provide exactly one of `url` | `html` | `html_path` (got none)"
    );
  }
  if (provided > 1) {
    throw new Error(
      "source: provide exactly one of `url` | `html` | `html_path` (got multiple, mutually exclusive)"
    );
  }
}

function shortSha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export async function resolveSource(input: SourceInput): Promise<ResolvedSource> {
  assertExactlyOneSource(input);

  if (input.url) {
    assertSafeUrl(input.url, { allowPrivate: !!input.allow_private_urls });
    return { kind: "url", url: input.url, label: input.url, baseUrl: input.base_url };
  }

  if (input.html) {
    const label = `inline:html#${shortSha(input.html)}`;
    return { kind: "inline", html: input.html, label, baseUrl: input.base_url };
  }

  const path = resolve(input.html_path!);
  const st = await stat(path).catch(() => null);
  if (!st || !st.isFile()) {
    throw new Error(`source: html_path not a readable file: ${path}`);
  }
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));

  if (ext === ".html" || ext === ".htm" || ext === ".mhtml" || ext === ".mht") {
    return {
      kind: "file",
      filePath: path,
      label: `file://${path}`,
      baseUrl: input.base_url,
    };
  }

  if (ext === ".zip") {
    if (st.size > ZIP_MAX_BYTES) {
      throw new Error(
        `source: zip exceeds ${ZIP_MAX_BYTES} bytes cap (got ${st.size}). Path: ${path}`
      );
    }
    const tempDir = await mkdtemp(join(tmpdir(), "ebm-zip-"));
    try {
      await unzipTo(path, tempDir);
    } catch (e) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    const entry = await findEntryHtml(tempDir, basename(path).replace(/\.zip$/i, ""));
    if (!entry) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`source: no .html/.htm entry found inside zip ${path}`);
    }
    return {
      kind: "file",
      filePath: entry,
      label: `file://${entry}`,
      baseUrl: input.base_url,
      tempDir,
    };
  }

  throw new Error(
    `source: unsupported html_path extension "${ext}" (expected .html | .htm | .zip | .mhtml | .mht)`
  );
}

export async function cleanupSource(resolved: ResolvedSource): Promise<void> {
  if (resolved.kind === "file" && resolved.tempDir) {
    await rm(resolved.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function loadIntoPage(
  page: Page,
  source: ResolvedSource,
  opts: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeoutMs: number }
): Promise<void> {
  switch (source.kind) {
    case "url": {
      await page.goto(source.url, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
      return;
    }
    case "file": {
      const url = `file://${source.filePath}`;
      await page.goto(url, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
      return;
    }
    case "inline": {
      const waitUntil = opts.waitUntil === "networkidle" ? "load" : opts.waitUntil;
      if (source.baseUrl) {
        const dataUrl = source.baseUrl;
        await page.goto(dataUrl, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs }).catch(() => {});
      }
      await page.setContent(source.html, { waitUntil, timeout: opts.timeoutMs });
      return;
    }
  }
}

function unzipTo(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolveProm, rejectProm) => {
    const proc = spawn("unzip", ["-q", "-o", zipPath, "-d", destDir]);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", rejectProm);
    proc.on("close", (code) => {
      if (code === 0) resolveProm();
      else rejectProm(new Error(`unzip exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function findEntryHtml(dir: string, zipBase: string): Promise<string | null> {
  const candidates = ["index.html", "index.htm", `${zipBase}.html`, `${zipBase}.htm`];
  for (const c of candidates) {
    const p = join(dir, c);
    const s = await stat(p).catch(() => null);
    if (s && s.isFile()) return p;
  }
  return await walkFirstHtml(dir);
}

async function walkFirstHtml(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && /\.html?$/i.test(e.name));
  if (files.length) {
    files.sort((a, b) => a.name.localeCompare(b.name));
    return join(dir, files[0]!.name);
  }
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    const found = await walkFirstHtml(join(dir, d.name));
    if (found) return found;
  }
  return null;
}

export { dirname };

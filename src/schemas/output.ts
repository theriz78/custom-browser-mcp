import { z } from "zod";

export const BUNDLE_SCHEMA_VERSION = "1.0.0";

export const OutputKind = z.enum(["a11y", "tokens", "screenshot"]);
export type OutputKind = z.infer<typeof OutputKind>;

export const CookieConsentMode = z.enum(["auto", "skip"]);
export type CookieConsentMode = z.infer<typeof CookieConsentMode>;

export const AnalyzePageInput = z.object({
  url: z.string().url(),
  outputs: z
    .array(OutputKind)
    .nonempty({ message: "outputs must contain at least one of: a11y, tokens, screenshot" })
    .default(["a11y", "tokens", "screenshot"]),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1440, height: 900 }),
  full_page_screenshot: z.boolean().default(true),
  wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
  timeout_ms: z.number().int().positive().default(30000),
  cookie_consent: CookieConsentMode.default("auto"),
  clear_cookies_after: z.boolean().default(true),
  allow_private_urls: z.boolean().default(false),
  pre_render_script: z.string().optional(),
  pre_render_delay_ms: z.number().int().nonnegative().default(0),
});
export type AnalyzePageInput = z.infer<typeof AnalyzePageInput>;

export const CookieConsentLog = z.object({
  attempted: z.boolean(),
  accepted: z.boolean(),
  selector_matched: z.string().optional(),
  duration_ms: z.number().int().nonnegative(),
});
export type CookieConsentLog = z.infer<typeof CookieConsentLog>;

export const A11yPayload = z.object({
  yaml: z.string(),
  node_count: z.number().int().nonnegative(),
  approx_tokens: z.number().int().nonnegative(),
});

export const TokensPayload = z.object({
  colors_top: z.array(
    z.object({ value: z.string(), count: z.number().int().nonnegative(), confidence: z.enum(["high", "medium", "low"]) })
  ),
  fonts: z.array(
    z.object({ family: z.string(), weights: z.array(z.string()), sample_count: z.number().int().nonnegative() })
  ),
  spacing_scale: z.array(z.number()),
  type_scale_px: z.array(z.number()),
});

export const ScreenshotPayload = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  full_page: z.boolean(),
});

export const Bundle = z.object({
  schema_version: z.literal(BUNDLE_SCHEMA_VERSION),
  url: z.string().url(),
  fetched_at: z.string(),
  duration_ms: z.number().int().nonnegative(),
  outputs_requested: z.array(OutputKind),
  a11y: A11yPayload.optional(),
  tokens: TokensPayload.optional(),
  screenshot: ScreenshotPayload.optional(),
  warnings: z.array(z.string()).default([]),
  snapshot_id: z.string(),
  cookie_consent: CookieConsentLog.optional(),
  cookies_cleared: z.boolean().optional(),
});
export type Bundle = z.infer<typeof Bundle>;

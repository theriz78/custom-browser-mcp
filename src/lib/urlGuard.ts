const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const PRIVATE_HOSTNAMES_EXACT = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127(\.\d{1,3}){3}$/,
  /^10(\.\d{1,3}){3}$/,
  /^192\.168(\.\d{1,3}){2}$/,
  /^172\.(1[6-9]|2\d|3[0-1])(\.\d{1,3}){2}$/,
  /^169\.254(\.\d{1,3}){2}$/,
  /^0\.0\.0\.0$/,
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])(\.\d{1,3}){2}$/,
];

const PRIVATE_IPV6_PREFIXES = ["::1", "fc", "fd", "fe80:", "fe90:", "fea0:", "feb0:"];

export interface UrlGuardOptions {
  allowPrivate?: boolean;
}

export class UrlGuardError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "UrlGuardError";
  }
}

function isPrivateIpv4(host: string): boolean {
  return PRIVATE_IPV4_PATTERNS.some((re) => re.test(host));
}

function isPrivateIpv6(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1") return true;
  return PRIVATE_IPV6_PREFIXES.some((p) => lower.startsWith(p));
}

export function assertSafeUrl(input: string, opts: UrlGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlGuardError("INVALID_URL", `Not a valid URL: ${input.slice(0, 80)}`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UrlGuardError(
      "FORBIDDEN_SCHEME",
      `URL scheme ${url.protocol} not allowed. Only http: and https: accepted. Got: ${input.slice(0, 80)}`
    );
  }
  if (opts.allowPrivate) return url;
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES_EXACT.has(host)) {
    throw new UrlGuardError(
      "PRIVATE_HOSTNAME",
      `URL host "${host}" is a loopback/local address (SSRF guard).`
    );
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new UrlGuardError(
      "PRIVATE_IP",
      `URL host "${host}" is a private/loopback/link-local IP (SSRF guard).`
    );
  }
  return url;
}

export function isSafeUrl(input: string, opts?: UrlGuardOptions): boolean {
  try {
    assertSafeUrl(input, opts);
    return true;
  } catch {
    return false;
  }
}

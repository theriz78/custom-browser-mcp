import type { Page } from "patchright";

function countYamlNodes(yaml: string): number {
  let n = 0;
  for (const line of yaml.split("\n")) {
    if (/^\s*-\s/.test(line)) n++;
  }
  return n;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function extractA11y(page: Page): Promise<{
  yaml: string;
  node_count: number;
  approx_tokens: number;
}> {
  const yaml = await page.locator(":root").ariaSnapshot();
  return {
    yaml,
    node_count: countYamlNodes(yaml),
    approx_tokens: approxTokens(yaml),
  };
}

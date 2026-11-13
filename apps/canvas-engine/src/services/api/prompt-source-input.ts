import { createPromptSource, type PromptSource } from "./prompt-source-presets";

export type PromptSourceInputResult =
  | { valid: true; value: PromptSource }
  | { valid: false; reason: "name" | "url" | "homepage" };

/** Catalog locations must be absolute web addresses without embedded credentials. */
export function isPromptSourceAddress(input: string): boolean {
  let parsed: URL;
  try { parsed = new URL(input.trim()); }
  catch { return false; }
  const web = parsed.protocol === "https:" || parsed.protocol === "http:";
  const anonymous = parsed.username.length + parsed.password.length === 0;
  return web && anonymous && parsed.host.length > 0;
}

/** Validation is a data boundary; reading or editing a source never requires mounting a UI. */
export function inspectPromptSourceInput(input: Partial<PromptSource>): PromptSourceInputResult {
  const record = createPromptSource({ ...input, builtIn: false });
  if (record.name.length === 0) return { valid: false, reason: "name" };
  for (const field of ["url", "homepage"] as const) {
    if (field === "homepage" && record[field].length === 0) continue;
    if (!isPromptSourceAddress(record[field])) return { valid: false, reason: field };
  }
  return { valid: true, value: record };
}

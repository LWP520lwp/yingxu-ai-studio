export function normalizePluginHttpUrl(value: string, base?: string) {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function addPluginCacheBuster(
  value: string,
  base: string,
  revision: number,
) {
  const url = normalizePluginHttpUrl(value, base);
  if (!url) throw new TypeError("Plugin URL must use HTTP or HTTPS");
  url.searchParams.set("_plugin_refresh", String(revision));
  return url.toString();
}

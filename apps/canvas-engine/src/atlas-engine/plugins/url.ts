export function resolvePluginSourceUrl(value: string, base?: string): URL | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function addPluginRefreshToken(value: string, origin: string, revision: number): string {
  const url = resolvePluginSourceUrl(value, origin);
  if (!url) throw new TypeError("Plugin source must be an HTTP(S) URL without credentials");
  url.searchParams.set("_plugin_refresh", String(revision));
  return url.toString();
}

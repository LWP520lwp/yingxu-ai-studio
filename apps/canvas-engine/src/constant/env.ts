const FALLBACK_REGISTRY = "/plugins/official-plugins.json";

function setting(value: string | undefined) {
  return value?.trim() || "";
}

function publicLink(value: string) {
  if (!value) return "";
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export const APP_VERSION = setting(__APP_VERSION__) || "dev";
export const DOCS_URL = publicLink(setting(import.meta.env.VITE_DOC_URL));
export const PLUGIN_REGISTRY_URL =
  publicLink(setting(import.meta.env.VITE_PLUGIN_REGISTRY_URL)) || FALLBACK_REGISTRY;

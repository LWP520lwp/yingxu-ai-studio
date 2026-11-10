export const APP_VERSION = __APP_VERSION__ || "dev";

// A deployer may provide their own documentation. Built-in help stays in the app.
export const DOCS_URL = import.meta.env.VITE_DOC_URL || "";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";

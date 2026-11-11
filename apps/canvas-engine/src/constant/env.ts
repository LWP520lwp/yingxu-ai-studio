export const APP_VERSION = __APP_VERSION__ || "dev";

// A deployer may provide their own documentation. Built-in help stays in the app.
export const DOCS_URL = import.meta.env.VITE_DOC_URL || "";

// The workbench owns its registry endpoint. Deployments can replace it with a
// trusted mirror, but a fresh install never reaches a third-party registry by
// default.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "/plugins/official-plugins.json";

export const LEGACY_CANVAS_FILE_ID = "infinite-canvas" as const;

export const LEGACY_STORAGE_KEYS = {
  locale: `${LEGACY_CANVAS_FILE_ID}:locale`,
  theme: `${LEGACY_CANVAS_FILE_ID}:theme_store`,
  canvas: `${LEGACY_CANVAS_FILE_ID}:canvas_store`,
  plugins: `${LEGACY_CANVAS_FILE_ID}:plugin_store`,
  assets: `${LEGACY_CANVAS_FILE_ID}:asset_store`,
  promptSources: `${LEGACY_CANVAS_FILE_ID}:prompt_source_store_v2`,
} as const;

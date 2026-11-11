/** File-format identity owned by 映序 AI Studio. Older exports remain readable. */
export const PRODUCT_FILE_ID = "yingxu-ai-studio" as const;
export const LEGACY_FILE_IDS = new Set(["infinite-canvas"]);

export function isSupportedFileId(value: unknown): value is typeof PRODUCT_FILE_ID {
    return value === PRODUCT_FILE_ID || (typeof value === "string" && LEGACY_FILE_IDS.has(value));
}

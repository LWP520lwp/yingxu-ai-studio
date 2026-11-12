export type ImageNodeActionToolId =
  | "copyPrompt"
  | "reversePrompt"
  | "replace"
  | "resize"
  | "maskEdit"
  | "crop"
  | "split"
  | "upscale"
  | "superResolve"
  | "angle"
  | "view";

export type ImageQuickToolId =
  "info" | "delete" | "saveAsset" | "download" | ImageNodeActionToolId;

export type ImageQuickToolsConfig = {
  ids: ImageQuickToolId[];
  showLabels: boolean;
};

export const IMAGE_QUICK_TOOLS_STORAGE_KEY = "canvas-image-quick-tools-v7";

const baseToolIds = ["info", "delete", "saveAsset", "download"] as const;
const actionToolIds: readonly ImageNodeActionToolId[] = [
  "copyPrompt",
  "reversePrompt",
  "replace",
  "resize",
  "maskEdit",
  "crop",
  "split",
  "upscale",
  "superResolve",
  "angle",
  "view",
];

const allToolIds: readonly ImageQuickToolId[] = [
  ...baseToolIds,
  ...actionToolIds,
];

export const defaultImageQuickToolIds: ImageQuickToolId[] = [
  ...baseToolIds,
  "copyPrompt",
  "reversePrompt",
  "replace",
  "maskEdit",
  "crop",
  "split",
  "upscale",
  "view",
];

const validToolIds = new Set<ImageQuickToolId>(allToolIds);

export function normalizeImageQuickToolIds(value: unknown): ImageQuickToolId[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.filter(isImageQuickToolId));
  return allToolIds.filter((id) => selected.has(id));
}

export function readImageQuickToolsConfig(
  value: unknown,
): ImageQuickToolsConfig {
  if (Array.isArray(value)) {
    return { ids: normalizeImageQuickToolIds(value), showLabels: false };
  }
  if (!value || typeof value !== "object") {
    return { ids: [...defaultImageQuickToolIds], showLabels: false };
  }

  const config = value as Partial<ImageQuickToolsConfig>;
  return {
    ids: Array.isArray(config.ids)
      ? normalizeImageQuickToolIds(config.ids)
      : [...defaultImageQuickToolIds],
    showLabels: config.showLabels === true,
  };
}

export function setImageQuickToolVisibility(
  currentIds: readonly ImageQuickToolId[],
  id: ImageQuickToolId,
  visible: boolean,
): ImageQuickToolId[] {
  const selected = new Set(currentIds);
  if (visible) selected.add(id);
  else selected.delete(id);
  return allToolIds.filter((toolId) => selected.has(toolId));
}

export function getImageQuickToolSelectionChanges(
  availableIds: readonly ImageQuickToolId[],
  currentIds: readonly ImageQuickToolId[],
  nextIds: readonly ImageQuickToolId[],
): Array<{ id: ImageQuickToolId; visible: boolean }> {
  const current = new Set(currentIds);
  const next = new Set(nextIds);
  return availableIds.flatMap((id) =>
    current.has(id) === next.has(id) ? [] : [{ id, visible: next.has(id) }],
  );
}

function isImageQuickToolId(value: unknown): value is ImageQuickToolId {
  return (
    typeof value === "string" && validToolIds.has(value as ImageQuickToolId)
  );
}

import type { AtlasCommand } from "@/atlas-engine/reducer";

export function planAtlasNodeDeletion(ids: Iterable<string>): AtlasCommand[] {
  const uniqueIds = [...new Set([...ids].filter((id) => id.trim().length > 0))];
  if (!uniqueIds.length) return [];
  return [
    { type: "remove-nodes", ids: uniqueIds },
    { type: "clear-selection" },
  ];
}

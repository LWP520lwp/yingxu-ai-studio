import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

/** Prefer the node's visible result; a restored batch may only have its selected slot. */
export function readCanvasImageReference(node: CanvasNodeData): ReferenceImage | null {
  const data = node.metadata;
  const slots = data?.images;
  const primary = slots?.find((slot) => slot.id === data?.primaryImageId && slot.status === "success")
    ?? slots?.find((slot) => slot.status === "success" && slot.content);
  const dataUrl = data?.content || primary?.content;
  if (!dataUrl) return null;
  return {
    id: node.id,
    name: `${node.title || node.id}.png`,
    dataUrl,
    type: data?.mimeType || primary?.mimeType || "image/png",
    storageKey: data?.content ? data.storageKey : primary?.storageKey,
  };
}

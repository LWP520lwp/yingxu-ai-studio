import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

function selectedResult(node: CanvasNodeData, images: readonly CanvasNodeImage[]) {
  const selectedId = node.metadata?.primaryImageId;
  if (selectedId) {
    const selected = images.find((image) => image.id === selectedId && image.status === "success");
    if (selected) return selected;
  }
  return images.find((image) => image.status === "success" && Boolean(image.content));
}

export function atlasImageReference(node: CanvasNodeData): ReferenceImage | null {
  const metadata = node.metadata;
  const batchResult = selectedResult(node, metadata?.images ?? []);
  const visibleContent = metadata?.content || batchResult?.content;
  if (!visibleContent) return null;

  const isNodeImage = Boolean(metadata?.content);
  return {
    id: node.id,
    name: `${node.title || node.id}.png`,
    dataUrl: visibleContent,
    type: metadata?.mimeType || batchResult?.mimeType || "image/png",
    storageKey: isNodeImage ? metadata?.storageKey : batchResult?.storageKey,
  };
}

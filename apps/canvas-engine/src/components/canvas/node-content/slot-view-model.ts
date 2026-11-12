import type {
  CanvasNodeImage,
  CanvasNodeStatus,
  CanvasNodeText,
} from "@/types/canvas";

import type { CanvasNodeData } from "@/types/canvas";

export type ContentSlotState = "content" | "loading" | "error" | "empty";
export type BatchCardPosition = { x: number; y: number };

export function expandedBatchCardPosition(
  index: number,
  itemCount: number,
  cardWidth: number,
  cardHeight: number,
  gap = 18,
): BatchCardPosition {
  if (itemCount <= 1 || index < 0 || index >= itemCount - 1) {
    return { x: 0, y: 0 };
  }

  const columns = Math.min(Math.max(1, itemCount), 4);
  const rows = Math.ceil(Math.max(1, itemCount) / columns);
  const primarySlot = (rows - 1) * columns;
  const slot = index >= primarySlot ? index + 1 : index;

  return {
    x: (slot % columns) * (cardWidth + gap),
    y: (Math.floor(slot / columns) - rows + 1) * (cardHeight + gap),
  };
}

export function contentSlotState(
  status: CanvasNodeStatus | undefined,
  content: string | undefined,
): ContentSlotState {
  if (content) return "content";
  if (status === "loading") return "loading";
  if (status === "error") return "error";
  return "empty";
}

export function primaryImageSlot(node: CanvasNodeData): {
  image?: CanvasNodeImage;
  content?: string;
} {
  const images = node.metadata?.images ?? [];
  const primaryId = node.metadata?.primaryImageId ?? images[0]?.id;
  const image = images.find((item) => item.id === primaryId) ?? images[0];
  return { image, content: image ? image.content : node.metadata?.content };
}

export function primaryTextSlot(node: CanvasNodeData): {
  text?: CanvasNodeText;
  content?: string;
} {
  const texts = node.metadata?.texts ?? [];
  const primaryId = node.metadata?.primaryTextId ?? texts[0]?.id;
  const text = texts.find((item) => item.id === primaryId) ?? texts[0];
  return { text, content: text ? text.content : node.metadata?.content };
}

import { getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasReferenceSource = {
  node: CanvasNodeData;
  sourceNodeId: string;
};

export type CanvasReferenceItem = CanvasReferenceSource & {
  frameLabel?: "首帧" | "尾帧" | "超出帧数";
};

export function canSwapFrameDrop(
  frameIds: readonly string[],
  draggedId: string,
  targetId: string,
) {
  return (
    frameIds.length === 2 &&
    draggedId !== targetId &&
    frameIds.includes(draggedId) &&
    frameIds.includes(targetId)
  );
}

export function expandReferenceSources(
  connectedNodes: readonly CanvasNodeData[],
  nodes: CanvasNodeData[],
): CanvasReferenceSource[] {
  return connectedNodes.flatMap((sourceNode) => {
    const resources =
      sourceNode.type === CanvasNodeType.Group
        ? getGroupResourceNodes(sourceNode.id, nodes)
        : [sourceNode];
    return resources.map((node) => ({ node, sourceNodeId: sourceNode.id }));
  });
}

export function createReferenceItems(
  references: readonly CanvasReferenceSource[],
  frameMode: boolean,
  imageIds: readonly string[],
  framesReversed: boolean,
): CanvasReferenceItem[] {
  const visible = frameMode
    ? [...new Map(references.map((item) => [item.node.id, item])).values()]
    : [...references];
  const orderedImageIds = framesReversed ? [...imageIds].reverse() : imageIds;
  const frameIndex = new Map(orderedImageIds.map((id, index) => [id, index]));

  return visible.map((reference) => {
    const index = frameIndex.get(reference.node.id);
    const frameLabel =
      !frameMode || index === undefined
        ? undefined
        : index === 0
          ? "首帧"
          : index === 1
            ? "尾帧"
            : "超出帧数";
    return { ...reference, frameLabel };
  });
}

export function referenceSourcesToDisconnect(
  references: readonly CanvasReferenceSource[],
  nodeId: string,
  sourceNodeId: string,
  frameMode: boolean,
) {
  if (!frameMode) return [sourceNodeId];
  return [
    ...new Set(
      references
        .filter((reference) => reference.node.id === nodeId)
        .map((reference) => reference.sourceNodeId),
    ),
  ];
}

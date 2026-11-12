import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type AngleSource = Pick<CanvasNodeData, "position" | "width" | "height">;

export function createAngleImageDraft(
  source: AngleSource,
  id: string,
  title: string,
  prompt: string,
  generationMetadata: CanvasNodeData["metadata"],
): CanvasNodeData {
  const size = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
  return {
    id,
    type: CanvasNodeType.Image,
    title,
    position: { x: source.position.x + source.width + 96, y: source.position.y },
    width: size.width,
    height: size.height,
    metadata: {
      prompt,
      status: "loading",
      ...generationMetadata,
    },
  };
}

export function applyAngleImageResult(
  node: CanvasNodeData,
  uploaded: UploadedImage,
  prompt: string,
  generationMetadata: CanvasNodeData["metadata"],
  bounds: { width: number; height: number } =
    NODE_DEFAULT_SIZE[CanvasNodeType.Image],
): CanvasNodeData {
  const size = fitNodeSize(
    uploaded.width,
    uploaded.height,
    bounds.width,
    bounds.height,
  );
  return {
    ...node,
    width: size.width,
    height: size.height,
    metadata: {
      ...node.metadata,
      ...imageMetadata(uploaded),
      prompt,
      ...generationMetadata,
    },
  };
}

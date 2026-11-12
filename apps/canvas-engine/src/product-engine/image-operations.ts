import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type ImageTransformSource = Pick<
  CanvasNodeData,
  "id" | "title" | "position" | "width" | "height" | "metadata"
>;

type SplitGrid = { rows: number; columns: number };

export type SplitImageResult = {
  id: string;
  title: string;
  row: number;
  column: number;
  image: UploadedImage;
};

export function createCropImageResult(
  source: ImageTransformSource,
  id: string,
  image: UploadedImage,
  title = "Cropped Image",
): CanvasNodeData {
  const width = Math.min(source.width, Math.max(220, image.width));
  return {
    id,
    type: CanvasNodeType.Image,
    title,
    position: { x: source.position.x + source.width + 96, y: source.position.y },
    width,
    height: width * (image.height / image.width),
    metadata: {
      ...imageMetadata(image),
      prompt: source.metadata?.prompt,
    },
  };
}

export function createSplitImageResults(
  source: ImageTransformSource,
  results: readonly SplitImageResult[],
  grid: SplitGrid,
  gap = 16,
): CanvasNodeData[] {
  const cellWidth = source.width / grid.columns;
  const cellHeight = source.height / grid.rows;
  const startX = source.position.x + source.width + 96;

  return results.map((result) => ({
    id: result.id,
    type: CanvasNodeType.Image,
    title: result.title,
    position: {
      x: startX + result.column * (cellWidth + gap),
      y: source.position.y + result.row * (cellHeight + gap),
    },
    width: cellWidth,
    height: cellHeight,
    metadata: {
      ...imageMetadata(result.image),
      prompt: source.metadata?.prompt,
    },
  }));
}

export function createUpscaleImageResult(
  source: ImageTransformSource,
  id: string,
  image: UploadedImage,
  title = "Upscaled Image",
): CanvasNodeData {
  const size = fitNodeSize(image.width, image.height);
  return {
    id,
    type: CanvasNodeType.Image,
    title,
    position: { x: source.position.x + source.width + 96, y: source.position.y },
    width: size.width,
    height: size.height,
    metadata: {
      ...imageMetadata(image),
      prompt: source.metadata?.prompt,
    },
  };
}

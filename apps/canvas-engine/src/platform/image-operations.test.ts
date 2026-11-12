import { describe, expect, it } from "vitest";

import {
  createCropImageResult,
  createSplitImageResults,
  createUpscaleImageResult,
} from "@/product-engine/image-operations";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { UploadedImage } from "@/services/image-storage";

function sourceNode(): CanvasNodeData {
  return {
    id: "source",
    type: CanvasNodeType.Image,
    title: "Source",
    position: { x: 20, y: 30 },
    width: 300,
    height: 200,
    metadata: { prompt: "Keep this subject" },
  };
}

function uploadedImage(
  overrides: Partial<UploadedImage> = {},
): UploadedImage {
  return {
    url: "blob:result",
    storageKey: "image:result",
    width: 400,
    height: 200,
    bytes: 64,
    mimeType: "image/png",
    ...overrides,
  };
}

describe("canvas image operation results", () => {
  it("creates a cropped image after the source and preserves its prompt", () => {
    const result = createCropImageResult(
      sourceNode(),
      "crop-1",
      uploadedImage(),
    );

    expect(result).toMatchObject({
      id: "crop-1",
      type: CanvasNodeType.Image,
      title: "Cropped Image",
      position: { x: 416, y: 30 },
      width: 300,
      height: 150,
      metadata: {
        content: "blob:result",
        prompt: "Keep this subject",
        status: "success",
      },
    });
  });

  it("maps split pieces to their grid cells with consistent spacing", () => {
    const source = sourceNode();
    const results = createSplitImageResults(
      { ...source, width: 600, height: 400 },
      [
        {
          id: "tile-1",
          title: "Tile 1",
          row: 0,
          column: 0,
          image: uploadedImage(),
        },
        {
          id: "tile-2",
          title: "Tile 2",
          row: 1,
          column: 2,
          image: uploadedImage({ url: "blob:second" }),
        },
      ],
      { rows: 2, columns: 3 },
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "tile-1",
      position: { x: 716, y: 30 },
      width: 200,
      height: 200,
      metadata: { content: "blob:result", prompt: "Keep this subject" },
    });
    expect(results[1]).toMatchObject({
      id: "tile-2",
      position: { x: 1148, y: 246 },
      width: 200,
      height: 200,
      metadata: { content: "blob:second", prompt: "Keep this subject" },
    });
  });

  it("fits an upscaled result and places it beside the source", () => {
    const result = createUpscaleImageResult(
      sourceNode(),
      "upscale-1",
      uploadedImage({ width: 1600, height: 900 }),
    );

    expect(result).toMatchObject({
      id: "upscale-1",
      type: CanvasNodeType.Image,
      title: "Upscaled Image",
      position: { x: 416, y: 30 },
      width: 640,
      height: 360,
      metadata: {
        content: "blob:result",
        prompt: "Keep this subject",
        status: "success",
      },
    });
  });
});

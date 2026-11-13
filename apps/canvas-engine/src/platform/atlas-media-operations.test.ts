import { describe, expect, it } from "vitest";

import {
  applyAtlasAngleImageResult,
  applyAtlasMediaReplacement,
  classifyAtlasMedia,
  createAtlasAngleImageDraft,
  createAtlasCropImageResult,
  createAtlasSplitImageResults,
  createAtlasUpscaleImageResult,
  planAtlasMediaImport,
  type AtlasMediaFile,
} from "@/atlas-engine/workflows/media-operations";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";

const file = (name: string, type: string): AtlasMediaFile => ({ name, type });

function image(overrides: Partial<UploadedImage> = {}): UploadedImage {
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

function uploadedFile(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    url: "blob:media",
    storageKey: "media:result",
    bytes: 128,
    mimeType: "application/octet-stream",
    ...overrides,
  };
}

function sourceNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id: "source",
    type: CanvasNodeType.Image,
    title: "Source",
    position: { x: 20, y: 30 },
    width: 300,
    height: 200,
    metadata: { prompt: "Keep the same subject", content: "blob:source" },
    ...overrides,
  };
}

describe("Atlas media workflows", () => {
  it("classifies supported media from metadata and common file extensions", () => {
    expect(classifyAtlasMedia(file("track.wav", "application/octet-stream"))).toBe("audio");
    expect(classifyAtlasMedia(file("clip.mp4", "application/octet-stream"))).toBe("video");
    expect(classifyAtlasMedia(file("cover.png", "image/png"))).toBe("image");
    expect(classifyAtlasMedia(file("notes.txt", "text/plain"))).toBeNull();
  });

  it("plans first-file replacement and staggered additions around the drop point", () => {
    const files = [
      file("ignore.txt", "text/plain"),
      file("replacement.mp4", "video/mp4"),
      file("nearby.png", "image/png"),
    ];
    const plan = planAtlasMediaImport(
      files,
      { nodeId: "target", position: { x: 30, y: 50 } },
      { x: 100, y: 200 },
    );

    expect(plan.replacement).toMatchObject({
      file: files[1],
      kind: "video",
      nodeId: "target",
      position: { x: 30, y: 50 },
    });
    expect(plan.additions).toEqual([{
      file: files[2],
      kind: "image",
      position: { x: 70, y: 90 },
    }]);
    expect(planAtlasMediaImport([files[2]], null, { x: 100, y: 200 }).additions[0]?.position)
      .toEqual({ x: 100, y: 200 });
  });

  it("replaces media at the prior visual center and clears stale generation state", () => {
    const original = sourceNode({
      type: CanvasNodeType.Text,
      width: 240,
      height: 120,
      metadata: {
        content: "old",
        status: "error",
        errorDetails: "old error",
        generationType: "generation",
        model: "old-model",
        size: "1:1",
        quality: "high",
        count: 4,
        references: ["reference"],
      },
    });
    const untouched = sourceNode({ id: "other" });
    const result = applyAtlasMediaReplacement(
      [original, untouched],
      original.id,
      {
        fileName: "voice.mp3",
        kind: "audio",
        media: image({ url: "blob:audio", storageKey: "audio:1", mimeType: "audio/mpeg" }),
      },
    );

    expect(result[0]).toMatchObject({
      type: CanvasNodeType.Audio,
      title: "voice.mp3",
      width: 340,
      height: 120,
      position: { x: -30, y: 30 },
      metadata: {
        content: "blob:audio",
        status: "success",
        errorDetails: undefined,
        generationType: undefined,
        model: undefined,
        references: undefined,
      },
    });
    expect(result[1]).toBe(untouched);
  });

  it("uses video dimensions when available and falls back to bounded defaults when metadata is missing", () => {
    const original = sourceNode({ type: CanvasNodeType.Text });
    const withDimensions = applyAtlasMediaReplacement([original], original.id, {
      fileName: "clip.mp4",
      kind: "video",
      media: uploadedFile({ width: 1920, height: 1080, mimeType: "video/mp4" }),
    }, { width: 420, height: 420 })[0];
    const withoutDimensions = applyAtlasMediaReplacement([original], original.id, {
      fileName: "clip.mp4",
      kind: "video",
      media: uploadedFile({ mimeType: "video/mp4" }),
    }, { width: 500, height: 500 })[0];

    expect(withDimensions).toMatchObject({ width: 420, height: 236.25, position: { x: -40, y: 11.875 } });
    expect(withoutDimensions).toMatchObject({ width: 420, height: 236, position: { x: -40, y: 12 } });
    expect(withoutDimensions.metadata?.naturalWidth).toBeUndefined();
  });

  it("accepts dimensionless uploaded audio files", () => {
    const original = sourceNode({ type: CanvasNodeType.Text });
    const [updated] = applyAtlasMediaReplacement([original], original.id, {
      fileName: "voice.mp3",
      kind: "audio",
      media: uploadedFile({ mimeType: "audio/mpeg" }),
    });

    expect(updated).toMatchObject({
      type: CanvasNodeType.Audio,
      width: 340,
      height: 120,
      position: { x: 0, y: 70 },
      metadata: { content: "blob:media", storageKey: "media:result", mimeType: "audio/mpeg" },
    });
    expect(updated.metadata?.naturalWidth).toBeUndefined();
    expect(updated.metadata?.naturalHeight).toBeUndefined();
  });

  it("creates and completes an angle-image draft while preserving prompt and model options", () => {
    const options = {
      model: "image-model",
      generationType: "edit" as const,
      size: "16:9",
      quality: "high",
      background: "transparent",
      references: ["ref-a", "ref-b"],
    };
    const draft = createAtlasAngleImageDraft(
      { position: { x: 24, y: 36 }, width: 280, height: 160 },
      "angle-1",
      "Rear view",
      "Show the rear view",
      options,
    );
    const completed = applyAtlasAngleImageResult(
      draft,
      image({ width: 1600, height: 900, storageKey: "image:angle-1" }),
      "Show the rear view",
      options,
      { width: 320, height: 240 },
    );

    expect(draft).toMatchObject({
      id: "angle-1",
      type: CanvasNodeType.Image,
      position: { x: 400, y: 36 },
      metadata: {
        prompt: "Show the rear view",
        status: "loading",
        model: "image-model",
        size: "16:9",
        quality: "high",
        background: "transparent",
        references: ["ref-a", "ref-b"],
      },
    });
    expect(completed).toMatchObject({
      width: 320,
      height: 180,
      metadata: {
        content: "blob:result",
        storageKey: "image:angle-1",
        status: "success",
        prompt: "Show the rear view",
        generationType: "edit",
        model: "image-model",
        size: "16:9",
        quality: "high",
        background: "transparent",
        references: ["ref-a", "ref-b"],
      },
    });
  });

  it("places crop and upscale outputs at predictable positions and maps split pieces to grid cells", () => {
    const source = sourceNode();
    const cropped = createAtlasCropImageResult(source, "crop-1", image());
    const upscaled = createAtlasUpscaleImageResult(source, "upscale-1", image({ width: 1600, height: 900 }));
    const tiles = createAtlasSplitImageResults(
      { ...source, width: 600, height: 400 },
      [
        { id: "tile-1", title: "Tile 1", row: 0, column: 0, image: image() },
        { id: "tile-2", title: "Tile 2", row: 1, column: 2, image: image({ url: "blob:second" }) },
        { id: "invalid", title: "Invalid", row: 2, column: 0, image: image() },
      ],
      { rows: 2, columns: 3 },
    );

    expect(cropped).toMatchObject({
      title: "Cropped Image",
      position: { x: 416, y: 30 },
      width: 300,
      height: 150,
      metadata: { content: "blob:result", prompt: "Keep the same subject", status: "success" },
    });
    expect(upscaled).toMatchObject({
      title: "Upscaled Image",
      position: { x: 416, y: 30 },
      width: 640,
      height: 360,
    });
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({ position: { x: 716, y: 30 }, width: 200, height: 200 });
    expect(tiles[1]).toMatchObject({ position: { x: 1148, y: 246 }, width: 200, height: 200 });
  });
});

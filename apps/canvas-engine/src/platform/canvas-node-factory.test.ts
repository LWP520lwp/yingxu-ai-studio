import { describe, expect, it } from "vitest";

import {
  applyNodeConfigPatch,
  audioMetadata,
  buildAudioGenerationMetadata,
  buildImageGenerationMetadata,
  createCanvasNode,
  imageMetadata,
  referenceUrl,
  videoMetadata,
} from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { defaultConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

const reference = (
  overrides: Partial<ReferenceImage> = {},
): ReferenceImage => ({
  id: "reference",
  name: "Reference",
  type: "image/png",
  dataUrl: "data:image/png;base64,AA==",
  ...overrides,
});

function node(
  type: CanvasNodeData["type"],
  patch: Partial<CanvasNodeData> = {},
): CanvasNodeData {
  return {
    id: "node",
    type,
    title: "Node",
    position: { x: 10, y: 20 },
    width: 300,
    height: 200,
    metadata: { content: "" },
    ...patch,
  };
}

describe("canvas node factory", () => {
  it("centers built-in nodes and keeps video configuration tall enough", () => {
    const text = createCanvasNode(CanvasNodeType.Text, { x: 500, y: 400 });
    expect(text.position).toEqual({ x: 330, y: 280 });
    expect(text.width).toBe(340);
    expect(text.metadata).toMatchObject({ content: "", status: "idle" });

    const videoConfig = createCanvasNode(
      CanvasNodeType.Config,
      { x: 500, y: 400 },
      { generationMode: "video" },
    );
    expect(videoConfig.height).toBe(360);
    expect(videoConfig.position).toEqual({ x: 330, y: 220 });
    expect(videoConfig.metadata?.generationMode).toBe("video");
  });

  it("normalizes uploaded media metadata and preserves media-specific fields", () => {
    expect(
      imageMetadata({
        url: "/image",
        width: Number.NaN,
        height: 500,
        bytes: -10,
        mimeType: "image/png",
      }),
    ).toEqual({
      content: "/image",
      status: "success",
      naturalHeight: 500,
      bytes: 0,
      mimeType: "image/png",
    });

    expect(
      videoMetadata({
        url: "/video",
        storageKey: "video:1",
        width: 1280,
        height: 720,
        bytes: 400,
        mimeType: "",
        durationMs: 6000,
      }),
    ).toMatchObject({
      content: "/video",
      storageKey: "video:1",
      naturalWidth: 1280,
      naturalHeight: 720,
      mimeType: "video/mp4",
      durationMs: 6000,
    });

    expect(
      audioMetadata({
        url: "/audio",
        storageKey: "audio:1",
        width: 100,
        height: 50,
        bytes: 20,
        mimeType: "",
        durationMs: Number.NaN,
      }),
    ).toEqual({
      content: "/audio",
      storageKey: "audio:1",
      status: "success",
      bytes: 20,
      mimeType: "audio/mpeg",
    });
  });

  it("uses stable reference priority and omits inline-only data URLs", () => {
    expect(
      referenceUrl(reference({ storageKey: "image:1", url: "/image" })),
    ).toBe("image:1");
    expect(referenceUrl(reference({ url: "/image" }))).toBe("/image");
    expect(referenceUrl(reference())).toBeUndefined();
    expect(referenceUrl(reference({ dataUrl: "/legacy-image" }))).toBe(
      "/legacy-image",
    );
  });

  it("keeps image generation reference order and emits a positive batch count", () => {
    expect(
      buildImageGenerationMetadata("generation", defaultConfig, Number.NaN, [
        reference({ storageKey: "image:b" }),
        reference({ url: "/image:a" }),
      ]),
    ).toMatchObject({
      generationType: "generation",
      count: 1,
      references: ["image:b", "/image:a"],
      model: defaultConfig.model,
      size: defaultConfig.size,
    });
    expect(buildAudioGenerationMetadata(defaultConfig)).toMatchObject({
      audioVoice: defaultConfig.audioVoice,
      audioFormat: defaultConfig.audioFormat,
      audioSpeed: defaultConfig.audioSpeed,
    });
  });

  it("keeps image and video nodes centered while an empty config changes ratio", () => {
    const image = node(CanvasNodeType.Image, {
      position: { x: 100, y: 200 },
      width: 340,
      height: 240,
    });
    const resized = applyNodeConfigPatch(image, { size: "16:9" });
    expect(resized.width).toBe(340);
    expect(resized.height).toBeCloseTo(191.25);
    expect(resized.position).toEqual({ x: 100, y: 224.375 });

    const video = node(CanvasNodeType.Video, {
      position: { x: 50, y: 80 },
      width: 420,
      height: 236,
    });
    const resizedVideo = applyNodeConfigPatch(video, { size: "1:1" });
    expect(resizedVideo.width).toBe(236);
    expect(resizedVideo.height).toBe(236);
    expect(resizedVideo.position).toEqual({ x: 142, y: 80 });
  });

  it("does not resize generated media and repairs malformed centers before resizing", () => {
    const generated = node(CanvasNodeType.Image, {
      metadata: { content: "/generated" },
    });
    expect(applyNodeConfigPatch(generated, { size: "16:9" })).toMatchObject({
      position: generated.position,
      width: generated.width,
      height: generated.height,
    });

    const malformed = node(CanvasNodeType.Image, {
      position: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY,
    });
    const repaired = applyNodeConfigPatch(malformed, { size: "1:1" });
    expect(repaired.position).toEqual({ x: 50, y: 0 });
    expect(repaired.width).toBe(240);
    expect(repaired.height).toBe(240);
  });
});

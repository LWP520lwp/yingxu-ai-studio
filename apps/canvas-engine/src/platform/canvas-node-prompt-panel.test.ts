import { describe, expect, it } from "vitest";

import {
  audioConfigPatch,
  buildNodeConfig,
  videoConfigPatch,
} from "@/components/canvas/canvas-node-prompt-panel";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(
  type: CanvasNodeType,
  metadata: CanvasNodeData["metadata"] = {},
): CanvasNodeData {
  return {
    id: "node",
    type,
    title: "node",
    position: { x: 0, y: 0 },
    width: 320,
    height: 200,
    metadata,
  };
}

describe("canvas node prompt panel configuration", () => {
  it("uses node overrides and keeps image-count fallback mode-specific", () => {
    const globalConfig = {
      ...defaultConfig,
      canvasImageCount: "3",
      count: "4",
    };
    const image = buildNodeConfig(
      globalConfig,
      node(CanvasNodeType.Image, {
        model: "custom-image",
        count: 2,
        quality: "high",
      }),
      "image",
    );
    const imageFallback = buildNodeConfig(
      globalConfig,
      node(CanvasNodeType.Image),
      "image",
    );
    const text = buildNodeConfig(
      globalConfig,
      node(CanvasNodeType.Text),
      "text",
    );

    expect(image.model).toBe("custom-image");
    expect(image.count).toBe("2");
    expect(image.quality).toBe("high");
    expect(imageFallback.count).toBe("3");
    expect(text.count).toBe("4");
  });

  it("maps video and audio controls to canvas metadata fields", () => {
    expect(videoConfigPatch("videoSeconds", "12")).toEqual({ seconds: "12" });
    expect(videoConfigPatch("videoGenerateAudio", "false")).toEqual({
      generateAudio: "false",
    });
    expect(videoConfigPatch("videoMode", "frames")).toEqual({
      videoMode: "frames",
    });
    expect(audioConfigPatch("audioSpeed", "1.2")).toEqual({
      audioSpeed: "1.2",
    });
    expect(audioConfigPatch("audioInstructions", "warm narration")).toEqual({
      audioInstructions: "warm narration",
    });
  });

  it("keeps explicit per-node video switches when they differ from globals", () => {
    const configured = buildNodeConfig(
      { ...defaultConfig, videoGenerateAudio: "true", videoWatermark: "true" },
      node(CanvasNodeType.Video, {
        generateAudio: "false",
        watermark: "false",
      }),
      "video",
    );

    expect(configured.videoGenerateAudio).toBe("false");
    expect(configured.videoWatermark).toBe("false");
  });
});

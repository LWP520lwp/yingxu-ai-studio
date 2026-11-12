import { describe, expect, it } from "vitest";

import { canGenerateFromInputs } from "@/components/canvas/canvas-config-node-panel";

describe("config node generation gate", () => {
  it("allows prompts to generate without connected inputs", () => {
    expect(
      canGenerateFromInputs("image", true, {
        textCount: 0,
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
      }),
    ).toBe(true);
  });

  it("requires text for audio generation", () => {
    expect(
      canGenerateFromInputs("audio", false, {
        textCount: 0,
        imageCount: 1,
        videoCount: 1,
        audioCount: 1,
      }),
    ).toBe(false);
    expect(
      canGenerateFromInputs("audio", false, {
        textCount: 1,
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
      }),
    ).toBe(true);
  });

  it("allows any connected input for non-audio modes", () => {
    expect(
      canGenerateFromInputs("video", false, {
        textCount: 0,
        imageCount: 0,
        videoCount: 0,
        audioCount: 1,
      }),
    ).toBe(true);
    expect(
      canGenerateFromInputs("text", false, {
        textCount: 0,
        imageCount: 0,
        videoCount: 0,
        audioCount: 0,
      }),
    ).toBe(false);
  });
});

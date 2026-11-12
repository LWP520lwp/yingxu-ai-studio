import { describe, expect, it } from "vitest";

import {
  applyAngleImageResult,
  createAngleImageDraft,
} from "@/product-engine/angle-image";
import { CanvasNodeType } from "@/types/canvas";

describe("angle image lifecycle", () => {
  it("places a loading output beside its source with the requested prompt", () => {
    const draft = createAngleImageDraft(
      { position: { x: 24, y: 36 }, width: 280, height: 160 },
      "angle-1",
      "Rear view",
      "Show the rear view",
      { model: "image-model", generationType: "edit" },
    );

    expect(draft).toMatchObject({
      id: "angle-1",
      type: CanvasNodeType.Image,
      title: "Rear view",
      position: { x: 400, y: 36 },
      metadata: {
        prompt: "Show the rear view",
        status: "loading",
        model: "image-model",
        generationType: "edit",
      },
    });
  });

  it("stores the uploaded output within bounds and retains its angle settings", () => {
    const draft = createAngleImageDraft(
      { position: { x: 0, y: 0 }, width: 280, height: 160 },
      "angle-1",
      "Rear view",
      "Show the rear view",
      { model: "image-model", generationType: "edit" },
    );
    const completed = applyAngleImageResult(
      draft,
      {
        url: "blob:angle",
        storageKey: "image:angle-1",
        width: 1600,
        height: 900,
        bytes: 128,
        mimeType: "image/png",
      },
      "Show the rear view",
      { model: "image-model", generationType: "edit" },
      { width: 320, height: 240 },
    );

    expect(completed).toMatchObject({
      width: 320,
      height: 180,
      metadata: {
        content: "blob:angle",
        storageKey: "image:angle-1",
        status: "success",
        prompt: "Show the rear view",
        model: "image-model",
        generationType: "edit",
      },
    });
  });
});

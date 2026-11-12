import { describe, expect, it } from "vitest";

import { getThumbnailDimensions, pickImageSource } from "@/lib/image-thumbnail";

describe("canvas image preview sizing", () => {
  it("bounds a preview without changing the source aspect ratio", () => {
    expect(getThumbnailDimensions(4000, 2000)).toEqual({
      width: 768,
      height: 384,
    });
  });

  it("does not enlarge media that already fits the preview limit", () => {
    expect(getThumbnailDimensions(320, 240)).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("chooses the cached preview until the rendered pixel demand exceeds it", () => {
    const base = {
      previewUrl: "/preview.webp",
      originalUrl: "/original.png",
      naturalWidth: 4000,
      naturalHeight: 2000,
      devicePixelRatio: 1,
      previewMaxEdge: 768,
    };

    expect(
      pickImageSource({
        ...base,
        renderedWidth: 600,
        renderedHeight: 300,
        scale: 1,
      }),
    ).toBe("/preview.webp");
    expect(
      pickImageSource({
        ...base,
        renderedWidth: 600,
        renderedHeight: 300,
        scale: 1.5,
      }),
    ).toBe("/original.png");
  });

  it("falls back to the original when no preview was stored", () => {
    expect(
      pickImageSource({
        originalUrl: "/original.png",
        renderedWidth: 200,
        renderedHeight: 100,
        scale: 1,
      }),
    ).toBe("/original.png");
  });
});

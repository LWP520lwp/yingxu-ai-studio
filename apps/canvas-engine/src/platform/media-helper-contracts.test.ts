import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_IMAGE_PREVIEW_MAX_EDGE,
  createImageThumbnail,
  getThumbnailDimensions,
  pickImageSource,
} from "@/lib/image-thumbnail";
import {
  buildImageReferencePromptText,
  imageReferenceLabel,
} from "@/lib/image-reference-prompt";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { cn, randomId } from "@/lib/utils";

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "imageReferences.label") return `Image ${values?.index}`;
      if (key === "imageReferences.separator") return ", ";
      if (key === "imageReferences.promptPrefix") {
        return `References: ${values?.labels}\n\n${values?.prompt}`;
      }
      return key;
    },
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image preview source selection", () => {
  it("keeps previews until device-pixel demand exceeds their real dimensions", () => {
    const source = {
      previewUrl: "/preview.webp",
      originalUrl: "/original.png",
      naturalWidth: 4000,
      naturalHeight: 2000,
      renderedWidth: 300,
      renderedHeight: 150,
      scale: 1.5,
      devicePixelRatio: 1,
    };
    expect(pickImageSource(source)).toBe("/preview.webp");
    expect(
      pickImageSource({ ...source, renderedWidth: 600, renderedHeight: 300 }),
    ).toBe("/original.png");
    expect(pickImageSource({ ...source, previewUrl: undefined })).toBe(
      "/original.png",
    );
    expect(CANVAS_IMAGE_PREVIEW_MAX_EDGE).toBe(768);
  });

  it("fits thumbnails without upscaling and handles invalid dimensions", () => {
    expect(getThumbnailDimensions(4000, 2000)).toEqual({
      width: 768,
      height: 384,
    });
    expect(getThumbnailDimensions(320, 160)).toEqual({
      width: 320,
      height: 160,
    });
    expect(getThumbnailDimensions(Number.NaN, 0)).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("closes decoded bitmaps on every completion path", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) =>
      callback(new Blob(["webp"])),
    );
    const context = { drawImage };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob,
    };
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 2000,
      height: 1000,
      close,
    }));
    vi.stubGlobal("document", { createElement: () => canvas });

    const result = await createImageThumbnail(new Blob(["source"]));
    expect(result).toBeInstanceOf(Blob);
    expect(canvas.width).toBe(768);
    expect(canvas.height).toBe(384);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(toBlob).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("shared text utilities", () => {
  it("composes translated image labels and leaves reference-free prompts alone", () => {
    const references = [
      { id: "a", name: "a.png", type: "image/png", dataUrl: "data:a" },
      { id: "b", name: "b.png", type: "image/png", dataUrl: "data:b" },
    ];
    expect(imageReferenceLabel(0)).toBe("Image 1");
    expect(buildImageReferencePromptText("  use these  ", references)).toBe(
      "References: Image 1, Image 2\n\nuse these",
    );
    expect(buildImageReferencePromptText("  prompt  ", [])).toBe("prompt");
  });

  it("does not submit a composing or modified Enter keystroke", () => {
    expect(isImeComposing({ nativeEvent: { which: 229 } })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isPlainEnterKey({ key: "Enter" })).toBe(true);
    expect(isPlainEnterKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isPlainEnterKey({ key: "Enter", ctrlKey: true })).toBe(false);
    expect(isPlainEnterKey({ key: "Enter", isComposing: true })).toBe(false);
  });

  it("merges conflicting utility classes and creates unique IDs", () => {
    expect(cn("p-2", false, ["text-sm", "px-2"], "px-4")).toBe(
      "p-2 text-sm px-4",
    );
    expect(cn(undefined, null, false)).toBe("");
    const first = randomId();
    const second = randomId();
    expect(first).not.toBe(second);
    expect(first).toHaveLength(21);
  });
});

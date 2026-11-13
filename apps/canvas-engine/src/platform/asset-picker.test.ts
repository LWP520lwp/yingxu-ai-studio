import { describe, expect, it } from "vitest";

import {
  ASSET_PICKER_PAGE_SIZE,
  clampAssetPickerPage,
  filterPickerAssets,
  getAssetPickerPage,
  getAssetPickerPageCount,
  toInsertAssetPayload,
} from "@/atlas-engine/ui/asset-picker";
import type { Asset } from "@/stores/use-asset-store";

const asset = (
  id: string,
  kind: Asset["kind"],
  title = id,
  tags: string[] = [],
): Asset => {
  const base = {
    id,
    title,
    kind,
    coverUrl: "",
    tags,
    createdAt: "",
    updatedAt: "",
  };
  if (kind === "text")
    return { ...base, kind, data: { content: `content:${id}` } };
  if (kind === "image")
    return {
      ...base,
      kind,
      data: {
        dataUrl: `image:${id}`,
        width: 640,
        height: 480,
        bytes: 12,
        mimeType: "image/png",
      },
    };
  return {
    ...base,
    kind,
    data: {
      url: `video:${id}`,
      width: 1920,
      height: 1080,
      bytes: 24,
      mimeType: "video/mp4",
    },
  };
};

describe("asset picker helpers", () => {
  const assets = [
    asset("text-1", "text", "Ocean notes", ["science"]),
    asset("image-1", "image", "Ocean current"),
    asset("video-1", "video", "Space flight", ["science"]),
  ];

  it("filters by kind and case-insensitive title or tag text", () => {
    expect(
      filterPickerAssets(assets, "all", " SCIENCE ").map(({ id }) => id),
    ).toEqual(["text-1", "video-1"]);
    expect(
      filterPickerAssets(assets, "image", "ocean").map(({ id }) => id),
    ).toEqual(["image-1"]);
    expect(filterPickerAssets(assets, "video", "ocean")).toEqual([]);
  });

  it("keeps pagination within valid boundaries, including empty results", () => {
    const items = Array.from(
      { length: ASSET_PICKER_PAGE_SIZE + 1 },
      (_, index) => index,
    );

    expect(getAssetPickerPageCount(0)).toBe(1);
    expect(getAssetPickerPageCount(items.length)).toBe(2);
    expect(clampAssetPickerPage(-2, items.length)).toBe(1);
    expect(clampAssetPickerPage(99, items.length)).toBe(2);
    expect(getAssetPickerPage(items, 2)).toEqual([ASSET_PICKER_PAGE_SIZE]);
    expect(getAssetPickerPage([], 4)).toEqual([]);
  });

  it("maps each asset kind to the existing canvas insertion payload", () => {
    expect(toInsertAssetPayload(assets[0])).toEqual({
      kind: "text",
      content: "content:text-1",
      title: "Ocean notes",
    });
    expect(toInsertAssetPayload(assets[1])).toEqual({
      kind: "image",
      dataUrl: "image:image-1",
      storageKey: undefined,
      title: "Ocean current",
    });
    expect(toInsertAssetPayload(assets[2])).toEqual({
      kind: "video",
      url: "video:video-1",
      storageKey: undefined,
      title: "Space flight",
      width: 1920,
      height: 1080,
    });
  });
});

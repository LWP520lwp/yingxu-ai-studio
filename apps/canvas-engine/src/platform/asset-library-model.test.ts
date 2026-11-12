import { describe, expect, it } from "vitest";

import {
  decodeAssetStorageValue,
  mapWithConcurrency,
  normalizeAssetCollection,
  reduceAssetCollection,
} from "@/lib/asset-library-model";
import type { TextAsset } from "@/stores/use-asset-store";

const textAsset = (
  id: string,
  overrides: Partial<TextAsset> = {},
): TextAsset => ({
  id,
  kind: "text",
  title: id,
  coverUrl: "",
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  data: { content: "content" },
  ...overrides,
});

describe("asset library model", () => {
  it("normalizes persisted records and filters malformed or duplicate entries", () => {
    const assets = normalizeAssetCollection(
      [
        textAsset("text"),
        {
          id: "image",
          kind: "image",
          title: "Image",
          data: { storageKey: "image:1", width: -1, height: 80 },
        },
        { id: "broken", kind: "image", data: {} },
        textAsset("text", { title: "duplicate" }),
      ],
      "2026-05-01T00:00:00.000Z",
    );

    expect(assets).toHaveLength(2);
    expect(assets[1]).toMatchObject({
      id: "image",
      kind: "image",
      coverUrl: "",
      tags: [],
      createdAt: "2026-05-01T00:00:00.000Z",
      data: { dataUrl: "", storageKey: "image:1", width: 0, height: 80 },
    });
  });

  it("decodes persisted envelopes so malformed data can fall back to legacy", () => {
    const legacy = JSON.stringify({
      state: { assets: [textAsset("legacy")] },
      version: 0,
    });
    expect(decodeAssetStorageValue(legacy)?.state.assets).toEqual([
      textAsset("legacy"),
    ]);
    expect(decodeAssetStorageValue("not-json")).toBeNull();
    expect(decodeAssetStorageValue(JSON.stringify({ state: null }))).toBeNull();
  });

  it("keeps collection order and stable identity on updates", () => {
    const first = textAsset("first");
    const second = textAsset("second");
    const inserted = textAsset("new");
    const next = reduceAssetCollection([first, second], {
      type: "insert",
      asset: inserted,
    });
    const updated = reduceAssetCollection(next, {
      type: "update",
      id: "first",
      patch: { title: "renamed" },
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(next.map(({ id }) => id)).toEqual(["new", "first", "second"]);
    expect(updated[1]).toMatchObject({
      id: "first",
      title: "renamed",
      createdAt: first.createdAt,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(
      reduceAssetCollection(updated, { type: "remove", id: "missing" }),
    ).toBe(updated);
    expect(
      reduceAssetCollection(updated, { type: "remove", id: "new" }),
    ).toEqual([updated[1], updated[2]]);
  });

  it("bounds parallel hydration while preserving original order", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([3, 1, 2, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 10;
    });

    expect(peak).toBe(2);
    expect(result).toEqual([30, 10, 20, 40]);
  });
});

import { describe, expect, it } from "vitest";

import {
  createAssetPickerQuery,
  deriveAssetPickerPage,
  transitionAssetPickerQuery,
} from "@/atlas-engine/ui/asset-picker-session";
import type { Asset } from "@/stores/use-asset-store";

const assets: Asset[] = [
  {
    id: "note-1",
    title: "Ocean notes",
    kind: "text",
    data: { content: "current study" },
    coverUrl: "",
    tags: ["science"],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "image-1",
    title: "Ocean current",
    kind: "image",
    data: {
      dataUrl: "data:image/png;base64,AA==",
      width: 2,
      height: 2,
      bytes: 8,
      mimeType: "image/png",
    },
    coverUrl: "",
    tags: [],
    createdAt: "",
    updatedAt: "",
  },
];

describe("asset picker query session", () => {
  it("keeps filter, search and page transitions in one query state", () => {
    let query = createAssetPickerQuery("all");
    query = transitionAssetPickerQuery(query, { type: "change-page", page: 4 });
    query = transitionAssetPickerQuery(query, {
      type: "search",
      text: "ocean",
    });
    expect(query).toEqual({ kind: "all", text: "ocean", page: 1 });

    query = transitionAssetPickerQuery(query, {
      type: "filter-kind",
      kind: "image",
    });
    expect(query).toEqual({ kind: "image", text: "ocean", page: 1 });
    expect(
      deriveAssetPickerPage(assets, query).items.map(({ id }) => id),
    ).toEqual(["image-1"]);
  });

  it("reconciles a stale page after the result set shrinks and restores the requested kind", () => {
    let query = createAssetPickerQuery("all");
    query = transitionAssetPickerQuery(query, { type: "change-page", page: 2 });
    query = transitionAssetPickerQuery(query, {
      type: "restore-kind",
      kind: "video",
    });
    expect(query).toEqual({ kind: "video", text: "", page: 1 });

    query = transitionAssetPickerQuery(query, {
      type: "filter-kind",
      kind: "all",
    });
    query = transitionAssetPickerQuery(query, { type: "change-page", page: 2 });
    query = transitionAssetPickerQuery(query, {
      type: "reconcile-results",
      resultCount: 0,
    });
    expect(query.page).toBe(1);
    expect(deriveAssetPickerPage([], query).items).toEqual([]);
  });
});

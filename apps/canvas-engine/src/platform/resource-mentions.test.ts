import { describe, expect, it } from "vitest";

import {
  activeResourceMentionLabels,
  createResourceMentionTextSplitter,
  deleteAdjacentResourceMention,
  findResourceMention,
  insertResourceMention,
  placeResourceMentionMenu,
  searchResourceMentions,
  splitResourceMentionText,
} from "@/lib/canvas/resource-mentions";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

const references: CanvasResourceReference[] = [
  {
    id: "photo-1",
    nodeId: "node-1",
    kind: "image",
    label: "@图像1",
    title: "月球表面",
    previewUrl: "data:image/png;base64,AA==",
    active: true,
  },
  {
    id: "text-1",
    nodeId: "node-2",
    kind: "text",
    label: "@图像1-说明",
    title: "参考说明",
    text: "月球基地草稿",
    active: true,
  },
  {
    id: "inactive",
    nodeId: "node-3",
    kind: "video",
    label: "@旧视频",
    title: "月球视频",
    active: false,
  },
];

describe("canvas resource mentions", () => {
  it("finds a mention only at the cursor and after a valid boundary", () => {
    expect(findResourceMention("Scene @月球基地", 14)).toEqual({
      start: 6,
      query: "月球基地",
    });
    expect(findResourceMention("email@moon", 10)).toBeNull();
    expect(findResourceMention("@one @two", 5)).toBeNull();
    expect(findResourceMention("@月球 extra", 3)).toEqual({
      start: 0,
      query: "月球",
    });
  });

  it("searches active references across labels, titles, kinds, and text", () => {
    expect(activeResourceMentionLabels(references)).toEqual([
      "@图像1-说明",
      "@图像1",
    ]);
    expect(
      searchResourceMentions(references, "基地").map(({ id }) => id),
    ).toEqual(["text-1"]);
    expect(searchResourceMentions(references, "VIDEO")).toEqual([]);
    expect(searchResourceMentions(references, " ")).toHaveLength(2);
  });

  it("inserts a reference in place of the current mention and returns the caret", () => {
    expect(
      insertResourceMention(
        "A @moon tail",
        { start: 2, query: "moon" },
        7,
        "@图像1",
      ),
    ).toEqual({ value: "A @图像1 tail", caret: 7 });
  });

  it("highlights longer and regex-special labels before shorter labels", () => {
    expect(splitResourceMentionText("@a+b then @a", ["@a", "@a+b"])).toEqual([
      { text: "", highlighted: false },
      { text: "@a+b", highlighted: true },
      { text: " then ", highlighted: false },
      { text: "@a", highlighted: true },
      { text: "", highlighted: false },
    ]);
  });

  it("reuses the compiled highlighter across consecutive input updates", () => {
    const splitText = createResourceMentionTextSplitter(["@a", "@a+b"]);

    expect(splitText("@a+b then @a").filter((part) => part.highlighted)).toEqual([
      { text: "@a+b", highlighted: true },
      { text: "@a", highlighted: true },
    ]);
    expect(splitText("@a @a+b").filter((part) => part.highlighted)).toEqual([
      { text: "@a", highlighted: true },
      { text: "@a+b", highlighted: true },
    ]);
  });

  it("deletes whole adjacent labels without matching a label inside prose", () => {
    expect(
      deleteAdjacentResourceMention(
        "prompt @图像1-说明 ",
        17,
        "backward",
        activeResourceMentionLabels(references),
      ),
    ).toEqual({ value: "prompt ", caret: 7 });
    expect(
      deleteAdjacentResourceMention("prefix@图像1suffix", 10, "backward", [
        "@图像1",
      ]),
    ).toBeNull();
    expect(
      deleteAdjacentResourceMention("before @图像1 after", 7, "forward", [
        "@图像1",
      ]),
    ).toEqual({ value: "before  after", caret: 7 });
  });

  it("preserves label boundaries and handles whitespace around a mention", () => {
    expect(
      deleteAdjacentResourceMention("scene @a+b  ", 12, "backward", [
        "@a",
        "@a+b",
      ]),
    ).toEqual({ value: "scene ", caret: 6 });
    expect(
      deleteAdjacentResourceMention("text @tag-extra", 5, "forward", [
        "@tag",
      ]),
    ).toBeNull();
    expect(
      deleteAdjacentResourceMention("text@tag", 8, "backward", ["@tag"]),
    ).toBeNull();
  });

  it("fits the menu to the available bounds and opens above when needed", () => {
    expect(
      placeResourceMentionMenu(
        { left: 490, top: 175, lineHeight: 20 },
        { left: 0, top: 0, right: 500, bottom: 200 },
      ),
    ).toEqual({ left: 236, top: 8, width: 256, maxHeight: 161 });
    expect(
      placeResourceMentionMenu(
        { left: 10, top: 12, lineHeight: 18 },
        { left: 0, top: 0, right: 160, bottom: 120 },
      ),
    ).toEqual({ left: 8, top: 36, width: 144, maxHeight: 76 });
  });
});

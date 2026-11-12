import { describe, expect, it } from "vitest";

import {
  filterComposerInputs,
  mentionQueryBeforeCaret,
  moveComposerSelection,
  parseComposerTokens,
  reduceComposerMention,
} from "@/lib/canvas/canvas-config-composer";

const inputs = [
  { nodeId: "txt-1", type: "text", title: "开场旁白", text: "鲸鱼迁徙与海洋" },
  { nodeId: "img-1", type: "image", title: "海岸照片" },
  {
    nodeId: "group-1",
    type: "group",
    title: "海洋素材",
    children: [{ title: "鲸鱼", text: "鲸鱼" }],
  },
];

describe("config composer token model", () => {
  it("parses adjacent references while preserving surrounding Unicode text", () => {
    expect(parseComposerTokens("前缀 @[node:a]@[node:b] 后缀")).toEqual([
      { type: "text", value: "前缀 " },
      { type: "reference", nodeId: "a" },
      { type: "reference", nodeId: "b" },
      { type: "text", value: " 后缀" },
    ]);
  });

  it("leaves malformed and empty-looking tokens as literal text", () => {
    expect(parseComposerTokens("@[node:] @[node:a")).toEqual([
      { type: "text", value: "@[node:] @[node:a" },
    ]);
  });

  it("does not share regex state between parse calls", () => {
    expect(parseComposerTokens("@[node:a]")).toEqual([
      { type: "reference", nodeId: "a" },
    ]);
    expect(parseComposerTokens("@[node:b]")).toEqual([
      { type: "reference", nodeId: "b" },
    ]);
  });

  it("reads only a trailing mention query and wraps keyboard selection", () => {
    expect(mentionQueryBeforeCaret("正文 @[node:a] @海")).toBe("海");
    expect(mentionQueryBeforeCaret("正文 @含 空格")).toBeNull();
    expect(moveComposerSelection(0, 3, -1)).toBe(2);
    expect(moveComposerSelection(2, 3, 1)).toBe(0);
    expect(moveComposerSelection(0, 0, 1)).toBe(0);
  });

  it("resets the active option for a new query and keeps navigation cyclic", () => {
    const opened = reduceComposerMention(null, { type: "open", query: "海" });
    expect(opened).toEqual({ query: "海", activeIndex: 0 });
    const moved = reduceComposerMention(opened, {
      type: "move",
      direction: -1,
      itemCount: 3,
    });
    expect(moved).toEqual({ query: "海", activeIndex: 2 });
    expect(
      reduceComposerMention(moved, { type: "open", query: "旁白" }),
    ).toEqual({ query: "旁白", activeIndex: 0 });
    expect(reduceComposerMention(moved, { type: "close" })).toBeNull();
  });

  it("filters by localized aliases and content but not hidden group child content", () => {
    const result = filterComposerInputs(inputs, "鲸鱼", (input) =>
      input.nodeId === "img-1"
        ? "图片 1"
        : input.nodeId === "group-1"
          ? "分组 1"
          : "文本 1",
    );
    expect(result.map((input) => input.nodeId)).toEqual(["txt-1"]);
    expect(
      filterComposerInputs(inputs, "分组 1", (input) =>
        input.nodeId === "group-1" ? "分组 1" : "其他",
      ).map((input) => input.nodeId),
    ).toEqual(["group-1"]);
  });
});

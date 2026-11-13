import { describe, expect, it } from "vitest";

import {
  beginAtlasTitleEdit,
  commitAtlasTitleEdit,
  resolveAtlasNodeActivation,
  resolveAtlasNodePointerIntent,
  resolveAtlasTitleKey,
  updateAtlasTitleEdit,
} from "@/atlas-engine/interaction/node-editing";

describe("canvas node interaction policy", () => {
  it("keeps normal pointer routing and only accepts primary presses for available references", () => {
    expect(resolveAtlasNodePointerIntent(0)).toBe("drag");
    expect(resolveAtlasNodePointerIntent(2)).toBe("drag");
    expect(resolveAtlasNodePointerIntent(0, "available")).toBe("reference");
    expect(resolveAtlasNodePointerIntent(1, "available")).toBe("ignore");
    expect(resolveAtlasNodePointerIntent(2, "available")).toBe("ignore");
    expect(resolveAtlasNodePointerIntent(0, "target")).toBe("ignore");
    expect(resolveAtlasNodePointerIntent(0, "disabled")).toBe("ignore");
  });

  it("gives reference selection priority over plugins and built-in node opening", () => {
    expect(
      resolveAtlasNodeActivation({
        referenceMode: "available",
        pluginAvailable: true,
        kind: "image",
        imageReady: true,
      }),
    ).toBe("block");
  });

  it("retains plugin first refusal and only previews populated built-in images", () => {
    const base = {
      kind: "image",
      imageReady: true,
      pluginAvailable: false,
    };
    expect(resolveAtlasNodeActivation({ ...base, pluginAvailable: true })).toBe(
      "plugin",
    );
    expect(resolveAtlasNodeActivation(base)).toBe("image");
    expect(resolveAtlasNodeActivation({ ...base, imageReady: false })).toBe(
      "none",
    );
    expect(resolveAtlasNodeActivation({ ...base, kind: "text" })).toBe(
      "text",
    );
    expect(resolveAtlasNodeActivation({ ...base, kind: "video" })).toBe(
      "none",
    );
    expect(resolveAtlasNodeActivation({ ...base, kind: "custom:editor" })).toBe(
      "none",
    );
  });

  it("leaves IME Enter and Escape inside the title input", () => {
    expect(resolveAtlasTitleKey("Enter", true)).toBe("none");
    expect(resolveAtlasTitleKey("Escape", true)).toBe("none");
    expect(resolveAtlasTitleKey("Enter", false, 229)).toBe("none");
    expect(resolveAtlasTitleKey("Enter")).toBe("commit");
    expect(resolveAtlasTitleKey("Escape")).toBe("cancel");
    expect(resolveAtlasTitleKey("Tab")).toBe("none");
  });
});

describe("canvas node title edit state", () => {
  const edit = (draft: string) =>
    updateAtlasTitleEdit(
      updateAtlasTitleEdit(beginAtlasTitleEdit("node", "原名称"), {
        type: "start",
      }),
      { type: "change", value: draft },
    );

  it("emits a trimmed title once across Enter, outside-pointer and blur completion", () => {
    const original = edit("  新名称  ");
    const committed = commitAtlasTitleEdit(original, "未命名");
    expect(committed.change).toEqual({ nodeId: "node", title: "新名称" });
    expect(committed.state).toMatchObject({ editing: false, draft: "新名称" });
    expect(
      commitAtlasTitleEdit(committed.state, "未命名").change,
    ).toBeNull();
    expect(original).toMatchObject({ editing: true, draft: "  新名称  " });
  });

  it("cancels before blur without accidentally committing the abandoned draft", () => {
    const cancelled = updateAtlasTitleEdit(edit("不要保存"), {
      type: "cancel",
    });
    expect(cancelled).toMatchObject({ editing: false, draft: "原名称" });
    expect(commitAtlasTitleEdit(cancelled, "未命名").change).toBeNull();
  });

  it("retains fallback and length rules and skips unchanged title updates", () => {
    expect(commitAtlasTitleEdit(edit("  "), "未命名").change).toBeNull();
    const empty = updateAtlasTitleEdit(
      beginAtlasTitleEdit("empty", ""),
      { type: "start" },
    );
    expect(commitAtlasTitleEdit(empty, "未命名").change).toEqual({
      nodeId: "empty",
      title: "未命名",
    });
    expect(
      commitAtlasTitleEdit(edit("字".repeat(80)), "未命名").change?.title,
    ).toBe("字".repeat(64));
  });

  it("does not allow drafts from a previous node to commit against another node", () => {
    const changedNode = updateAtlasTitleEdit(edit("旧节点草稿"), {
      type: "sync",
      nodeId: "other",
      title: "另一个节点",
    });
    expect(changedNode).toEqual(beginAtlasTitleEdit("other", "另一个节点"));
    expect(commitAtlasTitleEdit(changedNode, "未命名").change).toBeNull();
  });

  it("refreshes an existing title when its source changes and ignores drafts outside editing", () => {
    const idle = beginAtlasTitleEdit("node", "原名称");
    expect(
      updateAtlasTitleEdit(idle, { type: "change", value: "误输入" }),
    ).toBe(idle);
    expect(
      updateAtlasTitleEdit(idle, {
        type: "sync",
        nodeId: "node",
        title: "原名称",
      }),
    ).toBe(idle);
    const updated = updateAtlasTitleEdit(edit("当前草稿"), {
      type: "sync",
      nodeId: "node",
      title: "同步名称",
    });
    expect(updated).toMatchObject({
      editing: true,
      sourceTitle: "同步名称",
      draft: "同步名称",
    });
    expect(commitAtlasTitleEdit(updated, "未命名").change).toBeNull();
  });
});

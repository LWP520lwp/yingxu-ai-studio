import { describe, expect, it } from "vitest";

import {
  canvasNodeOpenAction,
  canvasNodePressAction,
  canvasNodeTitleKeyAction,
  createCanvasNodeTitleEdit,
  reduceCanvasNodeTitleEdit,
  settleCanvasNodeTitleEdit,
} from "@/lib/canvas/canvas-node-interaction";
import { CanvasNodeType } from "@/types/canvas";

describe("canvas node interaction policy", () => {
  it("keeps normal pointer routing and only accepts primary presses for available references", () => {
    expect(canvasNodePressAction(0)).toBe("drag");
    expect(canvasNodePressAction(2)).toBe("drag");
    expect(canvasNodePressAction(0, "available")).toBe("reference");
    expect(canvasNodePressAction(1, "available")).toBe("ignore");
    expect(canvasNodePressAction(2, "available")).toBe("ignore");
    expect(canvasNodePressAction(0, "target")).toBe("ignore");
    expect(canvasNodePressAction(0, "disabled")).toBe("ignore");
  });

  it("gives reference selection priority over plugins and built-in node opening", () => {
    expect(
      canvasNodeOpenAction({
        referenceSelection: "available",
        hasPluginHandler: true,
        type: CanvasNodeType.Image,
        hasImageContent: true,
      }),
    ).toBe("block");
  });

  it("retains plugin first refusal and only previews populated built-in images", () => {
    const base = {
      type: CanvasNodeType.Image,
      hasImageContent: true,
      hasPluginHandler: false,
    };
    expect(canvasNodeOpenAction({ ...base, hasPluginHandler: true })).toBe(
      "plugin",
    );
    expect(canvasNodeOpenAction(base)).toBe("image");
    expect(canvasNodeOpenAction({ ...base, hasImageContent: false })).toBe(
      "none",
    );
    expect(canvasNodeOpenAction({ ...base, type: CanvasNodeType.Text })).toBe(
      "text",
    );
    expect(canvasNodeOpenAction({ ...base, type: CanvasNodeType.Video })).toBe(
      "none",
    );
    expect(canvasNodeOpenAction({ ...base, type: "custom:editor" })).toBe(
      "none",
    );
  });

  it("leaves IME Enter and Escape inside the title input", () => {
    expect(canvasNodeTitleKeyAction("Enter", true)).toBe("none");
    expect(canvasNodeTitleKeyAction("Escape", true)).toBe("none");
    expect(canvasNodeTitleKeyAction("Enter", false, 229)).toBe("none");
    expect(canvasNodeTitleKeyAction("Enter")).toBe("commit");
    expect(canvasNodeTitleKeyAction("Escape")).toBe("cancel");
    expect(canvasNodeTitleKeyAction("Tab")).toBe("none");
  });
});

describe("canvas node title edit state", () => {
  const edit = (draft: string) =>
    reduceCanvasNodeTitleEdit(
      reduceCanvasNodeTitleEdit(createCanvasNodeTitleEdit("node", "原名称"), {
        type: "start",
      }),
      { type: "change", value: draft },
    );

  it("emits a trimmed title once across Enter, outside-pointer and blur completion", () => {
    const original = edit("  新名称  ");
    const committed = settleCanvasNodeTitleEdit(original, "未命名");
    expect(committed.change).toEqual({ nodeId: "node", title: "新名称" });
    expect(committed.state).toMatchObject({ editing: false, draft: "新名称" });
    expect(
      settleCanvasNodeTitleEdit(committed.state, "未命名").change,
    ).toBeNull();
    expect(original).toMatchObject({ editing: true, draft: "  新名称  " });
  });

  it("cancels before blur without accidentally committing the abandoned draft", () => {
    const cancelled = reduceCanvasNodeTitleEdit(edit("不要保存"), {
      type: "cancel",
    });
    expect(cancelled).toMatchObject({ editing: false, draft: "原名称" });
    expect(settleCanvasNodeTitleEdit(cancelled, "未命名").change).toBeNull();
  });

  it("retains fallback and length rules and skips unchanged title updates", () => {
    expect(settleCanvasNodeTitleEdit(edit("  "), "未命名").change).toBeNull();
    const empty = reduceCanvasNodeTitleEdit(
      createCanvasNodeTitleEdit("empty", ""),
      { type: "start" },
    );
    expect(settleCanvasNodeTitleEdit(empty, "未命名").change).toEqual({
      nodeId: "empty",
      title: "未命名",
    });
    expect(
      settleCanvasNodeTitleEdit(edit("字".repeat(80)), "未命名").change?.title,
    ).toBe("字".repeat(64));
  });

  it("does not allow drafts from a previous node to commit against another node", () => {
    const changedNode = reduceCanvasNodeTitleEdit(edit("旧节点草稿"), {
      type: "sync",
      nodeId: "other",
      title: "另一个节点",
    });
    expect(changedNode).toEqual(
      createCanvasNodeTitleEdit("other", "另一个节点"),
    );
    expect(settleCanvasNodeTitleEdit(changedNode, "未命名").change).toBeNull();
  });

  it("refreshes an existing title when its source changes and ignores drafts outside editing", () => {
    const idle = createCanvasNodeTitleEdit("node", "原名称");
    expect(
      reduceCanvasNodeTitleEdit(idle, { type: "change", value: "误输入" }),
    ).toBe(idle);
    expect(
      reduceCanvasNodeTitleEdit(idle, {
        type: "sync",
        nodeId: "node",
        title: "原名称",
      }),
    ).toBe(idle);
    const updated = reduceCanvasNodeTitleEdit(edit("当前草稿"), {
      type: "sync",
      nodeId: "node",
      title: "同步名称",
    });
    expect(updated).toMatchObject({
      editing: true,
      sourceTitle: "同步名称",
      draft: "同步名称",
    });
    expect(settleCanvasNodeTitleEdit(updated, "未命名").change).toBeNull();
  });
});

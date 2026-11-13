import { describe, expect, it } from "vitest";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import {
  StudioSession,
  type StudioDocument,
} from "@/atlas-engine/studio/studio-document";
import {
  filterNodeDrafts,
  projectNodeDrafts,
} from "@/atlas-engine/studio/studio-node-drafts";

function node(
  id: string,
  type: string,
  metadata?: CanvasNodeMetadata,
): CanvasNodeData {
  return {
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 220,
    metadata,
  };
}

describe("node drafts document projection", () => {
  it("keeps canvases isolated through persistence, edits and undo", () => {
    const document = (nodes: CanvasNodeData[]): StudioDocument => ({
      nodes,
      connections: [],
      viewport: { x: 0, y: 0, k: 1 },
      backgroundMode: "lines",
      showImageInfo: false,
    });
    const first = new StudioSession(
      document([node("shared-id", "text", { content: "海洋" })]),
    );
    const second = new StudioSession(
      document([node("shared-id", "text", { content: "太空" })]),
    );
    first.insert([node("unfinished", "config")]);
    const restored = new StudioSession(
      JSON.parse(JSON.stringify(first.read())),
    );
    restored.patch("shared-id", { title: "新标题" });
    expect(
      projectNodeDrafts(restored.read().nodes).map((item) => item.title),
    ).toEqual(["新标题", "unfinished"]);
    restored.undo();
    expect(
      projectNodeDrafts(restored.read().nodes).map((item) => item.id),
    ).toEqual(["shared-id", "unfinished"]);
    expect(projectNodeDrafts(second.read().nodes)).toHaveLength(1);
    expect(projectNodeDrafts(second.read().nodes)[0].summary).toBe("太空");
    expect(projectNodeDrafts(first.read().nodes)[0].summary).toBe("海洋");
  });
  it("keeps empty nodes, generation configs, groups and unknown extensions in document order", () => {
    const nodes = [
      node("empty", "image"),
      node("settings", "config"),
      node("chapter", "group"),
      node("custom", "plugin:depth-map"),
      node("script", "text", { groupId: "chapter", content: "分镜原文" }),
    ];
    const before = JSON.stringify(nodes);
    const items = projectNodeDrafts(nodes);
    expect(items.map((item) => item.id)).toEqual(nodes.map((item) => item.id));
    expect(items.map((item) => item.kind)).toEqual([
      "image",
      "config",
      "group",
      "extension",
      "text",
    ]);
    expect(items[0].summary).toBe("");
    expect(items[2].childCount).toBe(1);
    expect(items[3].type).toBe("plugin:depth-map");
    expect(items[4].summary).toBe("分镜原文");
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it("reflects delete, undo and edits from the current document without keeping a second collection", () => {
    const original = [node("first", "text"), node("second", "video")];
    const deleted = original.filter((item) => item.id !== "first");
    expect(projectNodeDrafts(deleted).map((item) => item.id)).toEqual([
      "second",
    ]);
    expect(projectNodeDrafts(original).map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
    const edited = original.map((item) =>
      item.id === "second"
        ? { ...item, title: "海浪", metadata: { prompt: "岸边潮汐" } }
        : item,
    );
    expect(projectNodeDrafts(edited)[1]).toMatchObject({
      title: "海浪",
      summary: "岸边潮汐",
    });
  });

  it("shows generation status for unfinished batches and respects explicit failures", () => {
    const items = projectNodeDrafts([
      node("batch", "text", {
        status: "idle",
        texts: [
          { id: "done", content: "第一版", status: "success" },
          { id: "pending", content: "", status: "loading" },
        ],
      }),
      node("failed", "image", { status: "error", prompt: "修复后的提示词" }),
      node("ready", "video", { status: "success" }),
      node("empty", "config"),
    ]);
    expect(items.map((item) => item.status)).toEqual([
      "loading",
      "error",
      "success",
      "idle",
    ]);
    expect(
      filterNodeDrafts(items, { status: "error" }).map((item) => item.id),
    ).toEqual(["failed"]);
  });

  it("searches across title, content and model with combined type and status filters", () => {
    const items = projectNodeDrafts([
      {
        ...node("science", "text", {
          content: " 月球  潮汐\n引力",
          model: "Muse-Large",
          status: "success",
        }),
        title: "科普脚本",
      },
      node("video", "video", {
        prompt: "潮汐 引力",
        model: "muse-large",
        status: "success",
      }),
      node("draft", "text", { content: "潮汐", status: "idle" }),
    ]);
    const before = JSON.stringify(items);
    expect(
      filterNodeDrafts(items, {
        query: "  科普  MUSE 月球 ",
        kind: "text",
        status: "success",
      }).map((item) => item.id),
    ).toEqual(["science"]);
    expect(filterNodeDrafts(items, { query: "不存在" })).toEqual([]);
    expect(filterNodeDrafts(items, {}).length).toBe(3);
    expect(JSON.stringify(items)).toBe(before);
  });

  it("never puts media payloads into the summary or search index", () => {
    const items = projectNodeDrafts([
      node("photo", "image", {
        content: `data:image/png;base64,${"A".repeat(50_000)}`,
        prompt: "真实海浪",
      }),
      node("movie", "video", { content: "/uploads/secret-video.mp4" }),
      node("sound", "audio", {
        content: "https://cdn.example.test/private.wav",
      }),
      node("text-url", "text", { content: "data:text/plain;base64,YWJj" }),
    ]);
    expect(items.map((item) => item.summary)).toEqual(["真实海浪", "", "", ""]);
    expect(
      items.some((item) => /base64|private|secret-video/.test(item.searchText)),
    ).toBe(false);
  });

  it("searches beyond the visible excerpt while keeping displayed summaries compact", () => {
    const items = projectNodeDrafts([
      node("long", "text", { content: `${"风".repeat(300)} 海洋酸化` }),
    ]);
    expect(items[0].summary.length).toBe(160);
    expect(filterNodeDrafts(items, { query: "海洋酸化" })).toHaveLength(1);
  });
});

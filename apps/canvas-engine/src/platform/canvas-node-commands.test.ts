import { describe, expect, it } from "vitest";
import { applyCanvasNodeCommand } from "@/lib/canvas/canvas-node-commands";
import {
  CanvasNodeType,
  type CanvasNodeData,
  type CanvasNodeImage,
} from "@/types/canvas";

const image = (id: string, content = id): CanvasNodeImage => ({
  id,
  content,
  status: "success",
  naturalWidth: 1600,
  naturalHeight: 900,
  bytes: 123,
  mimeType: "image/png",
  storageKey: id,
});
const node = (): CanvasNodeData => ({
  id: "a",
  type: CanvasNodeType.Image,
  title: "source",
  position: { x: 10, y: 20 },
  width: 400,
  height: 300,
});

describe("canvas document node commands", () => {
  it("keeps no-op identity and unaffected nodes while synchronizing edited primary text", () => {
    const text = {
      ...node(),
      type: CanvasNodeType.Text,
      metadata: {
        content: "old",
        primaryTextId: "t1",
        texts: [
          { id: "t1", content: "old", status: "success" as const },
          { id: "t2", content: "other", status: "success" as const },
        ],
      },
    };
    const other = node();
    other.id = "other";
    const before = [text, other];
    const after = applyCanvasNodeCommand(before, {
      kind: "content",
      nodeId: "a",
      value: "new",
    });
    expect(after[0].metadata?.texts?.map((item) => item.content)).toEqual([
      "new",
      "other",
    ]);
    expect(before[0].metadata?.content).toBe("old");
    expect(after[1]).toBe(other);
    expect(
      applyCanvasNodeCommand(after, {
        kind: "content",
        nodeId: "a",
        value: "new",
      }),
    ).toBe(after);
    expect(
      applyCanvasNodeCommand(before, {
        kind: "title",
        nodeId: "gone",
        value: "x",
      }),
    ).toBe(before);
  });

  it("rejects invalid geometry and preserves image center when locking the natural aspect ratio", () => {
    const source = {
      ...node(),
      metadata: { freeResize: true, naturalWidth: 1600, naturalHeight: 900 },
    };
    const before = [source];
    expect(
      applyCanvasNodeCommand(before, {
        kind: "resize",
        nodeId: "a",
        width: Infinity,
        height: 30,
      }),
    ).toBe(before);
    expect(
      applyCanvasNodeCommand(before, {
        kind: "resize",
        nodeId: "a",
        width: 10,
        height: 30,
        position: { x: NaN, y: 0 },
      }),
    ).toBe(before);
    const after = applyCanvasNodeCommand(before, {
      kind: "toggle-free-resize",
      nodeId: "a",
    })[0];
    expect(after.height).toBe(225);
    expect(after.position.y + after.height / 2).toBe(
      source.position.y + source.height / 2,
    );
    expect(after.metadata?.freeResize).toBe(false);
  });

  it("moves the preview to a surviving variant after removing the primary image", () => {
    const source = {
      ...node(),
      metadata: {
        content: "removed",
        primaryImageId: "one",
        images: [image("one", "removed"), image("two", "kept")],
      },
    };
    const after = applyCanvasNodeCommand([source], {
      kind: "remove-variant",
      nodeId: "a",
      variantId: "one",
    })[0];
    expect(after.metadata).toMatchObject({
      content: "kept",
      primaryImageId: "two",
      count: 1,
      storageKey: "two",
    });
    expect(after.position.x + after.width / 2).toBe(
      source.position.x + source.width / 2,
    );
    expect(source.metadata.images).toHaveLength(2);
  });

  it("clears stale preview and storage references when the last usable variant is deleted", () => {
    const source = {
      ...node(),
      metadata: {
        ...image("one"),
        primaryImageId: "one",
        images: [image("one")],
      },
    };
    const result = applyCanvasNodeCommand([source], {
      kind: "remove-variant",
      nodeId: "a",
      variantId: "one",
    });
    expect(result[0].metadata).toMatchObject({
      images: [],
      count: 0,
      status: "idle",
    });
    expect(result[0].metadata?.content).toBeUndefined();
    expect(result[0].metadata?.storageKey).toBeUndefined();
    expect(result[0].metadata?.primaryImageId).toBeUndefined();
  });

  it("preserves free sizing and keeps primary text consistent when removing text variants", () => {
    const source = {
      ...node(),
      metadata: { freeResize: true, images: [image("one")] },
    };
    expect(
      applyCanvasNodeCommand([source], {
        kind: "select-variant",
        nodeId: "a",
        variantId: "one",
      })[0],
    ).toMatchObject({ width: 400, height: 300, position: source.position });
    const text = {
      ...node(),
      type: CanvasNodeType.Text,
      metadata: {
        content: "old",
        primaryTextId: "t1",
        texts: [
          { id: "t1", content: "old", status: "success" as const },
          { id: "t2", content: "new", status: "success" as const },
        ],
      },
    };
    expect(
      applyCanvasNodeCommand([text], {
        kind: "remove-variant",
        nodeId: "a",
        variantId: "t1",
      })[0].metadata,
    ).toMatchObject({ content: "new", primaryTextId: "t2", textCount: 1 });
  });
});

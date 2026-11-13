import { describe, expect, it, vi } from "vitest";

import {
  createEmptyAtlasDocument,
  applyAtlasCommands,
} from "@/atlas-engine/reducer";
import {
  atlasMediaCommitCommands,
  atlasMediaOutputPosition,
  buildAtlasAssetDraft,
  createAtlasAssistantImageNode,
  createAtlasAssetNode,
  createAtlasMediaTransactions,
  importAtlasMediaBatch,
  readAtlasClipboard,
} from "@/atlas-engine/workflows/media-transaction";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const uploaded = (key = "image:one"): UploadedImage => ({
  url: `blob:${key}`,
  storageKey: key,
  width: 1200,
  height: 800,
  bytes: 256,
  mimeType: "image/png",
});
const imageFile = (name: string) =>
  new File(["pixels"], name, { type: "image/png" });
const center = { x: 300, y: 200 };
const imageNode = (id: string, position = { x: 0, y: 0 }): CanvasNodeData => ({
  id,
  type: CanvasNodeType.Image,
  title: id,
  position,
  width: 100,
  height: 100,
  metadata: {
    content: "data:image/png;base64,YQ==",
    mimeType: "image/png",
    status: "success",
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

describe("Atlas media import transactions", () => {
  it("limits decoding to three concurrent uploads while retaining the user's file order", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<UploadedImage>());
    const uploadImage = vi.fn(
      (file: string | Blob) =>
        gates[Number((file as File).name.split(".")[0])]!.promise,
    );
    const importing = importAtlasMediaBatch(
      Array.from({ length: 5 }, (_, index) => ({
        file: imageFile(`${index}.png`),
        kind: "image" as const,
        position: center,
      })),
      { uploadImage, uploadMediaFile: vi.fn() },
    );
    expect(uploadImage).toHaveBeenCalledTimes(3);
    gates[2]!.resolve(uploaded("image:2"));
    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(4));
    gates[3]!.resolve(uploaded("image:3"));
    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(5));
    gates[4]!.resolve(uploaded("image:4"));
    gates[1]!.resolve(uploaded("image:1"));
    gates[0]!.resolve(uploaded("image:0"));
    expect((await importing).map(({ node }) => node.title)).toEqual([
      "0.png",
      "1.png",
      "2.png",
      "3.png",
      "4.png",
    ]);
  });

  it("rolls back earlier uploads if a later file fails and exposes no partial batch", async () => {
    const rollback = vi.fn(async () => undefined);
    const uploadImage = vi
      .fn()
      .mockResolvedValueOnce(uploaded())
      .mockRejectedValueOnce(new Error("broken image"));
    const commit = vi.fn();
    await expect(
      importAtlasMediaBatch(
        [
          { file: imageFile("one.png"), kind: "image", position: center },
          { file: imageFile("two.png"), kind: "image", position: center },
        ],
        { uploadImage, uploadMediaFile: vi.fn() },
        { rollback },
      ).then(commit),
    ).rejects.toThrow("broken image");
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledExactlyOnceWith(uploaded());
  });

  it("cancels a prepared import after a project switch and releases its owned data", async () => {
    const gate = deferred<UploadedImage>();
    const rollback = vi.fn(async () => undefined);
    const commit = vi.fn();
    const transfers = createAtlasMediaTransactions(rollback);
    let current = true;
    const outcome = transfers.run({
      isCurrent: () => current,
      prepare: async (context) => {
        const media = await gate.promise;
        context.retain(media);
        return media;
      },
      commit,
    });
    current = false;
    gate.resolve(uploaded());
    expect(await outcome).toEqual({ status: "cancelled" });
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledExactlyOnceWith(uploaded());
  });

  it("lets a newer replacement supersede an older request without cancelling independent imports", async () => {
    const first = deferred<UploadedImage>();
    const rollback = vi.fn(async () => undefined);
    const commit = vi.fn();
    const transfers = createAtlasMediaTransactions(rollback);
    const older = transfers.run({
      channel: "replace:source",
      isCurrent: () => true,
      prepare: async (context) => {
        const media = await first.promise;
        context.retain(media);
        return media;
      },
      commit,
    });
    const newer = await transfers.run({
      channel: "replace:source",
      isCurrent: () => true,
      prepare: async (context) => {
        const media = uploaded("image:new");
        context.retain(media);
        return media;
      },
      commit,
    });
    const independent = await transfers.run({
      isCurrent: () => true,
      prepare: async () => "other",
      commit,
    });
    first.resolve(uploaded("image:old"));
    expect(await older).toEqual({ status: "cancelled" });
    expect(newer.status).toBe("committed");
    expect(independent.status).toBe("committed");
    expect(commit.mock.calls.map(([value]) => value)).toEqual([
      uploaded("image:new"),
      "other",
    ]);
    expect(rollback).toHaveBeenCalledExactlyOnceWith(uploaded("image:old"));
  });

  it("normalizes failures and rolls back resources when the document commit rejects", async () => {
    const rollback = vi.fn(async () => undefined);
    const transfers = createAtlasMediaTransactions(rollback);
    const outcome = await transfers.run({
      isCurrent: () => true,
      prepare: async (context) => {
        const media = uploaded();
        context.retain(media);
        return media;
      },
      commit: () => {
        throw new Error("target disappeared");
      },
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed")
      expect(outcome.error.message).toBe("target disappeared");
    expect(rollback).toHaveBeenCalledExactlyOnceWith(uploaded());
  });

  it("commits linked imported nodes and selection atomically, rejecting an invalid batch as a whole", () => {
    const source = imageNode("source");
    const child = imageNode("child", { x: 200, y: 0 });
    const next = applyAtlasCommands(
      createEmptyAtlasDocument(),
      atlasMediaCommitCommands(
        [source, child],
        [{ id: "link", fromNodeId: source.id, toNodeId: child.id }],
      ),
    );
    expect(next.nodes.map((node) => node.id)).toEqual(["source", "child"]);
    expect(next.edges).toEqual([
      { id: "link", source: "source", target: "child" },
    ]);
    expect(next.selection).toEqual({ nodeIds: ["source", "child"] });
    const before = createEmptyAtlasDocument();
    const invalid = { ...child, width: -1 };
    expect(
      applyAtlasCommands(before, atlasMediaCommitCommands([source, invalid])),
    ).toBe(before);
  });
});

describe("Atlas clipboard and asset boundaries", () => {
  it("prefers clipboard images and falls back to text when structured clipboard reads are denied", async () => {
    const blob = new Blob(["pixels"], { type: "image/png" });
    const readText = vi.fn(async () => "fallback");
    expect(
      await readAtlasClipboard({
        read: async () => [
          { types: ["text/plain", "image/png"], getType: async () => blob },
        ],
        readText,
      }),
    ).toEqual({ kind: "image", blob, mimeType: "image/png" });
    expect(readText).not.toHaveBeenCalled();
    expect(
      await readAtlasClipboard({
        read: async () => {
          throw new Error("denied");
        },
        readText,
      }),
    ).toEqual({ kind: "text", text: "fallback" });
  });

  it("resolves stored assistant images before decoding and never takes ownership of a reused asset", async () => {
    const uploadImage = vi.fn();
    const retain = vi.fn();
    const resolveImageUrl = vi.fn(async () => "blob:reused");
    const readImageMeta = vi.fn(async () => ({ width: 1200, height: 800 }));
    const node = await createAtlasAssistantImageNode(
      {
        id: "asset",
        dataUrl: "",
        storageKey: "image:reused",
        prompt: "Subject",
      },
      center,
      {
        uploadImage,
        resolveImageUrl,
        readImageMeta,
        ensureImagePreview: async () => undefined,
      },
      undefined,
      retain,
    );
    expect(resolveImageUrl).toHaveBeenCalledWith("image:reused", "");
    expect(readImageMeta).toHaveBeenCalledWith("blob:reused");
    expect(uploadImage).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
    expect(node.metadata).toMatchObject({
      content: "blob:reused",
      storageKey: "image:reused",
      naturalWidth: 1200,
      naturalHeight: 800,
    });
    expect(node.width).toBe(640);
  });

  it("stores original image dimensions without duplicating cached image data", () => {
    const node = imageNode("source");
    node.metadata = {
      ...node.metadata,
      storageKey: "image:saved",
      naturalWidth: 1920,
      naturalHeight: 1080,
      bytes: 400,
    };
    const asset = buildAtlasAssetDraft(node, {
      canvasText: "Text",
      canvasImage: "Image",
      canvasVideo: "Video",
    });
    expect(asset).toMatchObject({
      kind: "image",
      data: {
        dataUrl: "",
        storageKey: "image:saved",
        width: 1920,
        height: 1080,
        bytes: 400,
      },
    });
    expect(
      createAtlasAssetNode(
        { kind: "text", content: "   ", title: "blank" },
        center,
      ),
    ).toBeNull();
    expect(
      createAtlasAssetNode({ kind: "video", url: "", title: "blank" }, center),
    ).toBeNull();
  });

  it("places a frame below existing content without colliding with media on its output column", () => {
    const source = imageNode("source");
    const blocker = imageNode("blocker", { x: 196, y: 0 });
    expect(
      atlasMediaOutputPosition(source, [source, blocker], {
        width: 100,
        height: 100,
      }),
    ).toEqual({ x: 196, y: 124 });
  });
});

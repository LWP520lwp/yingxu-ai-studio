import { describe, expect, it } from "vitest";

import {
  applyMediaReplacement,
  planMediaImport,
} from "@/product-engine/media-import";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type TestFile = { name: string; type: string };

const isAudioFile = (file: TestFile) =>
  file.type.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(file.name);

function canvasNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    id: "target",
    type: CanvasNodeType.Text,
    title: "Old node",
    position: { x: 100, y: 80 },
    width: 240,
    height: 120,
    metadata: { content: "old", status: "error", errorDetails: "old error" },
    ...overrides,
  };
}

describe("media import planning", () => {
  it("filters unsupported files and classifies audio, video, and images", () => {
    const files: TestFile[] = [
      { name: "voice.wav", type: "application/octet-stream" },
      { name: "clip.mp4", type: "video/mp4" },
      { name: "cover.png", type: "image/png" },
      { name: "notes.txt", type: "text/plain" },
    ];

    const plan = planMediaImport(files, null, { x: 10, y: 20 }, isAudioFile);

    expect(plan.replacement).toBeNull();
    expect(plan.additions.map(({ file, kind }) => [file.name, kind])).toEqual([
      ["voice.wav", "audio"],
      ["clip.mp4", "video"],
      ["cover.png", "image"],
    ]);
  });

  it("places all files from the requested position or canvas center", () => {
    const files: TestFile[] = [
      { name: "one.png", type: "image/png" },
      { name: "two.png", type: "image/png" },
    ];

    const requested = planMediaImport(
      files,
      { position: { x: 5, y: 8 } },
      { x: 100, y: 200 },
      isAudioFile,
    );
    const centered = planMediaImport(files, null, { x: 100, y: 200 }, isAudioFile);

    expect(requested.additions.map(({ position }) => position)).toEqual([
      { x: 5, y: 8 },
      { x: 45, y: 48 },
    ]);
    expect(centered.additions.map(({ position }) => position)).toEqual([
      { x: 100, y: 200 },
      { x: 140, y: 240 },
    ]);
  });

  it("uses the first accepted file for replacement and offsets remaining files", () => {
    const files: TestFile[] = [
      { name: "ignore.txt", type: "text/plain" },
      { name: "replacement.mp4", type: "video/mp4" },
      { name: "nearby.png", type: "image/png" },
    ];

    const plan = planMediaImport(
      files,
      { nodeId: "target", position: { x: 30, y: 50 } },
      { x: 100, y: 200 },
      isAudioFile,
    );

    expect(plan.replacement).toMatchObject({
      file: files[1],
      kind: "video",
      nodeId: "target",
      position: { x: 30, y: 50 },
    });
    expect(plan.additions).toEqual([
      {
        file: files[2],
        kind: "image",
        position: { x: 70, y: 90 },
      },
    ]);
  });

  it("returns an empty plan when no supported file is selected", () => {
    const plan = planMediaImport(
      [{ name: "notes.txt", type: "text/plain" }],
      { nodeId: "target" },
      { x: 100, y: 200 },
      isAudioFile,
    );

    expect(plan).toEqual({ replacement: null, additions: [] });
  });

  it("replaces an audio node while keeping its visual center", () => {
    const original = canvasNode();
    const media = {
      url: "blob:audio",
      storageKey: "audio:1",
      bytes: 128,
      mimeType: "audio/mpeg",
    };

    const [updated] = applyMediaReplacement([original], original.id, {
      fileName: "voice.mp3",
      kind: "audio",
      media,
    });
    const size = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];

    expect(updated).toMatchObject({
      type: CanvasNodeType.Audio,
      title: "voice.mp3",
      width: size.width,
      height: size.height,
      position: {
        x: original.position.x + original.width / 2 - size.width / 2,
        y: original.position.y + original.height / 2 - size.height / 2,
      },
      metadata: {
        content: media.url,
        status: "success",
        errorDetails: undefined,
        storageKey: media.storageKey,
      },
    });
  });

  it("fits a replacement video and centers it within the old node", () => {
    const original = canvasNode({ width: 300, height: 180 });
    const media = {
      url: "blob:video",
      storageKey: "video:1",
      bytes: 256,
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
    };

    const [updated] = applyMediaReplacement(
      [original],
      original.id,
      { fileName: "clip.mp4", kind: "video", media },
      { width: 420, height: 420 },
    );

    expect(updated.type).toBe(CanvasNodeType.Video);
    expect(updated.title).toBe("clip.mp4");
    expect(updated.width).toBe(420);
    expect(updated.height).toBe(236.25);
    expect(updated.position).toEqual({ x: 40, y: 51.875 });
    expect(updated.metadata).toMatchObject({
      content: media.url,
      status: "success",
      errorDetails: undefined,
      storageKey: media.storageKey,
    });
  });

  it("clears image generation settings and leaves other nodes untouched", () => {
    const original = canvasNode({
      metadata: {
        content: "old",
        generationType: "generation",
        model: "old-model",
        size: "1:1",
        quality: "high",
        count: 4,
        references: ["ref"],
        primaryImageId: "image-1",
      },
    });
    const other = canvasNode({ id: "other" });
    const media = {
      url: "blob:image",
      storageKey: "image:1",
      bytes: 64,
      mimeType: "image/png",
      width: 1000,
      height: 500,
    };

    const updated = applyMediaReplacement([original, other], original.id, {
      fileName: "cover.png",
      kind: "image",
      media,
    });

    expect(updated[0]).toMatchObject({
      type: CanvasNodeType.Image,
      title: "cover.png",
      position: original.position,
      width: 640,
      height: 320,
      metadata: {
        content: media.url,
        status: "success",
        generationType: undefined,
        model: undefined,
        size: undefined,
        quality: undefined,
        count: undefined,
        references: undefined,
        primaryImageId: undefined,
        freeResize: false,
      },
    });
    expect(updated[1]).toBe(other);
  });
});

import { describe, expect, it } from "vitest";

import { planMediaImport } from "@/product-engine/media-import";

type TestFile = { name: string; type: string };

const isAudioFile = (file: TestFile) =>
  file.type.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(file.name);

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
});

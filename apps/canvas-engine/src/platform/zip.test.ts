import { describe, expect, it } from "vitest";

import { createZip, readZip } from "@/lib/zip";

describe("canvas ZIP archive", () => {
  it("round-trips text, binary and Unicode paths as Blobs", async () => {
    const original = new Uint8Array([0, 7, 127, 255]);
    const archive = await createZip([
      { name: "project/data.json", data: '{"version":1}' },
      { name: "媒体/片段.bin", data: original },
    ]);
    const restored = await readZip(archive);

    expect(await restored.get("project/data.json")?.text()).toBe(
      '{"version":1}',
    );
    expect(
      Array.from(
        new Uint8Array(await restored.get("媒体/片段.bin")!.arrayBuffer()),
      ),
    ).toEqual(Array.from(original));
    expect(archive.type).toBe("application/zip");
  });

  it("normalizes Windows separators and rejects duplicate or unsafe names", async () => {
    const archive = await createZip([{ name: "folder\\file.txt", data: "ok" }]);
    expect((await readZip(archive)).has("folder/file.txt")).toBe(true);

    await expect(
      createZip([
        { name: "same.txt", data: "a" },
        { name: "same.txt", data: "b" },
      ]),
    ).rejects.toThrow("重复文件名");
    await expect(
      createZip([{ name: "../escape.txt", data: "x" }]),
    ).rejects.toThrow("越过归档根目录");
    await expect(
      createZip([{ name: "C:\\escape.txt", data: "x" }]),
    ).rejects.toThrow("相对路径");
  });

  it("rejects malformed archive bytes", async () => {
    await expect(readZip(new Blob(["not an archive"]))).rejects.toThrow();
  });
});

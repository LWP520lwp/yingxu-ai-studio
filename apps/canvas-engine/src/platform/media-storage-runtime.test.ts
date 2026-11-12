import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectStoredKeys,
  ObjectUrlRegistry,
} from "@/services/media-storage-runtime";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("media storage runtime", () => {
  it("deduplicates concurrent reads and returns the same live object URL", async () => {
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one");
    const read = vi.fn(async () => new Blob(["image"]));
    const urls = new ObjectUrlRegistry();

    const [first, second] = await Promise.all([
      urls.resolve("image:one", read),
      urls.resolve("image:one", read),
    ]);

    expect(first).toBe("blob:one");
    expect(second).toBe("blob:one");
    expect(read).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it("does not publish a stale read after a newer blob replaces it", async () => {
    let finishRead!: (blob: Blob) => void;
    const read = () =>
      new Promise<Blob>((resolve) => {
        finishRead = resolve;
      });
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:replacement");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const urls = new ObjectUrlRegistry();

    const pending = urls.resolve("video:one", read);
    urls.put("video:one", new Blob(["new"]));
    finishRead(new Blob(["old"]));

    expect(await pending).toBe("blob:replacement");
    expect(urls.get("video:one")).toBe("blob:replacement");
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("collects matching keys through cycles without revisiting objects", () => {
    const node: Record<string, unknown> = { storageKey: "image:one" };
    node.next = { child: node, storageKey: "video:two" };
    const keys = collectStoredKeys(node, (key) => key.startsWith("image:"));

    expect([...keys]).toEqual(["image:one"]);
  });
});

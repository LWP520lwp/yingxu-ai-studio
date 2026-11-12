import { describe, expect, it, vi } from "vitest";
import { collectStorageGarbage } from "@/services/storage-garbage-collector";

const enumerable = (entries: Array<[string, unknown]>) => ({
  async iterate(visit: (value: unknown, key: string) => void) {
    for (const [key, value] of entries) visit(value, key);
  },
});

describe("storage garbage collection", () => {
  it("protects project and generation-history references and bounds deletions", async () => {
    let active = 0;
    let peak = 0;
    const removed: string[] = [];
    await collectStorageGarbage({
      retained: new Set(["project"]),
      references: [enumerable([["log", "history"]])],
      collect: (value, retained) => { retained.add(String(value)); },
      concurrency: 2,
      stores: [{
        storage: enumerable(["project", "history", "old1", "old2", "old3"].map((key) => [key, null])),
        remove: async (key) => {
          peak = Math.max(peak, ++active);
          await Promise.resolve();
          removed.push(key);
          active--;
        },
      }],
    });
    expect(removed.sort()).toEqual(["old1", "old2", "old3"]);
    expect(peak).toBe(2);
  });

  it("deletes nothing when any reference or candidate scan fails", async () => {
    const remove = vi.fn();
    await expect(collectStorageGarbage({
      retained: new Set(),
      stores: [
        { storage: enumerable([["orphan", null]]), remove },
        { storage: { iterate: async () => { throw new Error("disk unavailable"); } }, remove },
      ],
    })).rejects.toThrow("disk unavailable");
    expect(remove).not.toHaveBeenCalled();
  });
});

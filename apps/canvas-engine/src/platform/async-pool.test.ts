import { describe, expect, it } from "vitest";

import { mapConcurrent } from "@/lib/async-pool";

describe("bounded async mapping", () => {
  it("limits active work while returning values in source order", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapConcurrent([4, 3, 2, 1], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 10;
    });

    expect(result).toEqual([40, 30, 20, 10]);
    expect(maximum).toBe(2);
  });

  it("stops assigning new values after a worker fails", async () => {
    const started: number[] = [];

    await expect(
      mapConcurrent([0, 1, 2, 3], 1, async (value) => {
        started.push(value);
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");

    expect(started).toEqual([0]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { copyTextWithFallback } from "@/lib/clipboard";

describe("clipboard fallback", () => {
  it("uses the asynchronous browser clipboard before the legacy path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn().mockReturnValue(true);
    await expect(copyTextWithFallback("text", { writeText, fallback })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("text");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back when clipboard permission is unavailable or denied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const fallback = vi.fn().mockReturnValue(true);
    await expect(copyTextWithFallback("text", { writeText, fallback })).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledWith("text");
  });

  it("does not claim success for empty input or a failed fallback", async () => {
    const fallback = vi.fn().mockReturnValue(false);
    await expect(copyTextWithFallback("", { fallback })).resolves.toBe(false);
    await expect(copyTextWithFallback("text", { fallback })).resolves.toBe(false);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

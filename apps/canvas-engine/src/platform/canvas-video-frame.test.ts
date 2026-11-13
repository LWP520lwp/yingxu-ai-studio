import { describe, expect, it, vi } from "vitest";

import {
  resolveAtlasVideoFrameTime as resolveVideoFrameTime,
  ATLAS_VIDEO_FRAME_EVENT_TIMEOUT_MS as VIDEO_FRAME_EVENT_TIMEOUT_MS,
  waitForAtlasVideoEvent as waitForVideoEvent,
} from "@/atlas-engine/workflows/video-frame";

describe("video frame time resolution", () => {
  it("chooses the start, last decodable frame, and current frame", () => {
    expect(resolveVideoFrameTime(12, "first", 9)).toBe(0);
    expect(resolveVideoFrameTime(12, "last", 4)).toBeCloseTo(12 - 1 / 30);
    expect(resolveVideoFrameTime(12, "current", 4)).toBe(4);
  });

  it("clamps current and last positions to a seekable range", () => {
    expect(resolveVideoFrameTime(Infinity, "last", 0, 8)).toBeCloseTo(
      8 - 1 / 30,
    );
    expect(resolveVideoFrameTime(20, "current", 50, 8)).toBeCloseTo(8 - 1 / 30);
    expect(resolveVideoFrameTime(20, "current", -1, 8)).toBe(0);
  });

  it("supports very short videos without seeking before zero", () => {
    expect(resolveVideoFrameTime(0.01, "last", 1)).toBe(0.005);
    expect(resolveVideoFrameTime(0.01, "current", 1)).toBe(0.005);
  });

  it("rejects invalid last-frame duration and non-finite current time", () => {
    expect(() => resolveVideoFrameTime(Infinity, "last", 0)).toThrow(
      "视频时长",
    );
    expect(() => resolveVideoFrameTime(10, "current", NaN)).toThrow(
      "当前视频时间",
    );
  });
});

describe("video event waiting", () => {
  it("resolves on the requested event and removes both listeners", async () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const remove = vi.spyOn(target, "removeEventListener");
    const pending = waitForVideoEvent(target, "seeked", 100);
    target.dispatchEvent(new Event("seeked"));

    await expect(pending).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("rejects on media errors and detaches listeners", async () => {
    const target = new EventTarget();
    const remove = vi.spyOn(target, "removeEventListener");
    const pending = waitForVideoEvent(target, "loadedmetadata", 100);
    target.dispatchEvent(new Event("error"));

    await expect(pending).rejects.toThrow("读取视频失败");
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("rejects timed-out waits and clears listeners", async () => {
    const target = new EventTarget();
    const remove = vi.spyOn(target, "removeEventListener");

    await expect(waitForVideoEvent(target, "loadeddata", 1)).rejects.toThrow(
      "超时",
    );
    expect(remove).toHaveBeenCalledTimes(2);
    expect(VIDEO_FRAME_EVENT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("cancels a pending media wait and removes listeners immediately", async () => {
    const target = new EventTarget();
    const controller = new AbortController();
    const remove = vi.spyOn(target, "removeEventListener");
    const pending = waitForVideoEvent(target, "seeked", 100, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow("已取消");
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dataUrlToFile,
  formatBytes,
  formatDuration,
  getDataUrlByteSize,
  readFileAsDataUrl,
  readImageMeta,
} from "@/lib/image-utils";

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, value?: unknown) => JSON.stringify({ key, value }),
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("image IO utilities", () => {
  it("counts base64 padding, whitespace and UTF-8 data, excluding remote URLs", () => {
    expect(getDataUrlByteSize("data:image/png;base64,YQ==")).toBe(1);
    expect(getDataUrlByteSize("data:image/png;base64,Y W I=\n")).toBe(2);
    expect(getDataUrlByteSize("data:text/plain,%E4%B8%AD")).toBe(3);
    expect(getDataUrlByteSize("https://example.test/image?x=1,AAAA")).toBe(0);
    expect(getDataUrlByteSize("data:image/png;base64,%%%")).toBe(0);
    expect(getDataUrlByteSize("data:image/png;base64,A")).toBe(0);
  });
  it("converts data payloads to exact file bytes", async () => {
    const reference = {
      id: "r",
      name: "image.png",
      type: "image/png",
      dataUrl: "data:image/png;base64,YWI=",
    };
    const file = dataUrlToFile(reference);
    expect(await file.text()).toBe("ab");
    expect(file.type).toBe("image/png");
    expect(
      await dataUrlToFile({
        ...reference,
        dataUrl: "data:text/plain,%E4%B8%AD",
      }).text(),
    ).toBe("中");
    expect(() => dataUrlToFile({ ...reference, dataUrl: "/remote" })).toThrow();
    expect(() =>
      dataUrlToFile({ ...reference, dataUrl: "data:image/png;base64,%%%" }),
    ).toThrow();
  });
  it("releases load callbacks and timer on image completion, with a timed fallback", async () => {
    vi.useFakeTimers();
    const instances: FakeImage[] = [];
    class FakeImage {
      naturalWidth = 640;
      naturalHeight = 480;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      constructor() {
        instances.push(this);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const loaded = readImageMeta("data:image/jpeg;base64,AA==");
    instances[0].onload?.();
    expect(await loaded).toEqual({
      width: 640,
      height: 480,
      mimeType: "image/jpeg",
    });
    expect(instances[0].onload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const fallback = readImageMeta("/unavailable");
    instances[1].naturalWidth = 0;
    instances[1].naturalHeight = 0;
    await vi.advanceTimersByTimeAsync(3000);
    expect(await fallback).toMatchObject({ width: 1024, height: 1024 });
    expect(instances[1].onerror).toBeNull();
  });
  it("rejects an aborted file read and clears the event handlers", async () => {
    let reader: FakeReader;
    class FakeReader {
      result = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      constructor() {
        reader = this;
      }
      readAsDataURL() {}
    }
    vi.stubGlobal("FileReader", FakeReader);
    const result = readFileAsDataUrl(new File(["test"], "test.png"));
    const rejected = expect(result).rejects.toThrow();
    reader!.onabort?.();
    await rejected;
    expect(reader!.onabort).toBeNull();
    expect(reader!.onload).toBeNull();
  });
  it("normalizes non-finite sizes and durations", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatDuration(Number.NaN)).toContain('"seconds":0');
    expect(formatDuration(65000)).toContain('"minutes":1');
  });
});

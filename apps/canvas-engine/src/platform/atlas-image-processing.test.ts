import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cropAtlasImageDataUrl,
  splitAtlasImageDataUrl,
} from "@/atlas-engine/workflows/image-processing";

type DrawCall = unknown[];

const draws: DrawCall[] = [];
const canvases: FakeCanvas[] = [];

class FakeImage {
  naturalWidth = 200;
  naturalHeight = 100;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = "";

  set src(value: string) {
    this.source = value;
    queueMicrotask(() => this.onload?.());
  }

  get src() {
    return this.source;
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  context = {
    drawImage: (...args: unknown[]) => draws.push(args),
    save: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    scale: vi.fn(),
    restore: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    fillRect: vi.fn(),
    set fillStyle(_value: string) {},
    set imageSmoothingEnabled(_value: boolean) {},
    set imageSmoothingQuality(_value: ImageSmoothingQuality) {},
  };

  getContext() {
    return this.context as unknown as CanvasRenderingContext2D;
  }

  toDataURL() {
    return `data:image/mock,${this.width}x${this.height}`;
  }
}

beforeEach(() => {
  draws.length = 0;
  canvases.length = 0;
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Atlas browser image processing", () => {
  it("exports the centered square crop from a landscape source", async () => {
    const output = await cropAtlasImageDataUrl("data:image/source");

    expect(output).toBe("data:image/mock,100x100");
    expect(draws[0].slice(1)).toEqual([50, 0, 100, 100, 0, 0, 100, 100]);
  });

  it("cuts a source into the requested row and column grid", async () => {
    const output = await splitAtlasImageDataUrl("data:image/source", {
      rows: 2,
      columns: 2,
    });

    expect(output).toHaveLength(4);
    expect(output.map(({ row, column }) => [row, column])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    expect(canvases.map(({ width, height }) => [width, height])).toEqual(
      Array.from({ length: 4 }, () => [100, 50]),
    );
  });
});

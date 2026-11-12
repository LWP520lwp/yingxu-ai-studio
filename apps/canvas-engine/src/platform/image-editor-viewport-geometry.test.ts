import { describe, expect, it } from "vitest";

import {
  clampImageEditorZoom,
  fitImageToEditorViewport,
  imageEditorPanScroll,
  imageEditorLayout,
  normalizeImageEditorSize,
  scrollForZoomAnchor,
  zoomAnchorAtPoint,
} from "@/lib/canvas/image-editor-viewport-geometry";

describe("image editor viewport geometry", () => {
  it("fits valid images without upscaling and contains invalid dimensions", () => {
    expect(
      fitImageToEditorViewport(
        { width: 400, height: 200 },
        { width: 216, height: 116 },
      ),
    ).toEqual({ width: 168, height: 84 });
    expect(
      fitImageToEditorViewport(
        { width: 20, height: 10 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ width: 20, height: 10 });
    expect(
      fitImageToEditorViewport(
        { width: Infinity, height: 20 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ width: 0, height: 0 });
    expect(normalizeImageEditorSize({ width: -1, height: Number.NaN })).toEqual(
      { width: 0, height: 0 },
    );
  });

  it("bounds extreme dimensions before layout arithmetic", () => {
    expect(
      normalizeImageEditorSize({ width: Number.MAX_VALUE, height: 1 }),
    ).toEqual({ width: 100_000, height: 1 });
    const layout = imageEditorLayout(
      { width: 100_000, height: 1 },
      { width: 300, height: 200 },
      4,
    );
    expect(Number.isFinite(layout.contentSize.width)).toBe(true);
    expect(layout.contentSize.width).toBe(400_000);
  });

  it("centers the stage below fit zoom and expands the scroll area above fit zoom", () => {
    expect(
      imageEditorLayout(
        { width: 200, height: 100 },
        { width: 400, height: 300 },
        1,
      ),
    ).toEqual({
      stageSize: { width: 200, height: 100 },
      contentSize: { width: 400, height: 300 },
      stageOffset: { x: 100, y: 100 },
    });
    expect(
      imageEditorLayout(
        { width: 200, height: 100 },
        { width: 400, height: 300 },
        2,
      ),
    ).toEqual({
      stageSize: { width: 400, height: 200 },
      contentSize: { width: 400, height: 300 },
      stageOffset: { x: 0, y: 50 },
    });
  });

  it("clamps invalid and out-of-range zoom values", () => {
    expect(clampImageEditorZoom(Number.NaN)).toBe(1);
    expect(clampImageEditorZoom(0)).toBe(1);
    expect(clampImageEditorZoom(20)).toBe(4);
  });

  it("converts pointer deltas into bounded viewport scroll values", () => {
    expect(
      imageEditorPanScroll(
        { pointerX: 100, pointerY: 120, scrollLeft: 80, scrollTop: 50 },
        { x: 130, y: 100 },
      ),
    ).toEqual({ left: 50, top: 70 });
    expect(
      imageEditorPanScroll(
        { pointerX: 100, pointerY: 100, scrollLeft: 0, scrollTop: 0 },
        { x: 1000, y: 1000 },
      ),
    ).toEqual({ left: 0, top: 0 });
  });

  it("keeps the pointer anchored across zoom and computes the resulting scroll", () => {
    const viewport = { left: 100, top: 50, width: 400, height: 300 };
    const anchor = zoomAnchorAtPoint({
      baseSize: { width: 400, height: 200 },
      viewport,
      scroll: { x: 0, y: 0 },
      currentZoom: 1,
      nextZoom: 2,
      clientPoint: { x: 260, y: 170 },
    });
    expect(anchor).toEqual({
      zoom: 2,
      ratioX: 0.4,
      ratioY: 0.35,
      viewportX: 160,
      viewportY: 120,
    });
    const scroll = scrollForZoomAnchor(
      anchor!,
      { width: 400, height: 200 },
      { width: 400, height: 300 },
    );
    expect(scroll).toEqual({ left: 160, top: 20 });

    const currentLayout = imageEditorLayout(
      { width: 400, height: 200 },
      { width: 400, height: 300 },
      2,
    );
    const stageLeftAfter =
      viewport.left + currentLayout.stageOffset.x - scroll.left;
    const stageTopAfter =
      viewport.top + currentLayout.stageOffset.y - scroll.top;
    expect(
      stageLeftAfter + anchor!.ratioX * currentLayout.stageSize.width,
    ).toBe(260);
    expect(
      stageTopAfter + anchor!.ratioY * currentLayout.stageSize.height,
    ).toBe(170);
  });

  it("composes rapid zoom inputs against the pending anchor rather than stale scroll", () => {
    const viewport = { left: 0, top: 0, width: 400, height: 300 };
    const first = zoomAnchorAtPoint({
      baseSize: { width: 600, height: 400 },
      viewport,
      scroll: { x: 100, y: 40 },
      currentZoom: 1,
      nextZoom: 1.2,
      clientPoint: { x: 120, y: 90 },
    });
    const second = zoomAnchorAtPoint({
      baseSize: { width: 600, height: 400 },
      viewport,
      scroll: { x: 100, y: 40 },
      currentZoom: 1.2,
      nextZoom: 1.44,
      clientPoint: { x: 280, y: 190 },
      previousAnchor: first,
    });
    const expectedScrollX = first!.ratioX * 600 * 1.2 - first!.viewportX;
    const expectedScrollY = first!.ratioY * 400 * 1.2 - first!.viewportY;
    const currentLayout = imageEditorLayout(
      { width: 600, height: 400 },
      { width: 400, height: 300 },
      1.2,
    );
    expect(second?.ratioX).toBeCloseTo(
      (280 - (currentLayout.stageOffset.x - expectedScrollX)) /
        currentLayout.stageSize.width,
    );
    expect(second?.ratioY).toBeCloseTo(
      (190 - (currentLayout.stageOffset.y - expectedScrollY)) /
        currentLayout.stageSize.height,
    );
  });

  it("ignores no-op zooms and missing image geometry", () => {
    expect(
      zoomAnchorAtPoint({
        baseSize: { width: 0, height: 0 },
        viewport: { left: 0, top: 0, width: 10, height: 10 },
        scroll: { x: 0, y: 0 },
        currentZoom: 1,
        nextZoom: 2,
      }),
    ).toBeNull();
    expect(
      zoomAnchorAtPoint({
        baseSize: { width: 10, height: 10 },
        viewport: { left: 0, top: 0, width: 10, height: 10 },
        scroll: { x: 0, y: 0 },
        currentZoom: 1,
        nextZoom: 1,
      }),
    ).toBeNull();
  });
});

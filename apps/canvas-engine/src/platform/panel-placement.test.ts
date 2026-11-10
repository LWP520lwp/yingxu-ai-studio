import { describe, expect, it } from "vitest";
import { fitCanvasPanel } from "@/lib/canvas/canvas-panel-placement";

describe("configuration composer within the visible canvas", () => {
    it("keeps the ordinary centered placement below a node when it fits", () => {
        const result = fitCanvasPanel({ node: { left: 450, right: 650, top: 100, bottom: 200 }, viewport: { left: 0, top: 0, right: 1200, bottom: 720 }, panelWidth: 600, panelHeight: 200, bottomInset: 88 });
        expect(result).toEqual({ left: 250, top: 216, width: 600, maxHeight: 608 });
    });

    it("moves a lower-right composer above its node and keeps its right edge visible", () => {
        const result = fitCanvasPanel({ node: { left: 880, right: 1060, top: 460, bottom: 580 }, viewport: { left: 0, top: 0, right: 1120, bottom: 720 }, panelWidth: 600, panelHeight: 400, bottomInset: 88 });
        expect(result.left).toBe(508); expect(result.top).toBe(44);
        expect(result.left + result.width).toBe(1108);
        expect(result.top + 400).toBeLessThan(720 - 88);
    });

    it("shrinks the width and limits scroll height on a narrow, short viewport", () => {
        const result = fitCanvasPanel({ node: { left: 250, right: 350, top: 250, bottom: 350 }, viewport: { left: 0, top: 0, right: 360, bottom: 400 }, panelWidth: 600, panelHeight: 500, bottomInset: 88 });
        expect(result).toEqual({ left: 12, top: 12, width: 336, maxHeight: 288 });
        expect(result.top + result.maxHeight).toBe(300);
    });

    it("fits the actual 45-percent zoom case using screen coordinates and counter-scale positioning", () => {
        const scale = 0.45;
        const node = { left: 1800 * scale - 100, right: 2200 * scale - 100, top: 1000 * scale - 60, bottom: 1300 * scale - 60 };
        const result = fitCanvasPanel({ node, viewport: { left: 0, top: 0, right: 1100, bottom: 720 }, panelWidth: 600, panelHeight: 370, bottomInset: 88 });
        expect(result.left).toBe(488); expect(result.top).toBe(250);
        const localLeft = (result.left - node.left) / scale;
        const localTop = (result.top - node.top) / scale;
        expect(node.left + localLeft * scale + result.width).toBeLessThanOrEqual(1088);
        expect(node.top + localTop * scale + 370).toBeLessThanOrEqual(620);
    });

    it("uses the current canvas rectangle instead of assuming a full-window origin", () => {
        const result = fitCanvasPanel({ node: { left: 1000, right: 1060, top: 600, bottom: 700 }, viewport: { left: 200, top: 120, right: 1100, bottom: 820 }, panelWidth: 560, panelHeight: 250, bottomInset: 100 });
        expect(result.left).toBe(528); expect(result.top).toBe(334);
        expect(result.left).toBeGreaterThanOrEqual(212);
        expect(result.top + 250).toBeLessThanOrEqual(708);
    });

    it.each([
        { left: -500, right: -300, top: 100, bottom: 200 },
        { left: 1300, right: 1500, top: 100, bottom: 200 },
        { left: 500, right: 700, top: -400, bottom: -200 },
        { left: 500, right: 700, top: 900, bottom: 1100 },
    ])("keeps the composer reachable after panning its node outside the viewport: %j", (node) => {
        const result = fitCanvasPanel({ node, viewport: { left: 0, top: 0, right: 1200, bottom: 720 }, panelWidth: 600, panelHeight: 300, bottomInset: 88 });
        expect(result.left).toBeGreaterThanOrEqual(12); expect(result.left + result.width).toBeLessThanOrEqual(1188);
        expect(result.top).toBeGreaterThanOrEqual(12); expect(result.top + 300).toBeLessThanOrEqual(620);
    });
});

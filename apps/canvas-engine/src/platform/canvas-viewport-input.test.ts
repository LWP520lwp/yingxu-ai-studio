import { describe, expect, it } from "vitest";

import { chooseCanvasTool, isCanvasBackgroundTarget, isEditableCanvasTarget, panViewportFromPointer, zoomViewportFromWheel } from "@/lib/canvas/canvas-viewport-input";

describe("canvas viewport interaction policy", () => {
    it("prioritizes space and modifier keys over the selected tool", () => {
        expect(chooseCanvasTool("select", { button: 0, ctrlKey: false, shiftKey: false }, true)).toEqual({ activeTool: "pan", shouldPan: true });
        expect(chooseCanvasTool("pan", { button: 0, ctrlKey: true, shiftKey: false }, false)).toEqual({ activeTool: "select", shouldPan: false });
        expect(chooseCanvasTool("select", { button: 1, ctrlKey: false, shiftKey: false }, false).shouldPan).toBe(true);
    });

    it("keeps gesture filtering independent from the canvas renderer", () => {
        expect(isEditableCanvasTarget(null)).toBe(false);
        expect(isCanvasBackgroundTarget(null)).toBe(true);
    });

    it("delegates anchored zoom and scaled panning to the shared geometry", () => {
        const viewport = { x: 10, y: 20, k: 1 };
        expect(zoomViewportFromWheel(viewport, { x: 100, y: 50 }, -100).k).toBeGreaterThan(1);
        expect(panViewportFromPointer(viewport, 12, -4, 2)).toEqual({ x: 22, y: 16, k: 2 });
    });
});

import { describe, expect, it } from "vitest";

import { activeConnectionCurve, connectionCurve, panViewport, worldPoint, zoomViewportAt } from "@/lib/canvas/canvas-geometry";
import type { CanvasNodeData } from "@/types/canvas";

const node = (id: string, x: number, y: number): CanvasNodeData => ({ id, type: "text", title: id, position: { x, y }, width: 200, height: 100 });

describe("canvas geometry", () => {
    it("keeps the world point under the cursor while zooming", () => {
        const before = { x: 80, y: 50, k: 1 };
        const next = zoomViewportAt(before, { x: 240, y: 150 }, -100);
        expect(worldPoint(next, { x: 240, y: 150 }).x).toBeCloseTo(worldPoint(before, { x: 240, y: 150 }).x);
        expect(worldPoint(next, { x: 240, y: 150 }).y).toBeCloseTo(worldPoint(before, { x: 240, y: 150 }).y);
    });

    it("pans without changing scale", () => {
        expect(panViewport({ x: 10, y: 20, k: 1.5 }, -4, 12)).toEqual({ x: 6, y: 32, k: 1.5 });
    });

    it("returns stable source-to-target curves", () => {
        const path = connectionCurve(node("a", 10, 20), node("b", 420, 80));
        expect(path.path).toMatch(/^M 210 70 C /);
        expect(activeConnectionCurve(node("a", 10, 20), "source", { x: 300, y: 140 }).path).toContain("L 300 140");
    });
});

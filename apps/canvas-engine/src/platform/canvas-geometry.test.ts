import { describe, expect, it } from "vitest";

import { activeConnectionCurve, clampScale, connectionCurve, panViewport, screenPoint, worldPoint, zoomViewportAt } from "@/lib/canvas/canvas-geometry";
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

    it("keeps screen and world coordinates inverse and clamps invalid scales", () => {
        const viewport = { x: 80, y: -25, k: 1.7 };
        expect(screenPoint(viewport, worldPoint(viewport, { x: 240, y: 130 }))).toEqual({ x: 240, y: 130 });
        expect(clampScale(Number.NaN)).toBe(1);
        expect(worldPoint({ x: 0, y: 0, k: 0 }, { x: 20, y: 10 })).toEqual({ x: 400, y: 200 });
    });

    it("returns stable source-to-target curves", () => {
        const path = connectionCurve(node("a", 10, 20), node("b", 420, 80));
        expect(path.path).toMatch(/^M 210 70 C /);
        expect(activeConnectionCurve(node("a", 10, 20), "source", { x: 300, y: 140 }).path).toContain("L 300 140");
    });

    it("chooses facing ports for backwards connections", () => {
        const path = connectionCurve(node("a", 420, 20), node("b", 10, 80));
        expect(path.start.x).toBe(420);
        expect(path.end.x).toBe(210);
        expect(path.path).toMatch(/^M 420 70 C 315 70, 315 130, 210 130$/);
    });
});

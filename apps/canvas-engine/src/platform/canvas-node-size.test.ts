import { describe, expect, it } from "vitest";

import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";

describe("fitNodeSize", () => {
    it("keeps normal dimensions and fits wide or tall media inside the requested bounds", () => {
        expect(fitNodeSize(320, 180)).toEqual({ width: 320, height: 180 });
        expect(fitNodeSize(1920, 1080)).toEqual({ width: 640, height: 360 });
        expect(fitNodeSize(720, 1280, 360, 640)).toEqual({ width: 360, height: 640 });
        expect(fitNodeSize(800, 400, 300, 300)).toEqual({ width: 300, height: 150 });
    });

    it("returns finite positive dimensions for zero, negative, NaN, and infinite source values", () => {
        for (const [width, height] of [
            [0, 0],
            [-20, 90],
            [Number.NaN, 120],
            [120, Number.POSITIVE_INFINITY],
            [Number.NEGATIVE_INFINITY, Number.NaN],
        ]) {
            const result = fitNodeSize(width, height);
            expect(Number.isFinite(result.width)).toBe(true);
            expect(Number.isFinite(result.height)).toBe(true);
            expect(result.width).toBeGreaterThanOrEqual(1);
            expect(result.height).toBeGreaterThanOrEqual(1);
            expect(result.width).toBeLessThanOrEqual(640);
            expect(result.height).toBeLessThanOrEqual(640);
        }
        expect(fitNodeSize(0, -10)).toEqual({ width: 1, height: 1 });
    });

    it("bounds extreme media and invalid limits without producing overflow", () => {
        const result = fitNodeSize(Number.MAX_VALUE, Number.MIN_VALUE, Number.POSITIVE_INFINITY, Number.MAX_VALUE);
        expect(Number.isFinite(result.width)).toBe(true);
        expect(Number.isFinite(result.height)).toBe(true);
        expect(result.width).toBeLessThanOrEqual(1_000_000);
        expect(result.height).toBeLessThanOrEqual(1_000_000);

        expect(fitNodeSize(800, 400, Number.NaN, -1)).toEqual({ width: 640, height: 320 });
    });
});

describe("nodeSizeFromRatio", () => {
    it("fits standard landscape, portrait, and square ratios into the base rectangle", () => {
        expect(nodeSizeFromRatio("16:9", 400, 300)).toEqual({ width: 400, height: 225 });
        expect(nodeSizeFromRatio("9x16", 400, 300)).toEqual({ width: 168.75, height: 300 });
        expect(nodeSizeFromRatio("1:1", 400, 300)).toEqual({ width: 300, height: 300 });
    });

    it("rejects malformed or nonpositive ratios and safely falls back for extreme ratios", () => {
        expect(nodeSizeFromRatio("wide", 400, 300)).toBeNull();
        expect(nodeSizeFromRatio("-16:9", 400, 300)).toBeNull();
        expect(nodeSizeFromRatio("16:0", 400, 300)).toBeNull();
        expect(nodeSizeFromRatio("16:9 extra", 400, 300)).toBeNull();
        expect(nodeSizeFromRatio("100:1", 400, 300)).toEqual({ width: 400, height: 300 });
        expect(nodeSizeFromRatio("1:100", 400, 300)).toEqual({ width: 400, height: 300 });
    });

    it("returns finite positive bounded dimensions when the base rectangle is invalid or extreme", () => {
        expect(nodeSizeFromRatio("16:9", Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ width: 1, height: 1 });
        expect(nodeSizeFromRatio("4:3", Number.MAX_VALUE, Number.MAX_VALUE)).toEqual({ width: 1_000_000, height: 750_000 });
    });
});

import { describe, expect, it } from "vitest";
import {
    applyGroupSelection,
    applyUngroupSelection,
    canGroupSelectedNodes,
    canUngroupSelectedNodes,
    collectGroupMemberNodes,
    findContainingGroupId,
    findGroupDropTarget,
    focusViewportForNode,
    getConnectionTargetAnchor,
    getGroupWrapRect,
    nodeBounds,
    normalizeConnection,
    snapNodesIntoGroup,
} from "@/lib/canvas/canvas-node-geometry";
import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasNodeData,
} from "@/types/canvas";

const node = (
    id: string,
    x: number,
    y: number,
    patch: Partial<CanvasNodeData> = {},
): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Text,
    title: id,
    position: { x, y },
    width: 100,
    height: 60,
    ...patch,
});
const group = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    patch: Partial<CanvasNodeData> = {},
) => node(id, x, y, { type: CanvasNodeType.Group, width, height, ...patch });
const edge = (fromNodeId: string, toNodeId: string): CanvasConnection => ({
    id: `${fromNodeId}->${toNodeId}`,
    fromNodeId,
    toNodeId,
});
const byId = (nodes: CanvasNodeData[], id: string) =>
    nodes.find((item) => item.id === id)!;

describe("canvas node geometry", () => {
    it("returns finite bounds and a padded frame for empty input", () => {
        expect(nodeBounds([])).toEqual({
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        });
        expect(getGroupWrapRect([])).toEqual({
            x: -24,
            y: -52,
            width: 48,
            height: 76,
        });
        const malformed = node("bad", Number.NaN, 20, {
            width: Number.POSITIVE_INFINITY,
            height: -10,
        });
        expect(nodeBounds([malformed])).toEqual({
            left: 0,
            top: 20,
            right: 0,
            bottom: 20,
        });
    });

    it("wraps mixed-size nodes and does not mutate their input", () => {
        const members = [
            node("a", -10, 30),
            node("b", 150, -40, { width: 90, height: 80 }),
        ];
        expect(getGroupWrapRect(members)).toEqual({
            x: -34,
            y: -92,
            width: 298,
            height: 206,
        });
        expect(members[0].position).toEqual({ x: -10, y: 30 });
    });

    it("selects the topmost containing group and rejects group drags as targets", () => {
        const outer = group("outer", 0, 0, 400, 300);
        const inner = group("inner", 40, 40, 200, 160);
        const item = node("item", 80, 70);
        const nodes = [outer, inner, item];
        expect(findGroupDropTarget(new Set(["item"]), nodes)).toBe(inner);
        expect(findContainingGroupId(item, nodes)).toBe("inner");
        expect(findGroupDropTarget(new Set(["inner"]), nodes)).toBeNull();
        expect(findGroupDropTarget(new Set(["missing"]), nodes)).toBeNull();
    });

    it("snaps moved items into group padding while preserving relative offsets", () => {
        const first = node("first", -100, -100);
        const second = node("second", 20, -40);
        const stationary = node("stationary", 500, 500);
        const frame = group("frame", 0, 0, 300, 220);
        const input = [first, second, stationary];
        const result = snapNodesIntoGroup(
            new Set(["first", "second"]),
            input,
            frame,
        );
        expect(byId(result, "first").position).toEqual({ x: 24, y: 24 });
        expect(byId(result, "second").position).toEqual({ x: 144, y: 84 });
        expect(byId(result, "first").metadata?.groupId).toBe("frame");
        expect(byId(result, "stationary")).toBe(stationary);
        expect(first.position).toEqual({ x: -100, y: -100 });
        expect(snapNodesIntoGroup(new Set(), input, frame)).toBe(input);
    });

    it("expands selected groups to their direct members and supports group eligibility", () => {
        const frame = group("frame", 0, 0, 300, 200);
        const one = node("one", 0, 0, { metadata: { groupId: "frame" } });
        const two = node("two", 0, 0, { metadata: { groupId: "frame" } });
        const other = node("other", 0, 0);
        const nodes = [frame, one, two, other];
        expect(
            collectGroupMemberNodes(new Set(["frame"]), nodes).map(
                (item) => item.id,
            ),
        ).toEqual(["one", "two"]);
        expect(canGroupSelectedNodes(new Set(["one", "two"]), nodes)).toBe(
            false,
        );
        expect(canGroupSelectedNodes(new Set(["one", "other"]), nodes)).toBe(
            true,
        );
        expect(canUngroupSelectedNodes(new Set(["one"]), nodes)).toBe(true);
        expect(canUngroupSelectedNodes(new Set(["other"]), nodes)).toBe(false);
    });

    it("groups selected items without losing edge contracts and ungroups them again", () => {
        const one = node("one", 10, 20);
        const two = node("two", 140, 60);
        const outside = node("outside", 400, 40);
        const links = [edge("one", "outside"), edge("two", "one")];
        const created = group("new-group", 0, 0, 200, 150);
        const grouped = applyGroupSelection(
            new Set(["one", "two"]),
            [one, two, outside],
            links,
            created,
        )!;
        expect(grouped.nodes.map((item) => item.id)).toEqual([
            "new-group",
            "one",
            "two",
            "outside",
        ]);
        expect(byId(grouped.nodes, "one").metadata?.groupId).toBe("new-group");
        expect(grouped.connections).toEqual(links);
        expect(grouped.selectedIds).toEqual(["new-group"]);
        expect(
            applyGroupSelection(
                new Set(["one", "two"]),
                [one, two],
                links,
                one,
            ),
        ).toBeNull();
        expect(
            applyGroupSelection(
                new Set(["one", "two"]),
                grouped.nodes,
                links,
                created,
            ),
        ).toBeNull();

        const ungrouped = applyUngroupSelection(
            new Set(["new-group"]),
            grouped.nodes,
            grouped.connections,
        )!;
        expect(ungrouped.nodes.map((item) => item.id)).toContain("one");
        expect(ungrouped.nodes.map((item) => item.id)).toContain("two");
        expect(ungrouped.nodes.some((item) => item.id === "new-group")).toBe(
            false,
        );
        expect(
            ungrouped.nodes
                .filter((item) => item.id === "one" || item.id === "two")
                .every((item) => !item.metadata?.groupId),
        ).toBe(true);
        expect(ungrouped.connections).toEqual(links);
        expect(ungrouped.selectedIds).toEqual(["one", "two"]);
    });

    it("preserves orphan and cyclic group metadata without crashing or erasing unrelated data", () => {
        const firstGroup = group("g1", 0, 0, 200, 120, {
            metadata: { groupId: "g2" },
        });
        const secondGroup = group("g2", 10, 10, 180, 100, {
            metadata: { groupId: "g1" },
        });
        const orphan = node("orphan", 30, 40, {
            metadata: { groupId: "missing", content: "preserve" },
        });
        const nodes = [firstGroup, secondGroup, orphan];
        expect(collectGroupMemberNodes(new Set(["g1", "g2"]), nodes)).toEqual(
            [],
        );
        expect(findContainingGroupId(orphan, nodes)).toBe("g2");

        const newlyGrouped = applyGroupSelection(
            new Set(["orphan", "extra"]),
            nodes,
            [],
            group("new", 0, 0, 10, 10),
        );
        expect(newlyGrouped).toBeNull();
        expect(
            applyUngroupSelection(new Set(["orphan"]), nodes, [])?.nodes.find(
                (item) => item.id === "orphan",
            )?.metadata?.groupId,
        ).toBeUndefined();
        expect(nodes[2].metadata?.groupId).toBe("missing");
    });

    it("ungroups a parent frame while preserving nested groups and their internal edges", () => {
        const outer = group("outer", 0, 0, 500, 360);
        const inner = group("inner", 30, 70, 300, 220, {
            metadata: { groupId: "outer" },
        });
        const nested = node("nested", 60, 110, {
            metadata: { groupId: "inner" },
        });
        const direct = node("direct", 360, 100, {
            metadata: { groupId: "outer" },
        });
        const links = [
            edge("outer", "direct"),
            edge("inner", "nested"),
            edge("direct", "nested"),
        ];

        const result = applyUngroupSelection(
            new Set(["outer"]),
            [outer, inner, nested, direct],
            links,
        )!;

        expect(result.nodes.map((item) => item.id)).toEqual([
            "inner",
            "nested",
            "direct",
        ]);
        expect(byId(result.nodes, "inner").metadata?.groupId).toBeUndefined();
        expect(byId(result.nodes, "nested").metadata?.groupId).toBe("inner");
        expect(byId(result.nodes, "direct").metadata?.groupId).toBeUndefined();
        expect(result.connections).toEqual([links[1], links[2]]);
        expect(result.selectedIds).toEqual(["inner", "direct"]);
    });

    it("normalizes config inputs and allows explicitly opposing ordinary edges", () => {
        const source = node("source", 0, 0);
        const target = node("target", 150, 0);
        const config = node("config", 300, 0, { type: CanvasNodeType.Config });
        const groupNode = group("group", 0, 0, 100, 100);
        const nodes = [source, target, config, groupNode];

        expect(
            normalizeConnection("source", "config", nodes, "source"),
        ).toEqual({ fromNodeId: "source", toNodeId: "config" });
        expect(
            normalizeConnection("config", "target", nodes, "target"),
        ).toEqual({ fromNodeId: "target", toNodeId: "config" });
        expect(
            normalizeConnection("config", "target", nodes, "source"),
        ).toEqual({ fromNodeId: "config", toNodeId: "target" });
        expect(
            normalizeConnection("config", "config", nodes, "target"),
        ).toBeNull();
        expect(
            normalizeConnection("target", "group", nodes, "source"),
        ).toBeNull();
        expect(
            normalizeConnection("source", "source", nodes, "source"),
        ).toBeNull();
        expect(
            normalizeConnection("missing", "source", nodes, "source"),
        ).toBeNull();
        expect(
            normalizeConnection("source", "target", nodes, "source"),
        ).toEqual({ fromNodeId: "source", toNodeId: "target" });
        expect(
            normalizeConnection("target", "source", nodes, "source"),
        ).toEqual({ fromNodeId: "target", toNodeId: "source" });
    });

    it("returns the opposing candidate anchor for either drag handle", () => {
        const item = node("item", 20, 10, { width: 120, height: 80 });
        expect(
            getConnectionTargetAnchor(item, {
                nodeId: "other",
                handleType: "source",
            }),
        ).toEqual({ x: 20, y: 50 });
        expect(
            getConnectionTargetAnchor(item, {
                nodeId: "other",
                handleType: "target",
            }),
        ).toEqual({ x: 140, y: 50 });
    });

    it("keeps focused view transforms finite and scale bounded for tiny viewports and malformed dimensions", () => {
        const item = node("large", -1e12, 1e12, { width: 1e12, height: 1e12 });
        const fitted = focusViewportForNode(
            item,
            { width: 320, height: 180 },
            { above: 30, below: 64, bottomInset: 40 },
        );
        expect(fitted.k).toBeGreaterThanOrEqual(0.05);
        expect(fitted.k).toBeLessThanOrEqual(1);
        expect([fitted.x, fitted.y, fitted.k].every(Number.isFinite)).toBe(
            true,
        );

        const bad = focusViewportForNode(
            node("bad", 20, 30, { width: Number.NaN, height: 0 }),
            { width: 0, height: 0 },
            { above: Number.POSITIVE_INFINITY },
        );
        expect([bad.x, bad.y, bad.k].every(Number.isFinite)).toBe(true);
        expect(bad.k).toBeGreaterThanOrEqual(0.05);
        expect(bad.k).toBeLessThanOrEqual(1);
    });
});

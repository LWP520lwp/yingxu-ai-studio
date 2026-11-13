import { describe, expect, it } from "vitest";

import {
  auditCanvasWorkflow,
  repairCanvasConnections,
  summarizeCanvasWorkflow,
} from "@/atlas-engine/workflows/workflow-audit";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";

const node = (id: string): CanvasNodeData => ({
  id,
  type: CanvasNodeType.Text,
  title: id,
  position: { x: 0, y: 0 },
  width: 120,
  height: 80,
});
const edge = (
  id: string,
  fromNodeId: string,
  toNodeId: string,
): CanvasConnection => ({ id, fromNodeId, toNodeId });

describe("canvas workflow audit", () => {
  it("repairs malformed connections without deleting intentional cycles or mutating input", () => {
    const nodes = [node("a"), node("b")];
    const connections = [
      edge("ab", "a", "b"),
      edge("copy", "a", "b"),
      edge("self", "a", "a"),
      edge("missing", "gone", "b"),
      edge("ba", "b", "a"),
    ];
    const result = repairCanvasConnections(nodes, connections);
    expect(result.map((item) => item.id)).toEqual(["ab", "ba"]);
    expect(connections).toHaveLength(5);
    expect(
      auditCanvasWorkflow(nodes, result).map((issue) => issue.code),
    ).toEqual(["cycle"]);
    expect(repairCanvasConnections(nodes, result)).toEqual(result);
  });
  it("reports broken endpoints and self-links with a usable focus target", () => {
    expect(
      auditCanvasWorkflow(
        [node("a")],
        [
          edge("lost-source", "missing", "a"),
          edge("lost-target", "a", "missing"),
          edge("self", "a", "a"),
        ],
      ),
    ).toEqual([
      {
        code: "missing-source",
        severity: "error",
        connectionId: "lost-source",
        focusNodeId: "a",
        fromTitle: undefined,
        toTitle: "a",
      },
      {
        code: "missing-target",
        severity: "error",
        connectionId: "lost-target",
        focusNodeId: "a",
        fromTitle: "a",
        toTitle: undefined,
      },
      {
        code: "self-link",
        severity: "error",
        connectionId: "self",
        focusNodeId: "a",
        fromTitle: "a",
        toTitle: "a",
      },
    ]);
  });

  it("reports duplicate directed links and cycles without suppressing valid links", () => {
    const issues = auditCanvasWorkflow(
      [node("a"), node("b"), node("c")],
      [
        edge("ab", "a", "b"),
        edge("ab-copy", "a", "b"),
        edge("bc", "b", "c"),
        edge("ca", "c", "a"),
      ],
    );
    expect(
      issues.map(({ code, connectionId }) => [code, connectionId]),
    ).toEqual([
      ["duplicate-link", "ab-copy"],
      ["cycle", "ca"],
    ]);
  });

  it("returns no findings for an intact acyclic graph", () => {
    expect(
      auditCanvasWorkflow(
        [node("a"), node("b"), node("c")],
        [edge("ab", "a", "b"), edge("bc", "b", "c")],
      ),
    ).toEqual([]);
  });

  it("summarizes entry, exit, isolated, and branch nodes from valid unique edges", () => {
    const nodes = [
      node("start"),
      node("branch"),
      node("left"),
      node("right"),
      node("alone"),
    ];
    const summary = summarizeCanvasWorkflow(nodes, [
      edge("start-branch", "start", "branch"),
      edge("branch-left", "branch", "left"),
      edge("branch-right", "branch", "right"),
      edge("duplicate", "branch", "left"),
      edge("missing", "gone", "left"),
      edge("self", "alone", "alone"),
    ]);
    expect(summary.entryNodes.map((item) => item.id)).toEqual([
      "start",
      "alone",
    ]);
    expect(summary.exitNodes.map((item) => item.id)).toEqual([
      "left",
      "right",
      "alone",
    ]);
    expect(summary.isolatedNodes.map((item) => item.id)).toEqual(["alone"]);
    expect(summary.branchNodes.map((item) => item.id)).toEqual(["branch"]);
  });

  it("handles long workflows without recursive traversal", () => {
    const nodes = Array.from({ length: 12_000 }, (_, index) =>
      node(`node-${index}`),
    );
    const connections = Array.from({ length: nodes.length - 1 }, (_, index) =>
      edge(`edge-${index}`, nodes[index].id, nodes[index + 1].id),
    );
    expect(auditCanvasWorkflow(nodes, connections)).toEqual([]);
  });
});

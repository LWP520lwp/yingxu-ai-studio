import { describe, expect, it } from "vitest";

import { createAtlasDocument } from "@/atlas-engine/model";
import { applyAtlasCommands } from "@/atlas-engine/reducer";
import { planAtlasNodeDeletion } from "@/atlas-engine/interaction/node-actions";

const node = (
  id: string,
  kind = "image",
  data?: Readonly<Record<string, unknown>>,
) => ({
  id,
  kind,
  title: id,
  frame: { x: 0, y: 0, width: 100, height: 80 },
  ...(data ? { data } : {}),
});

describe("Atlas node actions", () => {
  it("deletes nodes, cascades connected edges, detaches surviving group members, and clears selection atomically", () => {
    const initial = createAtlasDocument({
      nodes: [
        node("group", "group"),
        node("member", "image", { groupId: "group", content: "keep" }),
        node("outside"),
      ],
      edges: [
        { id: "group-member", source: "group", target: "member" },
        { id: "member-outside", source: "member", target: "outside" },
      ],
      selection: { nodeIds: ["group", "outside"], edgeId: "group-member" },
    });

    const result = applyAtlasCommands(
      initial,
      planAtlasNodeDeletion(["group", "group"]),
    );

    expect(result.nodes.map(({ id }) => id)).toEqual(["member", "outside"]);
    expect(result.nodes[0]).toMatchObject({
      data: { groupId: undefined, content: "keep" },
    });
    expect(result.nodes[1]).toBe(initial.nodes[2]);
    expect(result.edges).toEqual([
      { id: "member-outside", source: "member", target: "outside" },
    ]);
    expect(result.selection).toEqual({ nodeIds: [] });
    expect(initial.nodes[1]?.data?.groupId).toBe("group");
  });

  it("returns no commands for empty or blank identifiers", () => {
    expect(planAtlasNodeDeletion([])).toEqual([]);
    expect(planAtlasNodeDeletion(["", "  "])).toEqual([]);
  });

  it("does not clear the document when asked to delete an unknown identifier", () => {
    const initial = createAtlasDocument({
      nodes: [node("a"), node("b")],
      selection: { nodeIds: ["a"] },
    });

    expect(
      applyAtlasCommands(initial, planAtlasNodeDeletion(["missing"])),
    ).not.toBe(initial);
    expect(
      applyAtlasCommands(initial, planAtlasNodeDeletion(["missing"])).selection,
    ).toEqual({ nodeIds: [] });
  });
});

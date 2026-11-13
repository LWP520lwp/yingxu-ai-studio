import { describe, expect, it } from "vitest";

import { planAtlasImageReversePrompt, planAtlasTextToImage, planAtlasTextToVideo } from "@/atlas-engine/interaction/generation-commands";
import { fromCanvasDocument, toCanvasConnections, toCanvasNodes } from "@/atlas-engine/adapter";
import { applyAtlasCommands } from "@/atlas-engine/reducer";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function source(type: CanvasNodeData["type"]): CanvasNodeData {
  return { id: "source", type, title: "Source", position: { x: 10, y: 20 }, width: 340, height: 240, metadata: { content: "  A continuous shot  ", fontSize: 19 } };
}

describe("Atlas generation graph commands", () => {
  it("patches source text, inserts its configuration, connects and selects it atomically", () => {
    const original = source(CanvasNodeType.Text);
    const plan = planAtlasTextToImage(original, { ...defaultConfig, imageModel: "image-model", canvasImageCount: "3" });
    expect(plan).not.toBeNull();
    const document = applyAtlasCommands(fromCanvasDocument([original], [], { x: 0, y: 0, k: 1 }), plan!.commands);
    const nodes = toCanvasNodes(document);

    expect(nodes[0].metadata).toMatchObject({ content: "A continuous shot", prompt: "A continuous shot", fontSize: 19, status: "success" });
    expect(nodes[1].metadata).toMatchObject({ prompt: "", model: "image-model", count: 3 });
    expect(toCanvasConnections(document)).toEqual([expect.objectContaining({ fromNodeId: original.id, toNodeId: plan!.panelId })]);
    expect(document.selection.nodeIds).toEqual([plan!.panelId]);
    expect(original.metadata?.content).toBe("  A continuous shot  ");
  });

  it("refuses empty or removed text sources without creating detached configurations", () => {
    expect(planAtlasTextToImage(undefined, defaultConfig)).toBeNull();
    expect(planAtlasTextToImage({ ...source(CanvasNodeType.Text), metadata: { content: "  " } }, defaultConfig)).toBeNull();
    expect(planAtlasTextToImage(source(CanvasNodeType.Image), defaultConfig)).toBeNull();
  });

  it("preserves video skill metadata and aligns the full composer to the source center", () => {
    const original = source(CanvasNodeType.Text);
    const plan = planAtlasTextToVideo(original, { generationMode: "video", videoSkillId: "combat", composerContent: "@[node:source]" }, "Action video");
    const document = applyAtlasCommands(fromCanvasDocument([original], [], { x: 0, y: 0, k: 1 }), plan!.commands);
    const output = toCanvasNodes(document)[1];

    expect(output.title).toBe("Action video");
    expect(output.metadata).toMatchObject({ videoSkillId: "combat", composerContent: "@[node:source]", generationMode: "video" });
    expect(output.position.y + output.height / 2).toBe(original.position.y + original.height / 2);
    expect(toCanvasNodes(document)[0].metadata).toEqual(original.metadata);
  });

  it("creates two explicit input branches for reverse prompting and selects only the composer", () => {
    const original = source(CanvasNodeType.Image);
    const plan = planAtlasImageReversePrompt({
      source: original,
      model: "vision-model",
      instruction: "Describe visual composition",
      instructionTitle: "Analysis instruction",
      configurationTitle: "Image analysis",
      compose: (imageId, textId) => `@[node:${imageId}] @[node:${textId}]`,
    });
    const document = applyAtlasCommands(fromCanvasDocument([original], [], { x: 0, y: 0, k: 1 }), plan!.commands);
    const nodes = toCanvasNodes(document);
    const output = nodes.find((node) => node.id === plan!.panelId)!;

    expect(nodes).toHaveLength(3);
    expect(output.metadata).toMatchObject({ generationMode: "text", model: "vision-model", count: 1 });
    expect(output.metadata?.composerContent).toContain(`@[node:${nodes[1].id}]`);
    expect(toCanvasConnections(document).map((edge) => edge.fromNodeId)).toEqual([original.id, nodes[1].id]);
    expect(document.selection.nodeIds).toEqual([output.id]);
  });
});

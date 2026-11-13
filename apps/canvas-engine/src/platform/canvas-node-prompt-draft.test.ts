import { describe, expect, it } from "vitest";

import { reduceCanvasPromptDraft } from "@/components/canvas/canvas-node-prompt-panel";

describe("canvas prompt draft ownership", () => {
  it("keeps edits when generation metadata changes on the same node", () => {
    const draft = { nodeId: "text-1", value: "in-progress prompt" };

    expect(
      reduceCanvasPromptDraft(draft, {
        type: "select-node",
        nodeId: "text-1",
        savedValue: "server-updated prompt",
      }),
    ).toBe(draft);
  });

  it("hydrates from the newly selected node and then owns later edits", () => {
    const selected = reduceCanvasPromptDraft(
      { nodeId: "text-1", value: "draft one" },
      { type: "select-node", nodeId: "image-2", savedValue: "saved prompt" },
    );
    const changed = reduceCanvasPromptDraft(selected, {
      type: "edit",
      value: "new prompt",
    });

    expect(selected).toEqual({ nodeId: "image-2", value: "saved prompt" });
    expect(changed).toEqual({ nodeId: "image-2", value: "new prompt" });
  });
});

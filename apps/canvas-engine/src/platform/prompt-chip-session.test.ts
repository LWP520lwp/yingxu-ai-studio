import { describe, expect, it } from "vitest";

import {
  findPromptReferences,
  getPromptChipKeyAction,
  indexPromptReferences,
  movePromptChoice,
} from "@/lib/canvas/prompt-chip-session";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

function reference(
  id: string,
  label: string,
  overrides: Partial<CanvasResourceReference> = {},
): CanvasResourceReference {
  return {
    id,
    label,
    title: label,
    kind: "image",
    active: true,
    ...overrides,
  } as CanvasResourceReference;
}

describe("prompt chip session", () => {
  it("indexes only active resources and sorts overlapping tokens longest-first", () => {
    const short = reference("short", "@ref");
    const long = reference("long", "@reference", { valueToken: "[frame]" });
    const inactive = reference("off", "@hidden", { active: false });

    const index = indexPromptReferences([short, long, inactive]);

    expect(index.active.map(({ id }) => id)).toEqual(["short", "long"]);
    expect(index.byToken.get("[frame]")).toBe(long);
    expect(index.tokens).toEqual(["[frame]", "@ref"]);
  });

  it("matches a mention against label, title, kind, and body text", () => {
    const references = [
      reference("image", "@scene", { title: "Forest clearing" }),
      reference("text", "@notes", { kind: "text", text: "Forest facts" }),
      reference("video", "@clip", { kind: "video", title: "City" }),
    ];

    expect(findPromptReferences(references, " FOREST ").map(({ id }) => id)).toEqual([
      "image",
      "text",
    ]);
    expect(findPromptReferences(references, "")).toEqual(references);
  });

  it("prioritizes composition and mention navigation before submit or token deletion", () => {
    expect(
      getPromptChipKeyAction({
        key: "Enter",
        composing: true,
        hasMentionChoices: true,
        adjacentToken: true,
        plainEnter: true,
        canSubmit: true,
      }),
    ).toBe("composing");
    expect(
      getPromptChipKeyAction({
        key: "ArrowDown",
        composing: false,
        hasMentionChoices: true,
        adjacentToken: false,
        plainEnter: false,
        canSubmit: true,
      }),
    ).toBe("move-forward");
    expect(
      getPromptChipKeyAction({
        key: "Backspace",
        composing: false,
        hasMentionChoices: false,
        adjacentToken: true,
        plainEnter: false,
        canSubmit: true,
      }),
    ).toBe("remove-token");
  });

  it("wraps selection and clamps stale indexes after the choice list shrinks", () => {
    expect(movePromptChoice(0, -1, 3)).toBe(2);
    expect(movePromptChoice(2, 1, 3)).toBe(0);
    expect(movePromptChoice(8, 1, 3)).toBe(0);
    expect(movePromptChoice(0, 1, 0)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  resolvePromptEditorKeyIntent,
  stepMentionSelection,
} from "@/lib/canvas/canvas-prompt-editor-model";

const intent = (
  overrides: Partial<Parameters<typeof resolvePromptEditorKeyIntent>[0]> = {},
) =>
  resolvePromptEditorKeyIntent({
    key: "a",
    composing: false,
    mentionHasCandidates: false,
    adjacentReference: false,
    plainEnter: false,
    canSubmit: true,
    ...overrides,
  });

describe("prompt editor keyboard decisions", () => {
  it("leaves IME keystrokes to the active composition", () => {
    expect(intent({ key: "Enter", composing: true, plainEnter: true })).toBe(
      "ignore-composition",
    );
  });

  it("navigates and resolves an open mention menu", () => {
    expect(intent({ key: "ArrowDown", mentionHasCandidates: true })).toBe(
      "next-mention",
    );
    expect(intent({ key: "ArrowUp", mentionHasCandidates: true })).toBe(
      "previous-mention",
    );
    expect(intent({ key: "Enter", mentionHasCandidates: true })).toBe(
      "accept-mention",
    );
    expect(intent({ key: "Escape", mentionHasCandidates: true })).toBe(
      "dismiss-mention",
    );
  });

  it("prioritizes mention selection and atomic chip deletion", () => {
    expect(
      intent({
        key: "Backspace",
        mentionHasCandidates: true,
        adjacentReference: true,
      }),
    ).toBe("delete-reference");
    expect(intent({ key: "Delete", adjacentReference: true })).toBe(
      "delete-reference",
    );
  });

  it("submits only for plain Enter when there is a submit action", () => {
    expect(intent({ key: "Enter", plainEnter: true })).toBe("submit");
    expect(intent({ key: "Enter", plainEnter: false })).toBe("refresh-mention");
    expect(intent({ key: "Enter", plainEnter: true, canSubmit: false })).toBe(
      "refresh-mention",
    );
  });

  it("wraps mention selection and handles an empty candidate list", () => {
    expect(stepMentionSelection(0, -1, 3)).toBe(2);
    expect(stepMentionSelection(2, 1, 3)).toBe(0);
    expect(stepMentionSelection(8, 1, 3)).toBe(0);
    expect(stepMentionSelection(0, 1, 0)).toBe(0);
  });
});

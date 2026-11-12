import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type PromptChipKeyAction =
  | "composing"
  | "move-forward"
  | "move-backward"
  | "choose"
  | "close"
  | "remove-token"
  | "submit"
  | "refresh";

export type PromptReferenceIndex = {
  active: CanvasResourceReference[];
  byToken: Map<string, CanvasResourceReference>;
  tokens: string[];
};

export function indexPromptReferences(
  references: readonly CanvasResourceReference[],
): PromptReferenceIndex {
  const active = references.filter((reference) => reference.active);
  const byToken = new Map<string, CanvasResourceReference>();

  for (const reference of active) {
    byToken.set(reference.valueToken || reference.label, reference);
  }

  return {
    active,
    byToken,
    tokens: [...byToken.keys()].sort((left, right) => right.length - left.length),
  };
}

export function findPromptReferences(
  references: readonly CanvasResourceReference[],
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...references];

  return references.filter((reference) => {
    const searchable = [
      reference.label,
      reference.title,
      reference.kind,
      reference.text || "",
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(needle);
  });
}

export function getPromptChipKeyAction(input: {
  key: string;
  composing: boolean;
  hasMentionChoices: boolean;
  adjacentToken: boolean;
  plainEnter: boolean;
  canSubmit: boolean;
}): PromptChipKeyAction {
  if (input.composing) return "composing";

  if (input.hasMentionChoices) {
    if (input.key === "ArrowDown") return "move-forward";
    if (input.key === "ArrowUp") return "move-backward";
    if (input.key === "Enter") return "choose";
    if (input.key === "Escape") return "close";
  }

  if (
    (input.key === "Backspace" || input.key === "Delete") &&
    input.adjacentToken
  ) {
    return "remove-token";
  }

  return input.plainEnter && input.canSubmit ? "submit" : "refresh";
}

export function movePromptChoice(
  index: number,
  direction: -1 | 1,
  length: number,
) {
  if (length < 1) return 0;
  const current = Math.max(0, Math.min(Math.trunc(index), length - 1));
  return (current + direction + length) % length;
}

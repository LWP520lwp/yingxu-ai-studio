export type PromptEditorKeyIntent =
  | "ignore-composition"
  | "next-mention"
  | "previous-mention"
  | "accept-mention"
  | "dismiss-mention"
  | "delete-reference"
  | "submit"
  | "refresh-mention";

export function resolvePromptEditorKeyIntent(options: {
  key: string;
  composing: boolean;
  mentionHasCandidates: boolean;
  adjacentReference: boolean;
  plainEnter: boolean;
  canSubmit: boolean;
}): PromptEditorKeyIntent {
  if (options.composing) return "ignore-composition";

  if (options.mentionHasCandidates) {
    if (options.key === "ArrowDown") return "next-mention";
    if (options.key === "ArrowUp") return "previous-mention";
    if (options.key === "Enter") return "accept-mention";
    if (options.key === "Escape") return "dismiss-mention";
  }

  if (
    (options.key === "Backspace" || options.key === "Delete") &&
    options.adjacentReference
  ) {
    return "delete-reference";
  }

  if (options.plainEnter && options.canSubmit) return "submit";
  return "refresh-mention";
}

export function stepMentionSelection(
  activeIndex: number,
  direction: -1 | 1,
  candidateCount: number,
) {
  if (candidateCount <= 0) return 0;
  const current = Math.min(
    Math.max(Math.trunc(activeIndex), 0),
    candidateCount - 1,
  );
  return (current + direction + candidateCount) % candidateCount;
}

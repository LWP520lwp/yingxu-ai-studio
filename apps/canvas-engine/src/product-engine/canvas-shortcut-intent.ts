export type CanvasShortcutIntent =
  | "none"
  | "undo"
  | "redo"
  | "select-all"
  | "group"
  | "ungroup"
  | "copy-nodes"
  | "paste-nodes"
  | "delete-nodes"
  | "delete-connection"
  | "cancel";

export interface CanvasShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  editableTarget: boolean;
  selectedText: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  selectedNodeCount: number;
  selectedConnection: boolean;
}

export function resolveCanvasShortcutIntent(
  input: CanvasShortcutInput,
): CanvasShortcutIntent {
  if (input.editableTarget) return "none";

  const key = input.key.toLowerCase();
  const modifier = input.ctrlKey || input.metaKey;

  if (modifier && key === "c" && input.selectedText) return "none";

  if (modifier && !input.altKey) {
    if (key === "z") return input.shiftKey ? "redo" : "undo";
    if (key === "y") return "redo";
    if (key === "a") return "select-all";
    if (key === "g") {
      if (input.shiftKey) return input.canUngroup ? "ungroup" : "none";
      return input.canGroup ? "group" : "none";
    }
    if (key === "c") return "copy-nodes";
    if (key === "v") return "paste-nodes";
  }

  if (key === "delete" || key === "backspace") {
    if (input.selectedNodeCount > 0) return "delete-nodes";
    if (input.selectedConnection) return "delete-connection";
  }

  if (input.key === "Escape") return "cancel";
  return "none";
}

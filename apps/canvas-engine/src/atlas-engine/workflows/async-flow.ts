export type AtlasGenerationOutcome = "completed" | "cancelled" | "failed" | "skipped";

export type AtlasGenerationOptions<TContext> = {
  begin: () => AbortController;
  prepare: (signal: AbortSignal) => Promise<TContext>;
  shouldSkip?: (context: TContext, signal: AbortSignal) => boolean;
  execute: (context: TContext, controller: AbortController) => Promise<void>;
  ignoreError: (error: unknown, controller: AbortController) => boolean;
  onError: (error: unknown, controller: AbortController) => void;
  finish: (controller: AbortController) => void;
};

export async function runAtlasGeneration<TContext>(
  options: AtlasGenerationOptions<TContext>,
): Promise<AtlasGenerationOutcome> {
  const controller = options.begin();

  try {
    const context = await options.prepare(controller.signal);
    if (controller.signal.aborted) return "cancelled";
    if (options.shouldSkip?.(context, controller.signal)) return "skipped";

    await options.execute(context, controller);
    return controller.signal.aborted ? "cancelled" : "completed";
  } catch (error) {
    if (options.ignoreError(error, controller)) return "cancelled";
    options.onError(error, controller);
    return "failed";
  } finally {
    options.finish(controller);
  }
}

export type AtlasShortcutAction =
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

export type AtlasShortcutContext = Readonly<{
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
}>;

export function resolveAtlasShortcut(context: AtlasShortcutContext): AtlasShortcutAction {
  if (context.editableTarget) return "none";

  const key = context.key.toLowerCase();
  const command = context.ctrlKey || context.metaKey;

  if (command && key === "c" && context.selectedText) return "none";
  if (command && !context.altKey) {
    switch (key) {
      case "z": return context.shiftKey ? "redo" : "undo";
      case "y": return "redo";
      case "a": return "select-all";
      case "g":
        return context.shiftKey
          ? context.canUngroup ? "ungroup" : "none"
          : context.canGroup ? "group" : "none";
      case "c": return "copy-nodes";
      case "v": return "paste-nodes";
    }
  }

  if (key === "delete" || key === "backspace") {
    if (context.selectedNodeCount > 0) return "delete-nodes";
    if (context.selectedConnection) return "delete-connection";
  }
  return context.key === "Escape" ? "cancel" : "none";
}

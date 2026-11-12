import { useEffect, useRef } from "react";

type EditorActions = { undo?: () => void; redo?: () => void; remove?: () => void };

export function useEditorShortcuts(active: boolean, actions: EditorActions) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    if (!active) return;
    const lifetime = new AbortController();
    window.addEventListener("keydown", (event) => {
      if (event.isComposing || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])")) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const action = modifier && key === "z"
        ? (event.shiftKey ? latest.current.redo : latest.current.undo)
        : modifier && key === "y"
          ? latest.current.redo
          : !modifier && (key === "delete" || key === "backspace")
            ? latest.current.remove
            : undefined;
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      action();
    }, { capture: true, signal: lifetime.signal });
    return () => lifetime.abort();
  }, [active]);
}

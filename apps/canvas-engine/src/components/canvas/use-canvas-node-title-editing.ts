import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  beginAtlasTitleEdit,
  updateAtlasTitleEdit,
  commitAtlasTitleEdit,
} from "@/atlas-engine/interaction/node-editing";

type UseCanvasNodeTitleEditingOptions = {
  nodeId: string;
  title: string;
  onTitleChange: (nodeId: string, title: string) => void;
};

export function useCanvasNodeTitleEditing({
  nodeId,
  title,
  onTitleChange,
}: UseCanvasNodeTitleEditingOptions) {
  const { t } = useTranslation();
  const [state, setState] = useState(() => beginAtlasTitleEdit(nodeId, title));
  const stateRef = useRef(state);
  const inputRef = useRef<HTMLInputElement>(null);
  const transition = useCallback(
    (action: Parameters<typeof updateAtlasTitleEdit>[1]) => {
      const next = updateAtlasTitleEdit(stateRef.current, action);
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  useEffect(
    () => transition({ type: "sync", nodeId, title }),
    [nodeId, title, transition],
  );

  useEffect(() => {
    if (!state.editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state.editing]);

  const finish = useCallback(() => {
    const settled = commitAtlasTitleEdit(
      stateRef.current,
      t("canvas.node.untitled"),
    );
    stateRef.current = settled.state;
    setState(settled.state);
    if (settled.change)
      onTitleChange(settled.change.nodeId, settled.change.title);
  }, [onTitleChange, t]);

  const cancel = useCallback(() => {
    transition({ type: "cancel" });
  }, [transition]);

  const start = useCallback(() => {
    transition({ type: "start" });
  }, [transition]);

  const setDraft = useCallback(
    (value: string) => transition({ type: "change", value }),
    [transition],
  );

  useEffect(() => {
    if (!state.editing) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && inputRef.current?.contains(target)) return;
      finish();
    };

    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [finish, state.editing]);

  return {
    isEditing: state.editing,
    draft: state.draft,
    setDraft,
    inputRef,
    start,
    finish,
    cancel,
  };
}

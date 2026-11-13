import { useLayoutEffect, useMemo, useReducer, useRef } from "react";

import {
  createAtlasNodeDialogActions,
  reduceAtlasNodeDialogSession,
  type AtlasNodeDialogKind,
  type AtlasNodeDialogSession,
} from "@/atlas-engine/ui/node-dialog-session";

export function useAtlasNodeDialogs(project: string) {
  const [session, dispatch] = useReducer(reduceAtlasNodeDialogSession, {
    project,
    active: null,
  } satisfies AtlasNodeDialogSession);
  const projectRef = useRef(project);
  useLayoutEffect(() => {
    projectRef.current = project;
    dispatch({ type: "project", project });
  }, [project]);

  const setters = useMemo(
    () => createAtlasNodeDialogActions(() => projectRef.current, dispatch),
    [],
  );
  const active = session.project === project ? session.active : null;
  const node = (kind: AtlasNodeDialogKind) =>
    active?.kind === kind ? active.node : null;
  return {
    ...setters,
    cropNodeId: node("crop"),
    maskEditNodeId: node("mask"),
    splitNodeId: node("split"),
    upscaleNodeId: node("upscale"),
    superResolveNodeId: node("superResolve"),
    angleNodeId: node("angle"),
  };
}

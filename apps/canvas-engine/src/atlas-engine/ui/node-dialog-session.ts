export type AtlasNodeDialogKind =
  "crop" | "mask" | "split" | "upscale" | "superResolve" | "angle";

export type AtlasNodeDialogSession = {
  project: string;
  active: { kind: AtlasNodeDialogKind; node: string } | null;
};

export type AtlasNodeDialogEvent =
  | { type: "project"; project: string }
  | {
      type: "set";
      project: string;
      kind: AtlasNodeDialogKind;
      next: string | null | ((current: string | null) => string | null);
    };

/** Matches React state setters: action identity survives a change of project. */
export function createAtlasNodeDialogActions(
  currentProject: () => string,
  dispatch: (event: AtlasNodeDialogEvent) => void,
) {
  const setter =
    (kind: AtlasNodeDialogKind) =>
    (next: Extract<AtlasNodeDialogEvent, { type: "set" }>["next"]) =>
      dispatch({ type: "set", project: currentProject(), kind, next });
  return {
    setCropNodeId: setter("crop"),
    setMaskEditNodeId: setter("mask"),
    setSplitNodeId: setter("split"),
    setUpscaleNodeId: setter("upscale"),
    setSuperResolveNodeId: setter("superResolve"),
    setAngleNodeId: setter("angle"),
  };
}

export function reduceAtlasNodeDialogSession(
  session: AtlasNodeDialogSession,
  event: AtlasNodeDialogEvent,
): AtlasNodeDialogSession {
  if (event.type === "project") {
    return session.project === event.project
      ? session
      : { project: event.project, active: null };
  }
  if (event.project !== session.project) return session;
  const current =
    session.active?.kind === event.kind ? session.active.node : null;
  const next =
    typeof event.next === "function" ? event.next(current) : event.next;
  if (next === current) return session;
  return {
    project: session.project,
    active: next ? { kind: event.kind, node: next } : null,
  };
}

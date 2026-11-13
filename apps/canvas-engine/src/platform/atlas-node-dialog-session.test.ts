import { describe, expect, it } from "vitest";
import {
  createAtlasNodeDialogActions,
  reduceAtlasNodeDialogSession,
  type AtlasNodeDialogSession,
} from "@/atlas-engine/ui/node-dialog-session";

const empty: AtlasNodeDialogSession = { project: "a", active: null };

describe("node image tool sessions", () => {
  it("lets a retained callback close the current project's editor after navigating between drafts", () => {
    let project = "a";
    let session = empty;
    const actions = createAtlasNodeDialogActions(
      () => project,
      (event) => {
        session = reduceAtlasNodeDialogSession(session, event);
      },
    );
    const retainedClose = () => actions.setCropNodeId(null);
    actions.setCropNodeId("first");
    project = "b";
    session = reduceAtlasNodeDialogSession(session, {
      type: "project",
      project,
    });
    actions.setCropNodeId("second");
    retainedClose();
    expect(session).toEqual({ project: "b", active: null });
  });

  it("opens exactly one image tool and ignores a late close from another tool", () => {
    const crop = reduceAtlasNodeDialogSession(empty, {
      type: "set",
      project: "a",
      kind: "crop",
      next: "subject",
    });
    const angle = reduceAtlasNodeDialogSession(crop, {
      type: "set",
      project: "a",
      kind: "angle",
      next: "subject",
    });
    expect(angle.active).toEqual({ kind: "angle", node: "subject" });
    expect(
      reduceAtlasNodeDialogSession(angle, {
        type: "set",
        project: "a",
        kind: "crop",
        next: null,
      }),
    ).toBe(angle);
  });

  it("clears tools on project changes and refuses callbacks from a previous project", () => {
    const split = reduceAtlasNodeDialogSession(empty, {
      type: "set",
      project: "a",
      kind: "split",
      next: "subject",
    });
    const changed = reduceAtlasNodeDialogSession(split, {
      type: "project",
      project: "b",
    });
    expect(changed.active).toBeNull();
    expect(
      reduceAtlasNodeDialogSession(changed, {
        type: "set",
        project: "a",
        kind: "crop",
        next: "subject",
      }),
    ).toBe(changed);
  });

  it("supports current-state cleanup without closing an unrelated tool", () => {
    const mask = reduceAtlasNodeDialogSession(empty, {
      type: "set",
      project: "a",
      kind: "mask",
      next: "subject",
    });
    expect(
      reduceAtlasNodeDialogSession(mask, {
        type: "set",
        project: "a",
        kind: "mask",
        next: (node) => (node === "subject" ? null : node),
      }).active,
    ).toBeNull();
    expect(
      reduceAtlasNodeDialogSession(mask, {
        type: "set",
        project: "a",
        kind: "split",
        next: () => null,
      }),
    ).toBe(mask);
  });
});

import { describe, expect, it } from "vitest";

import {
  createCropEditorSession,
  transitionCropEditorSession,
} from "@/atlas-engine/surface/crop-editor-session";

const image = { width: 1600, height: 900 };

describe("crop editor session", () => {
  it("fits ratio presets and captures a fixed ratio from the current crop", () => {
    let session = createCropEditorSession();
    session = transitionCropEditorSession(session, {
      type: "choose-preset",
      preset: "16:9",
      image,
    });
    expect(
      (session.crop.width * image.width) / (session.crop.height * image.height),
    ).toBeCloseTo(16 / 9);

    session = transitionCropEditorSession(session, {
      type: "choose-preset",
      preset: "fixed",
      image,
    });
    expect(session.fixedRatio).toBeCloseTo(16 / 9);
  });

  it("applies pointer motion relative to its start and ignores unrelated pointers", () => {
    let session = createCropEditorSession();
    session = transitionCropEditorSession(session, {
      type: "begin-drag",
      drag: {
        pointerId: 7,
        mode: "move",
        handle: "se",
        start: { x: 100, y: 100 },
        stage: { width: 400, height: 200 },
      },
    });
    const ignored = transitionCropEditorSession(session, {
      type: "drag-to",
      pointerId: 9,
      point: { x: 180, y: 120 },
      image,
    });
    expect(ignored).toBe(session);

    session = transitionCropEditorSession(session, {
      type: "drag-to",
      pointerId: 7,
      point: { x: 140, y: 120 },
      image,
    });
    expect(session.crop.x).toBeCloseTo(0.22);
    expect(session.crop.y).toBeCloseTo(0.22);
  });

  it("keeps resize constraints and only ends the matching pointer gesture", () => {
    let session = transitionCropEditorSession(createCropEditorSession(), {
      type: "choose-preset",
      preset: "1:1",
      image,
    });
    session = transitionCropEditorSession(session, {
      type: "begin-drag",
      drag: {
        pointerId: 4,
        mode: "resize",
        handle: "se",
        start: { x: 0, y: 0 },
        stage: { width: 400, height: 225 },
      },
    });
    session = transitionCropEditorSession(session, {
      type: "drag-to",
      pointerId: 4,
      point: { x: 20, y: 15 },
      image,
    });
    expect(session.crop.width / session.crop.height).toBeCloseTo(0.5625);
    expect(
      transitionCropEditorSession(session, { type: "end-drag", pointerId: 3 })
        .drag,
    ).not.toBeNull();
    session = transitionCropEditorSession(session, {
      type: "end-drag",
      pointerId: 4,
    });
    expect(session.drag).toBeNull();
  });

  it("supports keyboard nudge and a full session reset", () => {
    let session = transitionCropEditorSession(createCropEditorSession(), {
      type: "nudge",
      direction: "right",
      coarse: true,
    });
    expect(session.crop.x).toBeCloseTo(0.17);
    session = transitionCropEditorSession(session, { type: "reset" });
    expect(session).toEqual(createCropEditorSession());
  });
});

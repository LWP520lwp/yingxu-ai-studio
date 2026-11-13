import {
  ATLAS_DEFAULT_CROP,
  fitAtlasCropRatio,
  moveAtlasCrop,
  nudgeAtlasCrop,
  resizeAtlasCrop,
  resolveAtlasCropRatio,
  type AtlasCropHandle,
  type AtlasCropRect,
  type AtlasEditorPoint,
  type AtlasImageSize,
} from "./image-editing-geometry";

export type CropEditorDrag = Readonly<{
  pointerId: number;
  mode: "move" | "resize";
  handle: AtlasCropHandle;
  start: AtlasEditorPoint;
  crop: AtlasCropRect;
  stage: AtlasImageSize;
}>;

export type CropEditorSession = Readonly<{
  crop: AtlasCropRect;
  preset: string;
  fixedRatio: number | null;
  drag: CropEditorDrag | null;
}>;

export type CropEditorAction =
  | { type: "reset" }
  | { type: "choose-preset"; preset: string; image: AtlasImageSize | null }
  | { type: "begin-drag"; drag: Omit<CropEditorDrag, "crop"> }
  | {
      type: "drag-to";
      pointerId: number;
      point: AtlasEditorPoint;
      image: AtlasImageSize | null;
    }
  | { type: "end-drag"; pointerId: number }
  | {
      type: "nudge";
      direction: "up" | "down" | "left" | "right";
      coarse: boolean;
    };

export function createCropEditorSession(): CropEditorSession {
  return {
    crop: ATLAS_DEFAULT_CROP,
    preset: "free",
    fixedRatio: null,
    drag: null,
  };
}

export function transitionCropEditorSession(
  session: CropEditorSession,
  action: CropEditorAction,
): CropEditorSession {
  switch (action.type) {
    case "reset":
      return createCropEditorSession();
    case "choose-preset": {
      const pixelRatio = action.image
        ? (session.crop.width * action.image.width) /
          Math.max(1, session.crop.height * action.image.height)
        : null;
      const fixedRatio = action.preset === "fixed" ? pixelRatio : null;
      const ratio = resolveAtlasCropRatio(
        action.preset,
        action.image,
        fixedRatio,
      );
      return {
        ...session,
        preset: action.preset,
        fixedRatio,
        drag: null,
        crop:
          ratio && action.image
            ? fitAtlasCropRatio(session.crop, ratio, action.image)
            : session.crop,
      };
    }
    case "begin-drag":
      return {
        ...session,
        drag: { ...action.drag, crop: session.crop },
      };
    case "drag-to": {
      const drag = session.drag;
      if (!drag || drag.pointerId !== action.pointerId) return session;
      const dx = (action.point.x - drag.start.x) / drag.stage.width;
      const dy = (action.point.y - drag.start.y) / drag.stage.height;
      const crop =
        drag.mode === "move"
          ? moveAtlasCrop(drag.crop, dx, dy)
          : resizeAtlasCrop(
              drag.crop,
              dx,
              dy,
              drag.handle,
              resolveAtlasCropRatio(
                session.preset,
                action.image,
                session.fixedRatio,
              ),
              drag.stage,
            );
      return crop === session.crop ? session : { ...session, crop };
    }
    case "end-drag":
      return session.drag?.pointerId === action.pointerId
        ? { ...session, drag: null }
        : session;
    case "nudge":
      return {
        ...session,
        crop: nudgeAtlasCrop(session.crop, action.direction, action.coarse),
      };
  }
}

import {
  appendMaskStrokePoint,
  createMaskStroke,
  type MaskDrawMode,
  type MaskPoint,
  type MaskStroke,
} from "@/lib/canvas/mask-stroke-history";

export type MaskPointerSession = {
  pointerId: number;
  stroke: MaskStroke;
};

export type MaskPointerEnd = "up" | "cancel";

export function beginMaskPointerSession(
  pointerId: number,
  mode: MaskDrawMode,
  size: number,
  point?: MaskPoint,
): MaskPointerSession {
  const stroke = createMaskStroke(mode, size);
  if (point) appendMaskStrokePoint(stroke, point);
  return { pointerId, stroke };
}

export function appendMaskPointerSessionPoint(
  session: MaskPointerSession | null,
  pointerId: number,
  point: MaskPoint,
) {
  if (!session || session.pointerId !== pointerId) return false;
  return appendMaskStrokePoint(session.stroke, point);
}

export function finishMaskPointerSession(
  session: MaskPointerSession | null,
  pointerId: number,
  end: MaskPointerEnd,
  finalPoint?: MaskPoint,
): { session: MaskPointerSession | null; stroke: MaskStroke | null } {
  if (!session || session.pointerId !== pointerId) {
    return { session, stroke: null };
  }
  if (end === "up" && finalPoint) {
    appendMaskStrokePoint(session.stroke, finalPoint, true);
  }
  return {
    session: null,
    stroke: session.stroke.points.length ? session.stroke : null,
  };
}

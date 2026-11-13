import {
  appendAtlasMaskPoint,
  createAtlasMaskStroke,
  type AtlasMaskDrawMode,
  type AtlasMaskPoint,
  type AtlasMaskStroke,
} from "@/atlas-engine/workflows/mask-strokes";

export type AtlasMaskPointerSession = {
  pointerId: number;
  stroke: AtlasMaskStroke;
};
export type AtlasMaskPointerEnd = "up" | "cancel";

export function beginAtlasMaskPointer(
  pointerId: number,
  mode: AtlasMaskDrawMode,
  size: number,
  point?: AtlasMaskPoint,
): AtlasMaskPointerSession {
  const stroke = createAtlasMaskStroke(mode, size);
  if (point) appendAtlasMaskPoint(stroke, point);
  return { pointerId, stroke };
}

export function appendAtlasMaskPointerPoint(
  session: AtlasMaskPointerSession | null,
  pointerId: number,
  point: AtlasMaskPoint,
): boolean {
  return Boolean(
    session &&
      session.pointerId === pointerId &&
      appendAtlasMaskPoint(session.stroke, point),
  );
}

export function finishAtlasMaskPointer(
  session: AtlasMaskPointerSession | null,
  pointerId: number,
  end: AtlasMaskPointerEnd,
  finalPoint?: AtlasMaskPoint,
): { session: AtlasMaskPointerSession | null; stroke: AtlasMaskStroke | null } {
  if (!session || session.pointerId !== pointerId) {
    return { session, stroke: null };
  }
  if (end === "up" && finalPoint) {
    appendAtlasMaskPoint(session.stroke, finalPoint, true);
  }
  return {
    session: null,
    stroke: session.stroke.points.length ? session.stroke : null,
  };
}

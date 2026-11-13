export type AtlasConnectionSide = "top" | "right" | "bottom" | "left";
export type AtlasConnectionBox = Readonly<{ x: number; y: number; width: number; height: number }>;
export type AtlasConnectionPoint = Readonly<{ x: number; y: number }>;

export type AtlasConnectionRoute = Readonly<{
  path: string;
  start: AtlasConnectionPoint;
  control1: AtlasConnectionPoint;
  control2: AtlasConnectionPoint;
  end: AtlasConnectionPoint;
  startSide: AtlasConnectionSide;
  endSide: AtlasConnectionSide;
}>;

const CENTER_BIAS = 0.72;

function center(box: AtlasConnectionBox): AtlasConnectionPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function sidePoint(box: AtlasConnectionBox, side: AtlasConnectionSide): AtlasConnectionPoint {
  const middle = center(box);
  switch (side) {
    case "top": return { x: middle.x, y: box.y };
    case "right": return { x: box.x + box.width, y: middle.y };
    case "bottom": return { x: middle.x, y: box.y + box.height };
    case "left": return { x: box.x, y: middle.y };
  }
}

function facingSide(from: AtlasConnectionPoint, to: AtlasConnectionPoint): AtlasConnectionSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) * CENTER_BIAS) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function outwardVector(side: AtlasConnectionSide): AtlasConnectionPoint {
  switch (side) {
    case "top": return { x: 0, y: -1 };
    case "right": return { x: 1, y: 0 };
    case "bottom": return { x: 0, y: 1 };
    case "left": return { x: -1, y: 0 };
  }
}

function curveBetween(
  start: AtlasConnectionPoint,
  startSide: AtlasConnectionSide,
  end: AtlasConnectionPoint,
  endSide: AtlasConnectionSide,
): AtlasConnectionRoute {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const reach = Math.max(36, Math.min(240, distance * 0.42));
  const a = outwardVector(startSide);
  const b = outwardVector(endSide);
  const control1 = { x: start.x + a.x * reach, y: start.y + a.y * reach };
  const control2 = { x: end.x + b.x * reach, y: end.y + b.y * reach };
  return {
    start,
    control1,
    control2,
    end,
    startSide,
    endSide,
    path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`,
  };
}

export function routeCanvasConnection(source: AtlasConnectionBox, target: AtlasConnectionBox): AtlasConnectionRoute {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const startSide = facingSide(sourceCenter, targetCenter);
  const endSide = facingSide(targetCenter, sourceCenter);
  return curveBetween(sidePoint(source, startSide), startSide, sidePoint(target, endSide), endSide);
}

export function routeConnectionPreview(
  node: AtlasConnectionBox,
  handle: "source" | "target",
  pointer: AtlasConnectionPoint,
): AtlasConnectionRoute {
  const nodeSide: AtlasConnectionSide = handle === "source" ? "right" : "left";
  const nodeAnchor = sidePoint(node, nodeSide);
  const pointerSide = facingSide(pointer, nodeAnchor);
  const pointerAnchor = pointer;
  return handle === "source"
    ? curveBetween(nodeAnchor, nodeSide, pointerAnchor, pointerSide)
    : curveBetween(pointerAnchor, pointerSide, nodeAnchor, nodeSide);
}

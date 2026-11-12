export type ThemeRevealShape =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "rectangle"
  | "star";

type Point = { x: number; y: number };

export function themeRevealPaths(
  shape: ThemeRevealShape,
  x: number,
  y: number,
  width: number,
  height: number,
): [string, string] {
  const origin = { x: finite(x), y: finite(y) };
  const viewWidth = Math.max(1, finite(width));
  const viewHeight = Math.max(1, finite(height));
  const radius = Math.hypot(
    Math.max(origin.x, viewWidth - origin.x),
    Math.max(origin.y, viewHeight - origin.y),
  );

  if (shape === "circle") {
    return [
      `circle(0px at ${origin.x}px ${origin.y}px)`,
      `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
    ];
  }

  const sides: Record<Exclude<ThemeRevealShape, "circle" | "rectangle" | "star">, number> = {
    square: 4,
    triangle: 3,
    diamond: 4,
    hexagon: 6,
  };
  const vertices = shape === "rectangle"
    ? rectangleVertices(origin, viewWidth, viewHeight)
    : shape === "star"
      ? starVertices(origin, radius * 1.5)
      : regularVertices(
          origin,
          radius / Math.cos(Math.PI / sides[shape]),
          sides[shape],
          shape === "square" ? -Math.PI / 4 : -Math.PI / 2,
        );
  const collapsed = vertices.map(() => origin);
  return [polygon(collapsed), polygon(vertices)];
}

function regularVertices(center: Point, radius: number, sides: number, rotation: number) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / sides;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

function starVertices(center: Point, outerRadius: number) {
  const innerRadius = outerRadius * 0.43;
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

function rectangleVertices(center: Point, width: number, height: number) {
  const halfWidth = Math.max(center.x, width - center.x);
  const halfHeight = Math.max(center.y, height - center.y);
  return [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
  ];
}

function polygon(points: Point[]) {
  return `polygon(${points.map(({ x, y }) => `${round(x)}px ${round(y)}px`).join(", ")})`;
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

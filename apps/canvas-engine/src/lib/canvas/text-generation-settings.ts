export const REASONING_EFFORTS = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortOption = (typeof REASONING_EFFORTS)[number];

export type TextSettingsPlacement =
  "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";

export type TextSettingsRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type TextSettingsPopoverPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function normalizeReasoningEffort(
  value: string | null | undefined,
): ReasoningEffortOption {
  return REASONING_EFFORTS.includes(value as ReasoningEffortOption)
    ? (value as ReasoningEffortOption)
    : "auto";
}

export function clampTextGenerationCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count)
    ? Math.min(15, Math.max(1, Math.round(count)))
    : 1;
}

export function placeTextSettingsPopover(
  anchor: TextSettingsRect,
  viewport: { width: number; height: number },
  placement: TextSettingsPlacement,
  desired = { width: 356, height: 260, margin: 12, gap: 8 },
): TextSettingsPopoverPosition {
  const margin = Math.max(0, Math.min(desired.margin, viewport.width / 4));
  const width = Math.max(
    1,
    Math.min(desired.width, viewport.width - margin * 2),
  );
  const maxHeight = Math.max(
    1,
    Math.min(desired.height, viewport.height - margin * 2),
  );
  const rightAligned = placement.endsWith("Right");
  const centered = placement === "top" || placement === "bottom";
  const preferredLeft = centered
    ? anchor.left + anchor.width / 2 - width / 2
    : rightAligned
      ? anchor.right - width
      : anchor.left;
  const left = clamp(
    preferredLeft,
    margin,
    Math.max(margin, viewport.width - width - margin),
  );

  const above = Math.max(0, anchor.top - desired.gap - margin);
  const below = Math.max(
    0,
    viewport.height - anchor.bottom - desired.gap - margin,
  );
  const preferAbove = placement.startsWith("top");
  const opensAbove = preferAbove
    ? above >= Math.min(maxHeight, 160) || above > below
    : below < Math.min(maxHeight, 160) && above > below;
  const available = opensAbove ? above : below;
  const height = Math.max(1, Math.min(maxHeight, available || maxHeight));
  const preferredTop = opensAbove
    ? anchor.top - desired.gap - height
    : anchor.bottom + desired.gap;
  const top = clamp(
    preferredTop,
    margin,
    Math.max(margin, viewport.height - height - margin),
  );

  return { left, top, width, maxHeight: height };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type ResourceMention = { start: number; query: string };
export type MentionTextPart = { text: string; highlighted: boolean };
export type MentionMenuBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type MentionMenuPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function findResourceMention(
  value: string,
  cursor: number,
): ResourceMention | null {
  const safeCursor = Math.min(value.length, Math.max(0, cursor));
  const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, safeCursor));
  return match
    ? { start: safeCursor - match[2].length - 1, query: match[2] }
    : null;
}

export function activeResourceMentionLabels(
  references: readonly CanvasResourceReference[],
): string[] {
  return Array.from(
    new Set(references.filter((item) => item.active).map((item) => item.label)),
  )
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

export function searchResourceMentions(
  references: readonly CanvasResourceReference[],
  query: string,
): CanvasResourceReference[] {
  const active = references.filter((item) => item.active);
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return active;

  return active.filter((item) =>
    [item.label, item.title, item.kind, item.text || ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export function insertResourceMention(
  value: string,
  mention: ResourceMention,
  selectionStart: number,
  label: string,
): { value: string; caret: number } {
  const start = Math.min(value.length, Math.max(0, mention.start));
  const end = Math.min(value.length, Math.max(start, selectionStart));
  const text = `${label} `;
  const existingSeparator = value.slice(end).startsWith(" ") ? 1 : 0;
  return {
    value: `${value.slice(0, start)}${text}${value.slice(end + existingSeparator)}`,
    caret: start + text.length,
  };
}

export function createResourceMentionTextSplitter(labels: readonly string[]) {
  const orderedLabels = [...new Set(labels.filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  if (!orderedLabels.length) {
    return (value: string): MentionTextPart[] => [
      { text: value, highlighted: false },
    ];
  }

  const expression = new RegExp(
    `(${orderedLabels.map(escapeRegExp).join("|")})`,
    "g",
  );
  const labelSet = new Set(orderedLabels);
  return (value: string): MentionTextPart[] =>
    value.split(expression).map((text) => ({
      text,
      highlighted: labelSet.has(text),
    }));
}

export function splitResourceMentionText(
  value: string,
  labels: readonly string[],
): MentionTextPart[] {
  return createResourceMentionTextSplitter(labels)(value);
}

export function deleteAdjacentResourceMention(
  value: string,
  caret: number,
  direction: "backward" | "forward",
  labels: readonly string[],
): { value: string; caret: number } | null {
  const safeCaret = Math.min(value.length, Math.max(0, caret));
  const orderedLabels = [...new Set(labels.filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );

  if (direction === "backward") {
    const before = value.slice(0, safeCaret);
    const end = before.trimEnd().length;
    for (const label of orderedLabels) {
      const start = end - label.length;
      if (
        start < 0 ||
        before.slice(start, end) !== label ||
        (start > 0 && !/\s/.test(before[start - 1]))
      )
        continue;
      return {
        value: value.slice(0, start) + value.slice(safeCaret),
        caret: start,
      };
    }
    return null;
  }

  if (safeCaret > 0 && !/\s/.test(value[safeCaret - 1])) return null;
  const after = value.slice(safeCaret);
  let start = 0;
  while (start < after.length && /\s/.test(after[start])) start += 1;
  for (const label of orderedLabels) {
    const end = start + label.length;
    if (
      after.slice(start, end) !== label ||
      (end < after.length && !/\s/.test(after[end]))
    )
      continue;
    return {
      value: value.slice(0, safeCaret) + value.slice(safeCaret + end),
      caret: safeCaret,
    };
  }
  return null;
}

export function placeResourceMentionMenu(
  caret: { left: number; top: number; lineHeight: number },
  bounds: MentionMenuBounds,
  options: {
    width?: number;
    height?: number;
    gap?: number;
    padding?: number;
  } = {},
): MentionMenuPlacement {
  const desiredWidth = Math.max(1, options.width ?? 256);
  const desiredHeight = Math.max(1, options.height ?? 224);
  const gap = Math.max(0, options.gap ?? 6);
  const padding = Math.max(0, options.padding ?? 8);
  const boundWidth = Math.max(1, bounds.right - bounds.left - padding * 2);
  const boundHeight = Math.max(1, bounds.bottom - bounds.top - padding * 2);
  const width = Math.min(desiredWidth, boundWidth);
  const maxHeight = Math.min(desiredHeight, boundHeight);
  const above = Math.max(0, caret.top - bounds.top - gap - padding);
  const below = Math.max(
    0,
    bounds.bottom - caret.top - caret.lineHeight - gap - padding,
  );
  const openAbove = below < maxHeight && above > below;
  const availableHeight = openAbove ? above : below;
  const height = Math.max(1, Math.min(maxHeight, availableHeight || maxHeight));
  const maxLeft = Math.max(
    bounds.left + padding,
    bounds.right - width - padding,
  );
  const left = clamp(caret.left, bounds.left + padding, maxLeft);
  const desiredTop = openAbove
    ? caret.top - gap - height
    : caret.top + caret.lineHeight + gap;
  const maxTop = Math.max(
    bounds.top + padding,
    bounds.bottom - height - padding,
  );
  const top = clamp(desiredTop, bounds.top + padding, maxTop);
  return { left, top, width, maxHeight: height };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

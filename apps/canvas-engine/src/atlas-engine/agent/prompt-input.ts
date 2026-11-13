import type { CanvasResourceReference } from "@/atlas-engine/model/resource-references";

export type PromptInputToken =
  { type: "text"; value: string } | { type: "reference"; label: string };

export type PromptMenuAnchor = Pick<
  DOMRect,
  "left" | "right" | "top" | "bottom"
>;
export type PromptMenuViewport = { width: number; height: number };
export type PromptMenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

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

export type PromptChipKeyAction =
  | "composing"
  | "move-forward"
  | "move-backward"
  | "choose"
  | "close"
  | "remove-token"
  | "submit"
  | "refresh";

export type PromptReferenceIndex = {
  active: CanvasResourceReference[];
  byToken: Map<string, CanvasResourceReference>;
  tokens: string[];
};

const BLOCK_TAGS = new Set([
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "OL",
  "P",
  "PRE",
  "UL",
]);

function uniqueLabels(labels: readonly string[]) {
  return [...new Set(labels.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
}

function labelExpression(labels: readonly string[]) {
  return new RegExp(
    `(${uniqueLabels(labels).map(escapeRegExp).join("|")})`,
    "g",
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function parsePromptInputTokens(
  value: string,
  labels: readonly string[],
): PromptInputToken[] {
  const ordered = uniqueLabels(labels);
  if (!ordered.length) return value ? [{ type: "text", value }] : [];

  const result: PromptInputToken[] = [];
  let cursor = 0;
  let textStart = 0;
  while (cursor < value.length) {
    const label = ordered.find((candidate) =>
      value.startsWith(candidate, cursor),
    );
    if (!label) {
      cursor += 1;
      continue;
    }
    if (cursor > textStart)
      result.push({ type: "text", value: value.slice(textStart, cursor) });
    result.push({ type: "reference", label });
    cursor += label.length;
    textStart = cursor;
  }
  if (textStart < value.length)
    result.push({ type: "text", value: value.slice(textStart) });
  return result;
}

export function mentionQueryBeforeCaret(text: string): string | null {
  const at = text.lastIndexOf("@");
  if (at < 0) return null;
  const query = text.slice(at + 1);
  return /[\s@]/.test(query) ? null : query;
}

export function promptMenuPosition(
  anchor: PromptMenuAnchor,
  viewport: PromptMenuViewport,
  desired = { width: 256, height: 224, gutter: 8, gap: 6 },
): PromptMenuPosition {
  const gutter = Math.min(desired.gutter, Math.max(1, viewport.width / 4));
  const width = Math.max(
    1,
    Math.min(desired.width, viewport.width - gutter * 2),
  );
  const heightLimit = Math.max(
    1,
    Math.min(desired.height, viewport.height - gutter * 2),
  );
  const below = Math.max(
    0,
    viewport.height - anchor.bottom - desired.gap - gutter,
  );
  const above = Math.max(0, anchor.top - desired.gap - gutter);
  const opensAbove = below < Math.min(heightLimit, 120) && above > below;
  const available = opensAbove ? above : below;
  const height = Math.max(1, Math.min(heightLimit, available || heightLimit));
  const left = clamp(
    anchor.left,
    gutter,
    Math.max(gutter, viewport.width - width - gutter),
  );
  const intendedTop = opensAbove
    ? anchor.top - desired.gap - height
    : anchor.bottom + desired.gap;
  const top = clamp(
    intendedTop,
    gutter,
    Math.max(gutter, viewport.height - height - gutter),
  );
  return { left, top, width, maxHeight: height };
}

export function serializePromptContents(root: Pick<ParentNode, "childNodes">) {
  const children = Array.from(root.childNodes);
  if (children.length === 1 && isPlaceholderBreak(children[0])) return "";
  return serializeChildren(children).replace(/\uFEFF/g, "");
}

function serializeChildren(children: readonly Node[]): string {
  if (children.length === 1 && isPlaceholderBreak(children[0])) return "";
  let output = "";
  let previousBlock = false;
  for (const node of children) {
    if (node.nodeType === 3) {
      if (previousBlock && output && !output.endsWith("\n")) output += "\n";
      output += node.textContent || "";
      previousBlock = false;
      continue;
    }
    if (node.nodeType !== 1) continue;

    const element = node as HTMLElement;
    if (element.dataset.refLabel) {
      if (previousBlock && output && !output.endsWith("\n")) output += "\n";
      output += element.dataset.refLabel;
      previousBlock = false;
      continue;
    }
    if (element.tagName === "BR") {
      output += "\n";
      previousBlock = false;
      continue;
    }

    const block = BLOCK_TAGS.has(element.tagName);
    if ((block || previousBlock) && output && !output.endsWith("\n"))
      output += "\n";
    output += serializeChildren(Array.from(element.childNodes));
    previousBlock = block;
  }
  return output;
}

function isPlaceholderBreak(node: Node) {
  if (node.nodeType !== 1) return false;
  const element = node as HTMLElement;
  if (element.tagName === "BR") return true;
  return (
    BLOCK_TAGS.has(element.tagName) &&
    element.childNodes.length === 1 &&
    element.firstChild?.nodeType === 1 &&
    (element.firstChild as HTMLElement).tagName === "BR"
  );
}

export function findResourceMention(
  value: string,
  cursor: number,
): ResourceMention | null {
  const end = Math.min(value.length, Math.max(0, cursor));
  const at = value.lastIndexOf("@", end - 1);
  if (at < 0 || (at > 0 && !/\s/.test(value[at - 1]))) return null;
  const query = value.slice(at + 1, end);
  return /[\s@]/.test(query) ? null : { start: at, query };
}

export function activeResourceMentionLabels(
  references: readonly CanvasResourceReference[],
) {
  return uniqueLabels(
    references.filter((item) => item.active).map((item) => item.label),
  );
}

export function searchResourceMentions(
  references: readonly CanvasResourceReference[],
  query: string,
) {
  const active = references.filter((item) => item.active);
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return active;
  return active.filter((item) =>
    [item.label, item.title, item.kind, item.text || ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
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
  const insertion = `${label} `;
  const trimSpace = value.slice(end).startsWith(" ") ? 1 : 0;
  return {
    value: value.slice(0, start) + insertion + value.slice(end + trimSpace),
    caret: start + insertion.length,
  };
}

export function createResourceMentionTextSplitter(labels: readonly string[]) {
  const ordered = uniqueLabels(labels);
  if (!ordered.length)
    return (value: string): MentionTextPart[] => [
      { text: value, highlighted: false },
    ];
  const expression = labelExpression(ordered);
  const set = new Set(ordered);
  return (value: string): MentionTextPart[] =>
    value
      .split(expression)
      .map((text) => ({ text, highlighted: set.has(text) }));
}

export function splitResourceMentionText(
  value: string,
  labels: readonly string[],
) {
  return createResourceMentionTextSplitter(labels)(value);
}

export function deleteAdjacentResourceMention(
  value: string,
  caret: number,
  direction: "backward" | "forward",
  labels: readonly string[],
): { value: string; caret: number } | null {
  const point = Math.min(value.length, Math.max(0, caret));
  const ordered = uniqueLabels(labels);
  if (direction === "backward") {
    const prefix = value.slice(0, point);
    const end = prefix.trimEnd().length;
    for (const label of ordered) {
      const start = end - label.length;
      if (
        start < 0 ||
        prefix.slice(start, end) !== label ||
        (start > 0 && !/\s/.test(prefix[start - 1]))
      )
        continue;
      return {
        value: value.slice(0, start) + value.slice(point),
        caret: start,
      };
    }
    return null;
  }

  if (point > 0 && !/\s/.test(value[point - 1])) return null;
  const suffix = value.slice(point);
  let start = 0;
  while (start < suffix.length && /\s/.test(suffix[start])) start += 1;
  for (const label of ordered) {
    const end = start + label.length;
    if (
      suffix.slice(start, end) !== label ||
      (end < suffix.length && !/\s/.test(suffix[end]))
    )
      continue;
    return {
      value: value.slice(0, point) + value.slice(point + end),
      caret: point,
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
  const widthLimit = Math.max(1, options.width ?? 256);
  const heightLimit = Math.max(1, options.height ?? 224);
  const gap = Math.max(0, options.gap ?? 6);
  const padding = Math.max(0, options.padding ?? 8);
  const boundWidth = Math.max(1, bounds.right - bounds.left - padding * 2);
  const boundHeight = Math.max(1, bounds.bottom - bounds.top - padding * 2);
  const width = Math.min(widthLimit, boundWidth);
  const cap = Math.min(heightLimit, boundHeight);
  const above = Math.max(0, caret.top - bounds.top - gap - padding);
  const below = Math.max(
    0,
    bounds.bottom - caret.top - caret.lineHeight - gap - padding,
  );
  const openAbove = below < cap && above > below;
  const available = openAbove ? above : below;
  const maxHeight = Math.max(1, Math.min(cap, available || cap));
  const minLeft = bounds.left + padding;
  const left = clamp(
    caret.left,
    minLeft,
    Math.max(minLeft, bounds.right - width - padding),
  );
  const desiredTop = openAbove
    ? caret.top - gap - maxHeight
    : caret.top + caret.lineHeight + gap;
  const minTop = bounds.top + padding;
  const top = clamp(
    desiredTop,
    minTop,
    Math.max(minTop, bounds.bottom - maxHeight - padding),
  );
  return { left, top, width, maxHeight };
}

export function indexPromptReferences(
  references: readonly CanvasResourceReference[],
): PromptReferenceIndex {
  const active = references.filter((reference) => reference.active);
  const byToken = new Map<string, CanvasResourceReference>();
  for (const reference of active)
    byToken.set(reference.valueToken || reference.label, reference);
  return {
    active,
    byToken,
    tokens: [...byToken.keys()].sort((a, b) => b.length - a.length),
  };
}

export function findPromptReferences(
  references: readonly CanvasResourceReference[],
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...references];
  return references.filter((reference) =>
    [reference.label, reference.title, reference.kind, reference.text || ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
}

export function getPromptChipKeyAction(input: {
  key: string;
  composing: boolean;
  hasMentionChoices: boolean;
  adjacentToken: boolean;
  plainEnter: boolean;
  canSubmit: boolean;
}): PromptChipKeyAction {
  if (input.composing) return "composing";
  if (input.hasMentionChoices) {
    if (input.key === "ArrowDown") return "move-forward";
    if (input.key === "ArrowUp") return "move-backward";
    if (input.key === "Enter") return "choose";
    if (input.key === "Escape") return "close";
  }
  if (
    (input.key === "Backspace" || input.key === "Delete") &&
    input.adjacentToken
  )
    return "remove-token";
  return input.plainEnter && input.canSubmit ? "submit" : "refresh";
}

export function movePromptChoice(
  index: number,
  direction: -1 | 1,
  length: number,
) {
  if (length < 1) return 0;
  const current = Math.max(0, Math.min(Math.trunc(index), length - 1));
  return (current + direction + length) % length;
}

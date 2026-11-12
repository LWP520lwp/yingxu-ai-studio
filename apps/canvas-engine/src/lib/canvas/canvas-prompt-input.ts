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

export function parsePromptInputTokens(
  value: string,
  labels: readonly string[],
): PromptInputToken[] {
  const orderedLabels = [...new Set(labels.filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  if (!orderedLabels.length) return value ? [{ type: "text", value }] : [];

  const pattern = new RegExp(
    `(${orderedLabels.map(escapeRegExp).join("|")})`,
    "g",
  );
  const tokens: PromptInputToken[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    if (index === undefined) continue;
    if (index > cursor)
      tokens.push({ type: "text", value: value.slice(cursor, index) });
    tokens.push({ type: "reference", label: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < value.length)
    tokens.push({ type: "text", value: value.slice(cursor) });
  return tokens;
}

export function mentionQueryBeforeCaret(text: string): string | null {
  const match = /@([^\s@]*)$/.exec(text);
  return match ? match[1] || "" : null;
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
  const maxHeight = Math.max(
    1,
    Math.min(desired.height, viewport.height - gutter * 2),
  );
  const below = Math.max(
    0,
    viewport.height - anchor.bottom - desired.gap - gutter,
  );
  const above = Math.max(0, anchor.top - desired.gap - gutter);
  const opensAbove = below < Math.min(maxHeight, 120) && above > below;
  const available = opensAbove ? above : below;
  const height = Math.max(1, Math.min(maxHeight, available || maxHeight));
  const maxLeft = Math.max(gutter, viewport.width - width - gutter);
  const left = clamp(anchor.left, gutter, maxLeft);
  const preferredTop = opensAbove
    ? anchor.top - desired.gap - height
    : anchor.bottom + desired.gap;
  const maxTop = Math.max(gutter, viewport.height - height - gutter);
  const top = clamp(preferredTop, gutter, maxTop);
  return { left, top, width, maxHeight: height };
}

export function serializePromptContents(root: Pick<ParentNode, "childNodes">) {
  const children = Array.from(root.childNodes);
  if (children.length === 1 && isPlaceholderBreak(children[0])) return "";
  return serializeChildren(children).replace(/\uFEFF/g, "");
}

function serializeChildren(children: readonly Node[]) {
  if (children.length === 1 && isPlaceholderBreak(children[0])) return "";
  let result = "";
  let previousWasBlock = false;

  for (const node of children) {
    if (node.nodeType === 3) {
      if (previousWasBlock && result && !result.endsWith("\n")) result += "\n";
      result += node.textContent || "";
      previousWasBlock = false;
      continue;
    }
    if (node.nodeType !== 1) continue;

    const element = node as HTMLElement;
    if (element.dataset.refLabel) {
      if (previousWasBlock && result && !result.endsWith("\n")) result += "\n";
      result += element.dataset.refLabel;
      previousWasBlock = false;
      continue;
    }
    if (element.tagName === "BR") {
      result += "\n";
      previousWasBlock = false;
      continue;
    }

    const isBlock = BLOCK_TAGS.has(element.tagName);
    if (isBlock && result && !result.endsWith("\n")) result += "\n";
    else if (previousWasBlock && result && !result.endsWith("\n"))
      result += "\n";

    result += serializeChildren(Array.from(element.childNodes));
    previousWasBlock = isBlock;
  }

  return result;
}

function isPlaceholderBreak(node: Node) {
  if (node.nodeType === 1 && (node as HTMLElement).tagName === "BR")
    return true;
  if (node.nodeType !== 1) return false;
  const element = node as HTMLElement;
  return (
    BLOCK_TAGS.has(element.tagName) &&
    element.childNodes.length === 1 &&
    element.firstChild?.nodeType === 1 &&
    (element.firstChild as HTMLElement).tagName === "BR"
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

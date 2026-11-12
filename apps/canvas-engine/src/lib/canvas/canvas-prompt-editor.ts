import { canvasThemes } from "@/lib/canvas-theme";
import {
  mentionQueryBeforeCaret,
  serializePromptContents,
  type PromptInputToken,
} from "@/lib/canvas/canvas-prompt-input";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type PromptEditorTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type PromptEditorContext = {
  referenceByLabel: ReadonlyMap<string, CanvasResourceReference>;
  theme: PromptEditorTheme;
  onImagePreview: (url: string) => void;
};

export type PromptMentionContext = {
  query: string;
  rect: DOMRect | null;
};

export class CanvasPromptEditorController {
  private context: PromptEditorContext;

  constructor(
    readonly element: HTMLDivElement,
    context: PromptEditorContext,
  ) {
    this.context = context;
  }

  updateContext(context: PromptEditorContext) {
    this.context = context;
  }

  render(tokens: readonly PromptInputToken[]) {
    const { element } = this;
    element.replaceChildren();

    for (const token of tokens) {
      if (token.type === "text") {
        element.append(document.createTextNode(token.value));
        continue;
      }

      const reference = this.context.referenceByLabel.get(token.label);
      element.append(
        reference
          ? this.createChip(reference)
          : document.createTextNode(token.label),
      );
    }
  }

  serialize() {
    return serializePromptContents(this.element);
  }

  mentionAtCaret(): PromptMentionContext | null {
    const position = textPositionAtCaret(this.element);
    if (!position) return null;
    const query = mentionQueryBeforeCaret(
      position.node.data.slice(0, position.offset),
    );
    return query === null ? null : { query, rect: caretRect(this.element) };
  }

  hasAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!this.element.contains(range.commonAncestorContainer)) return false;
    return Boolean(adjacentReferenceNode(range, key));
  }

  deleteAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!this.element.contains(range.commonAncestorContainer)) return false;
    const target = adjacentReferenceNode(range, key);
    if (!target) return false;

    const caretNode = document.createTextNode("");
    target.replaceWith(caretNode);
    range.setStart(caretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  insertReference(reference: CanvasResourceReference) {
    this.removeActiveMention();
    const chip = this.createChip(reference);
    const spacer = document.createTextNode(" ");
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

    if (range && this.element.contains(range.commonAncestorContainer)) {
      range.insertNode(spacer);
      range.insertNode(chip);
      range.setStartAfter(spacer);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      this.element.append(chip, spacer);
      placeCaretAtEnd(this.element);
    }
  }

  private createChip(reference: CanvasResourceReference) {
    const { theme, onImagePreview } = this.context;
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.refLabel = reference.label;
    chip.setAttribute("aria-label", `${reference.label}: ${reference.title}`);

    if (reference.kind === "image" && reference.previewUrl) {
      const image = document.createElement("img");
      image.src = reference.previewUrl;
      image.alt = reference.title;
      image.className = "size-6 rounded object-cover";
      chip.className =
        "mx-px inline-flex size-6 items-center justify-center overflow-hidden rounded align-middle";
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onImagePreview(reference.previewUrl || "");
      });
      chip.append(image);
      return chip;
    }

    chip.className =
      "mx-px inline-flex h-6 max-w-40 items-center justify-center overflow-hidden rounded-md border px-1 text-xs leading-none align-middle";
    Object.assign(chip.style, {
      background: theme.toolbar.panel,
      borderColor: theme.node.stroke,
      color: theme.node.text,
    });
    chip.title = reference.text || reference.title;

    const text = document.createElement("span");
    text.className = "block truncate";
    text.textContent =
      reference.kind === "text"
        ? reference.text || reference.title
        : reference.label;
    chip.append(text);
    return chip;
  }

  private removeActiveMention() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!this.element.contains(range.commonAncestorContainer)) return;

    const position = textPositionAtCaret(this.element, range);
    if (!position) return;
    const { node: textNode, offset } = position;
    const prefix = textNode.data.slice(0, offset);
    const match = /@([^\s@]*)$/.exec(prefix);
    if (!match) return;

    range.setStart(textNode, offset - match[0].length);
    range.deleteContents();
  }
}

function adjacentReferenceNode(range: Range, key: string) {
  const container = range.startContainer;
  const offset = range.startOffset;
  const previous = key === "Backspace";
  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent || "";
    if ((previous && offset > 0) || (!previous && offset < text.length))
      return null;
    return findReferenceSibling(container, previous);
  }

  const children = Array.from(container.childNodes);
  return findReferenceSibling(
    children[previous ? offset - 1 : offset] || container,
    previous,
    true,
  );
}

function findReferenceSibling(
  node: Node,
  previous: boolean,
  includeSelf = false,
) {
  let current: Node | null = includeSelf
    ? node
    : previous
      ? node.previousSibling
      : node.nextSibling;
  while (
    current &&
    current.nodeType === Node.TEXT_NODE &&
    !(current.textContent || "").trim()
  ) {
    current = previous ? current.previousSibling : current.nextSibling;
  }
  return current instanceof HTMLElement && current.dataset.refLabel
    ? current
    : null;
}

function caretRect(editor: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!editor.contains(range.startContainer)) return null;
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  if (rect.width || rect.height || rect.left || rect.top) return rect;
  return editor.getBoundingClientRect();
}

function textPositionAtCaret(editor: HTMLElement, activeRange?: Range) {
  const selection = activeRange ? null : window.getSelection();
  const range =
    activeRange || (selection?.rangeCount ? selection.getRangeAt(0) : null);
  if (!range || !range.collapsed || !editor.contains(range.startContainer))
    return null;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    return {
      node: range.startContainer as Text,
      offset: range.startOffset,
    };
  }

  const container = range.startContainer;
  const before = container.childNodes[range.startOffset - 1];
  const after = container.childNodes[range.startOffset];
  const atEnd = Boolean(before);
  const candidate = atEnd ? before : after;
  return candidate && !isReferenceChip(candidate)
    ? textPositionWithin(candidate, atEnd)
    : null;
}

function isReferenceChip(node: Node) {
  return node instanceof HTMLElement && Boolean(node.dataset.refLabel);
}

function textPositionWithin(node: Node, atEnd: boolean) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    return { node: text, offset: atEnd ? text.length : 0 };
  }
  if (!(node instanceof Element) || isReferenceChip(node)) return null;

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let found: Text | null = null;
  while (walker.nextNode()) {
    found = walker.currentNode as Text;
    if (!atEnd) break;
  }
  return found ? { node: found, offset: atEnd ? found.length : 0 } : null;
}

function placeCaretAtEnd(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

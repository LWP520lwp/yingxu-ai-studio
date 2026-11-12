import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Image } from "antd";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  parsePromptInputTokens,
  promptMenuPosition,
} from "@/lib/canvas/canvas-prompt-input";
import {
  CanvasPromptEditorController,
  type PromptMentionContext,
} from "@/lib/canvas/canvas-prompt-editor";
import {
  resolvePromptEditorKeyIntent,
  stepMentionSelection,
} from "@/lib/canvas/canvas-prompt-editor-model";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type Props = {
  value: string;
  references: CanvasResourceReference[];
  onChange: (value: string) => void;
  onSubmit?: () => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
};

// Prompt-panel contentEditable input: @ references embed thumbnail chips instead of plain label text.
// Serialization converts chips back to reference labels so the generated value matches the former textarea semantics.
export function CanvasPromptChipInput({
  value,
  references,
  onChange,
  onSubmit,
  className,
  style,
  placeholder,
}: Props) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const editorRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<CanvasPromptEditorController | null>(null);
  const composingRef = useRef(false);
  // Track the last value emitted to the parent. An identical focused value is this component's own echo,
  // so skip rebuilding to preserve the caret and IME. Rebuild external changes even while focused.
  const lastEmittedRef = useRef(value);
  const [mention, setMention] = useState<PromptMentionContext | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const activeReferences = useMemo(
    () => references.filter((item) => item.active),
    [references],
  );
  const referenceByLabel = useMemo(
    () => new Map(activeReferences.map((item) => [item.label, item])),
    [activeReferences],
  );
  // Match longer labels first so a shorter label cannot split a longer one.
  const activeLabels = useMemo(
    () =>
      Array.from(new Set(activeReferences.map((item) => item.label))).sort(
        (a, b) => b.length - a.length,
      ),
    [activeReferences],
  );
  const tokens = useMemo(
    () => parsePromptInputTokens(value, activeLabels),
    [value, activeLabels],
  );

  const candidates = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.trim().toLowerCase();
    if (!query) return activeReferences;
    return activeReferences.filter((item) =>
      `${item.label} ${item.title} ${item.kind} ${item.text || ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [mention, activeReferences]);

  // Rebuild the DOM from value when unfocused, or when a focused value is an external change rather than an emitted echo.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const context = {
      referenceByLabel,
      theme,
      onImagePreview: setImagePreview,
    };
    if (!controllerRef.current || controllerRef.current.element !== editor) {
      controllerRef.current = new CanvasPromptEditorController(editor, context);
    } else {
      controllerRef.current.updateContext(context);
    }

    if (document.activeElement === editor && value === lastEmittedRef.current)
      return;
    controllerRef.current.render(tokens);
    lastEmittedRef.current = value;
  }, [tokens, referenceByLabel, theme, value]);

  const emit = (next: string) => {
    lastEmittedRef.current = next;
    onChange(next);
  };

  const syncFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    emit(controllerRef.current?.serialize() || "");
    syncMention();
  };

  const syncMention = () => {
    const next = controllerRef.current?.mentionAtCaret() || null;
    if (!next || !activeReferences.length) {
      closeMention();
      return;
    }
    setMention(next);
    setActiveIndex(0);
  };

  const closeMention = () => {
    setMention(null);
    setActiveIndex(0);
  };

  const insertReference = (reference: CanvasResourceReference) => {
    const editor = editorRef.current;
    if (!editor) return;
    controllerRef.current?.insertReference(reference);
    closeMention();
    emit(controllerRef.current?.serialize() || "");
  };

  const showPlaceholder = !value.trim();

  return (
    <div className="relative w-full">
      {showPlaceholder && placeholder ? (
        <div
          className="pointer-events-none absolute left-3 top-2 text-sm leading-5"
          style={{ color: theme.node.placeholder }}
        >
          {placeholder}
        </div>
      ) : null}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        className={`${className || ""} overflow-y-auto whitespace-pre-wrap break-words outline-none`}
        style={{ ...style, cursor: "text" }}
        onInput={() => {
          if (!composingRef.current) syncFromEditor();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          syncFromEditor();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          event.stopPropagation();
          const intent = resolvePromptEditorKeyIntent({
            key: event.key,
            composing: isImeComposing(event),
            mentionHasCandidates: Boolean(mention && candidates.length),
            adjacentReference:
              controllerRef.current?.hasAdjacentReference(event.key) || false,
            plainEnter: isPlainEnterKey(event),
            canSubmit: Boolean(onSubmit),
          });
          switch (intent) {
            case "ignore-composition":
              return;
            case "next-mention":
              event.preventDefault();
              setActiveIndex((index) =>
                stepMentionSelection(index, 1, candidates.length),
              );
              return;
            case "previous-mention":
              event.preventDefault();
              setActiveIndex((index) =>
                stepMentionSelection(index, -1, candidates.length),
              );
              return;
            case "accept-mention":
              event.preventDefault();
              insertReference(
                candidates[Math.min(activeIndex, candidates.length - 1)],
              );
              return;
            case "dismiss-mention":
              event.preventDefault();
              closeMention();
              return;
            case "delete-reference":
              event.preventDefault();
              controllerRef.current?.deleteAdjacentReference(event.key);
              requestAnimationFrame(syncFromEditor);
              return;
            case "submit":
              event.preventDefault();
              onSubmit?.();
              return;
            case "refresh-mention":
              requestAnimationFrame(syncMention);
          }
        }}
        onBlur={() => window.setTimeout(closeMention, 120)}
      />
      {mention && candidates.length ? (
        <MentionMenu
          rect={mention.rect}
          references={candidates}
          activeIndex={Math.min(activeIndex, candidates.length - 1)}
          theme={theme}
          onSelect={insertReference}
        />
      ) : null}
      {imagePreview ? (
        <Image
          src={imagePreview}
          alt={i18n.t("canvas.composer.imagePreview")}
          style={{ display: "none" }}
          preview={{
            visible: true,
            src: imagePreview,
            onVisibleChange: (visible) => !visible && setImagePreview(null),
          }}
        />
      ) : null}
    </div>
  );
}

function MentionMenu({
  rect,
  references,
  activeIndex,
  theme,
  onSelect,
}: {
  rect: DOMRect | null;
  references: CanvasResourceReference[];
  activeIndex: number;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onSelect: (reference: CanvasResourceReference) => void;
}) {
  const selectedRef = useRef(false);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, references]);

  const selectReference = (reference: CanvasResourceReference) => {
    if (selectedRef.current) return;
    selectedRef.current = true;
    onSelect(reference);
  };

  const stopCanvasInteraction = (event: PointerEvent | MouseEvent) =>
    event.stopPropagation();

  const anchor = rect || { left: 16, right: 16, top: 16, bottom: 16 };
  const position = promptMenuPosition(anchor, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  return createPortal(
    <div
      data-canvas-resource-mention-menu="true"
      className="fixed z-[1100] overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
      }}
      onPointerDown={stopCanvasInteraction}
      onMouseDown={stopCanvasInteraction}
      onClick={(event) => event.stopPropagation()}
    >
      {references.map((reference, index) => (
        <button
          key={reference.id}
          ref={index === activeIndex ? activeItemRef : undefined}
          type="button"
          className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
          style={{
            background:
              index === activeIndex ? theme.toolbar.activeBg : "transparent",
            color:
              index === activeIndex
                ? theme.toolbar.activeText
                : theme.node.text,
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectReference(reference);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectReference(reference);
          }}
        >
          <ReferencePreview reference={reference} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{reference.label}</span>
            <span className="block truncate opacity-65">
              {reference.text || reference.title}
            </span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

function ReferencePreview({
  reference,
}: {
  reference: CanvasResourceReference;
}) {
  if (reference.kind === "image" && reference.previewUrl)
    return (
      <img
        src={reference.previewUrl}
        alt=""
        className="size-9 rounded-md object-cover"
      />
    );
  if (reference.kind === "video" && reference.previewUrl)
    return (
      <video
        src={reference.previewUrl}
        className="size-9 rounded-md bg-black object-cover"
        muted
        preload="metadata"
      />
    );
  const Icon =
    reference.kind === "audio"
      ? Music2
      : reference.kind === "video"
        ? Video
        : reference.kind === "image"
          ? ImageIcon
          : FileText;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
      <Icon className="size-4" />
    </span>
  );
}

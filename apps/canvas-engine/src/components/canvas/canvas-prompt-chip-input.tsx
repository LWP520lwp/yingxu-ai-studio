import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Image } from "antd";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { parsePromptInputTokens, promptMenuPosition } from "@/lib/canvas/canvas-prompt-input";
import { CanvasPromptEditorController, type PromptMentionContext } from "@/lib/canvas/canvas-prompt-editor";
import { resolvePromptEditorKeyIntent, stepMentionSelection } from "@/lib/canvas/canvas-prompt-editor-model";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasPromptChipInputProps = {
  value: string;
  references: CanvasResourceReference[];
  onChange: (value: string) => void;
  onSubmit?: () => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
};

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type MentionPickerProps = {
  id: string;
  anchor: DOMRect | null;
  choices: CanvasResourceReference[];
  activeIndex: number;
  theme: CanvasTheme;
  onSelect: (reference: CanvasResourceReference) => void;
};

const editorToken = (reference: CanvasResourceReference) =>
  reference.valueToken || reference.label;

export function CanvasPromptChipInput({
  value,
  references,
  onChange,
  onSubmit,
  className,
  style,
  placeholder,
}: CanvasPromptChipInputProps) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const editorId = `prompt-editor-${useId().replace(/:/g, "")}`;
  const inputRef = useRef<HTMLDivElement>(null);
  const behavior = useRef<CanvasPromptEditorController | null>(null);
  const composing = useRef(false);
  const lastPublishedValue = useRef(value);
  const [activeMention, setActiveMention] = useState<PromptMentionContext | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const usableReferences = useMemo(
    () => references.filter((reference) => reference.active),
    [references],
  );
  const referencesByToken = useMemo(
    () => new Map(usableReferences.map((reference) => [editorToken(reference), reference])),
    [usableReferences],
  );
  const tokensInUse = useMemo(
    () => [...new Set(usableReferences.map(editorToken))].sort((a, b) => b.length - a.length),
    [usableReferences],
  );
  const documentTokens = useMemo(
    () => parsePromptInputTokens(value, tokensInUse),
    [tokensInUse, value],
  );
  const choices = useMemo(() => {
    if (!activeMention) return [];
    const query = activeMention.query.trim().toLocaleLowerCase();
    return usableReferences.filter((reference) => {
      const searchable = [reference.label, reference.title, reference.kind, reference.text || ""]
        .join(" ")
        .toLocaleLowerCase();
      return !query || searchable.includes(query);
    });
  }, [activeMention, usableReferences]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;

    const editorContext = {
      referenceByLabel: referencesByToken,
      theme,
      onImagePreview: setImagePreview,
    };
    if (!behavior.current || behavior.current.element !== element) {
      behavior.current = new CanvasPromptEditorController(element, editorContext);
    } else {
      behavior.current.updateContext(editorContext);
    }

    // Rebuilding active content would reset the browser caret on each keystroke.
    if (document.activeElement === element && value === lastPublishedValue.current) return;
    behavior.current.render(documentTokens);
    lastPublishedValue.current = value;
  }, [documentTokens, referencesByToken, theme, value]);

  const emitValue = (next: string) => {
    lastPublishedValue.current = next;
    onChange(next);
  };

  const inspectCaret = () => {
    const found = behavior.current?.mentionAtCaret() || null;
    if (!found || usableReferences.length === 0) {
      setActiveMention(null);
      setActiveIndex(0);
      return;
    }
    setActiveMention(found);
    setActiveIndex(0);
  };

  const commitDomEdit = () => {
    emitValue(behavior.current?.serialize() || "");
    inspectCaret();
  };

  const insertReference = (reference: CanvasResourceReference) => {
    behavior.current?.insertReference(reference);
    setActiveMention(null);
    emitValue(behavior.current?.serialize() || "");
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const hasChoices = Boolean(activeMention && choices.length > 0);
    const intent = resolvePromptEditorKeyIntent({
      key: event.key,
      composing: isImeComposing(event) || composing.current,
      mentionHasCandidates: hasChoices,
      adjacentReference: behavior.current?.hasAdjacentReference(event.key) ?? false,
      plainEnter: isPlainEnterKey(event),
      canSubmit: Boolean(onSubmit),
    });

    switch (intent) {
      case "ignore-composition":
        return;
      case "next-mention":
        event.preventDefault();
        setActiveIndex((index) => stepMentionSelection(index, 1, choices.length));
        return;
      case "previous-mention":
        event.preventDefault();
        setActiveIndex((index) => stepMentionSelection(index, -1, choices.length));
        return;
      case "accept-mention":
        event.preventDefault();
        insertReference(choices[Math.min(activeIndex, choices.length - 1)]);
        return;
      case "dismiss-mention":
        event.preventDefault();
        setActiveMention(null);
        return;
      case "delete-reference":
        event.preventDefault();
        behavior.current?.deleteAdjacentReference(event.key);
        requestAnimationFrame(commitDomEdit);
        return;
      case "submit":
        event.preventDefault();
        onSubmit?.();
        return;
      case "refresh-mention":
        requestAnimationFrame(inspectCaret);
    }
  };

  return (
    <div className="relative w-full">
      {value.trim() === "" && placeholder ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 top-2 text-sm leading-5"
          style={{ color: theme.node.placeholder }}
        >
          {placeholder}
        </div>
      ) : null}

      <div
        id={editorId}
        ref={inputRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={placeholder || i18n.t("canvas.composer.title")}
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={Boolean(activeMention && choices.length)}
        aria-controls={activeMention && choices.length ? `${editorId}-mentions` : undefined}
        aria-activedescendant={activeMention && choices.length ? `${editorId}-mention-${activeIndex}` : undefined}
        className={`${className || ""} overflow-y-auto whitespace-pre-wrap break-words outline-none`}
        style={{ ...style, cursor: "text" }}
        onInput={() => {
          if (!composing.current) commitDomEdit();
        }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => {
          composing.current = false;
          commitDomEdit();
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setActiveMention(null), 120)}
      />

      {activeMention && choices.length > 0 ? (
        <MentionPicker
          id={`${editorId}-mentions`}
          anchor={activeMention.rect}
          choices={choices}
          activeIndex={Math.min(activeIndex, choices.length - 1)}
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
            onVisibleChange: (visible) => {
              if (!visible) setImagePreview(null);
            },
          }}
        />
      ) : null}
    </div>
  );
}

function MentionPicker({ id, anchor, choices, activeIndex, theme, onSelect }: MentionPickerProps) {
  const activeOption = useRef<HTMLButtonElement>(null);
  const selectionClaimed = useRef(false);
  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, choices]);

  const fallbackAnchor = { left: 16, right: 16, top: 16, bottom: 36 };
  const placement = promptMenuPosition(
    anchor || fallbackAnchor,
    { width: window.innerWidth, height: window.innerHeight },
    { width: 280, height: 240, gutter: 12, gap: 5 },
  );
  const stopMenuEvent = (event: ReactPointerEvent | ReactMouseEvent) => event.stopPropagation();

  const choose = (reference: CanvasResourceReference) => {
    if (selectionClaimed.current) return;
    selectionClaimed.current = true;
    onSelect(reference);
  };

  return createPortal(
    <div
      id={id}
      data-canvas-resource-mention-menu="true"
      role="listbox"
      className="fixed z-[1100] overflow-y-auto rounded-md border p-1 shadow-xl"
      style={{
        left: placement.left,
        top: placement.top,
        width: placement.width,
        maxHeight: placement.maxHeight,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
      }}
      onPointerDown={stopMenuEvent}
      onMouseDown={stopMenuEvent}
      onClick={(event) => event.stopPropagation()}
    >
      {choices.map((reference, index) => (
        <button
          key={reference.id}
          id={`${id.slice(0, -"-mentions".length)}-mention-${index}`}
          ref={index === activeIndex ? activeOption : undefined}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
          style={{
            background: index === activeIndex ? theme.toolbar.activeBg : "transparent",
            color: index === activeIndex ? theme.toolbar.activeText : theme.node.text,
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            choose(reference);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            choose(reference);
          }}
        >
          <ResourceIcon reference={reference} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{reference.label}</span>
            <span className="block truncate opacity-60">{reference.text || reference.title}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

function ResourceIcon({ reference }: { reference: CanvasResourceReference }) {
  if (reference.kind === "image" && reference.previewUrl) {
    return <img src={reference.previewUrl} alt="" className="size-9 rounded object-cover" />;
  }
  if (reference.kind === "video" && reference.previewUrl) {
    return (
      <video
        src={reference.previewUrl}
        className="size-9 rounded bg-black object-cover"
        muted
        preload="metadata"
        aria-hidden="true"
      />
    );
  }

  const Icon = reference.kind === "audio"
    ? Music2
    : reference.kind === "video"
      ? Video
      : reference.kind === "image"
        ? ImageIcon
        : FileText;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded bg-black/10" aria-hidden="true">
      <Icon className="size-4" />
    </span>
  );
}

import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import {
  activeResourceMentionLabels,
  createResourceMentionTextSplitter,
  deleteAdjacentResourceMention,
  findResourceMention,
  insertResourceMention,
  placeResourceMentionMenu,
  searchResourceMentions,
  type ResourceMention,
} from "@/lib/canvas/resource-mentions";
import { useThemeStore } from "@/stores/use-theme-store";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  references: CanvasResourceReference[];
  onChange: (value: string) => void;
  onSubmit?: () => void;
  containerClassName?: string;
  highlightLabels?: boolean;
};

type Theme = (typeof canvasThemes)[keyof typeof canvasThemes];
type PickerProps = {
  id: string;
  input: HTMLTextAreaElement;
  caret: number;
  items: CanvasResourceReference[];
  activeIndex: number;
  theme: Theme;
  onPick: (reference: CanvasResourceReference) => void;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function CanvasResourceMentionTextarea(
    {
      value,
      references,
      onChange,
      onSubmit,
      onKeyDown,
      className,
      containerClassName,
      style,
      highlightLabels = true,
      ...nativeProps
    },
    forwardedRef,
  ) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const pickerId = `resource-picker-${useId().replace(/:/g, "")}`;
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const mirrorRef = useRef<HTMLDivElement | null>(null);
    const [mention, setMention] = useState<ResourceMention | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [hasRangeSelection, setHasRangeSelection] = useState(false);

    const choices = useMemo(
      () => mention ? searchResourceMentions(references, mention.query) : [],
      [mention, references],
    );
    const labels = useMemo(
      () => highlightLabels ? activeResourceMentionLabels(references) : [],
      [highlightLabels, references],
    );
    const splitText = useMemo(() => createResourceMentionTextSplitter(labels), [labels]);
    const drawHighlights = labels.length > 0 && !hasRangeSelection;
    const hasPicker = Boolean(mention && choices.length && textareaRef.current);

    const setTextareaRef = useCallback((element: HTMLTextAreaElement | null) => {
      textareaRef.current = element;
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    }, [forwardedRef]);

    const closePicker = () => {
      setMention(null);
      setActiveIndex(0);
    };

    const reflectSelection = () => {
      const element = textareaRef.current;
      setHasRangeSelection(Boolean(element && element.selectionStart !== element.selectionEnd));
    };

    const restoreCaret = (position: number) => {
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.focus();
        element.setSelectionRange(position, position);
      });
    };

    const writeValue = (next: string, caret?: number) => {
      onChange(next);
      if (caret !== undefined) restoreCaret(caret);
    };

    const discoverMention = (text: string, cursor: number) => {
      const next = findResourceMention(text, cursor);
      if (!next || !references.some((reference) => reference.active)) {
        closePicker();
        return;
      }
      setMention(next);
      setActiveIndex(0);
    };

    const chooseReference = (reference: CanvasResourceReference) => {
      if (!mention) return;
      const cursor = textareaRef.current?.selectionStart ?? value.length;
      const result = insertResourceMention(value, mention, cursor, reference.label);
      closePicker();
      writeValue(result.value, result.caret);
    };

    const synchronizeMirror = () => {
      const input = textareaRef.current;
      const mirror = mirrorRef.current;
      if (!input || !mirror) return;
      mirror.scrollTop = input.scrollTop;
      mirror.scrollLeft = input.scrollLeft;
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeComposing(event)) {
        onKeyDown?.(event);
        return;
      }

      const input = textareaRef.current;
      const collapsed = input && input.selectionStart === input.selectionEnd;
      if (!mention && collapsed && (event.key === "Backspace" || event.key === "Delete")) {
        const result = deleteAdjacentResourceMention(
          value,
          input.selectionStart,
          event.key === "Backspace" ? "backward" : "forward",
          labels,
        );
        if (result) {
          event.preventDefault();
          writeValue(result.value, result.caret);
          requestAnimationFrame(reflectSelection);
          return;
        }
      }

      if (mention && choices.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setActiveIndex((current) => (current + delta + choices.length) % choices.length);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          chooseReference(choices[Math.min(activeIndex, choices.length - 1)]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closePicker();
          return;
        }
      }

      if (onSubmit && isPlainEnterKey(event)) {
        event.preventDefault();
        onSubmit();
        return;
      }
      onKeyDown?.(event);
    };

    const mirrorStyle: CSSProperties = { ...style, color: theme.node.text };
    const textareaStyle: CSSProperties = {
      ...style,
      color: drawHighlights ? "transparent" : style?.color,
      caretColor: style?.color || theme.node.text,
      cursor: "text",
      ...(drawHighlights
        ? { position: "relative", zIndex: 1, background: "transparent", backgroundColor: "transparent" }
        : {}),
    };

    return (
      <div className={`relative h-full w-full ${containerClassName || ""}`}>
        {drawHighlights ? (
          <MentionHighlight
            ref={mirrorRef}
            value={value}
            placeholder={nativeProps.placeholder}
            className={className}
            style={mirrorStyle}
            splitText={splitText}
          />
        ) : null}

        <textarea
          {...nativeProps}
          ref={setTextareaRef}
          value={value}
          className={className}
          style={textareaStyle}
          aria-autocomplete="list"
          aria-expanded={Boolean(mention && choices.length)}
          aria-controls={hasPicker ? pickerId : undefined}
          aria-activedescendant={hasPicker ? `${pickerId}-option-${Math.min(activeIndex, choices.length - 1)}` : undefined}
          onChange={(event) => {
            const text = event.currentTarget.value;
            onChange(text);
            discoverMention(text, event.currentTarget.selectionStart);
            requestAnimationFrame(() => {
              synchronizeMirror();
              reflectSelection();
            });
          }}
          onSelect={(event) => {
            reflectSelection();
            nativeProps.onSelect?.(event);
          }}
          onKeyUp={(event) => {
            reflectSelection();
            nativeProps.onKeyUp?.(event);
          }}
          onPointerUp={(event) => {
            reflectSelection();
            nativeProps.onPointerUp?.(event);
          }}
          onKeyDown={handleKeyDown}
          onScroll={(event) => {
            synchronizeMirror();
            nativeProps.onScroll?.(event);
          }}
          onBlur={(event) => {
            setHasRangeSelection(false);
            window.setTimeout(closePicker, 120);
            nativeProps.onBlur?.(event);
          }}
        />

        {hasPicker && textareaRef.current && mention ? (
          <MentionPicker
            id={pickerId}
            input={textareaRef.current}
            caret={mention.start}
            items={choices}
            activeIndex={Math.min(activeIndex, choices.length - 1)}
            theme={theme}
            onPick={chooseReference}
          />
        ) : null}
      </div>
    );
  },
);

const MentionHighlight = forwardRef<HTMLDivElement, {
  value: string;
  placeholder?: string;
  className?: string;
  style: CSSProperties;
  splitText: (value: string) => Array<{ text: string; highlighted: boolean }>;
}>(function MentionHighlight({ value, placeholder, className, style, splitText }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`${className || ""} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`}
      style={style}
    >
      {value ? splitText(value).map((part, index) => (
        <span
          key={`${index}:${part.text}`}
          className={part.highlighted ? "rounded bg-sky-500/15 px-0.5 text-sky-500" : undefined}
        >
          {part.text}
        </span>
      )) : placeholder ? <span className="opacity-45">{placeholder}</span> : null}
    </div>
  );
});

function MentionPicker({ id, input, caret, items, activeIndex, theme, onPick }: PickerProps) {
  const selectedButton = useRef<HTMLButtonElement>(null);
  const completed = useRef(false);

  useEffect(() => {
    selectedButton.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  const bounds = input.closest(".ant-modal-content")?.getBoundingClientRect() ?? {
    left: 8,
    top: 8,
    right: window.innerWidth - 8,
    bottom: window.innerHeight - 8,
  };
  const box = input.getBoundingClientRect();
  const scale = input.offsetWidth > 0 ? box.width / input.offsetWidth : 1;
  const computed = window.getComputedStyle(input);
  const lineHeight = (parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4 || 20) * scale;
  const point = measureCaret(input, caret);
  const placement = placeResourceMentionMenu({
    left: box.left + (point.left - input.scrollLeft) * scale,
    top: box.top + (point.top - input.scrollTop) * scale,
    lineHeight,
  }, bounds);

  const stopPointer = (event: ReactPointerEvent | ReactMouseEvent) => event.stopPropagation();
  const pickOnce = (reference: CanvasResourceReference) => {
    if (completed.current) return;
    completed.current = true;
    onPick(reference);
  };

  return createPortal(
    <div
      id={id}
      data-canvas-resource-mention-menu="true"
      role="listbox"
      className="fixed z-[120] overflow-y-auto rounded-md border p-1 shadow-xl"
      style={{
        left: placement.left,
        top: placement.top,
        width: placement.width,
        maxHeight: placement.maxHeight,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
      }}
      onPointerDown={stopPointer}
      onMouseDown={stopPointer}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((reference, index) => (
        <button
          key={reference.id}
          id={`${id}-option-${index}`}
          ref={index === activeIndex ? selectedButton : undefined}
          type="button"
          role="option"
          aria-selected={activeIndex === index}
          className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
          style={{
            background: activeIndex === index ? theme.toolbar.activeBg : "transparent",
            color: activeIndex === index ? theme.toolbar.activeText : theme.node.text,
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            pickOnce(reference);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            pickOnce(reference);
          }}
        >
          <MentionResourceIcon reference={reference} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{reference.label}</span>
            <span className="block truncate opacity-65">{reference.text || reference.title}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

function MentionResourceIcon({ reference }: { reference: CanvasResourceReference }) {
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

const copiedTextStyleKeys = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight",
  "fontFamily", "textAlign", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "textTransform",
] as const;

function measureCaret(input: HTMLTextAreaElement, offset: number) {
  const computed = window.getComputedStyle(input);
  const ruler = document.createElement("div");
  Object.assign(ruler.style, {
    position: "absolute",
    top: "0",
    left: "-10000px",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  for (const key of copiedTextStyleKeys) ruler.style[key] = computed[key];

  ruler.textContent = input.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(offset) || ".";
  ruler.append(marker);
  document.body.append(ruler);
  const location = { left: marker.offsetLeft, top: marker.offsetTop };
  ruler.remove();
  return location;
}

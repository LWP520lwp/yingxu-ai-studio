import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  getPromptChipKeyAction,
  movePromptChoice,
} from "@/lib/canvas/prompt-chip-session";
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
type SuggestionMenuProps = {
  id: string;
  input: HTMLTextAreaElement;
  caret: number;
  items: CanvasResourceReference[];
  activeIndex: number;
  theme: Theme;
  onPick: (reference: CanvasResourceReference) => void;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function CanvasResourceMentionTextarea(props, forwardedRef) {
    const {
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
    } = props;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuId = `resource-picker-${useId().replace(/:/g, "")}`;
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const mirrorRef = useRef<HTMLDivElement | null>(null);
    const dismissTimer = useRef<number | null>(null);
    const [mention, setMention] = useState<ResourceMention | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [selectionIsRange, setSelectionIsRange] = useState(false);

    const labels = useMemo(
      () => (highlightLabels ? activeResourceMentionLabels(references) : []),
      [highlightLabels, references],
    );
    const splitText = useMemo(
      () => createResourceMentionTextSplitter(labels),
      [labels],
    );
    const options = useMemo(
      () => (mention ? searchResourceMentions(references, mention.query) : []),
      [mention, references],
    );
    const showHighlights = labels.length > 0 && !selectionIsRange;
    const showMenu = Boolean(mention && options.length && inputRef.current);

    const setInputRef = useCallback(
      (element: HTMLTextAreaElement | null) => {
        inputRef.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      },
      [forwardedRef],
    );

    const dismissMenu = useCallback(() => {
      setMention(null);
      setActiveIndex(0);
    }, []);

    const syncSelectionState = useCallback((input = inputRef.current) => {
      setSelectionIsRange(Boolean(input && input.selectionStart !== input.selectionEnd));
    }, []);

    const focusAt = useCallback((position: number) => {
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(position, position);
      });
    }, []);

    const commitText = useCallback(
      (next: string, caret?: number) => {
        onChange(next);
        if (caret !== undefined) focusAt(caret);
      },
      [focusAt, onChange],
    );

    const refreshMention = useCallback(
      (text: string, cursor: number) => {
        const next = findResourceMention(text, cursor);
        if (!next || !references.some((reference) => reference.active)) {
          dismissMenu();
          return;
        }
        setMention(next);
        setActiveIndex(0);
      },
      [dismissMenu, references],
    );

    const chooseOption = useCallback(
      (reference: CanvasResourceReference) => {
        if (!mention) return;
        const cursor = inputRef.current?.selectionStart ?? value.length;
        const replacement = insertResourceMention(
          value,
          mention,
          cursor,
          reference.label,
        );
        dismissMenu();
        commitText(replacement.value, replacement.caret);
      },
      [commitText, dismissMenu, mention, value],
    );

    const syncMirrorScroll = useCallback(() => {
      const input = inputRef.current;
      const mirror = mirrorRef.current;
      if (!input || !mirror) return;
      mirror.scrollTop = input.scrollTop;
      mirror.scrollLeft = input.scrollLeft;
    }, []);

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        const input = inputRef.current;
        const collapsed = Boolean(
          input && input.selectionStart === input.selectionEnd,
        );
        const deletion =
          !mention && collapsed && input &&
          (event.key === "Backspace" || event.key === "Delete")
            ? deleteAdjacentResourceMention(
                value,
                input.selectionStart,
                event.key === "Backspace" ? "backward" : "forward",
                labels,
              )
            : null;
        const intent = getPromptChipKeyAction({
          key: event.key,
          composing: isImeComposing(event),
          hasMentionChoices: Boolean(mention && options.length),
          adjacentToken: Boolean(deletion),
          plainEnter: isPlainEnterKey(event),
          canSubmit: Boolean(onSubmit),
        });

        switch (intent) {
          case "composing":
          case "refresh":
            onKeyDown?.(event);
            return;
          case "move-forward":
          case "move-backward": {
            event.preventDefault();
            const direction: -1 | 1 = intent === "move-forward" ? 1 : -1;
            setActiveIndex((current) =>
              movePromptChoice(current, direction, options.length),
            );
            return;
          }
          case "choose":
            event.preventDefault();
            chooseOption(options[Math.min(activeIndex, options.length - 1)]);
            return;
          case "close":
            event.preventDefault();
            dismissMenu();
            return;
          case "remove-token":
            if (deletion) {
              event.preventDefault();
              commitText(deletion.value, deletion.caret);
              requestAnimationFrame(() => syncSelectionState());
              return;
            }
            break;
          case "submit":
            event.preventDefault();
            onSubmit?.();
            return;
        }

        onKeyDown?.(event);
      },
      [
        activeIndex,
        chooseOption,
        commitText,
        dismissMenu,
        labels,
        mention,
        onKeyDown,
        onSubmit,
        options,
        syncSelectionState,
        value,
      ],
    );

    useEffect(
      () => () => {
        if (dismissTimer.current !== null) {
          window.clearTimeout(dismissTimer.current);
        }
      },
      [],
    );

    const mirrorStyle: CSSProperties = { ...style, color: theme.node.text };
    const editorStyle: CSSProperties = {
      ...style,
      color: showHighlights ? "transparent" : style?.color,
      caretColor: style?.color || theme.node.text,
      cursor: "text",
      ...(showHighlights
        ? {
            position: "relative",
            zIndex: 1,
            background: "transparent",
            backgroundColor: "transparent",
          }
        : {}),
    };

    return (
      <div className={`relative h-full w-full ${containerClassName || ""}`}>
        {showHighlights ? (
          <TextHighlightMirror
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
          ref={setInputRef}
          value={value}
          className={className}
          style={editorStyle}
          aria-autocomplete="list"
          aria-expanded={Boolean(mention && options.length)}
          aria-controls={showMenu ? menuId : undefined}
          aria-activedescendant={
            showMenu
              ? `${menuId}-option-${Math.min(activeIndex, options.length - 1)}`
              : undefined
          }
          onChange={(event) => {
            const input = event.currentTarget;
            const next = input.value;
            onChange(next);
            refreshMention(next, input.selectionStart);
            requestAnimationFrame(() => {
              syncMirrorScroll();
              syncSelectionState(input);
            });
          }}
          onSelect={(event) => {
            syncSelectionState(event.currentTarget);
            nativeProps.onSelect?.(event);
          }}
          onKeyUp={(event) => {
            syncSelectionState(event.currentTarget);
            nativeProps.onKeyUp?.(event);
          }}
          onPointerUp={(event) => {
            syncSelectionState(event.currentTarget);
            nativeProps.onPointerUp?.(event);
          }}
          onKeyDown={handleKeyDown}
          onScroll={(event) => {
            syncMirrorScroll();
            nativeProps.onScroll?.(event);
          }}
          onBlur={(event) => {
            setSelectionIsRange(false);
            if (dismissTimer.current !== null) {
              window.clearTimeout(dismissTimer.current);
            }
            dismissTimer.current = window.setTimeout(dismissMenu, 120);
            nativeProps.onBlur?.(event);
          }}
        />

        {showMenu && inputRef.current && mention ? (
          <ResourceSuggestionMenu
            id={menuId}
            input={inputRef.current}
            caret={mention.start}
            items={options}
            activeIndex={Math.min(activeIndex, options.length - 1)}
            theme={theme}
            onPick={chooseOption}
          />
        ) : null}
      </div>
    );
  },
);

const TextHighlightMirror = forwardRef<
  HTMLDivElement,
  {
    value: string;
    placeholder?: string;
    className?: string;
    style: CSSProperties;
    splitText: (value: string) => Array<{ text: string; highlighted: boolean }>;
  }
>(function TextHighlightMirror({ value, placeholder, className, style, splitText }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`${className || ""} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`}
      style={style}
    >
      {value ? (
        splitText(value).map((part, index) => (
          <span
            key={`${index}:${part.text}`}
            className={part.highlighted ? "rounded bg-sky-500/15 px-0.5 text-sky-500" : undefined}
          >
            {part.text}
          </span>
        ))
      ) : placeholder ? (
        <span className="opacity-45">{placeholder}</span>
      ) : null}
    </div>
  );
});

function ResourceSuggestionMenu({
  id,
  input,
  caret,
  items,
  activeIndex,
  theme,
  onPick,
}: SuggestionMenuProps) {
  const activeButton = useRef<HTMLButtonElement>(null);
  const selected = useRef(false);

  useEffect(() => {
    activeButton.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  const menuBounds = input.closest(".ant-modal-content")?.getBoundingClientRect() ?? {
    left: 8,
    top: 8,
    right: window.innerWidth - 8,
    bottom: window.innerHeight - 8,
  };
  const inputBounds = input.getBoundingClientRect();
  const scale = input.offsetWidth > 0 ? inputBounds.width / input.offsetWidth : 1;
  const metrics = window.getComputedStyle(input);
  const lineHeight =
    (parseFloat(metrics.lineHeight) || parseFloat(metrics.fontSize) * 1.4 || 20) *
    scale;
  const anchor = locateCaret(input, caret);
  const placement = placeResourceMentionMenu(
    {
      left: inputBounds.left + (anchor.left - input.scrollLeft) * scale,
      top: inputBounds.top + (anchor.top - input.scrollTop) * scale,
      lineHeight,
    },
    menuBounds,
  );

  const preventCanvasGesture = (event: ReactPointerEvent | ReactMouseEvent) => {
    event.stopPropagation();
  };
  const chooseOnce = (item: CanvasResourceReference) => {
    if (selected.current) return;
    selected.current = true;
    onPick(item);
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
      onPointerDown={preventCanvasGesture}
      onMouseDown={preventCanvasGesture}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          id={`${id}-option-${index}`}
          ref={index === activeIndex ? activeButton : undefined}
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
            chooseOnce(item);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            chooseOnce(item);
          }}
        >
          <ResourceKindIcon reference={item} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{item.label}</span>
            <span className="block truncate opacity-65">{item.text || item.title}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

function ResourceKindIcon({ reference }: { reference: CanvasResourceReference }) {
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

  const Icon = {
    audio: Music2,
    video: Video,
    image: ImageIcon,
    text: FileText,
  }[reference.kind];
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded bg-black/10" aria-hidden="true">
      <Icon className="size-4" />
    </span>
  );
}

const textMetrics = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "textTransform",
] as const;

function locateCaret(input: HTMLTextAreaElement, offset: number) {
  const metrics = window.getComputedStyle(input);
  const ruler = document.createElement("div");
  Object.assign(ruler.style, {
    position: "absolute",
    top: "0",
    left: "-10000px",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  for (const key of textMetrics) ruler.style[key] = metrics[key];

  ruler.textContent = input.value.slice(0, offset);
  const caretMarker = document.createElement("span");
  caretMarker.textContent = input.value.slice(offset) || ".";
  ruler.append(caretMarker);
  document.body.append(ruler);
  const point = { left: caretMarker.offsetLeft, top: caretMarker.offsetTop };
  ruler.remove();
  return point;
}

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Image } from "antd";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import { parsePromptInputTokens } from "@/lib/canvas/canvas-prompt-input";
import { CanvasPromptEditorController, type PromptMentionContext } from "@/lib/canvas/canvas-prompt-editor";
import {
  findPromptReferences,
  getPromptChipKeyAction,
  indexPromptReferences,
  movePromptChoice,
} from "@/lib/canvas/prompt-chip-session";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasPromptReferencePicker } from "./canvas-prompt-reference-picker";

type CanvasPromptChipInputProps = {
  value: string;
  references: CanvasResourceReference[];
  onChange: (value: string) => void;
  onSubmit?: () => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
};

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

  const referenceIndex = useMemo(() => indexPromptReferences(references), [references]);
  const documentTokens = useMemo(
    () => parsePromptInputTokens(value, referenceIndex.tokens),
    [referenceIndex.tokens, value],
  );
  const choices = useMemo(() => {
    if (!activeMention) return [];
    return findPromptReferences(referenceIndex.active, activeMention.query);
  }, [activeMention, referenceIndex.active]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;

    const editorContext = {
      referenceByLabel: referenceIndex.byToken,
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
  }, [documentTokens, referenceIndex.byToken, theme, value]);

  const emitValue = (next: string) => {
    lastPublishedValue.current = next;
    onChange(next);
  };

  const inspectCaret = () => {
    const found = behavior.current?.mentionAtCaret() || null;
    if (!found || referenceIndex.active.length === 0) {
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
    const intent = getPromptChipKeyAction({
      key: event.key,
      composing: isImeComposing(event) || composing.current,
      hasMentionChoices: hasChoices,
      adjacentToken: behavior.current?.hasAdjacentReference(event.key) ?? false,
      plainEnter: isPlainEnterKey(event),
      canSubmit: Boolean(onSubmit),
    });

    switch (intent) {
      case "composing":
        return;
      case "move-forward":
        event.preventDefault();
        setActiveIndex((index) => movePromptChoice(index, 1, choices.length));
        return;
      case "move-backward":
        event.preventDefault();
        setActiveIndex((index) => movePromptChoice(index, -1, choices.length));
        return;
      case "choose":
        event.preventDefault();
        insertReference(choices[Math.min(activeIndex, choices.length - 1)]);
        return;
      case "close":
        event.preventDefault();
        setActiveMention(null);
        return;
      case "remove-token":
        event.preventDefault();
        behavior.current?.deleteAdjacentReference(event.key);
        requestAnimationFrame(commitDomEdit);
        return;
      case "submit":
        event.preventDefault();
        onSubmit?.();
        return;
      case "refresh":
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
        <CanvasPromptReferencePicker
          editorId={editorId}
          mention={activeMention}
          references={choices}
          activeIndex={Math.min(activeIndex, choices.length - 1)}
          theme={theme}
          onChoose={insertReference}
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

import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { promptMenuPosition } from "@/lib/canvas/canvas-prompt-input";
import type { PromptMentionContext } from "@/lib/canvas/canvas-prompt-editor";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type CanvasPromptReferencePickerProps = {
  editorId: string;
  mention: PromptMentionContext;
  references: readonly CanvasResourceReference[];
  activeIndex: number;
  theme: CanvasTheme;
  onChoose: (reference: CanvasResourceReference) => void;
};

export function CanvasPromptReferencePicker({
  editorId,
  mention,
  references,
  activeIndex,
  theme,
  onChoose,
}: CanvasPromptReferencePickerProps) {
  const activeOption = useRef<HTMLButtonElement>(null);
  const choiceAccepted = useRef(false);
  const menuId = `${editorId}-mentions`;
  const optionBaseId = `${editorId}-mention`;

  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, references]);

  const fallbackAnchor = { left: 16, right: 16, top: 16, bottom: 36 };
  const placement = promptMenuPosition(
    mention.rect || fallbackAnchor,
    { width: window.innerWidth, height: window.innerHeight },
    { width: 280, height: 240, gutter: 12, gap: 5 },
  );
  const stopMenuEvent = (event: PointerEvent | MouseEvent) => event.stopPropagation();

  const chooseOnce = (reference: CanvasResourceReference) => {
    if (choiceAccepted.current) return;
    choiceAccepted.current = true;
    onChoose(reference);
  };

  return createPortal(
    <div
      id={menuId}
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
      {references.map((reference, index) => (
        <button
          key={reference.id}
          id={`${optionBaseId}-${index}`}
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
            chooseOnce(reference);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            chooseOnce(reference);
          }}
        >
          <ReferenceThumbnail reference={reference} />
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

function ReferenceThumbnail({ reference }: { reference: CanvasResourceReference }) {
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

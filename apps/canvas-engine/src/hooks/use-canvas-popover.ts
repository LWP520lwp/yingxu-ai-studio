import { useEffect, useRef, useState } from "react";

export type CanvasPopoverDismissReason = "outside" | "escape";

/** Tracks the anchor for a portal and owns the document-level dismissal rules. */
export function useCanvasPopover<
  Anchor extends HTMLElement,
  Panel extends HTMLElement,
>(open: boolean, onDismiss: (reason: CanvasPopoverDismissReason) => void) {
  const anchorRef = useRef<Anchor>(null);
  const panelRef = useRef<Panel>(null);
  const dismissRef = useRef(onDismiss);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) {
      setAnchorRect(null);
      return;
    }

    const measure = () => {
      setAnchorRect(anchorRef.current?.getBoundingClientRect() ?? null);
    };
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        anchorRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      )
        return;
      dismissRef.current("outside");
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current("escape");
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissEscape, true);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    if (anchorRef.current) observer?.observe(anchorRef.current);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissEscape, true);
      observer?.disconnect();
    };
  }, [open]);

  return { anchorRef, panelRef, anchorRect };
}

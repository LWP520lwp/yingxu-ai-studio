import { useCallback, useEffect, useRef, useState } from "react";

import {
  measurePreviewScroll,
  type PreviewScrollMetrics,
} from "@/atlas-engine/ui/image-toolbar-settings";

const initialMetrics = measurePreviewScroll(0, 1, 1);

export function useElementScrollMetrics(active: boolean, layoutKey: string) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<PreviewScrollMetrics>(initialMetrics);

  const measure = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    setMetrics(
      measurePreviewScroll(
        element.scrollLeft,
        element.scrollWidth,
        element.clientWidth,
      ),
    );
  }, []);

  const scrollTo = useCallback(
    (left: number) => {
      const element = elementRef.current;
      if (!element) return;
      element.scrollLeft = left;
      measure();
    },
    [measure],
  );

  useEffect(() => {
    if (!active) return;
    const element = elementRef.current;
    if (!element) return;

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(element);
    for (const child of element.children) resizeObserver?.observe(child);

    let followupFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      measure();
      followupFrame = window.requestAnimationFrame(measure);
    });
    const settleTimer = window.setTimeout(measure, 120);
    window.addEventListener("resize", measure);
    measure();

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (followupFrame) window.cancelAnimationFrame(followupFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
    };
  }, [active, layoutKey, measure]);

  return { elementRef, metrics, measure, scrollTo };
}

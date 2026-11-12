import { useEffect, useState, type ReactNode } from "react";
import { readImageMeta } from "@/lib/image-utils";
import { useImageEditorViewport } from "./use-image-editor-viewport";

type ImageDimensions = { width: number; height: number };
type ImageSource =
  | { source: string; status: "ready"; size: ImageDimensions }
  | { source: string; status: "loading" | "error" };

/** Source identity prevents the previous image's dimensions leaking into a new edit. */
export function useImageEditorSource(source: string, open: boolean) {
  const [state, setState] = useState<ImageSource>({ source, status: "loading" });
  useEffect(() => {
    if (!open || !source) return;
    const lifetime = new AbortController();
    setState({ source, status: "loading" });
    void readImageMeta(source).then(
      (size) => {
        if (!lifetime.signal.aborted) setState({ source, status: "ready", size });
      },
      () => {
        if (!lifetime.signal.aborted) setState({ source, status: "error" });
      },
    );
    return () => lifetime.abort();
  }, [source, open]);
  const current = open && state.source === source;
  return {
    image: current && state.status === "ready" ? state.size : null,
    imageReadError: Boolean(current && state.status === "error"),
  };
}

type ImageEditorSurfaceProps = {
  source: string;
  viewport: ReturnType<typeof useImageEditorViewport>;
  children: ReactNode;
  className?: string;
};

/** One viewport owns pan, zoom and media coordinates for every image editing tool. */
export function ImageEditorSurface({ source, viewport, children, className = "h-[340px]" }: ImageEditorSurfaceProps) {
  const cursor = viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : "";
  return (
    <div
      ref={viewport.viewportRef}
      {...viewport.panHandlers}
      className={`relative isolate min-h-[300px] rounded-xl bg-black/5 ${className} ${cursor} ${viewport.scrollClassName}`}
    >
      <div style={viewport.contentStyle} className="relative">
        <div
          ref={viewport.stageRef}
          style={viewport.stageStyle}
          className="absolute isolate overflow-hidden rounded-lg bg-black select-none [contain:layout_paint]"
        >
          <img
            alt=""
            src={source}
            draggable={false}
            style={viewport.mediaStyle}
            className="pointer-events-none absolute left-0 top-0 block object-contain"
          />
          {children}
        </div>
      </div>
    </div>
  );
}

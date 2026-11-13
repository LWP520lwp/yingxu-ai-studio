import { Button, Modal, Slider, Tooltip } from "antd";
import {
  Brush,
  Eraser,
  ImagePlus,
  Redo2,
  RotateCcw,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as CanvasPointer,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "./use-image-editor-viewport";
import { readImageMeta } from "@/lib/image-utils";
import { MaskEditorSession } from "@/atlas-engine/workflows/mask-editor-session";
import {
  ATLAS_MASK_BRUSH_MAX,
  ATLAS_MASK_BRUSH_MIN,
  ATLAS_MASK_BRUSH_STEP,
  ATLAS_MASK_OVERLAY_OPACITY,
  clampAtlasMaskBrushSize,
  mapAtlasMaskPoint,
  MaskRasterSurface,
  type AtlasMaskCanvasBounds,
} from "@/atlas-engine/workflows/mask-raster";
import type { AtlasMaskDrawMode } from "@/atlas-engine/workflows/mask-strokes";

export type CanvasImageMaskEditPayload = {
  prompt: string;
  maskDataUrl: string;
  generate: boolean;
};
type MaskDialogProps = {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: CanvasImageMaskEditPayload) => void;
};
type StrokeCoordinates = { pointer: number; bounds: AtlasMaskCanvasBounds };
type BrushAdjustment = { pointer: number; startX: number; size: number };

export function CanvasNodeMaskEditDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: MaskDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      footer={null}
      title={t("canvas.editors.maskTitle")}
      width={1040}
      centered
      destroyOnHidden
    >
      {open && dataUrl && (
        <MaskWorkspace key={dataUrl} source={dataUrl} confirm={onConfirm} />
      )}
    </Modal>
  );
}

function MaskWorkspace({
  source,
  confirm,
}: {
  source: string;
  confirm: MaskDialogProps["onConfirm"];
}) {
  const { t } = useTranslation();
  const field = useId();
  const [session] = useState(() => new MaskEditorSession());
  const status = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [image, setImage] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [size, setSize] = useState(100);
  const [mode, setMode] = useState<AtlasMaskDrawMode>("paint");
  const [hovered, setHovered] = useState(false);
  const picture = useRef<HTMLImageElement>(null);
  const raster = useRef<MaskRasterSurface | null>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const lastCursor = useRef({ x: 0, y: 0 });
  const coordinates = useRef<StrokeCoordinates | null>(null);
  const adjustment = useRef<BrushAdjustment | null>(null);
  const view = useImageEditorViewport(image, true);

  useEffect(() => {
    let alive = true;
    readImageMeta(source).then(
      (value) => {
        if (alive) setImage(value);
      },
      () => {
        if (alive) setError("canvas.editors.maskImageLoadFailed");
      },
    );
    return () => {
      alive = false;
    };
  }, [source]);

  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      raster.current = canvas ? new MaskRasterSurface(canvas) : null;
      session.attach(raster.current);
    },
    [session],
  );

  const abort = useCallback(() => {
    coordinates.current = null;
    adjustment.current = null;
    session.cancel();
    setHovered(false);
  }, [session]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input,textarea,[contenteditable='true']")
      )
        return;
      if (event.key === "Escape" && session.getSnapshot().drawing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        abort();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === "y" || event.shiftKey) session.redo();
      else session.undo();
    };
    window.addEventListener("blur", abort);
    window.addEventListener("keydown", shortcut, true);
    return () => {
      window.removeEventListener("blur", abort);
      window.removeEventListener("keydown", shortcut, true);
      session.cancel();
    };
  }, [abort, session]);

  const moveCursor = (x: number, y: number) => {
    lastCursor.current = { x, y };
    if (cursor.current)
      cursor.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  };
  const pointAt = (
    event: CanvasPointer<HTMLCanvasElement>,
    x = event.clientX,
    y = event.clientY,
  ) =>
    mapAtlasMaskPoint(
      x,
      y,
      coordinates.current?.bounds ??
        event.currentTarget.getBoundingClientRect(),
      event.currentTarget,
    );

  const begin = (event: CanvasPointer<HTMLCanvasElement>) => {
    if (
      view.spacePressed ||
      view.isPanning ||
      status.drawing ||
      adjustment.current
    )
      return;
    if (event.button !== 0 && !(event.altKey && event.button === 2)) return;
    event.preventDefault();
    event.stopPropagation();
    setHovered(true);
    moveCursor(event.clientX, event.clientY);
    if (event.altKey) {
      adjustment.current = {
        pointer: event.pointerId,
        startX: event.clientX,
        size,
      };
    } else {
      // One layout read for the entire stroke; pointer samples never trigger measurements.
      coordinates.current = {
        pointer: event.pointerId,
        bounds: event.currentTarget.getBoundingClientRect(),
      };
      if (!session.begin(event.pointerId, mode, size, pointAt(event))) {
        coordinates.current = null;
        return;
      }
      setError("");
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: CanvasPointer<HTMLCanvasElement>) => {
    const brush = adjustment.current;
    if (brush?.pointer === event.pointerId) {
      setSize(
        clampAtlasMaskBrushSize(brush.size + event.clientX - brush.startX),
      );
      event.preventDefault();
      return;
    }
    moveCursor(event.clientX, event.clientY);
    if (coordinates.current?.pointer !== event.pointerId) return;
    event.preventDefault();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    session.append(event.pointerId, [
      ...samples.map((sample) =>
        pointAt(event, sample.clientX, sample.clientY),
      ),
      pointAt(event),
    ]);
  };

  const finish = (event: CanvasPointer<HTMLCanvasElement>) => {
    if (adjustment.current?.pointer === event.pointerId)
      adjustment.current = null;
    if (coordinates.current?.pointer === event.pointerId) {
      session.end(event.pointerId, event.type === "pointerup", pointAt(event));
      coordinates.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type !== "pointerup") setHovered(false);
  };

  const submit = (generate: boolean) => {
    const text = prompt.trim();
    if (!text) {
      setError("canvas.editors.maskPromptRequired");
      return;
    }
    if (
      status.drawing ||
      !raster.current ||
      !picture.current?.complete ||
      !picture.current.naturalWidth
    )
      return;
    let maskDataUrl: string;
    try {
      if (!raster.current.hasPaint()) {
        setError("canvas.editors.maskRequired");
        return;
      }
      maskDataUrl = raster.current.exportOverlay(picture.current);
    } catch {
      setError("canvas.editors.maskImageLoadFailed");
      return;
    }
    confirm({ prompt: text, maskDataUrl, generate });
  };

  const iconAction = (
    key: string,
    icon: React.ReactNode,
    action: () => void,
    disabled = false,
  ) => (
    <Tooltip title={t(key)}>
      <Button
        type="text"
        icon={icon}
        onClick={action}
        aria-label={t(key)}
        disabled={disabled}
      />
    </Tooltip>
  );

  return (
    <section className="flex min-w-0 flex-col gap-4 pt-2" data-canvas-no-zoom>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
        <div
          className="flex gap-1"
          role="group"
          aria-label={t("canvas.editors.maskTitle")}
        >
          <Button
            icon={<Brush size={16} />}
            type={mode === "paint" ? "primary" : "text"}
            aria-pressed={mode === "paint"}
            onClick={() => setMode("paint")}
          >
            {t("canvas.editors.brush")}
          </Button>
          <Button
            icon={<Eraser size={16} />}
            type={mode === "erase" ? "primary" : "text"}
            aria-pressed={mode === "erase"}
            onClick={() => setMode("erase")}
          >
            {t("canvas.editors.erase")}
          </Button>
        </div>
        <label className="flex min-w-48 flex-1 items-center gap-3 text-xs">
          <span>{t("canvas.editors.brushSize")}</span>
          <Slider
            className="min-w-20 flex-1"
            aria-label={t("canvas.editors.brushSize")}
            min={ATLAS_MASK_BRUSH_MIN}
            max={ATLAS_MASK_BRUSH_MAX}
            step={ATLAS_MASK_BRUSH_STEP}
            value={size}
            onChange={(value) => setSize(clampAtlasMaskBrushSize(value))}
          />
          <span className="w-10 text-right tabular-nums">{size}px</span>
        </label>
        <div className="flex items-center gap-1">
          {iconAction(
            "canvas.editors.undoMask",
            <Undo2 size={16} />,
            session.undo,
            status.drawing || !status.undoCount,
          )}
          {iconAction(
            "canvas.editors.redoMask",
            <Redo2 size={16} />,
            session.redo,
            status.drawing || !status.redoCount,
          )}
          {iconAction("canvas.editors.reset", <RotateCcw size={16} />, () => {
            abort();
            session.reset();
            setError("");
          })}
        </div>
      </div>

      <div
        ref={view.viewportRef}
        {...view.panHandlers}
        onWheelCapture={abort}
        className={`relative h-[min(52vh,600px)] min-h-64 rounded-lg border bg-black/[.025] dark:bg-white/[.025] ${view.scrollClassName} ${view.isPanning ? "cursor-grabbing" : view.spacePressed ? "cursor-grab" : ""}`}
      >
        <div className="relative" style={view.contentStyle}>
          <div
            ref={view.stageRef}
            style={view.stageStyle}
            className="absolute isolate overflow-hidden select-none"
          >
            {image && (
              <div className="absolute left-0 top-0" style={view.mediaStyle}>
                <img
                  ref={picture}
                  src={source}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 size-full object-contain"
                  onError={() => setError("canvas.editors.maskImageLoadFailed")}
                />
                <canvas
                  ref={attachCanvas}
                  width={image.width}
                  height={image.height}
                  className={`absolute inset-0 size-full touch-none ${view.spacePressed ? "cursor-grab" : "cursor-none"}`}
                  style={{ opacity: ATLAS_MASK_OVERLAY_OPACITY }}
                  onPointerDown={begin}
                  onPointerMove={move}
                  onPointerUp={finish}
                  onPointerCancel={finish}
                  onLostPointerCapture={(event) => {
                    if (
                      coordinates.current?.pointer === event.pointerId ||
                      adjustment.current?.pointer === event.pointerId
                    )
                      abort();
                  }}
                  onPointerEnter={(event) => {
                    moveCursor(event.clientX, event.clientY);
                    setHovered(true);
                  }}
                  onPointerLeave={() => {
                    if (!coordinates.current && !adjustment.current)
                      setHovered(false);
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                />
              </div>
            )}
          </div>
        </div>
        {!image && (
          <div
            className="absolute inset-0 grid place-content-center text-sm opacity-60"
            role="status"
          >
            {error ? t(error) : t("canvas.editors.loading")}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs opacity-70">
        <span>{t("canvas.editors.maskHint")}</span>
        <div className="flex items-center gap-1 tabular-nums">
          {image && (
            <span className="mr-2">
              {image.width} × {image.height}px
            </span>
          )}
          {iconAction(
            "canvas.editors.zoomOut",
            <ZoomOut size={16} />,
            view.zoomOut,
            status.drawing || !view.canZoomOut,
          )}
          <Button
            type="text"
            onClick={view.resetZoom}
            disabled={status.drawing}
            aria-label={t("canvas.editors.reset")}
          >
            {Math.round(view.zoom * 100)}%
          </Button>
          {iconAction(
            "canvas.editors.zoomIn",
            <ZoomIn size={16} />,
            view.zoomIn,
            status.drawing || !view.canZoomIn,
          )}
        </div>
      </div>

      <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <label className="mb-2 block text-sm font-medium" htmlFor={field}>
            {t("canvas.editors.editInstructions")}
          </label>
          <textarea
            id={field}
            rows={3}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setError("");
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${field}-error` : undefined}
            placeholder={t("canvas.editors.maskPlaceholder")}
            className="block w-full resize-y rounded-lg border bg-transparent p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          />
          {error && (
            <p
              id={`${field}-error`}
              className="mb-0 mt-2 text-xs text-red-600"
              role="alert"
            >
              {t(error)}
            </p>
          )}
          {status.hasCheckpoint && (
            <p className="mb-0 mt-2 text-xs opacity-60">
              {t("canvas.editors.maskHistoryLimit")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pb-1">
          <Button
            icon={<ImagePlus size={16} />}
            disabled={!image || status.drawing}
            onClick={() => submit(false)}
          >
            {t("canvas.editors.maskExport")}
          </Button>
          <Button
            type="primary"
            icon={<WandSparkles size={16} />}
            disabled={!image || status.drawing}
            onClick={() => submit(true)}
          >
            {t("canvas.editors.maskGenerate")}
          </Button>
        </div>
      </div>

      {hovered &&
        image &&
        !view.isPanning &&
        !view.spacePressed &&
        createPortal(
          <div
            ref={cursor}
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-[1100] rounded-full border-2 border-white shadow-[0_0_0_1px_#1f2937]"
            style={{
              width: Math.max(4, size * view.imageScale),
              aspectRatio: 1,
              transform: `translate(${lastCursor.current.x}px, ${lastCursor.current.y}px) translate(-50%, -50%)`,
            }}
          />,
          document.body,
        )}
    </section>
  );
}

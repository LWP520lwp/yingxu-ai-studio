import { Button, Input, Modal, Slider, Tooltip } from "antd";
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
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import {
  ATLAS_MASK_HISTORY_LIMIT,
  commitAtlasMaskStroke,
  redoAtlasMaskStroke,
  undoAtlasMaskStroke,
  type AtlasMaskStrokeHistory,
} from "@/atlas-engine/workflows/mask-strokes";
import {
  ATLAS_MASK_OVERLAY,
  ATLAS_MASK_OVERLAY_OPACITY,
  clampAtlasMaskBrushSize,
  clearAtlasMaskCanvas,
  composeAtlasMaskOverlay,
  hasAtlasMaskPixels,
  mapAtlasMaskPoint,
  renderAtlasMaskSegment,
  renderAtlasMaskStroke,
  replayAtlasMaskLayers,
} from "@/atlas-engine/workflows/mask-raster";
import {
  appendAtlasMaskPointerPoint,
  beginAtlasMaskPointer,
  finishAtlasMaskPointer,
  type AtlasMaskPointerSession,
} from "@/atlas-engine/workflows/mask-pointer";

export type CanvasImageMaskEditPayload = {
  prompt: string;
  maskDataUrl: string;
  generate: boolean;
};

type DrawMode = "paint" | "erase";
type ImageSize = { width: number; height: number };
type CursorState = { x: number; y: number };

const startingBrushSize = 100;

export function CanvasNodeMaskEditDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: CanvasImageMaskEditPayload) => void;
}) {
  const { t } = useTranslation();
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseMaskRef = useRef<HTMLCanvasElement>(null);
  const baseOverlayRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const sessionRef = useRef<AtlasMaskPointerSession | null>(null);
  const historyRef = useRef<AtlasMaskStrokeHistory>({ history: [], redo: [] });
  const loadVersionRef = useRef(0);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [prompt, setPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(startingBrushSize);
  const [mode, setMode] = useState<DrawMode>("paint");
  const [error, setError] = useState("");
  const [historySize, setHistorySize] = useState(0);
  const [redoSize, setRedoSize] = useState(0);
  const [historyFull, setHistoryFull] = useState(false);
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const viewportState = useImageEditorViewport(imageSize, open);

  useEffect(() => {
    const version = ++loadVersionRef.current;
    if (!open) {
      setImageSize(null);
      return;
    }
    setImageSize(null);
    setPrompt("");
    setBrushSize(startingBrushSize);
    setMode("paint");
    setError("");
    setHistorySize(0);
    setRedoSize(0);
    setHistoryFull(false);
    setCursor(null);
    sessionRef.current = null;
    historyRef.current = { history: [], redo: [] };
    for (const canvas of [
      maskCanvasRef.current,
      liveCanvasRef.current,
      baseMaskRef.current,
      baseOverlayRef.current,
    ])
      clearAtlasMaskCanvas(canvas);
    void readImageMeta(dataUrl)
      .then((size) => {
        if (loadVersionRef.current === version) setImageSize(size);
      })
      .catch(() => {
        if (loadVersionRef.current === version)
          setError(t("canvas.editors.maskImageLoadFailed"));
      });
    return () => {
      loadVersionRef.current += 1;
    };
  }, [dataUrl, open, t]);

  useEffect(() => {
    if (!imageSize) return;
    for (const canvas of [
      maskCanvasRef.current,
      liveCanvasRef.current,
      baseMaskRef.current,
      baseOverlayRef.current,
    ])
      clearAtlasMaskCanvas(canvas);
  }, [imageSize]);

  const drawSegment = (
    stroke: AtlasMaskPointerSession["stroke"],
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const maskContext = maskCanvasRef.current?.getContext("2d", {
      willReadFrequently: true,
    });
    const overlayContext = liveCanvasRef.current?.getContext("2d");
    if (!maskContext || !overlayContext) return;
    renderAtlasMaskSegment(maskContext, stroke, from, to, { color: "#000" });
    renderAtlasMaskSegment(overlayContext, stroke, from, to, {
      color: ATLAS_MASK_OVERLAY,
    });
  };

  const readPoint = (canvas: HTMLCanvasElement, x: number, y: number) => {
    const rect = canvas.getBoundingClientRect();
    return mapAtlasMaskPoint(x, y, rect, canvas);
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || sessionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = readPoint(event.currentTarget, event.clientX, event.clientY);
    const session = beginAtlasMaskPointer(
      event.pointerId,
      mode,
      brushSize,
      point,
    );
    sessionRef.current = session;
    drawSegment(session.stroke, point, point);
    setCursor({ x: event.clientX, y: event.clientY });
  };

  const moveStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    setCursor({ x: event.clientX, y: event.clientY });
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = readPoint(event.currentTarget, event.clientX, event.clientY);
    const from = session.stroke.points.at(-1) || point;
    if (appendAtlasMaskPointerPoint(session, event.pointerId, point))
      drawSegment(session.stroke, from, point);
  };

  const replay = (history: AtlasMaskStrokeHistory) =>
    replayAtlasMaskLayers(
      history.history,
      baseMaskRef.current,
      baseOverlayRef.current,
      maskCanvasRef.current,
      liveCanvasRef.current,
    );

  const stopStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const ended = event.type === "pointerup";
    const point = ended
      ? readPoint(event.currentTarget, event.clientX, event.clientY)
      : undefined;
    const priorPoint = session.stroke.points.at(-1);
    const result = finishAtlasMaskPointer(
      session,
      event.pointerId,
      ended ? "up" : "cancel",
      point,
    );
    sessionRef.current = result.session;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!ended || !result.stroke) {
      replay(historyRef.current);
      return;
    }
    if (
      point &&
      priorPoint &&
      (point.x !== priorPoint.x || point.y !== priorPoint.y)
    )
      drawSegment(result.stroke, priorPoint, point);
    const next = commitAtlasMaskStroke(historyRef.current, result.stroke);
    historyRef.current = { history: next.history, redo: next.redo };
    for (const stroke of next.evictedStrokes) {
      renderAtlasMaskStroke(
        baseMaskRef.current?.getContext("2d", { willReadFrequently: true }) ||
          null,
        stroke,
        { color: "#000" },
      );
      renderAtlasMaskStroke(
        baseOverlayRef.current?.getContext("2d") || null,
        stroke,
        { color: ATLAS_MASK_OVERLAY },
      );
    }
    setHistorySize(next.history.length);
    setRedoSize(next.redo.length);
    if (next.droppedStrokes) setHistoryFull(true);
  };

  const undo = useCallback(() => {
    if (sessionRef.current || !historyRef.current.history.length) return;
    historyRef.current = undoAtlasMaskStroke(historyRef.current);
    setHistorySize(historyRef.current.history.length);
    setRedoSize(historyRef.current.redo.length);
    replayAtlasMaskLayers(
      historyRef.current.history,
      baseMaskRef.current,
      baseOverlayRef.current,
      maskCanvasRef.current,
      liveCanvasRef.current,
    );
    setError("");
  }, []);

  const redo = useCallback(() => {
    if (sessionRef.current || !historyRef.current.redo.length) return;
    const before = historyRef.current;
    const stroke = before.redo.at(-1);
    historyRef.current = redoAtlasMaskStroke(before);
    if (stroke && historyRef.current.history.length >= ATLAS_MASK_HISTORY_LIMIT) {
      const evicted = before.history.length + 1 - historyRef.current.history.length;
      if (evicted > 0) {
        for (const oldStroke of [...before.history, stroke].slice(0, evicted)) {
          renderAtlasMaskStroke(
            baseMaskRef.current?.getContext("2d", {
              willReadFrequently: true,
            }) || null,
            oldStroke,
            { color: "#000" },
          );
          renderAtlasMaskStroke(
            baseOverlayRef.current?.getContext("2d") || null,
            oldStroke,
            { color: ATLAS_MASK_OVERLAY },
          );
        }
      }
    }
    setHistorySize(historyRef.current.history.length);
    setRedoSize(historyRef.current.redo.length);
    replayAtlasMaskLayers(
      historyRef.current.history,
      baseMaskRef.current,
      baseOverlayRef.current,
      maskCanvasRef.current,
      liveCanvasRef.current,
    );
    setError("");
  }, []);

  const reset = () => {
    historyRef.current = { history: [], redo: [] };
    sessionRef.current = null;
    for (const canvas of [
      maskCanvasRef.current,
      liveCanvasRef.current,
      baseMaskRef.current,
      baseOverlayRef.current,
    ])
      clearAtlasMaskCanvas(canvas);
    setHistorySize(0);
    setRedoSize(0);
    setHistoryFull(false);
    setError("");
  };

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input,textarea,[contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const modifier = (event.metaKey || event.ctrlKey) && !event.altKey;
      const undoKey = modifier && !event.shiftKey && key === "z";
      const redoKey =
        modifier &&
        ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
      if (!undoKey && !redoKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (redoKey) redo();
      else undo();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [open, redo, undo]);

  const submit = (generate: boolean) => {
    const text = prompt.trim();
    const mask = maskCanvasRef.current;
    const image = imageRef.current;
    if (!text) return setError(t("canvas.editors.maskPromptRequired"));
    if (!mask || !image || !image.complete) return;
    if (!hasAtlasMaskPixels(mask)) return setError(t("canvas.editors.maskRequired"));
    onConfirm({
      prompt: text,
      maskDataUrl: composeAtlasMaskOverlay(image, mask),
      generate,
    });
  };

  const cursorSize = brushSize * viewportState.imageScale;
  return (
    <Modal
      title={null}
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      footer={null}
      width={980}
      centered
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
    >
      <div
        className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]"
        data-canvas-no-zoom
      >
        <div
          ref={viewportState.viewportRef}
          {...viewportState.panHandlers}
          className={`relative h-[min(68vh,720px)] min-h-[360px] rounded-lg border border-black/10 bg-transparent dark:border-white/10 ${viewportState.scrollClassName} ${viewportState.isPanning ? "cursor-grabbing" : viewportState.spacePressed ? "cursor-grab" : ""}`}
        >
          <div className="relative" style={viewportState.contentStyle}>
            <div
              ref={viewportState.stageRef}
              className="absolute isolate overflow-hidden rounded-md select-none"
              style={viewportState.stageStyle}
            >
              {imageSize ? (
                <>
                  <canvas
                    ref={maskCanvasRef}
                    width={imageSize.width}
                    height={imageSize.height}
                    className="hidden"
                  />
                  <canvas
                    ref={baseMaskRef}
                    width={imageSize.width}
                    height={imageSize.height}
                    className="hidden"
                  />
                  <canvas
                    ref={baseOverlayRef}
                    width={imageSize.width}
                    height={imageSize.height}
                    className="hidden"
                  />
                  <div
                    className="absolute left-0 top-0"
                    style={viewportState.mediaStyle}
                  >
                    <img
                      ref={imageRef}
                      src={dataUrl}
                      alt=""
                      draggable={false}
                      className="absolute inset-0 block size-full bg-transparent object-contain"
                      onError={() =>
                        setError(t("canvas.editors.maskImageLoadFailed"))
                      }
                    />
                    <canvas
                      ref={liveCanvasRef}
                      width={imageSize.width}
                      height={imageSize.height}
                      className="absolute inset-0 size-full cursor-none touch-none"
                      style={{ opacity: ATLAS_MASK_OVERLAY_OPACITY }}
                      onPointerDown={startStroke}
                      onPointerMove={moveStroke}
                      onPointerUp={stopStroke}
                      onPointerCancel={stopStroke}
                      onPointerLeave={() => {
                        if (!sessionRef.current) setCursor(null);
                      }}
                      onContextMenu={(event) => event.preventDefault()}
                    />
                  </div>
                </>
              ) : (
                <div className="grid h-full place-items-center text-sm opacity-60">
                  {error || t("canvas.editors.loading")}
                </div>
              )}
            </div>
          </div>
        </div>
        {cursor && imageSize
          ? createPortal(
              <div
                className="pointer-events-none fixed z-[1100] rounded-full border-2 border-white/90 bg-black/5 shadow-[0_0_0_1px_rgba(0,0,0,.8)]"
                style={{
                  left: cursor.x,
                  top: cursor.y,
                  width: Math.max(4, cursorSize),
                  aspectRatio: 1,
                  transform: "translate(-50%, -50%)",
                }}
              />,
              document.body,
            )
          : null}
        <div className="flex min-h-[360px] flex-col gap-5">
          <header>
            <h2 className="text-lg font-semibold">
              {t("canvas.editors.maskTitle")}
            </h2>
            <div className="mt-1 text-xs opacity-60">
              {imageSize
                ? `${imageSize.width} × ${imageSize.height}px`
                : t("canvas.editors.loading")}
            </div>
          </header>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type={mode === "paint" ? "primary" : "default"}
              icon={<Brush size={15} />}
              onClick={() => setMode("paint")}
            >
              {t("canvas.editors.brush")}
            </Button>
            <Button
              type={mode === "erase" ? "primary" : "default"}
              icon={<Eraser size={15} />}
              onClick={() => setMode("erase")}
            >
              {t("canvas.editors.erase")}
            </Button>
          </div>
          <div className="flex items-center justify-between border-y py-1">
            <Tooltip title={t("canvas.editors.undoMaskTitle")}>
              <Button
                type="text"
                icon={<Undo2 size={16} />}
                disabled={!historySize}
                aria-label={t("canvas.editors.undoMask")}
                onClick={undo}
              />
            </Tooltip>
            <Tooltip title={t("canvas.editors.redoMaskTitle")}>
              <Button
                type="text"
                icon={<Redo2 size={16} />}
                disabled={!redoSize}
                aria-label={t("canvas.editors.redoMask")}
                onClick={redo}
              />
            </Tooltip>
            <div className="flex items-center gap-1">
              <Tooltip title={t("canvas.editors.zoomOut")}>
                <Button
                  type="text"
                  icon={<ZoomOut size={16} />}
                  disabled={!viewportState.canZoomOut}
                  aria-label={t("canvas.editors.zoomOut")}
                  onClick={viewportState.zoomOut}
                />
              </Tooltip>
              <button
                type="button"
                className="min-w-14 text-center text-xs font-semibold tabular-nums"
                onClick={viewportState.resetZoom}
              >
                {Math.round(viewportState.zoom * 100)}%
              </button>
              <Tooltip title={t("canvas.editors.zoomIn")}>
                <Button
                  type="text"
                  icon={<ZoomIn size={16} />}
                  disabled={!viewportState.canZoomIn}
                  aria-label={t("canvas.editors.zoomIn")}
                  onClick={viewportState.zoomIn}
                />
              </Tooltip>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-sm">
              <span>{t("canvas.editors.brushSize")}</span>
              <span className="font-semibold">{brushSize}px</span>
            </div>
            <Slider
              min={8}
              max={160}
              step={2}
              value={brushSize}
              onChange={(value) => setBrushSize(clampAtlasMaskBrushSize(value))}
            />
            {historyFull ? (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {t("canvas.editors.maskHistoryLimit")}
              </div>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="mask-edit-instructions"
              className="mb-2 block text-sm font-medium"
            >
              {t("canvas.editors.editInstructions")}
            </label>
            <Input.TextArea
              id="mask-edit-instructions"
              rows={6}
              value={prompt}
              status={error && !prompt.trim() ? "error" : undefined}
              placeholder={t("canvas.editors.maskPlaceholder")}
              onChange={(event) => {
                setPrompt(event.target.value);
                setError("");
              }}
            />
            {error ? (
              <div
                role="alert"
                className="mt-2 text-xs font-medium text-red-600"
              >
                {error}
              </div>
            ) : null}
          </div>
          <footer className="mt-auto flex flex-wrap items-center justify-between gap-2">
            <Button icon={<RotateCcw size={15} />} onClick={reset}>
              {t("canvas.editors.reset")}
            </Button>
            <div className="flex gap-2">
              <Button
                icon={<ImagePlus size={15} />}
                onClick={() => submit(false)}
              >
                {t("canvas.editors.maskExport")}
              </Button>
              <Button
                type="primary"
                icon={<WandSparkles size={15} />}
                onClick={() => submit(true)}
              >
                {t("canvas.editors.maskGenerate")}
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </Modal>
  );
}

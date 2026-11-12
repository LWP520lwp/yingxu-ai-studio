import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
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
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import {
  commitMaskStroke,
  redoMaskStroke,
  undoMaskStroke,
  type MaskStrokeHistory,
} from "@/lib/canvas/mask-stroke-history";
import {
  MASK_OVERLAY_ALPHA,
  MASK_OVERLAY_COLOR,
  clampMaskBrushSize,
  clearMaskCanvas,
  composeMaskOverlay,
  hasMaskPixels,
  mapMaskCanvasPoint,
  renderMaskSegment,
  renderMaskStroke,
  replayMaskLayers,
} from "@/lib/canvas/mask-editor-engine";
import {
  appendMaskPointerSessionPoint,
  beginMaskPointerSession,
  finishMaskPointerSession,
  type MaskPointerSession,
} from "@/lib/canvas/mask-pointer-session";

export type CanvasImageMaskEditPayload = {
  prompt: string;
  maskDataUrl: string;
  generate: boolean;
};

type DrawMode = "paint" | "erase";
type BrushPreview = { x: number; y: number; size: number; adjusting: boolean };

const defaultBrushSize = 100;
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
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const basePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drawingRef = useRef<MaskPointerSession | null>(null);
  const brushAdjustRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startSize: number;
    previewX: number;
    previewY: number;
  } | null>(null);
  const historyRef = useRef<MaskStrokeHistory>({ history: [], redo: [] });
  const [image, setImage] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(defaultBrushSize);
  const [mode, setMode] = useState<DrawMode>("paint");
  const [error, setError] = useState("");
  const [historySize, setHistorySize] = useState(0);
  const [redoSize, setRedoSize] = useState(0);
  const [historyLimitReached, setHistoryLimitReached] = useState(false);
  const [brushPreview, setBrushPreview] = useState<BrushPreview | null>(null);
  const viewport = useImageEditorViewport(image, open);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setBrushSize(defaultBrushSize);
    setMode("paint");
    setError("");
    setHistorySize(0);
    setRedoSize(0);
    setBrushPreview(null);
    historyRef.current = { history: [], redo: [] };
    setHistoryLimitReached(false);
    brushAdjustRef.current = null;
    drawingRef.current = null;
    clearMaskCanvas(maskCanvasRef.current);
    clearMaskCanvas(previewCanvasRef.current);
    clearMaskCanvas(baseMaskCanvasRef.current);
    clearMaskCanvas(basePreviewCanvasRef.current);
    void readImageMeta(dataUrl).then(setImage);
  }, [dataUrl, open]);

  useEffect(() => {
    clearMaskCanvas(maskCanvasRef.current);
    clearMaskCanvas(previewCanvasRef.current);
    clearMaskCanvas(baseMaskCanvasRef.current);
    clearMaskCanvas(basePreviewCanvasRef.current);
  }, [image]);

  useEffect(() => {
    if (!open) return;
    return () => {
      const canvas = previewCanvasRef.current;
      for (const pointerId of [
        drawingRef.current?.pointerId,
        brushAdjustRef.current?.pointerId,
      ]) {
        if (pointerId !== undefined && canvas?.hasPointerCapture(pointerId)) {
          canvas.releasePointerCapture(pointerId);
        }
      }
      drawingRef.current = null;
      brushAdjustRef.current = null;
    };
  }, [open]);

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const session = drawingRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const point = readCanvasPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    const maskCanvas = maskCanvasRef.current;
    const context = maskCanvas?.getContext("2d", { willReadFrequently: true });
    const previewContext = previewCanvasRef.current?.getContext("2d");
    const stroke = session.stroke;
    if (!maskCanvas || !context || !previewContext) return;
    const last = stroke.points.at(-1);
    if (!appendMaskPointerSessionPoint(session, event.pointerId, point)) return;
    renderMaskSegment(context, stroke, last || point, point, { color: "#000" });
    renderMaskSegment(previewContext, stroke, last || point, point, {
      color: MASK_OVERLAY_COLOR,
    });
    if (stroke.mode === "paint") {
      setError("");
    }
  };

  const updateBrushPreview = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    size = brushSize,
    adjusting = false,
  ) => {
    setBrushPreview({
      x: event.clientX,
      y: event.clientY,
      size,
      adjusting,
    });
  };

  const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drawingRef.current || brushAdjustRef.current) return;
    if ((event.button === 0 || event.button === 2) && event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      brushAdjustRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startSize: brushSize,
        previewX: event.clientX,
        previewY: event.clientY,
      };
      updateBrushPreview(event, brushSize, true);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateBrushPreview(event);
    drawingRef.current = beginMaskPointerSession(
      event.pointerId,
      mode,
      brushSize,
    );
    draw(event);
  };

  const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const brushAdjust = brushAdjustRef.current;
    if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const nextSize = clampMaskBrushSize(
        brushAdjust.startSize + event.clientX - brushAdjust.startX,
      );
      setBrushSize(nextSize);
      setBrushPreview({
        x: brushAdjust.previewX,
        y: brushAdjust.previewY,
        size: nextSize,
        adjusting: true,
      });
      return;
    }
    updateBrushPreview(event);
    if (!drawingRef.current || drawingRef.current.pointerId !== event.pointerId)
      return;
    event.preventDefault();
    draw(event);
  };

  const stopDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const brushAdjust = brushAdjustRef.current;
    if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
      brushAdjustRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      const canceled = event.type !== "pointerup";
      if (canceled) setBrushSize(brushAdjust.startSize);
      if (canceled) setBrushPreview(null);
      else updateBrushPreview(event, brushSize);
      return;
    }
    const session = drawingRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const canceled = event.type !== "pointerup";
    const previous = session.stroke.points.at(-1);
    const previousLength = session.stroke.points.length;
    const finalPoint = canceled
      ? undefined
      : readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
    const result = finishMaskPointerSession(
      session,
      event.pointerId,
      canceled ? "cancel" : "up",
      finalPoint,
    );
    drawingRef.current = result.session;
    const stroke = result.stroke;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      !canceled &&
      stroke &&
      previous &&
      stroke.points.length > previousLength
    ) {
      const point = stroke.points.at(-1)!;
      const maskContext = maskCanvasRef.current?.getContext("2d", {
        willReadFrequently: true,
      });
      const previewContext = previewCanvasRef.current?.getContext("2d");
      if (maskContext && previewContext) {
        renderMaskSegment(maskContext, stroke, previous, point, {
          color: "#000",
        });
        renderMaskSegment(previewContext, stroke, previous, point, {
          color: MASK_OVERLAY_COLOR,
        });
      }
    }
    if (canceled) setBrushPreview(null);
    if (stroke) {
      const next = commitMaskStroke(historyRef.current, stroke);
      historyRef.current = { history: next.history, redo: next.redo };
      for (const evicted of next.evictedStrokes) {
        renderMaskStroke(
          baseMaskCanvasRef.current?.getContext("2d", {
            willReadFrequently: true,
          }) || null,
          evicted,
          { color: "#000" },
        );
        renderMaskStroke(
          basePreviewCanvasRef.current?.getContext("2d") || null,
          evicted,
          { color: MASK_OVERLAY_COLOR },
        );
      }
      setHistorySize(next.history.length);
      setRedoSize(next.redo.length);
      if (next.droppedStrokes) setHistoryLimitReached(true);
    }
  };

  const undoMask = useCallback(() => {
    if (drawingRef.current || !historyRef.current.history.length) return;
    historyRef.current = undoMaskStroke(historyRef.current);
    setHistorySize(historyRef.current.history.length);
    setRedoSize(historyRef.current.redo.length);
    replayMaskLayers(
      historyRef.current.history,
      baseMaskCanvasRef.current,
      basePreviewCanvasRef.current,
      maskCanvasRef.current,
      previewCanvasRef.current,
    );
    setError("");
  }, []);

  const redoMask = useCallback(() => {
    if (drawingRef.current || !historyRef.current.redo.length) return;
    historyRef.current = redoMaskStroke(historyRef.current);
    setHistorySize(historyRef.current.history.length);
    setRedoSize(historyRef.current.redo.length);
    replayMaskLayers(
      historyRef.current.history,
      baseMaskCanvasRef.current,
      basePreviewCanvasRef.current,
      maskCanvasRef.current,
      previewCanvasRef.current,
    );
    setError("");
  }, []);

  const resetMask = () => {
    historyRef.current = { history: [], redo: [] };
    setHistoryLimitReached(false);
    setHistorySize(0);
    setRedoSize(0);
    drawingRef.current = null;
    clearMaskCanvas(maskCanvasRef.current);
    clearMaskCanvas(previewCanvasRef.current);
    clearMaskCanvas(baseMaskCanvasRef.current);
    clearMaskCanvas(basePreviewCanvasRef.current);
    setError("");
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input,textarea,[contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const modifier = (event.metaKey || event.ctrlKey) && !event.altKey;
      const isUndo = modifier && !event.shiftKey && key === "z";
      const isRedo =
        modifier &&
        ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
      if (!isUndo && !isRedo) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (isRedo) redoMask();
      else undoMask();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, redoMask, undoMask]);

  const submit = (generate: boolean) => {
    const nextPrompt = prompt.trim();
    const canvas = maskCanvasRef.current;
    const element = imageRef.current;
    if (!nextPrompt) return setError(t("canvas.editors.maskPromptRequired"));
    if (!canvas || !element) return;
    if (!hasMaskPixels(canvas))
      return setError(t("canvas.editors.maskRequired"));
    onConfirm({
      prompt: nextPrompt,
      maskDataUrl: composeMaskOverlay(element, canvas),
      generate,
    });
  };

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
          ref={viewport.viewportRef}
          {...viewport.panHandlers}
          className={`relative h-[min(68vh,720px)] min-h-[360px] rounded-xl border border-black/10 bg-transparent dark:border-white/10 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
        >
          <div className="relative" style={viewport.contentStyle}>
            <div
              ref={viewport.stageRef}
              className="absolute isolate overflow-hidden rounded-lg bg-transparent select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]"
              style={viewport.stageStyle}
            >
              {image ? (
                <>
                  <canvas
                    ref={maskCanvasRef}
                    width={image.width}
                    height={image.height}
                    className="hidden"
                  />
                  <canvas
                    ref={baseMaskCanvasRef}
                    width={image.width}
                    height={image.height}
                    className="hidden"
                  />
                  <canvas
                    ref={basePreviewCanvasRef}
                    width={image.width}
                    height={image.height}
                    className="hidden"
                  />
                  <div
                    className="absolute left-0 top-0 [backface-visibility:hidden]"
                    style={viewport.mediaStyle}
                  >
                    <img
                      ref={imageRef}
                      src={dataUrl}
                      alt=""
                      className="absolute inset-0 block h-full w-full bg-transparent object-contain"
                      draggable={false}
                    />
                    <canvas
                      ref={previewCanvasRef}
                      width={image.width}
                      height={image.height}
                      className="absolute inset-0 h-full w-full cursor-none touch-none"
                      style={{ opacity: MASK_OVERLAY_ALPHA }}
                      onPointerDown={startDraw}
                      onPointerMove={moveDraw}
                      onPointerUp={stopDraw}
                      onPointerCancel={stopDraw}
                      onPointerEnter={(event) => updateBrushPreview(event)}
                      onPointerLeave={() => {
                        if (
                          !drawingRef.current &&
                          !brushAdjustRef.current?.active
                        )
                          setBrushPreview(null);
                      }}
                      onContextMenu={(event) => event.preventDefault()}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
        {brushPreview
          ? createPortal(
              <div
                className={`pointer-events-none fixed z-[1100] rounded-full border-2 ${brushPreview.adjusting ? "border-[#fbbf24] bg-black/10" : "border-white/90 bg-black/5"} shadow-[0_0_0_1px_rgba(0,0,0,.8)]`}
                style={{
                  left: brushPreview.x,
                  top: brushPreview.y,
                  width: Math.max(4, brushPreview.size * viewport.imageScale),
                  aspectRatio: 1,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {brushPreview.adjusting ? (
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {brushSize}px
                  </span>
                ) : null}
              </div>,
              document.body,
            )
          : null}

        <div className="flex min-h-[360px] flex-col gap-5">
          <div>
            <h2 className="text-xl font-semibold">
              {t("canvas.editors.maskTitle")}
            </h2>
            <div className="mt-2 text-sm opacity-60">
              {image
                ? `${image.width} x ${image.height}px`
                : t("canvas.editors.loading")}
            </div>
            <div className="mt-2 text-xs leading-5 opacity-55">
              {t("canvas.editors.maskHint")}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type={mode === "paint" ? "primary" : "default"}
              icon={<Brush className="size-4" />}
              onClick={() => setMode("paint")}
            >
              {t("canvas.editors.brush")}
            </Button>
            <Button
              type={mode === "erase" ? "primary" : "default"}
              icon={<Eraser className="size-4" />}
              onClick={() => setMode("erase")}
            >
              {t("canvas.editors.erase")}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-black/10 px-2 py-1 dark:border-white/10">
            <Tooltip title={t("canvas.editors.undoMaskTitle")}>
              <Button
                type="text"
                icon={<Undo2 className="size-4" />}
                disabled={!historySize}
                aria-label={t("canvas.editors.undoMask")}
                onClick={undoMask}
              />
            </Tooltip>
            <Tooltip title={t("canvas.editors.redoMaskTitle")}>
              <Button
                type="text"
                icon={<Redo2 className="size-4" />}
                disabled={!redoSize}
                aria-label={t("canvas.editors.redoMask")}
                onClick={redoMask}
              />
            </Tooltip>
            <div className="flex items-center gap-1">
              <Tooltip title={t("canvas.editors.zoomOut")}>
                <Button
                  type="text"
                  icon={<ZoomOut className="size-4" />}
                  disabled={!viewport.canZoomOut}
                  aria-label={t("canvas.editors.zoomOut")}
                  onClick={viewport.zoomOut}
                />
              </Tooltip>
              <button
                type="button"
                className="min-w-14 text-center text-xs font-semibold tabular-nums opacity-70"
                onClick={viewport.resetZoom}
              >
                {Math.round(viewport.zoom * 100)}%
              </button>
              <Tooltip title={t("canvas.editors.zoomIn")}>
                <Button
                  type="text"
                  icon={<ZoomIn className="size-4" />}
                  disabled={!viewport.canZoomIn}
                  aria-label={t("canvas.editors.zoomIn")}
                  onClick={viewport.zoomIn}
                />
              </Tooltip>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium opacity-75">
                {t("canvas.editors.brushSize")}
              </span>
              <span className="font-semibold">{brushSize}px</span>
            </div>
            <Slider
              min={8}
              max={160}
              step={2}
              value={brushSize}
              onChange={setBrushSize}
            />
            {historyLimitReached ? (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {t("canvas.editors.maskHistoryLimit")}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium opacity-75">
              {t("canvas.editors.editInstructions")}
            </div>
            <Input.TextArea
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
              <div className="text-xs font-medium text-[#ef4444]">{error}</div>
            ) : null}
          </div>

          <div className="mt-auto flex items-center justify-between gap-2">
            <Button icon={<RotateCcw className="size-4" />} onClick={resetMask}>
              {t("canvas.editors.reset")}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                icon={<ImagePlus className="size-4" />}
                onClick={() => submit(false)}
              >
                {t("canvas.editors.maskExport")}
              </Button>
              <Button
                type="primary"
                icon={<WandSparkles className="size-4" />}
                onClick={() => submit(true)}
              >
                {t("canvas.editors.maskGenerate")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function readCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
) {
  const rect = canvas.getBoundingClientRect();
  return mapMaskCanvasPoint(clientX, clientY, rect, canvas);
}

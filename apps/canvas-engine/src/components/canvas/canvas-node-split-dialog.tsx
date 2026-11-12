import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, InputNumber, Modal, Tooltip } from "antd";
import {
  Grid2x2,
  ListRestart,
  PanelTop,
  Redo2,
  Rows3,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import {
  createSplitEditorState,
  reduceSplitEditorState,
  splitEditorCounts,
  type SplitAxis,
  type SplitEditorSelection,
} from "@/lib/canvas/canvas-split-editor";
import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";

export type CanvasImageSplitParams = ImageSplitParams;

const maxGridSize = 12;
type ActiveLine = SplitEditorSelection;

export function CanvasNodeSplitDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (params: CanvasImageSplitParams) => void;
}) {
  const { t } = useTranslation();
  const [editor, dispatch] = useReducer(
    reduceSplitEditorState,
    undefined,
    createSplitEditorState,
  );
  const { params, active } = editor;
  const [image, setImage] = useState<{ width: number; height: number } | null>(
    null,
  );
  const dragAbortRef = useRef<AbortController | null>(null);
  const viewport = useImageEditorViewport(image, open);
  const previewRef = viewport.stageRef;
  const { horizontalLines, verticalLines, rows, columns } =
    splitEditorCounts(params);
  const total = rows * columns;
  const pieceSize = image
    ? {
        width: Math.max(1, Math.floor(image.width / columns)),
        height: Math.max(1, Math.floor(image.height / rows)),
      }
    : null;

  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset" });
    setImage(null);
  }, [dataUrl, open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void readImageMeta(dataUrl).then((meta) => {
      if (current) setImage(meta);
    });
    return () => {
      current = false;
    };
  }, [dataUrl, open]);

  useEffect(() => {
    if (!open) dragAbortRef.current?.abort();
    return () => dragAbortRef.current?.abort();
  }, [open]);

  const startDrag = (
    axis: SplitAxis,
    index: number,
    event: ReactPointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const box = previewRef.current?.getBoundingClientRect();
    dispatch({ type: "select-line", axis, index, record: Boolean(box) });
    if (!box) return;
    dragAbortRef.current?.abort();
    const controller = new AbortController();
    dragAbortRef.current = controller;
    const move = (moveEvent: PointerEvent) =>
      dispatch({
        type: "move-line",
        axis,
        index,
        value:
          axis === "horizontal"
            ? (moveEvent.clientY - box.top) / box.height
            : (moveEvent.clientX - box.left) / box.width,
      });
    const stop = () => controller.abort();
    window.addEventListener("pointermove", move, { signal: controller.signal });
    window.addEventListener("pointerup", stop, { signal: controller.signal });
    window.addEventListener("pointercancel", stop, {
      signal: controller.signal,
    });
  };
  const undoSplit = useCallback(() => {
    dispatch({ type: "undo" });
  }, []);
  const redoSplit = useCallback(() => {
    dispatch({ type: "redo" });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input,textarea,[contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const isUndo =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        key === "z";
      const isRedo =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
      const isDelete = event.key === "Delete" || event.key === "Backspace";
      if (!isUndo && !isRedo && !isDelete) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (isDelete) dispatch({ type: "delete-active" });
      else if (isRedo) dispatch({ type: "redo" });
      else dispatch({ type: "undo" });
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);
  const confirmParams = {
    ...params,
    horizontalLines,
    verticalLines,
    rows,
    columns,
  };

  return (
    <Modal
      title={null}
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      footer={null}
      width={780}
      centered
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
    >
      <div className="space-y-5" data-canvas-no-zoom>
        <div>
          <h2 className="text-xl font-semibold">
            {t("canvas.editors.splitTitle")}
          </h2>
          <p className="mt-1 text-sm opacity-60">
            {t("canvas.editors.splitDescription", { count: total })}
          </p>
          <p className="mt-2 text-xs leading-5 opacity-55">
            {t("canvas.editors.splitHint")}
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_280px]">
          <div className="rounded-xl border p-4">
            <div
              ref={viewport.viewportRef}
              {...viewport.panHandlers}
              className={`relative isolate h-[340px] min-h-[300px] rounded-lg bg-black/5 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
            >
              <div className="relative" style={viewport.contentStyle}>
                <div
                  ref={previewRef}
                  className="absolute isolate overflow-hidden rounded-lg bg-black [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]"
                  style={viewport.stageStyle}
                >
                  <div
                    className="absolute left-0 top-0 [backface-visibility:hidden]"
                    style={viewport.mediaStyle}
                  >
                    <img
                      src={dataUrl}
                      alt=""
                      className="block h-full w-full object-contain"
                      draggable={false}
                    />
                  </div>
                  <SplitGrid
                    horizontalLines={horizontalLines}
                    verticalLines={verticalLines}
                    active={active}
                    onPointerDown={startDrag}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <div className="flex items-center gap-1">
                <Tooltip title={t("canvas.editors.undoSplitTitle")}>
                  <Button
                    type="text"
                    icon={<Undo2 className="size-4" />}
                    disabled={!editor.history.length}
                    aria-label={t("canvas.editors.undoSplit")}
                    onClick={undoSplit}
                  />
                </Tooltip>
                <Tooltip title={t("canvas.editors.redoSplitTitle")}>
                  <Button
                    type="text"
                    icon={<Redo2 className="size-4" />}
                    disabled={!editor.redo.length}
                    aria-label={t("canvas.editors.redoSplit")}
                    onClick={redoSplit}
                  />
                </Tooltip>
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
              <span className="font-semibold">
                {image
                  ? `${image.width} x ${image.height} px`
                  : t("canvas.editors.loading")}
              </span>
            </div>
          </div>
          <div className="space-y-5 py-2">
            <NumberField
              label={t("canvas.editors.rows")}
              value={rows}
              onChange={(value) =>
                dispatch({ type: "set-count", axis: "horizontal", value })
              }
            />
            <NumberField
              label={t("canvas.editors.columns")}
              value={columns}
              onChange={(value) =>
                dispatch({ type: "set-count", axis: "vertical", value })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                icon={<Rows3 className="size-4" />}
                disabled={rows >= maxGridSize}
                onClick={() =>
                  dispatch({ type: "add-line", axis: "horizontal" })
                }
              >
                {t("canvas.editors.horizontalLine")}
              </Button>
              <Button
                icon={<PanelTop className="size-4 rotate-90" />}
                disabled={columns >= maxGridSize}
                onClick={() => dispatch({ type: "add-line", axis: "vertical" })}
              >
                {t("canvas.editors.verticalLine")}
              </Button>
              <Button
                icon={<Trash2 className="size-4" />}
                disabled={!active}
                onClick={() => dispatch({ type: "delete-active" })}
              >
                {t("canvas.editors.deleteLine")}
              </Button>
              <Button
                icon={<ListRestart className="size-4" />}
                onClick={() => dispatch({ type: "reset-lines" })}
              >
                {t("canvas.editors.resetLines")}
              </Button>
            </div>
            <div className="rounded-xl border px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="opacity-60">
                  {t("canvas.editors.pieceCount")}
                </span>
                <span className="font-semibold">
                  {t("canvas.editors.pieces", { count: total })}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="opacity-60">
                  {t("canvas.editors.averageSize")}
                </span>
                <span className="font-semibold">
                  {pieceSize
                    ? `${pieceSize.width} x ${pieceSize.height}`
                    : t("canvas.editors.unknown")}
                </span>
              </div>
            </div>
            <Button
              type="primary"
              size="large"
              className="w-full"
              icon={<Grid2x2 className="size-4" />}
              onClick={() => onConfirm(confirmParams)}
            >
              {t("canvas.editors.generateChildren")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string | number | null) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="font-medium opacity-75">{label}</span>
      <InputNumber
        className="w-full"
        min={1}
        max={maxGridSize}
        precision={0}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

function SplitGrid({
  horizontalLines,
  verticalLines,
  active,
  onPointerDown,
}: {
  horizontalLines: number[];
  verticalLines: number[];
  active: ActiveLine;
  onPointerDown: (
    axis: "horizontal" | "vertical",
    index: number,
    event: ReactPointerEvent,
  ) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {verticalLines.map((line, index) => (
        <div
          key={`column-${index}`}
          className="pointer-events-auto absolute inset-y-0 -ml-2 w-4 cursor-ew-resize"
          style={{ left: `${line * 100}%` }}
          onPointerDown={(event) => onPointerDown("vertical", index, event)}
        >
          <div
            className={`absolute left-1/2 top-0 h-full border-l shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "vertical" && active.index === index ? "border-amber-300" : "border-white/90"}`}
          />
        </div>
      ))}
      {horizontalLines.map((line, index) => (
        <div
          key={`row-${index}`}
          className="pointer-events-auto absolute inset-x-0 -mt-2 h-4 cursor-ns-resize"
          style={{ top: `${line * 100}%` }}
          onPointerDown={(event) => onPointerDown("horizontal", index, event)}
        >
          <div
            className={`absolute left-0 top-1/2 w-full border-t shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "horizontal" && active.index === index ? "border-amber-300" : "border-white/90"}`}
          />
        </div>
      ))}
    </div>
  );
}

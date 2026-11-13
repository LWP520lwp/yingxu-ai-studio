import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, InputNumber, Modal } from "antd";
import {
  Grid2x2,
  ListRestart,
  PanelTop,
  Rows3,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageEditorSurface, useImageEditorSource } from "./image-editor-surface";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import {
  createSplitEditorState,
  reduceSplitEditorState,
  splitEditorCounts,
  type SplitAxis,
  type SplitEditorSelection,
} from "@/atlas-engine/workflows/image-splitting-editor";
import type { AtlasImageSplit } from "@/atlas-engine/workflows/image-processing";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { ImageEditorViewportControls } from "@/components/canvas/image-editor-viewport-controls";

export type CanvasImageSplitParams = AtlasImageSplit;

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
  const { image, imageReadError } = useImageEditorSource(dataUrl, open);
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

  useEditorShortcuts(open, {
    undo: undoSplit,
    redo: redoSplit,
    remove: () => dispatch({ type: "delete-active" }),
  });
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
          {imageReadError ? (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {t("canvas.editors.imageReadError")}
            </p>
          ) : null}
        </div>
        <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_280px]">
          <div className="rounded-xl border p-4">
            <ImageEditorSurface source={dataUrl} viewport={viewport}>
                  <SplitGrid
                    horizontalLines={horizontalLines}
                    verticalLines={verticalLines}
                    active={active}
                    onPointerDown={startDrag}
                  />
            </ImageEditorSurface>
            <div className="mt-3 flex items-center justify-between text-sm">
              <ImageEditorViewportControls
                zoom={viewport.zoom}
                canZoomIn={viewport.canZoomIn}
                canZoomOut={viewport.canZoomOut}
                onZoomIn={viewport.zoomIn}
                onZoomOut={viewport.zoomOut}
                onResetZoom={viewport.resetZoom}
                undo={{ enabled: Boolean(editor.history.length), run: undoSplit }}
                redo={{ enabled: Boolean(editor.redo.length), run: redoSplit }}
              />
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
            <nav className="grid grid-cols-2 gap-2" aria-label={t("canvas.editors.adjustCrop")}>
              {[
                { label: "horizontalLine", Icon: Rows3, disabled: rows >= maxGridSize, run: () => dispatch({ type: "add-line", axis: "horizontal" }) },
                { label: "verticalLine", Icon: PanelTop, disabled: columns >= maxGridSize, run: () => dispatch({ type: "add-line", axis: "vertical" }) },
                { label: "deleteLine", Icon: Trash2, disabled: !active, run: () => dispatch({ type: "delete-active" }) },
                { label: "resetLines", Icon: ListRestart, disabled: false, run: () => dispatch({ type: "reset-lines" }) },
              ].map(({ label, Icon, disabled, run }) => (
                <Button key={label} disabled={disabled} onClick={run} icon={<Icon className="size-4" />}>
                  {t(`canvas.editors.${label}`)}
                </Button>
              ))}
            </nav>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 rounded-lg border bg-black/[.025] p-4 text-sm" aria-live="polite">
              <dt className="opacity-60">{t("canvas.editors.pieceCount")}</dt>
              <dd className="m-0 font-semibold tabular-nums">{t("canvas.editors.pieces", { count: total })}</dd>
              <dt className="opacity-60">{t("canvas.editors.averageSize")}</dt>
              <dd className="m-0 font-mono text-xs">{pieceSize ? `${pieceSize.width} × ${pieceSize.height}` : t("canvas.editors.unknown")}</dd>
            </dl>
            <Button
              type="primary"
              size="large"
              className="w-full"
              icon={<Grid2x2 className="size-4" />}
              disabled={!image || imageReadError}
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
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-label="Image split guides"
    >
      {verticalLines.map((line, index) => (
        <g
          key={`column-${index}`}
          className="pointer-events-auto"
          onPointerDown={(event) => onPointerDown("vertical", index, event)}
        >
          <line
            x1={line * 1000}
            x2={line * 1000}
            y1="0"
            y2="1000"
            stroke={active?.axis === "vertical" && active.index === index ? "#fcd34d" : "#ffffff"}
            strokeWidth={active?.axis === "vertical" && active.index === index ? 2 : 1}
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x={line * 1000 - 12}
            y="0"
            width="24"
            height="1000"
            fill="transparent"
            style={{ cursor: "ew-resize", touchAction: "none" }}
          />
        </g>
      ))}
      {horizontalLines.map((line, index) => (
        <g
          key={`row-${index}`}
          className="pointer-events-auto"
          onPointerDown={(event) => onPointerDown("horizontal", index, event)}
        >
          <line
            x1="0"
            x2="1000"
            y1={line * 1000}
            y2={line * 1000}
            stroke={active?.axis === "horizontal" && active.index === index ? "#fcd34d" : "#ffffff"}
            strokeWidth={active?.axis === "horizontal" && active.index === index ? 2 : 1}
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x="0"
            y={line * 1000 - 12}
            width="1000"
            height="24"
            fill="transparent"
            style={{ cursor: "ns-resize", touchAction: "none" }}
          />
        </g>
      ))}
    </svg>
  );
}

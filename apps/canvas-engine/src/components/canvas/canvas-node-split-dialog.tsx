import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Button, InputNumber, Modal } from "antd";
import { Columns3, Grid2x2, RotateCcw, Rows3, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ImageEditorSurface,
  useImageEditorSource,
} from "./image-editor-surface";
import { ImageEditorViewportControls } from "./image-editor-viewport-controls";
import { useImageEditorViewport } from "./use-image-editor-viewport";
import {
  createSplitWorkspace,
  reduceSplitWorkspace,
  splitGuideKeyboardValue,
  splitPointerPosition,
} from "./split-workspace-interaction";
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts";
import {
  splitEditorCounts,
  type SplitAxis,
  type SplitEditorAction,
} from "@/atlas-engine/workflows/image-splitting-editor";
import type { AtlasImageSplit } from "@/atlas-engine/workflows/image-processing";
import "./split-workspace.css";

export type CanvasImageSplitParams = AtlasImageSplit;

export function CanvasNodeSplitDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: {
  dataUrl: string;
  open: boolean;
  onClose(): void;
  onConfirm(params: CanvasImageSplitParams): void;
}) {
  const { i18n } = useTranslation();
  const english = (i18n.resolvedLanguage || i18n.language).startsWith("en");
  const label = (zh: string, en: string) => (english ? en : zh);
  const headingId = useId();
  const hintId = useId();
  const [workspace, dispatch] = useReducer(
    reduceSplitWorkspace,
    undefined,
    createSplitWorkspace,
  );
  const editor = workspace.document;
  const { image, imageReadError } = useImageEditorSource(dataUrl, open);
  const viewport = useImageEditorViewport(image, open);
  const capture = useRef<{
    element: HTMLButtonElement;
    pointerId: number;
  } | null>(null);
  const currentDrag = useRef(workspace.drag);
  currentDrag.current = workspace.drag;
  const counts = splitEditorCounts(editor.params);
  const total = counts.rows * counts.columns;
  const active = editor.active;
  const selectedPosition = active
    ? (active.axis === "horizontal"
        ? counts.horizontalLines
        : counts.verticalLines)[active.index]
    : undefined;

  const releaseCapture = useCallback((cancel: boolean) => {
    const held = capture.current;
    capture.current = null;
    if (!held) return;
    dispatch({ type: "release", pointerId: held.pointerId, cancel });
    try {
      if (held.element.hasPointerCapture(held.pointerId))
        held.element.releasePointerCapture(held.pointerId);
    } catch {
      // A closed dialog may already have detached its guide element.
    }
  }, []);
  useEffect(() => {
    releaseCapture(true);
    dispatch({ type: "reset" });
    return () => releaseCapture(true);
  }, [dataUrl, open, releaseCapture]);
  const edit = useCallback(
    (command: SplitEditorAction) => {
      releaseCapture(false);
      dispatch({ type: "edit", command });
    },
    [releaseCapture],
  );
  const undo = useCallback(() => edit({ type: "undo" }), [edit]);
  const redo = useCallback(() => edit({ type: "redo" }), [edit]);
  useEditorShortcuts(open, {
    undo,
    redo,
    remove: () => edit({ type: "delete-active" }),
  });

  const pointFor = (
    axis: SplitAxis,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    const box = viewport.stageRef.current?.getBoundingClientRect();
    return box ? splitPointerPosition(axis, event, box) : null;
  };
  const grab = (
    axis: SplitAxis,
    index: number,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || viewport.spacePressed || capture.current) return;
    const position = pointFor(axis, event);
    if (position === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    capture.current = {
      element: event.currentTarget,
      pointerId: event.pointerId,
    };
    dispatch({
      type: "grab",
      axis,
      index,
      pointerId: event.pointerId,
      position,
    });
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = currentDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = pointFor(drag.axis, event);
    if (position === null) return;
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: "point", pointerId: event.pointerId, position });
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, cancel: boolean) => {
    if (capture.current?.pointerId !== event.pointerId) return;
    if (!cancel) move(event);
    event.preventDefault();
    event.stopPropagation();
    releaseCapture(cancel);
  };
  const adjust = (
    axis: SplitAxis,
    index: number,
    position: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === "Escape" && capture.current) {
      event.preventDefault();
      event.stopPropagation();
      releaseCapture(true);
      return;
    }
    if (!image || event.altKey || event.ctrlKey || event.metaKey) return;
    const value = splitGuideKeyboardValue(
      axis,
      event.key,
      position,
      image,
      event.shiftKey,
    );
    if (value === null) return;
    event.preventDefault();
    event.stopPropagation();
    releaseCapture(false);
    dispatch({ type: "place", axis, index, value });
  };
  const close = () => {
    releaseCapture(true);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={null}
      footer={null}
      closable={false}
      onCancel={close}
      width={1000}
      centered
      destroyOnHidden
      className="split-workspace-modal"
      aria-labelledby={headingId}
    >
      <section className="split-workspace" data-canvas-no-zoom>
        <header className="split-workspace-heading">
          <div>
            <span className="split-workspace-eyebrow">
              {label("图像工具 / 分割", "IMAGE TOOLS / SPLIT")}
            </span>
            <h2 id={headingId}>
              {label("图像分割工作区", "Image split workspace")}
            </h2>
          </div>
          <Button
            type="text"
            icon={<X size={18} />}
            onClick={close}
            aria-label={label("关闭切图", "Close image splitter")}
          />
        </header>
        <div className="split-workspace-controls">
          <div className="split-workspace-counts">
            {(
              [
                {
                  axis: "horizontal",
                  value: counts.rows,
                  text: label("行", "Rows"),
                },
                {
                  axis: "vertical",
                  value: counts.columns,
                  text: label("列", "Columns"),
                },
              ] as const
            ).map(({ axis, value, text }) => (
              <label key={axis}>
                <span>{text}</span>
                <InputNumber
                  min={1}
                  max={12}
                  precision={0}
                  value={value}
                  aria-label={text}
                  onChange={(value) => edit({ type: "set-count", axis, value })}
                />
              </label>
            ))}
          </div>
          <div
            className="split-workspace-add"
            role="group"
            aria-label={label("添加分割线", "Add split guides")}
          >
            <Button
              icon={<Rows3 size={15} />}
              disabled={counts.rows >= 12 || !image}
              onClick={() => edit({ type: "add-line", axis: "horizontal" })}
            >
              {label("加横线", "Horizontal")}
            </Button>
            <Button
              icon={<Columns3 size={15} />}
              disabled={counts.columns >= 12 || !image}
              onClick={() => edit({ type: "add-line", axis: "vertical" })}
            >
              {label("加竖线", "Vertical")}
            </Button>
            <Button
              icon={<RotateCcw size={15} />}
              onClick={() => edit({ type: "reset-lines" })}
            >
              {label("均分排列", "Even spacing")}
            </Button>
          </div>
        </div>
        <div className="split-workspace-preview" aria-describedby={hintId}>
          <ImageEditorSurface
            source={dataUrl}
            viewport={viewport}
            className="split-workspace-surface"
          >
            {image &&
              (["horizontal", "vertical"] as const).flatMap((axis) => {
                const lines =
                  axis === "horizontal"
                    ? counts.horizontalLines
                    : counts.verticalLines;
                return lines.map((position, index) => {
                  const selected =
                    active?.axis === axis && active.index === index;
                  const name =
                    axis === "horizontal"
                      ? label("横向分割线", "Horizontal guide")
                      : label("竖向分割线", "Vertical guide");
                  return (
                    <button
                      key={`${axis}:${index}`}
                      type="button"
                      role="slider"
                      aria-label={`${name} ${index + 1}`}
                      aria-orientation={
                        axis === "horizontal" ? "vertical" : "horizontal"
                      }
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(position * 1000) / 10}
                      aria-valuetext={`${Math.round(position * 1000) / 10}%`}
                      className={`split-workspace-guide split-workspace-guide-${axis}`}
                      data-selected={selected}
                      style={
                        axis === "horizontal"
                          ? { top: `${position * 100}%` }
                          : { left: `${position * 100}%` }
                      }
                      onPointerDown={(event) => grab(axis, index, event)}
                      onPointerMove={move}
                      onPointerUp={(event) => finish(event, false)}
                      onPointerCancel={(event) => finish(event, true)}
                      onLostPointerCapture={(event) => finish(event, true)}
                      onKeyDown={(event) =>
                        adjust(axis, index, position, event)
                      }
                      onClick={() =>
                        edit({
                          type: "select-line",
                          axis,
                          index,
                          record: false,
                        })
                      }
                    >
                      <span className="split-workspace-guide-track" />
                      <span
                        className="split-workspace-guide-grip"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                    </button>
                  );
                });
              })}
          </ImageEditorSurface>
          {(!image || imageReadError || !dataUrl) && (
            <div
              className="split-workspace-status"
              role={imageReadError || !dataUrl ? "alert" : "status"}
            >
              <Grid2x2 size={24} />
              <span>
                {!dataUrl
                  ? label("尚未选择图片", "No image selected")
                  : imageReadError
                    ? label(
                        "无法读取图片，请重新打开素材后再试。",
                        "This image could not be read. Reopen the source and try again.",
                      )
                    : label("正在读取图片尺寸…", "Reading image dimensions…")}
              </span>
            </div>
          )}
        </div>
        <div className="split-workspace-review">
          <ImageEditorViewportControls
            zoom={viewport.zoom}
            canZoomIn={viewport.canZoomIn}
            canZoomOut={viewport.canZoomOut}
            onZoomIn={viewport.zoomIn}
            onZoomOut={viewport.zoomOut}
            onResetZoom={viewport.resetZoom}
            undo={{ enabled: Boolean(editor.history.length), run: undo }}
            redo={{ enabled: Boolean(editor.redo.length), run: redo }}
          />
          <div className="split-workspace-selection">
            {active && selectedPosition !== undefined ? (
              <>
                <span>
                  {active.axis === "horizontal"
                    ? label("横线", "Horizontal")
                    : label("竖线", "Vertical")}{" "}
                  {active.index + 1}
                </span>
                <InputNumber
                  min={0}
                  max={100}
                  step={0.1}
                  precision={1}
                  value={Math.round(selectedPosition * 1000) / 10}
                  suffix="%"
                  aria-label={label(
                    "分割线位置百分比",
                    "Guide position percentage",
                  )}
                  onChange={(value) => {
                    if (typeof value === "number") {
                      releaseCapture(false);
                      dispatch({
                        type: "place",
                        ...active,
                        value: value / 100,
                      });
                    }
                  }}
                />
                <Button
                  type="text"
                  icon={<Trash2 size={15} />}
                  aria-label={label("删除选中分割线", "Delete selected guide")}
                  onClick={() => edit({ type: "delete-active" })}
                />
              </>
            ) : (
              <span className="split-workspace-muted">
                {label(
                  "点击分割线调整位置",
                  "Select a guide to refine its position",
                )}
              </span>
            )}
          </div>
        </div>
        <footer className="split-workspace-footer">
          <div>
            <p className="split-workspace-output" aria-live="polite">
              {label(
                `将生成 ${total} 个图片节点`,
                `${total} image nodes will be created`,
              )}
              <span>{image ? `${image.width} × ${image.height} px` : "—"}</span>
              {image && (
                <span>
                  {label("平均约", "Average")}{" "}
                  {Math.max(1, Math.floor(image.width / counts.columns))} ×{" "}
                  {Math.max(1, Math.floor(image.height / counts.rows))} px
                </span>
              )}
            </p>
            <p id={hintId} className="split-workspace-muted">
              {label(
                "拖动线条自定义裁切 · 方向键微调 1 px，Shift 加速 · 空格拖动画面",
                "Drag guides to frame each piece · Arrow keys: 1 px, Shift: 10 px · Space + drag to pan",
              )}
            </p>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<Grid2x2 size={17} />}
            disabled={!image || imageReadError || !dataUrl}
            onClick={() => {
              releaseCapture(false);
              onConfirm({ ...editor.params, ...counts });
            }}
          >
            {label("创建切图节点", "Create image nodes")}
          </Button>
        </footer>
      </section>
    </Modal>
  );
}

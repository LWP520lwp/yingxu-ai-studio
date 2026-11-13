import {
  useEffect,
  useReducer,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, Modal, Segmented } from "antd";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { ImageEditorViewportControls } from "@/components/canvas/image-editor-viewport-controls";
import {
  ATLAS_CROP_HANDLES as CROP_RESIZE_HANDLES,
  atlasCropHandleStyle as cropHandleStyle,
  atlasCropRatio as cropRatio,
  type AtlasCropRect as CanvasImageCropRect,
  type AtlasCropHandle as CropResizeHandle,
} from "@/atlas-engine/surface/image-editing-geometry";
import {
  createCropEditorSession,
  transitionCropEditorSession,
} from "@/atlas-engine/surface/crop-editor-session";
import {
  ImageEditorSurface,
  useImageEditorSource,
} from "./image-editor-surface";

export type { AtlasCropRect as CanvasImageCropRect } from "@/atlas-engine/surface/image-editing-geometry";

type CropDialogProps = {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (crop: CanvasImageCropRect) => void;
};

export function CanvasNodeCropDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: CropDialogProps) {
  const { t } = useTranslation();
  const [session, dispatch] = useReducer(
    transitionCropEditorSession,
    undefined,
    createCropEditorSession,
  );
  const { crop, preset: ratioPreset } = session;
  const { image, imageReadError } = useImageEditorSource(dataUrl, open);
  const viewport = useImageEditorViewport(image, open);
  const stageRef = viewport.stageRef;
  const pixelCrop = image
    ? {
        width: Math.max(1, Math.round(crop.width * image.width)),
        height: Math.max(1, Math.round(crop.height * image.height)),
      }
    : null;

  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset" });
  }, [dataUrl, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const updateDrag = (event: PointerEvent) => {
      dispatch({
        type: "drag-to",
        pointerId: event.pointerId,
        point: { x: event.clientX, y: event.clientY },
        image,
      });
    };
    const finishDrag = (event: PointerEvent) => {
      dispatch({ type: "end-drag", pointerId: event.pointerId });
    };
    document.addEventListener("pointermove", updateDrag, {
      signal: controller.signal,
    });
    document.addEventListener("pointerup", finishDrag, {
      signal: controller.signal,
    });
    document.addEventListener("pointercancel", finishDrag, {
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [image, open]);

  const startDrag = (
    mode: "move" | "resize",
    event: ReactPointerEvent,
    handle?: CropResizeHandle,
  ) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || stage.width <= 0 || stage.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    dispatch({
      type: "begin-drag",
      drag: {
        pointerId: event.pointerId,
        mode,
        handle: handle ?? "se",
        start: { x: event.clientX, y: event.clientY },
        stage: { width: stage.width, height: stage.height },
      },
    });
  };

  const handleCropKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const directionByKey = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    } as const;
    const direction = directionByKey[event.key as keyof typeof directionByKey];
    if (!direction) return;
    event.preventDefault();
    dispatch({ type: "nudge", direction, coarse: event.shiftKey });
  };

  const changeRatioPreset = (value: string | number) => {
    dispatch({ type: "choose-preset", preset: String(value), image });
  };

  return (
    <Modal
      title={t("canvas.editors.cropTitle")}
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      footer={null}
      width={780}
      centered
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
    >
      <div className="space-y-4">
        {imageReadError ? (
          <p className="text-sm text-red-600" role="alert">
            {t("canvas.editors.imageReadError")}
          </p>
        ) : null}
        <ImageEditorSurface
          source={dataUrl}
          viewport={viewport}
          className="h-[min(62vh,620px)] min-h-[340px]"
        >
          <CropFrame
            crop={crop}
            label={t("canvas.editors.adjustCrop")}
            onKeyDown={handleCropKeyDown}
            onMove={(event) => startDrag("move", event)}
            onResize={(event, handle) => startDrag("resize", event, handle)}
          />
        </ImageEditorSurface>

        <ImageEditorViewportControls
          className="justify-center"
          zoom={viewport.zoom}
          canZoomIn={viewport.canZoomIn}
          canZoomOut={viewport.canZoomOut}
          onZoomIn={viewport.zoomIn}
          onZoomOut={viewport.zoomOut}
          onResetZoom={viewport.resetZoom}
          hint={t("canvas.editors.cropHint")}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-sm opacity-80">
            <span>
              {t("canvas.editors.cropSize", {
                size: pixelCrop
                  ? `${pixelCrop.width} x ${pixelCrop.height}`
                  : t("canvas.editors.unknown"),
              })}
            </span>
            <span>
              {t("canvas.editors.ratio", {
                ratio: pixelCrop
                  ? cropRatio(pixelCrop.width, pixelCrop.height)
                  : t("canvas.editors.unknown"),
              })}
            </span>
            {image ? (
              <span>
                {t("canvas.editors.original", {
                  width: image.width,
                  height: image.height,
                })}
              </span>
            ) : null}
          </div>
          <Segmented
            size="small"
            options={[
              { label: t("canvas.editors.free"), value: "free" },
              { label: t("canvas.editors.fixed"), value: "fixed" },
              { label: t("canvas.editors.originalMode"), value: "original" },
              ...["1:1", "4:3", "16:9", "9:16"],
            ]}
            value={ratioPreset}
            onChange={changeRatioPreset}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button onClick={() => dispatch({ type: "reset" })}>
            {t("canvas.editors.reset")}
          </Button>
          <Button icon={<X className="size-4" />} onClick={onClose}>
            {t("canvas.editors.cancel")}
          </Button>
          <Button
            type="primary"
            icon={<Check className="size-4" />}
            disabled={!image || imageReadError}
            onClick={() => onConfirm(crop)}
          >
            {t("canvas.editors.confirmCrop")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CropFrame({
  crop,
  label,
  onKeyDown,
  onMove,
  onResize,
}: {
  crop: CanvasImageCropRect;
  label: string;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResize: (
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: CropResizeHandle,
  ) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      tabIndex={0}
      className="absolute cursor-move border-2 border-white outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      style={cropFrameStyle(crop)}
      onKeyDown={onKeyDown}
      onPointerDown={onMove}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
      <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
      <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
      <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
      {CROP_RESIZE_HANDLES.map((handle) => (
        <button
          key={handle}
          type="button"
          className="absolute size-6 touch-none rounded-full border border-black bg-white shadow-sm"
          style={cropHandleStyle(handle)}
          onPointerDown={(event) => onResize(event, handle)}
          aria-label={`${label} ${handle}`}
        />
      ))}
    </div>
  );
}

function cropFrameStyle(crop: CanvasImageCropRect) {
  return {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
    boxShadow:
      "0 0 0 100vmax rgb(0 0 0 / 55%), 0 0 0 1px rgb(0 0 0 / 30%), 0 12px 28px rgb(0 0 0 / 28%)",
  };
}

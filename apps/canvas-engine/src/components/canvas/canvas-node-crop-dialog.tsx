import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, Modal, Segmented } from "antd";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { ImageEditorViewportControls } from "@/components/canvas/image-editor-viewport-controls";
import {
  CROP_RESIZE_HANDLES,
  DEFAULT_CROP_RECT,
  cropHandleStyle,
  cropRatio,
  fitCropToAspectRatio,
  moveCrop,
  nudgeCrop,
  resizeCrop,
  resolveCropAspectRatio,
  type CanvasImageCropRect,
  type CropResizeHandle,
} from "@/lib/canvas/crop-selection";
import { ImageEditorSurface, useImageEditorSource } from "./image-editor-surface";

export type { CanvasImageCropRect } from "@/lib/canvas/crop-selection";

type CropDialogProps = {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (crop: CanvasImageCropRect) => void;
};

type DragMode = "move" | "resize";

export function CanvasNodeCropDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: CropDialogProps) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState(DEFAULT_CROP_RECT);
  const [ratioPreset, setRatioPreset] = useState("free");
  const [fixedRatio, setFixedRatio] = useState<number | null>(null);
  const { image, imageReadError } = useImageEditorSource(dataUrl, open);
  const dragAbortRef = useRef<AbortController | null>(null);
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
    setCrop(DEFAULT_CROP_RECT);
    setRatioPreset("free");
    setFixedRatio(null);
  }, [dataUrl, open]);

  useEffect(() => {
    if (!open) dragAbortRef.current?.abort();
    return () => dragAbortRef.current?.abort();
  }, [open]);

  const startDrag = (
    mode: DragMode,
    event: ReactPointerEvent,
    handle?: CropResizeHandle,
  ) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || stage.width <= 0 || stage.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragAbortRef.current?.abort();

    const controller = new AbortController();
    dragAbortRef.current = controller;
    const origin = { x: event.clientX, y: event.clientY, crop };
    const move = (pointer: PointerEvent) => {
      const dx = (pointer.clientX - origin.x) / stage.width;
      const dy = (pointer.clientY - origin.y) / stage.height;
      if (mode === "move") {
        setCrop(moveCrop(origin.crop, dx, dy));
        return;
      }
      setCrop(
        resizeCrop(
          origin.crop,
          dx,
          dy,
          handle ?? "se",
          resolveCropAspectRatio(ratioPreset, image, fixedRatio),
          stage,
        ),
      );
    };
    const stop = () => controller.abort();
    document.addEventListener("pointermove", move, {
      signal: controller.signal,
    });
    document.addEventListener("pointerup", stop, {
      signal: controller.signal,
    });
    document.addEventListener("pointercancel", stop, {
      signal: controller.signal,
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
    setCrop((current) => nudgeCrop(current, direction, event.shiftKey));
  };

  const changeRatioPreset = (value: string | number) => {
    const preset = String(value);
    const currentRatio = image
      ? (crop.width * image.width) / Math.max(1, crop.height * image.height)
      : null;
    const nextFixedRatio = preset === "fixed" ? currentRatio : null;
    setRatioPreset(preset);
    setFixedRatio(nextFixedRatio);
    const ratio = resolveCropAspectRatio(preset, image, nextFixedRatio);
    if (ratio && image) {
      setCrop((current) => fitCropToAspectRatio(current, ratio, image));
    }
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
        <ImageEditorSurface source={dataUrl} viewport={viewport} className="h-[min(62vh,620px)] min-h-[340px]">
              <CropMask crop={crop} />
              <div
                role="group"
                aria-label={t("canvas.editors.adjustCrop")}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                tabIndex={0}
                className="absolute cursor-move border-2 border-white outline-none shadow-[0_0_0_1px_rgba(0,0,0,.3),0_0_28px_rgba(0,0,0,.28)] focus-visible:ring-2 focus-visible:ring-blue-400"
                style={cropStyle(crop)}
                onKeyDown={handleCropKeyDown}
                onPointerDown={(event) => startDrag("move", event)}
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
                    onPointerDown={(event) =>
                      startDrag("resize", event, handle)
                    }
                    aria-label={`${t("canvas.editors.adjustCrop")} ${handle}`}
                  />
                ))}
              </div>
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
          <Button onClick={() => setCrop(DEFAULT_CROP_RECT)}>
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

function CropMask({ crop }: { crop: CanvasImageCropRect }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={`M0 0H1V1H0Z M${crop.x} ${crop.y}h${crop.width}v${crop.height}h-${crop.width}Z`}
        fill="rgba(0, 0, 0, .55)"
        fillRule="evenodd"
      />
    </svg>
  );
}

function cropStyle(crop: CanvasImageCropRect) {
  return {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  };
}

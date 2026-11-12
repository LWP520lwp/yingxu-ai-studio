import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, Modal, Segmented, Tooltip } from "antd";
import { Check, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
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
  type CropImageSize,
  type CropResizeHandle,
} from "@/lib/canvas/crop-selection";
import { readImageMeta } from "@/lib/image-utils";

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
  const [image, setImage] = useState<CropImageSize | null>(null);
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
    if (!open) return;
    let current = true;
    setImage(null);
    void readImageMeta(dataUrl)
      .then((size) => {
        if (current) setImage(size);
      })
      .catch(() => {
        if (current) setImage(null);
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
        <div
          ref={viewport.viewportRef}
          {...viewport.panHandlers}
          className={`relative h-[min(62vh,620px)] min-h-[340px] rounded-lg bg-black/5 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
        >
          <div className="relative" style={viewport.contentStyle}>
            <div
              ref={stageRef}
              className="absolute isolate overflow-hidden rounded-lg bg-black select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]"
              style={viewport.stageStyle}
            >
              <div
                className="absolute left-0 top-0 [backface-visibility:hidden]"
                style={viewport.mediaStyle}
              >
                <img
                  src={dataUrl}
                  alt=""
                  className="block h-full w-full object-contain opacity-90"
                  draggable={false}
                />
              </div>
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
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1">
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
            aria-label={t("canvas.editors.reset")}
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
          <span className="ml-2 text-xs opacity-55">
            {t("canvas.editors.cropHint")}
          </span>
        </div>

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
    <>
      <div
        className="absolute inset-x-0 top-0 bg-black/55"
        style={{ height: `${crop.y * 100}%` }}
      />
      <div
        className="absolute inset-x-0 bottom-0 bg-black/55"
        style={{ height: `${(1 - crop.y - crop.height) * 100}%` }}
      />
      <div
        className="absolute bg-black/55"
        style={{
          left: 0,
          top: `${crop.y * 100}%`,
          width: `${crop.x * 100}%`,
          height: `${crop.height * 100}%`,
        }}
      />
      <div
        className="absolute bg-black/55"
        style={{
          right: 0,
          top: `${crop.y * 100}%`,
          width: `${(1 - crop.x - crop.width) * 100}%`,
          height: `${crop.height * 100}%`,
        }}
      />
    </>
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

import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented } from "antd";
import { ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import {
  DEFAULT_IMAGE_UPSCALE_PARAMS,
  IMAGE_UPSCALE_ALGORITHMS,
  IMAGE_UPSCALE_TARGETS,
  deriveImageUpscaleState,
  initialUpscaleTarget,
  isImageUpscaleAlgorithm,
  isUpscaleTargetReached,
} from "@/lib/canvas/canvas-image-upscale";
import {
  MAX_UPSCALE_LONG_EDGE,
  type ImageUpscaleAlgorithm,
  type ImageUpscaleParams,
} from "@/lib/canvas/canvas-image-data";

export type CanvasImageUpscaleParams = ImageUpscaleParams;

type CanvasNodeUpscaleDialogProps = {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (params: CanvasImageUpscaleParams) => void;
};

type ImageSize = { width: number; height: number };

export function CanvasNodeUpscaleDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
}: CanvasNodeUpscaleDialogProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<CanvasImageUpscaleParams>(
    DEFAULT_IMAGE_UPSCALE_PARAMS,
  );
  const [image, setImage] = useState<ImageSize | null>(null);

  const upscaleState = useMemo(
    () => deriveImageUpscaleState(image, params.targetLongEdge),
    [image, params.targetLongEdge],
  );

  useEffect(() => {
    if (!open) return;
    setParams(DEFAULT_IMAGE_UPSCALE_PARAMS);
    setImage(null);
  }, [dataUrl, open]);

  useEffect(() => {
    if (!open) return;

    let current = true;
    void readImageMeta(dataUrl).then(({ width, height }) => {
      if (current) setImage({ width, height });
    });

    return () => {
      current = false;
    };
  }, [dataUrl, open]);

  useEffect(() => {
    if (!image) return;
    const sourceLongEdge = Math.max(image.width, image.height);
    const targetLongEdge = initialUpscaleTarget(sourceLongEdge);
    setParams((current) =>
      current.targetLongEdge === targetLongEdge
        ? current
        : { ...current, targetLongEdge },
    );
  }, [image]);

  const handleTargetChange = (value: string | number) => {
    const targetLongEdge = Number(value);
    if (
      !IMAGE_UPSCALE_TARGETS.some(
        (option) => option.value === targetLongEdge,
      ) ||
      isUpscaleTargetReached(upscaleState.sourceLongEdge, targetLongEdge)
    ) {
      return;
    }
    setParams((current) => ({ ...current, targetLongEdge }));
  };

  const handleAlgorithmChange = (value: string | number) => {
    if (!isImageUpscaleAlgorithm(String(value))) return;
    setParams((current) => ({
      ...current,
      algorithm: value as ImageUpscaleAlgorithm,
    }));
  };

  return (
    <Modal
      title={null}
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      footer={null}
      width={820}
      centered
      destroyOnHidden
    >
      <div className="space-y-5">
        <header>
          <h2 className="text-xl font-semibold">
            {t("canvas.editors.upscaleTitle")}
          </h2>
        </header>

        <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
          <section
            className="rounded-xl border p-4"
            aria-label={t("canvas.editors.source")}
          >
            <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
              <img
                src={dataUrl}
                alt=""
                className="max-h-[320px] max-w-full rounded-lg object-contain shadow-xl"
                draggable={false}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span className="opacity-60">{t("canvas.editors.source")}</span>
              <span className="text-right font-semibold">
                {image
                  ? `${image.width} x ${image.height} px`
                  : t("canvas.editors.loading")}
              </span>
            </div>
          </section>

          <div className="space-y-6 py-2">
            <section
              className="space-y-2"
              aria-labelledby="upscale-target-label"
            >
              <div id="upscale-target-label" className="font-medium opacity-75">
                {t("canvas.editors.targetPixels")}
              </div>
              <Segmented
                block
                value={params.targetLongEdge}
                options={IMAGE_UPSCALE_TARGETS.map(({ label, value }) => ({
                  label: `${label} · ${value}px`,
                  value,
                  disabled: isUpscaleTargetReached(
                    upscaleState.sourceLongEdge,
                    value,
                  ),
                }))}
                onChange={handleTargetChange}
              />
              {upscaleState.limitMessage ? (
                <p role="status" className="text-xs font-medium text-[#ef4444]">
                  {t(`canvas.editors.${upscaleState.limitMessage}`)}
                </p>
              ) : null}
            </section>

            <section
              className="space-y-2"
              aria-labelledby="upscale-algorithm-label"
            >
              <div
                id="upscale-algorithm-label"
                className="font-medium opacity-75"
              >
                {t("canvas.editors.algorithm")}
              </div>
              <Segmented
                block
                value={params.algorithm}
                options={IMAGE_UPSCALE_ALGORITHMS.map((algorithm) => ({
                  value: algorithm,
                  label: (
                    <span className="flex min-h-12 flex-col justify-center text-left leading-5">
                      <span className="font-medium">
                        {t(`canvas.editors.${algorithm}`)}
                      </span>
                      <span className="text-xs opacity-55">
                        {t(`canvas.editors.${algorithm}Description`)}
                      </span>
                    </span>
                  ),
                }))}
                onChange={handleAlgorithmChange}
              />
            </section>

            <section
              className="rounded-xl border px-4 py-3 text-sm"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="opacity-60">
                  {t("canvas.editors.outputSize")}
                </span>
                <span className="text-right font-semibold">
                  {upscaleState.outputSize
                    ? `${upscaleState.outputSize.width} x ${upscaleState.outputSize.height} px`
                    : t("canvas.editors.unknown")}
                </span>
              </div>
            </section>
          </div>
        </div>

        <footer className="flex justify-end">
          <Button
            type="primary"
            size="large"
            icon={<ImagePlus className="size-4" />}
            disabled={
              !upscaleState.canUpscale ||
              params.targetLongEdge > MAX_UPSCALE_LONG_EDGE
            }
            onClick={() => onConfirm(params)}
          >
            {t("canvas.editors.upscale")}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

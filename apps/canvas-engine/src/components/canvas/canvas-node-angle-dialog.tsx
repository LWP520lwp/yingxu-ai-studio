import { useEffect, useState } from "react";
import { Button, Modal, Segmented, Slider } from "antd";
import { Camera, RotateCcw, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { boundedAngle } from "@/lib/canvas/canvas-image-geometry";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

export const DEFAULT_IMAGE_ANGLE_PARAMS: CanvasImageAngleParams = {
    horizontalAngle: 0,
    pitchAngle: 9,
    cameraDistance: 4.8,
    wideAngle: false,
};

export function CanvasNodeAngleDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageAngleParams) => void }) {
    const { t } = useTranslation();
    const [params, setParams] = useState(DEFAULT_IMAGE_ANGLE_PARAMS);

    useEffect(() => {
        if (open) setParams(DEFAULT_IMAGE_ANGLE_PARAMS);
    }, [dataUrl, open]);

    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => {
        setParams((current) => normalizeImageAngleParams({ ...current, [key]: value }));
    };

    return (
        <Modal title={t("canvas.editors.angleTitle")} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={920} centered destroyOnHidden>
            <div className="grid gap-5 md:grid-cols-[minmax(280px,1fr)_minmax(320px,0.95fr)]">
                <section className="flex min-h-[330px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900" aria-label={t("canvas.editors.angleTitle")}>
                    <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 text-sm font-medium dark:border-neutral-700">
                        <Camera aria-hidden="true" className="size-4 opacity-70" />
                        <span>{t("canvas.editors.angleTitle")}</span>
                    </div>
                    <div className="grid flex-1 place-items-center overflow-hidden p-6" style={{ perspective: "700px" }}>
                        <div className="relative grid place-items-center">
                            <img src={dataUrl} alt={t("canvas.editors.angleDescription")} className="max-h-64 max-w-full rounded-md object-contain shadow-xl" draggable={false} style={{ transform: previewTransform(params) }} />
                            <div aria-hidden="true" className="absolute -bottom-6 left-1/2 h-5 w-20 -translate-x-1/2 rounded-[50%] border border-neutral-300 bg-neutral-300/30 dark:border-neutral-600 dark:bg-neutral-500/20" />
                        </div>
                    </div>
                    <div className="border-t border-neutral-200 p-3 dark:border-neutral-700">
                        <Button icon={<RotateCcw aria-hidden="true" className="size-4" />} onClick={() => setParams(DEFAULT_IMAGE_ANGLE_PARAMS)}>
                            {t("canvas.editors.reset")}
                        </Button>
                    </div>
                </section>

                <section className="flex flex-col justify-center gap-6 py-2" aria-label={t("canvas.editors.angleDescription")}>
                    <p className="text-sm leading-6 text-neutral-500">{t("canvas.editors.angleDescription")}</p>
                    <div className="space-y-6">
                        <AngleControl label={t("canvas.editors.horizontal")} value={params.horizontalAngle} min={-60} max={60} step={1} suffix="deg" onChange={(value) => update("horizontalAngle", value)} />
                        <AngleControl label={t("canvas.editors.pitch")} value={params.pitchAngle} min={-45} max={45} step={1} suffix="deg" onChange={(value) => update("pitchAngle", value)} />
                        <AngleControl label={t("canvas.editors.distance")} value={params.cameraDistance} min={1} max={10} step={0.1} onChange={(value) => update("cameraDistance", value)} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-700">
                        <span className="text-sm font-medium">{t("canvas.editors.lens")}</span>
                        <Segmented
                            aria-label={t("canvas.editors.lens")}
                            value={params.wideAngle ? "wide" : "standard"}
                            options={[
                                { label: t("canvas.editors.standard"), value: "standard" },
                                { label: t("canvas.editors.wide"), value: "wide" },
                            ]}
                            onChange={(value) => update("wideAngle", value === "wide")}
                        />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button type="primary" icon={<WandSparkles aria-hidden="true" className="size-4" />} onClick={() => onConfirm(normalizeImageAngleParams(params))}>
                            {t("canvas.editors.aiGenerate")}
                        </Button>
                    </div>
                </section>
            </div>
        </Modal>
    );
}

function AngleControl({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{label}</span>
                <output className="min-w-14 text-right font-mono text-sm tabular-nums text-neutral-500">
                    {formatAngleValue(value)}{suffix}
                </output>
            </div>
            <Slider aria-label={label} min={min} max={max} step={step} value={value} onChange={onChange} />
        </div>
    );
}

export function normalizeImageAngleParams(params: CanvasImageAngleParams): CanvasImageAngleParams {
    return {
        horizontalAngle: boundedAngle(params.horizontalAngle, -60, 60),
        pitchAngle: boundedAngle(params.pitchAngle, -45, 45),
        cameraDistance: boundedAngle(params.cameraDistance, 1, 10),
        wideAngle: params.wideAngle === true,
    };
}

export function formatAngleValue(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function previewTransform(params: CanvasImageAngleParams) {
    const safeParams = normalizeImageAngleParams(params);
    const scale = 1.08 - safeParams.cameraDistance * 0.035 + (safeParams.wideAngle ? -0.08 : 0);
    const rotateY = roundCssValue(safeParams.horizontalAngle * -0.45, 2);
    const rotateX = roundCssValue(safeParams.pitchAngle * 0.35, 2);
    const previewScale = roundCssValue(Math.max(0.72, Math.min(1.08, scale)), 3);
    return `rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${previewScale})`;
}

function roundCssValue(value: number, decimals: number) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

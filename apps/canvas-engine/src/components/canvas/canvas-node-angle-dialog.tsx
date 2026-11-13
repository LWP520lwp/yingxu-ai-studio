import { useEffect, useId, useState } from "react";
import { Modal } from "antd";
import { Camera, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AtlasImageAngle } from "@/atlas-engine/workflows/image-processing";

export type CanvasImageAngleParams = AtlasImageAngle;
type AngleDialogProps = {
  open: boolean;
  dataUrl: string;
  onClose(): void;
  onConfirm(value: CanvasImageAngleParams): void;
};
type NumericAxis = "horizontalAngle" | "pitchAngle" | "cameraDistance";
const cameraAxes: ReadonlyArray<{
  key: NumericAxis;
  label: "horizontal" | "pitch" | "distance";
  low: number;
  high: number;
  step: number;
  initial: number;
}> = [
  {
    key: "horizontalAngle",
    label: "horizontal",
    low: -60,
    high: 60,
    step: 1,
    initial: 0,
  },
  {
    key: "pitchAngle",
    label: "pitch",
    low: -45,
    high: 45,
    step: 1,
    initial: 0,
  },
  {
    key: "cameraDistance",
    label: "distance",
    low: 1,
    high: 10,
    step: 0.1,
    initial: 5,
  },
];
export const DEFAULT_IMAGE_ANGLE_PARAMS = Object.fromEntries([
  ...cameraAxes.map((axis) => [axis.key, axis.initial]),
  ["wideAngle", false],
]) as CanvasImageAngleParams;

export function normalizeImageAngleParams(
  input: CanvasImageAngleParams,
): CanvasImageAngleParams {
  const result = {
    ...DEFAULT_IMAGE_ANGLE_PARAMS,
    wideAngle: input.wideAngle === true,
  };
  for (const axis of cameraAxes)
    result[axis.key] = Math.max(
      axis.low,
      Math.min(
        axis.high,
        Number.isFinite(input[axis.key]) ? input[axis.key] : axis.initial,
      ),
    );
  return result;
}

/** This diagram represents requested camera placement; the source image stays unmodified. */
export function angleCameraPosition(input: CanvasImageAngleParams) {
  const value = normalizeImageAngleParams(input);
  const yaw = (value.horizontalAngle * Math.PI) / 180;
  const radius = 30 + value.cameraDistance * 4;
  return {
    x: 110 + Math.sin(yaw) * radius,
    y: 76 + Math.cos(yaw) * radius,
    elevation: value.pitchAngle,
  };
}

export function CanvasNodeAngleDialog({
  open,
  dataUrl,
  onClose,
  onConfirm,
}: AngleDialogProps) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const id = useId();
  const [camera, setCamera] = useState(() => ({
    ...DEFAULT_IMAGE_ANGLE_PARAMS,
  }));
  useEffect(() => {
    if (open) setCamera({ ...DEFAULT_IMAGE_ANGLE_PARAMS });
  }, [open, dataUrl]);
  const point = angleCameraPosition(camera);
  const update = (key: NumericAxis, value: number) =>
    setCamera((current) =>
      normalizeImageAngleParams({ ...current, [key]: value }),
    );
  return (
    <Modal
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      title={t("canvas.editors.angleTitle")}
      width={860}
      footer={null}
      destroyOnHidden
      centered
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))",
          gap: 24,
        }}
      >
        <figure
          style={{
            margin: 0,
            background: "var(--muted)",
            borderRadius: 8,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <img
            src={dataUrl}
            alt={zh ? "原始参考图" : "Original reference"}
            style={{
              width: "100%",
              height: 245,
              objectFit: "contain",
              padding: 14,
            }}
          />
          <figcaption
            style={{ padding: "12px 16px", fontSize: 12, opacity: 0.7 }}
          >
            {zh
              ? "保留原始参考，按机位要求重新生成。"
              : "The original guides a new image from your requested viewpoint."}
          </figcaption>
          <svg
            viewBox="0 0 220 170"
            role="img"
            aria-label={
              zh
                ? "目标机位示意图，俯视方向"
                : "Requested camera position, top view"
            }
            style={{ width: "100%", height: 160 }}
          >
            <ellipse
              cx="110"
              cy="76"
              rx="80"
              ry="64"
              fill="none"
              stroke="currentColor"
              opacity=".15"
              strokeDasharray="3 5"
            />
            <path
              d={`M110 76 L${point.x} ${point.y}`}
              stroke="#71ab95"
              strokeWidth="2"
            />
            <rect
              x="101"
              y="67"
              width="18"
              height="18"
              rx="3"
              fill="currentColor"
              opacity=".65"
            />
            <circle cx={point.x} cy={point.y} r="9" fill="#71ab95" />
            <text
              x="110"
              y="24"
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              opacity=".65"
            >
              {zh ? "主体 / 机位" : "SUBJECT / CAMERA"}
            </text>
          </svg>
        </figure>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(normalizeImageAngleParams(camera));
          }}
          style={{ display: "flex", flexDirection: "column", gap: 20 }}
        >
          <p style={{ margin: 0, lineHeight: 1.8, opacity: 0.65 }}>
            {t("canvas.editors.angleDescription")}
          </p>
          {cameraAxes.map((axis) => (
            <label
              key={axis.key}
              htmlFor={`${id}-${axis.key}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 76px",
                gap: "8px 14px",
                alignItems: "center",
              }}
            >
              <span>{t(`canvas.editors.${axis.label}`)}</span>
              <input
                id={`${id}-${axis.key}`}
                type="number"
                min={axis.low}
                max={axis.high}
                step={axis.step}
                value={camera[axis.key]}
                onChange={(event) =>
                  update(axis.key, event.target.valueAsNumber)
                }
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  padding: 6,
                  borderRadius: 4,
                  width: "100%",
                }}
              />
              <input
                aria-label={`${t(`canvas.editors.${axis.label}`)} slider`}
                type="range"
                min={axis.low}
                max={axis.high}
                step={axis.step}
                value={camera[axis.key]}
                onChange={(event) =>
                  update(axis.key, event.target.valueAsNumber)
                }
                style={{
                  gridColumn: "1/-1",
                  width: "100%",
                  accentColor: "#71ab95",
                }}
              />
            </label>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={camera.wideAngle}
              onChange={(event) =>
                setCamera((current) => ({
                  ...current,
                  wideAngle: event.target.checked,
                }))
              }
            />
            {t("canvas.editors.wide")}
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: "auto",
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={() => setCamera({ ...DEFAULT_IMAGE_ANGLE_PARAMS })}
              style={{
                display: "flex",
                gap: 6,
                marginRight: "auto",
                alignItems: "center",
              }}
            >
              <RotateCcw size={14} />
              {t("canvas.editors.reset")}
            </button>
            <button type="button" onClick={onClose} style={{ padding: 10 }}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              style={{
                display: "flex",
                gap: 7,
                alignItems: "center",
                padding: "10px 14px",
                background: "#39715c",
                color: "white",
                borderRadius: 5,
              }}
            >
              <Camera size={15} />
              {t("canvas.editors.aiGenerate")}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Slider } from "antd";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { getPlatformInit } from "@/platform/rpc";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { videoRatioOptions } from "@/lib/media-size";
import {
  normalizeVideoMode,
  normalizeVideoResolution,
  normalizeVideoSize,
  normalizedVideoSeconds,
  sizeFromDimensions,
  videoDimensions,
  videoRatioForSize,
  VIDEO_RESOLUTIONS,
  VIDEO_SECONDS_RANGE,
} from "@/lib/video-settings-model";
import type { AiConfig } from "@/stores/use-config-store";

const standardResolutions = VIDEO_RESOLUTIONS.map((value) => ({
  value,
  label: `${value}p`,
}));
const modes = ["auto", "frames", "reference"] as const;

export const videoResolutionOptions = standardResolutions;
export const videoSizeOptions = videoRatioOptions.map((item) => ({
  value: item.value,
  get label() {
    return item.value === "auto"
      ? i18n.t("settingsPanels.common.auto")
      : item.value;
  },
}));
export const videoSecondsRange = VIDEO_SECONDS_RANGE;

type VideoSettingsPanelProps = {
  config: AiConfig;
  onConfigChange: (
    key:
      | "vquality"
      | "size"
      | "videoSeconds"
      | "videoGenerateAudio"
      | "videoWatermark"
      | "videoMode",
    value: string,
  ) => void;
  theme: CanvasTheme;
  showTitle?: boolean;
  className?: string;
};

export function VideoSettingsPanel({
  config,
  onConfigChange,
  theme,
  showTitle = true,
  className = "w-[320px] space-y-4 px-1 py-0.5",
}: VideoSettingsPanelProps) {
  const { t } = useTranslation();
  const ratio = videoRatioForSize(config.size);
  const resolution = normalizeVideoResolution(
    config.vquality,
    ratio === "auto" ? "16:9" : ratio,
  );
  const dimensions = videoDimensions(
    normalizeVideoSize(config.size, resolution),
    resolution,
    ratio,
  );
  const seconds = normalizedVideoSeconds(config.videoSeconds);
  const mode = normalizeVideoMode(config.videoMode);
  const [resolutionText, setResolutionText] = useState(resolution);
  const [secondsText, setSecondsText] = useState(String(seconds));
  const cancelledDraftRef = useRef<"resolution" | "seconds" | null>(null);
  const platformId = config.model.startsWith("platform::")
    ? config.model.slice("platform::".length)
    : "";
  const selectedModel = platformId
    ? getPlatformInit()?.models.video.find((item) => item.id === platformId)
    : null;
  const allowedModes = selectedModel?.caps?.supportedVideoModes;
  const supportsFrames =
    !platformId ||
    (Array.isArray(allowedModes) && allowedModes.includes("frames"));

  useEffect(() => setResolutionText(resolution), [resolution]);
  useEffect(() => setSecondsText(String(seconds)), [seconds]);

  const setRatio = (nextRatio: string) =>
    applyDimensions(resolution, nextRatio, onConfigChange);
  const setResolution = (raw: string) => {
    const next = normalizeVideoResolution(
      raw,
      ratio === "auto" ? "16:9" : ratio,
    );
    setResolutionText(next);
    if (ratio === "auto") onConfigChange("vquality", next);
    else applyDimensions(next, ratio, onConfigChange);
  };
  const setLength = (raw: string) => {
    const next = normalizedVideoSeconds(raw);
    setSecondsText(String(next));
    onConfigChange("videoSeconds", String(next));
  };

  const commitDraft = (field: "resolution" | "seconds") => {
    if (cancelledDraftRef.current === field) {
      cancelledDraftRef.current = null;
      return;
    }
    if (field === "resolution") setResolution(resolutionText);
    else setLength(secondsText);
  };

  const cancelDraft = (
    field: "resolution" | "seconds",
    input: HTMLInputElement,
  ) => {
    cancelledDraftRef.current = field;
    if (field === "resolution") setResolutionText(resolution);
    else setSecondsText(String(seconds));
    input.blur();
  };

  return (
    <ImageSettingsTheme theme={theme}>
      <div
        className={className}
        style={{ color: theme.node.text }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {showTitle && (
          <h2 className="text-sm font-semibold">
            {t("settingsPanels.video.title")}
          </h2>
        )}

        <SettingBlock
          title={t("settingsPanels.video.quality")}
          muted={theme.node.muted}
        >
          <div className="flex flex-wrap gap-1.5">
            {standardResolutions.map((item) => (
              <Choice
                key={item.value}
                selected={resolution === item.value}
                theme={theme}
                onClick={() => setResolution(item.value)}
              >
                {item.label}
              </Choice>
            ))}
            <label
              className="flex h-8 items-center gap-1 rounded border px-2 text-xs"
              style={{ borderColor: theme.node.stroke }}
            >
              <input
                aria-label={t("settingsPanels.video.quality")}
                type="number"
                min={1}
                value={resolutionText}
                className="w-12 bg-transparent text-center outline-none"
                onChange={(event) => setResolutionText(event.target.value)}
                onBlur={() => commitDraft("resolution")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelDraft("resolution", event.currentTarget);
                  }
                }}
              />
              <span style={{ color: theme.node.muted }}>p</span>
            </label>
          </div>
        </SettingBlock>

        <SettingBlock
          title={t("settingsPanels.video.size")}
          muted={theme.node.muted}
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <DimensionField
              axis="width"
              value={dimensions.width}
              disabled={ratio === "auto"}
              theme={theme}
              onChange={(value) =>
                onConfigChange(
                  "size",
                  sizeFromDimensions("width", value, dimensions),
                )
              }
            />
            <span className="text-xs opacity-50">×</span>
            <DimensionField
              axis="height"
              value={dimensions.height}
              disabled={ratio === "auto"}
              theme={theme}
              onChange={(value) =>
                onConfigChange(
                  "size",
                  sizeFromDimensions("height", value, dimensions),
                )
              }
            />
          </div>
        </SettingBlock>

        <SettingBlock
          title={t("settingsPanels.video.ratio")}
          muted={theme.node.muted}
        >
          <div className="grid grid-cols-4 gap-2">
            {videoRatioOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className="flex h-[66px] flex-col items-center justify-center gap-1 rounded-md border bg-transparent text-xs transition hover:opacity-80"
                style={{
                  borderColor:
                    ratio === item.value ? theme.node.text : theme.node.stroke,
                  color: theme.node.text,
                }}
                onClick={() => setRatio(item.value)}
                aria-pressed={ratio === item.value}
              >
                <RatioGlyph
                  width={item.width}
                  height={item.height}
                  color={theme.node.text}
                />
                <span>
                  {item.value === "auto"
                    ? t("settingsPanels.common.auto")
                    : item.value}
                </span>
              </button>
            ))}
          </div>
        </SettingBlock>

        <SettingBlock
          title={t("settingsPanels.video.seconds")}
          muted={theme.node.muted}
        >
          <div className="flex items-center gap-3">
            <Slider
              className="min-w-0 flex-1"
              min={VIDEO_SECONDS_RANGE.min}
              max={VIDEO_SECONDS_RANGE.max}
              step={1}
              value={seconds}
              onChange={(value) =>
                setLength(String(Array.isArray(value) ? value[0] : value))
              }
            />
            <input
              type="number"
              aria-label={t("settingsPanels.video.seconds")}
              min={VIDEO_SECONDS_RANGE.min}
              max={VIDEO_SECONDS_RANGE.max}
              value={secondsText}
              className="h-8 w-[58px] rounded border bg-transparent px-1 text-center text-xs outline-none"
              style={{ borderColor: theme.node.stroke }}
              onChange={(event) => setSecondsText(event.target.value)}
              onBlur={() => commitDraft("seconds")}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelDraft("seconds", event.currentTarget);
                }
              }}
            />
            <span className="text-xs" style={{ color: theme.node.muted }}>
              s
            </span>
          </div>
        </SettingBlock>

        <SettingBlock
          title={t("settingsPanels.video.mode")}
          muted={theme.node.muted}
        >
          <div
            role="radiogroup"
            aria-label={t("settingsPanels.video.mode")}
            className="grid grid-cols-3 gap-1 rounded-md border p-1"
            style={{ borderColor: theme.node.stroke }}
          >
            {modes.map((item) => {
              const disabled = item === "frames" && !supportsFrames;
              const label =
                item === "auto"
                  ? t("settingsPanels.common.auto")
                  : t(`settingsPanels.video.modes.${item}`);
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={mode === item}
                  disabled={disabled}
                  className="h-8 rounded px-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background:
                      mode === item ? theme.node.activeStroke : "transparent",
                    color:
                      mode === item
                        ? theme.toolbar.activeText
                        : theme.node.text,
                  }}
                  onClick={() => onConfigChange("videoMode", item)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </SettingBlock>
      </div>
    </ImageSettingsTheme>
  );
}

export function videoResolutionLabel(value: string, ratio = "16:9") {
  return `${normalizeVideoResolution(value, ratio)}p`;
}
export function videoSizeLabel(value: string) {
  const selected = videoRatioForSize(value);
  return selected === "auto"
    ? i18n.t("settingsPanels.video.adaptive")
    : selected;
}
export function videoSecondsLabel(value: string) {
  return String(value).trim() === "-1"
    ? i18n.t("settingsPanels.video.smart")
    : `${value || "6"}s`;
}
export function videoModeLabel(value: string) {
  const selected = normalizeVideoMode(value);
  return selected === "auto"
    ? i18n.t("settingsPanels.common.auto")
    : i18n.t(`settingsPanels.video.modes.${selected}`);
}
export function normalizeVideoModeValue(value: string | undefined) {
  return normalizeVideoMode(value);
}
export function normalizeVideoSizeValue(value: string, resolution = "720") {
  return normalizeVideoSize(value, resolution);
}
export function normalizeVideoResolutionValue(value: string) {
  return normalizeVideoResolution(value);
}

function applyDimensions(
  resolution: string,
  ratio: string,
  update: VideoSettingsPanelProps["onConfigChange"],
) {
  const normalized = normalizeVideoResolution(
    resolution,
    ratio === "auto" ? "16:9" : ratio,
  );
  update("vquality", normalized);
  update("size", normalizeVideoSize(ratio, normalized));
}

function Choice({
  selected,
  theme,
  onClick,
  children,
}: {
  selected: boolean;
  theme: CanvasTheme;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className="h-8 rounded border px-2 text-xs transition hover:opacity-80"
      style={{
        borderColor: selected ? theme.node.text : theme.node.stroke,
        color: theme.node.text,
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SettingBlock({
  title,
  muted,
  children,
}: {
  title: string;
  muted: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 space-y-2 border-0 p-0">
      <legend className="text-xs font-medium" style={{ color: muted }}>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function DimensionField({
  axis,
  value,
  disabled,
  theme,
  onChange,
}: {
  axis: "width" | "height";
  value: number;
  disabled: boolean;
  theme: CanvasTheme;
  onChange: (value: number | null) => void;
}) {
  const shortName = axis === "width" ? "W" : "H";
  return (
    <label
      className="flex h-8 items-center rounded border text-xs"
      style={{ borderColor: theme.node.stroke, opacity: disabled ? 0.55 : 1 }}
    >
      <span
        className="grid w-8 place-items-center"
        style={{ color: theme.node.muted }}
      >
        {shortName}
      </span>
      <input
        type="number"
        min={1}
        disabled={disabled}
        value={value || ""}
        className="min-w-0 flex-1 bg-transparent px-1 outline-none"
        onChange={(event) => onChange(Number(event.target.value) || null)}
      />
    </label>
  );
}

function RatioGlyph({
  width,
  height,
  color,
}: {
  width: number;
  height: number;
  color: string;
}) {
  if (!width || !height)
    return <span className="grid h-6 w-7 place-items-center text-sm">↗</span>;
  const edge = Math.max(width, height);
  return (
    <span
      className="rounded-[2px] border"
      style={{
        width: Math.max(9, Math.round((width / edge) * 25)),
        height: Math.max(9, Math.round((height / edge) * 25)),
        borderColor: color,
      }}
    />
  );
}

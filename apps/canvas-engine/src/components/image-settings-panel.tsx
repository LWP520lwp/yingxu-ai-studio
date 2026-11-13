import { type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { ConfigProvider, InputNumber, Switch } from "antd";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import type { CanvasTheme } from "@/lib/canvas-theme";
import {
  inferMediaRatio,
  inferMediaScale,
  mediaRatioOptions,
  mediaScaleOptions,
} from "@/lib/media-size";
import {
  alignImageDimension,
  getQuickImageCounts,
  normalizeImageCount,
  readImageSettings,
  selectImageRatio,
  selectImageScale,
  updateImageDimension,
} from "@/lib/image-settings-model";
import type { AiConfig } from "@/stores/use-config-store";

const qualityChoices = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const imageQualityOptions = qualityChoices.map((value) => ({
  value,
  get label() {
    return i18n.t(`settingsPanels.common.${value}`);
  },
}));

export const imageAspectOptions = mediaRatioOptions.map(({ value }) => ({
  value,
  get label() {
    return value === "auto" ? i18n.t("settingsPanels.common.auto") : value;
  },
}));

export const imageScaleOptions = mediaScaleOptions.map((value) => ({
  value,
  get label() {
    return value === "auto" ? i18n.t("settingsPanels.common.auto") : value;
  },
}));

type ImageSettingsPanelProps = {
  config: AiConfig;
  onConfigChange: (
    key: "quality" | "size" | "count" | "background",
    value: string,
  ) => void;
  theme: CanvasTheme;
  showTitle?: boolean;
  className?: string;
  maxCount?: number;
  quickCount?: number;
};

export function ImageSettingsPanel({
  config,
  onConfigChange,
  theme,
  showTitle = true,
  className = "w-[320px] space-y-4 px-1 py-0.5",
  maxCount = 15,
  quickCount = 10,
}: ImageSettingsPanelProps) {
  const { t } = useTranslation();
  const [alignDimensions, setAlignDimensions] = useState(true);
  const size = config.size || "auto";
  const { scale, ratio, dimensions, dimensionsEditable } =
    readImageSettings(size);
  const count = normalizeImageCount(config.count, maxCount);
  const transparent = config.background === "transparent";
  const quickCounts = getQuickImageCounts(quickCount, maxCount);

  const changeDimension = (edge: "width" | "height", value: number) => {
    onConfigChange(
      "size",
      updateImageDimension(size, edge, value, alignDimensions),
    );
  };

  return (
    <ImageSettingsTheme theme={theme}>
      <div
        className={className}
        style={{ color: theme.node.text }}
        onMouseDown={keepPanelInputsFocused}
      >
        {showTitle ? (
          <h2 className="text-lg font-semibold">
            {t("settingsPanels.image.title")}
          </h2>
        ) : null}

        <SettingBlock title={t("settingsPanels.image.quality")} theme={theme}>
          <ImageChoiceGrid
            label={t("settingsPanels.image.quality")}
            value={config.quality || "auto"}
            columns={3}
            theme={theme}
            options={qualityChoices.map((value) => ({
              value,
              label: t(`settingsPanels.common.${value}`),
            }))}
            onSelect={(value) => onConfigChange("quality", value)}
          />
        </SettingBlock>

        <SettingBlock
          title={t("settingsPanels.image.size")}
          theme={theme}
          accessory={
            <label
              className="flex cursor-pointer items-center gap-2 text-xs"
              title={t("settingsPanels.image.align16Hint")}
              onMouseDown={stopPanelMouseDown}
            >
              <span>{t("settingsPanels.image.align16")}</span>
              <Switch
                size="small"
                checked={alignDimensions}
                aria-label={t("settingsPanels.image.align16")}
                onChange={setAlignDimensions}
              />
            </label>
          }
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <DimensionInput
              axis="W"
              value={dimensions.width}
              disabled={!dimensionsEditable}
              alignToStep={alignDimensions}
              theme={theme}
              onCommit={(value) => changeDimension("width", value)}
            />
            <ArrowLeftRight className="size-4 opacity-45" aria-hidden="true" />
            <DimensionInput
              axis="H"
              value={dimensions.height}
              disabled={!dimensionsEditable}
              alignToStep={alignDimensions}
              theme={theme}
              onCommit={(value) => changeDimension("height", value)}
            />
          </div>
        </SettingBlock>

        <SettingBlock
          title={t("settingsPanels.image.resolution")}
          theme={theme}
        >
          <ImageChoiceGrid
            label={t("settingsPanels.image.resolution")}
            value={scale}
            columns={4}
            theme={theme}
            options={mediaScaleOptions.map((value) => ({
              value,
              label: value === "auto" ? t("settingsPanels.common.auto") : value,
            }))}
            onSelect={(value) =>
              onConfigChange("size", selectImageScale(size, value))
            }
          />
        </SettingBlock>

        <SettingBlock
          title={t("settingsPanels.image.aspectRatio")}
          theme={theme}
        >
          <ImageChoiceGrid
            label={t("settingsPanels.image.aspectRatio")}
            value={ratio}
            columns={4}
            optionHeight={68}
            theme={theme}
            options={mediaRatioOptions.map((option) => ({
              ...option,
              label: option.value === "auto"
                ? t("settingsPanels.common.auto")
                : option.value,
            }))}
            renderOption={(option) => (
              <span className="flex h-full flex-col items-center justify-center gap-1">
                <RatioMark width={option.width ?? 0} height={option.height ?? 0} />
                <span>{option.label}</span>
              </span>
            )}
            onSelect={(value) =>
              onConfigChange("size", selectImageRatio(size, value))
            }
          />
        </SettingBlock>

        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div
              className="text-xs font-medium"
              style={{ color: theme.node.muted }}
            >
              {t("settingsPanels.image.transparent")}
            </div>
            <p
              className="text-xs opacity-75"
              style={{ color: theme.node.muted }}
            >
              {t("settingsPanels.image.transparentHint")}
            </p>
          </div>
          <span onMouseDown={stopPanelMouseDown}>
            <Switch
              size="small"
              checked={transparent}
              aria-label={t("settingsPanels.image.transparent")}
              onChange={(enabled) =>
                onConfigChange("background", enabled ? "transparent" : "")
              }
            />
          </span>
        </div>

        <SettingBlock title={t("settingsPanels.image.count")} theme={theme}>
          <div className="grid grid-cols-4 gap-2">
            {quickCounts.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={count === value}
                className={`h-9 rounded-lg border text-sm transition ${count === value ? "font-semibold" : "opacity-75 hover:opacity-100"}`}
                style={{
                  background:
                    count === value ? theme.node.panel : "transparent",
                  borderColor:
                    count === value
                      ? theme.node.activeStroke
                      : theme.node.stroke,
                  color: theme.node.text,
                }}
                onMouseDown={stopPanelMouseDown}
                onClick={() => onConfigChange("count", String(value))}
              >
                {value}
              </button>
            ))}
            <CountInput
              label={t("settingsPanels.image.count")}
              value={count}
              max={maxCount}
              theme={theme}
              onCommit={(value) =>
                onConfigChange(
                  "count",
                  String(normalizeImageCount(value, maxCount)),
                )
              }
            />
          </div>
        </SettingBlock>
      </div>
    </ImageSettingsTheme>
  );
}

export function ImageSettingsTheme({
  theme,
  children,
}: {
  theme: CanvasTheme;
  children: ReactNode;
}) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorBgContainer: theme.toolbar.panel,
          colorBgElevated: theme.toolbar.panel,
          colorBorder: theme.node.stroke,
          colorPrimary: theme.node.activeStroke,
          colorText: theme.node.text,
          colorTextLightSolid: theme.node.panel,
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

export function imageQualityLabel(value: string) {
  return qualityChoices.some((choice) => choice === value)
    ? i18n.t(`settingsPanels.common.${value}`)
    : value;
}

export function imageSizeLabel(size: string) {
  const scale = inferMediaScale(size);
  const ratio = inferMediaRatio(size);
  if (size === "auto" || ratio === "auto") {
    return i18n.t("settingsPanels.common.auto");
  }
  return scale === "auto" ? ratio : `${scale} · ${ratio}`;
}

function SettingBlock({
  title,
  theme,
  accessory,
  children,
}: {
  title: string;
  theme: CanvasTheme;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex min-h-4 items-center justify-between gap-3">
        <h3 className="text-xs font-medium" style={{ color: theme.node.muted }}>
          {title}
        </h3>
        {accessory}
      </div>
      {children}
    </section>
  );
}

type ImageChoiceOption = {
  value: string;
  label: string;
  width?: number;
  height?: number;
};

function ImageChoiceGrid({
  label,
  value,
  columns,
  theme,
  options,
  optionHeight = 36,
  renderOption,
  onSelect,
}: {
  label: string;
  value: string;
  columns: number;
  theme: CanvasTheme;
  options: readonly ImageChoiceOption[];
  optionHeight?: number;
  renderOption?: (option: ImageChoiceOption) => ReactNode;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid w-full gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={option.value}
            className="min-w-0 rounded-md border px-1.5 text-center text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              minHeight: optionHeight,
              background: selected ? theme.node.panel : "transparent",
              borderColor: selected ? theme.node.activeStroke : theme.node.stroke,
              color: theme.node.text,
            }}
            onMouseDown={stopPanelMouseDown}
            onClick={() => onSelect(option.value)}
          >
            {renderOption ? renderOption(option) : option.label}
          </button>
        );
      })}
    </div>
  );
}

function DimensionInput({
  axis,
  value,
  disabled,
  alignToStep,
  theme,
  onCommit,
}: {
  axis: "W" | "H";
  value: number;
  disabled: boolean;
  alignToStep: boolean;
  theme: CanvasTheme;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(value || null);
  useEffect(() => setDraft(value || null), [value]);
  const commit = () => {
    const next = alignImageDimension(
      Math.max(1, Math.floor(draft || value || 1024)),
      alignToStep,
    );
    setDraft(next);
    onCommit(next);
  };

  return (
    <label
      className="flex h-9 min-w-0 items-center gap-2 rounded-lg px-2"
      style={{ background: theme.node.fill, opacity: disabled ? 0.55 : 1 }}
    >
      <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
        {axis}
      </span>
      <InputNumber
        aria-label={axis === "W" ? "Width" : "Height"}
        className="w-full"
        controls={false}
        min={1}
        value={draft}
        disabled={disabled}
        bordered={false}
        onMouseDown={stopPanelMouseDown}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function CountInput({
  label,
  value,
  max,
  theme,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  theme: CanvasTheme;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = normalizeImageCount(draft, max);
    setDraft(next);
    onCommit(next);
  };

  return (
    <label
      className="col-span-2 flex h-9 items-center justify-center rounded-lg border px-2"
      style={{ borderColor: theme.node.stroke }}
    >
      <InputNumber
        aria-label={label}
        className="w-full text-center"
        controls={false}
        min={1}
        max={max}
        value={draft}
        bordered={false}
        onMouseDown={stopPanelMouseDown}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function RatioMark({ width, height }: { width: number; height: number }) {
  if (!width || !height) return <span className="h-5 w-6" aria-hidden="true" />;
  const ratio = width / height;
  return (
    <span
      className="block max-h-6 max-w-7 border-2"
      style={{
        aspectRatio: `${width} / ${height}`,
        width: ratio >= 1 ? 24 : Math.max(10, 24 * ratio),
        height: ratio >= 1 ? Math.max(10, 24 / ratio) : 24,
      }}
      aria-hidden="true"
    />
  );
}

function keepPanelInputsFocused(event: MouseEvent<HTMLDivElement>) {
  event.stopPropagation();
  if (event.target instanceof HTMLInputElement) return;
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement &&
    event.currentTarget.contains(active)
  ) {
    active.blur();
  }
}

function stopPanelMouseDown(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

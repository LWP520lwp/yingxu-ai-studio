import { type MouseEvent, type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
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
  { value: "auto", labelKey: "auto" },
  { value: "low", labelKey: "low" },
  { value: "medium", labelKey: "medium" },
  { value: "high", labelKey: "high" },
  { value: "xhigh", labelKey: "xhigh" },
  { value: "max", labelKey: "max" },
] as const;

export const imageQualityOptions = qualityChoices.map((choice) => ({
  value: choice.value,
  get label() {
    return i18n.t(`settingsPanels.common.${choice.labelKey}`);
  },
}));

export const imageAspectOptions = mediaRatioOptions.map((choice) => ({
  value: choice.value,
  get label() {
    return choice.value === "auto"
      ? i18n.t("settingsPanels.common.auto")
      : choice.value;
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
  className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5",
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

  const changeDimension = (edge: "width" | "height", nextValue: number) => {
    onConfigChange(
      "size",
      updateImageDimension(size, edge, nextValue, alignDimensions),
    );
  };

  return (
    <ImageSettingsTheme theme={theme}>
      <div
        className={className}
        style={{ color: theme.node.text }}
        onMouseDown={keepCanvasStill}
      >
        {showTitle ? (
          <h2 className="text-lg font-semibold">
            {t("settingsPanels.image.title")}
          </h2>
        ) : null}

        <SettingsSection
          title={t("settingsPanels.image.quality")}
          color={theme.node.muted}
        >
          <div className="grid grid-cols-3 gap-2.5">
            {qualityChoices.map((choice) => (
              <OptionButton
                key={choice.value}
                active={(config.quality || "auto") === choice.value}
                theme={theme}
                onSelect={() => onConfigChange("quality", choice.value)}
              >
                {t(`settingsPanels.common.${choice.labelKey}`)}
              </OptionButton>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("settingsPanels.image.size")}
          color={theme.node.muted}
          accessory={
            <label
              className="flex cursor-pointer items-center gap-2 text-xs font-medium"
              title={t("settingsPanels.image.align16Hint")}
              onMouseDown={stopCanvasMouseDown}
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
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
            <DimensionField
              label={t("settingsPanels.image.size")}
              edge="width"
              value={dimensions.width}
              disabled={!dimensionsEditable}
              theme={theme}
              alignToStep={alignDimensions}
              onCommit={(value) => changeDimension("width", value)}
            />
            <ArrowLeftRight className="size-4 opacity-45" aria-hidden="true" />
            <DimensionField
              label={t("settingsPanels.image.size")}
              edge="height"
              value={dimensions.height}
              disabled={!dimensionsEditable}
              theme={theme}
              alignToStep={alignDimensions}
              onCommit={(value) => changeDimension("height", value)}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("settingsPanels.image.resolution")}
          color={theme.node.muted}
        >
          <div className="grid grid-cols-4 gap-2.5">
            {mediaScaleOptions.map((choice) => (
              <OptionButton
                key={choice}
                active={scale === choice}
                theme={theme}
                onSelect={() =>
                  onConfigChange("size", selectImageScale(size, choice))
                }
              >
                {choice === "auto" ? t("settingsPanels.common.auto") : choice}
              </OptionButton>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("settingsPanels.image.aspectRatio")}
          color={theme.node.muted}
        >
          <div className="grid grid-cols-4 gap-2.5">
            {mediaRatioOptions.map((choice) => (
              <AspectRatioButton
                key={choice.value}
                value={choice.value}
                width={choice.width}
                height={choice.height}
                label={
                  choice.value === "auto"
                    ? t("settingsPanels.common.auto")
                    : choice.value
                }
                active={ratio === choice.value}
                theme={theme}
                onSelect={() =>
                  onConfigChange("size", selectImageRatio(size, choice.value))
                }
              />
            ))}
          </div>
        </SettingsSection>

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
          <span onMouseDown={stopCanvasMouseDown}>
            <Switch
              size="small"
              checked={transparent}
              aria-label={t("settingsPanels.image.transparent")}
              onChange={(checked) =>
                onConfigChange("background", checked ? "transparent" : "")
              }
            />
          </span>
        </div>

        <SettingsSection
          title={t("settingsPanels.image.count")}
          color={theme.node.muted}
        >
          <div className="grid grid-cols-4 gap-2.5">
            {quickCounts.map((value) => (
              <OptionButton
                key={value}
                active={count === value}
                theme={theme}
                onSelect={() => onConfigChange("count", String(value))}
              >
                {t("settingsPanels.image.images", { count: value })}
              </OptionButton>
            ))}
            <CountField
              label={t("settingsPanels.image.count")}
              value={count}
              max={maxCount}
              theme={theme}
              onChange={(value) =>
                onConfigChange(
                  "count",
                  String(normalizeImageCount(value, maxCount)),
                )
              }
            />
          </div>
        </SettingsSection>
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
        components: {
          Button: {
            defaultBg: theme.toolbar.panel,
            defaultBorderColor: theme.node.stroke,
            defaultColor: theme.node.text,
          },
          Slider: {
            railBg: theme.node.stroke,
            railHoverBg: theme.node.stroke,
            trackBg: theme.node.activeStroke,
            handleColor: theme.node.text,
            handleActiveColor: theme.node.text,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

export function imageQualityLabel(value: string) {
  return qualityChoices.some((choice) => choice.value === value)
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

function SettingsSection({
  title,
  color,
  accessory,
  children,
}: {
  title: string;
  color: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5" aria-label={title}>
      <div className="flex min-h-4 items-center justify-between gap-3">
        <h3 className="text-xs font-medium" style={{ color }}>
          {title}
        </h3>
        {accessory}
      </div>
      {children}
    </section>
  );
}

function OptionButton({
  active,
  theme,
  onSelect,
  children,
}: {
  active: boolean;
  theme: CanvasTheme;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
      style={{
        background: "transparent",
        borderColor: active ? theme.node.text : theme.node.stroke,
        color: theme.node.text,
      }}
      onMouseDown={stopCanvasMouseDown}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function AspectRatioButton({
  value,
  width,
  height,
  label,
  active,
  theme,
  onSelect,
}: {
  value: string;
  width: number;
  height: number;
  label: string;
  active: boolean;
  theme: CanvasTheme;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
      style={{
        borderColor: active ? theme.node.text : theme.node.stroke,
        color: theme.node.text,
      }}
      onMouseDown={stopCanvasMouseDown}
      onClick={onSelect}
    >
      <AspectRatioGlyph width={width} height={height} color={theme.node.text} />
      <span>{label}</span>
      <span className="sr-only">{value}</span>
    </button>
  );
}

function DimensionField({
  label,
  edge,
  value,
  disabled,
  theme,
  alignToStep,
  onCommit,
}: {
  label: string;
  edge: "width" | "height";
  value: number;
  disabled: boolean;
  theme: CanvasTheme;
  alignToStep: boolean;
  onCommit: (value: number) => void;
}) {
  const axis = edge === "width" ? "W" : "H";
  const commit = (input: HTMLInputElement) => {
    const entered = Number(input.value);
    const next = Math.max(1, Math.floor(entered || value || 1024));
    input.value = String(alignImageDimension(next, alignToStep));
    onCommit(next);
  };

  return (
    <label
      className="flex h-9 overflow-hidden rounded-xl text-sm"
      style={{
        background: theme.node.fill,
        color: theme.node.text,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        className="grid w-9 shrink-0 place-items-center"
        style={{ color: theme.node.muted }}
      >
        {axis}
      </span>
      <input
        type="number"
        aria-label={`${label} ${axis}`}
        min={1}
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        defaultValue={value || ""}
        key={`${edge}-${value}`}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onMouseDown={stopCanvasMouseDown}
      />
    </label>
  );
}

function CountField({
  label,
  value,
  max,
  theme,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  theme: CanvasTheme;
  onChange: (value: number | null) => void;
}) {
  return (
    <label
      className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm"
      style={{ borderColor: theme.node.stroke, color: theme.node.text }}
    >
      <input
        type="number"
        aria-label={label}
        min={1}
        max={max}
        className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
        value={value || ""}
        onChange={(event) => onChange(Number(event.target.value) || null)}
        onMouseDown={stopCanvasMouseDown}
      />
    </label>
  );
}

function AspectRatioGlyph({
  width,
  height,
  color,
}: {
  width: number;
  height: number;
  color: string;
}) {
  if (!width || !height) return <span className="grid h-7 w-9" />;
  const ratio = width / height;
  const glyphWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
  const glyphHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;

  return (
    <span className="grid h-7 w-9 place-items-center" aria-hidden="true">
      <span
        className="border-2"
        style={{ width: glyphWidth, height: glyphHeight, borderColor: color }}
      />
    </span>
  );
}

function keepCanvasStill(event: MouseEvent<HTMLDivElement>) {
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

function stopCanvasMouseDown(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

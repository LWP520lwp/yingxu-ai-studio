import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Modal,
  Switch,
  Tooltip,
  theme as antdTheme,
} from "antd";
import { Ellipsis, Image as ImageIcon, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  getImageQuickToolSelectionChanges,
  type ImageQuickToolId,
} from "@/atlas-engine/ui/image-quick-tools";
import { previewScrollbarThumbWidth } from "@/atlas-engine/ui/image-toolbar-settings";
import { useElementScrollMetrics } from "@/hooks/use-element-scroll-metrics";

export type ImageToolbarSettingsTool = {
  id: ImageQuickToolId;
  title: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  danger?: boolean;
};

type PreviewItem = Pick<
  ImageToolbarSettingsTool,
  "title" | "label" | "icon" | "active" | "danger"
> & { id: ImageQuickToolId | "more" };

type ImageToolSettingsModalProps = {
  open: boolean;
  tools: ImageToolbarSettingsTool[];
  selectedIds: ImageQuickToolId[];
  showLabels: boolean;
  onToggle: (id: ImageQuickToolId, visible: boolean) => void;
  onShowLabelsChange: (value: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function ImageToolSettingsModal({
  open,
  tools,
  selectedIds,
  showLabels,
  onToggle,
  onShowLabelsChange,
  onCancel,
  onSave,
}: ImageToolSettingsModalProps) {
  const { t } = useTranslation();
  const { token } = antdTheme.useToken();
  const rangeRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleTools = useMemo(
    () => tools.filter(({ id }) => selected.has(id)),
    [selected, tools],
  );
  const previewItems = useMemo<PreviewItem[]>(
    () => [
      ...visibleTools,
      {
        id: "more",
        title: t("canvas.imageTools.configure"),
        label: t("canvas.imageTools.more"),
        icon: <Ellipsis className="size-4" />,
        active: true,
      },
    ],
    [t, visibleTools],
  );

  const { elementRef, metrics, measure, scrollTo } = useElementScrollMetrics(
    open,
    `${selectedIds.join("\u0000")}:${showLabels}:${previewItems.length}`,
  );

  const onSelectionChange = (values: Array<string | number>) => {
    const changed = getImageQuickToolSelectionChanges(
      tools.map(({ id }) => id),
      selectedIds,
      values as ImageQuickToolId[],
    );
    for (const change of changed) onToggle(change.id, change.visible);
  };

  const sliderMax = Math.max(metrics.max, 1);
  const thumb = previewScrollbarThumbWidth(
    rangeRef.current?.clientWidth || metrics.viewport,
    metrics.viewport,
    metrics.content,
    metrics.max > 0,
  );

  return (
    <Modal
      title={t("canvas.imageTools.customize")}
      open={open}
      centered
      width={760}
      destroyOnHidden
      onCancel={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button type="primary" onClick={onSave}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section
          className="min-w-0"
          aria-labelledby="image-toolbar-preview-title"
        >
          <header className="mb-3 flex items-center gap-2">
            <ImageIcon className="size-4 text-secondary" aria-hidden="true" />
            <h3
              id="image-toolbar-preview-title"
              className="m-0 text-sm font-semibold"
            >
              {t("canvas.imageTools.preview")}
            </h3>
          </header>
          <ToolbarPreview
            items={previewItems}
            showLabels={showLabels}
            scrollRef={elementRef}
            rangeRef={rangeRef}
            left={metrics.left}
            max={sliderMax}
            maxScroll={metrics.max}
            thumbWidth={thumb}
            onScroll={measure}
            onScrollChange={(value) => scrollTo(Number(value))}
            label={t("canvas.imageTools.preview")}
            imageLabel={t("canvas.imageTools.imageNode")}
            background={token.colorFillAlter}
            elevatedBackground={token.colorBgElevated}
            border={token.colorBorderSecondary}
            muted={token.colorTextSecondary}
            text={token.colorText}
            shadow={token.boxShadowSecondary}
          />
          <p className="mb-0 mt-3 text-sm text-secondary">
            {t("canvas.imageTools.description")}
          </p>
        </section>

        <section className="min-w-0" aria-labelledby="image-quick-tools-title">
          <header className="mb-2 flex items-center justify-between gap-3">
            <h3
              id="image-quick-tools-title"
              className="m-0 flex min-w-0 items-center gap-2 text-sm font-semibold"
            >
              <Settings2 className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {t("canvas.imageTools.quickTools")}
              </span>
            </h3>
            <output
              className="shrink-0 text-xs text-secondary"
              aria-live="polite"
            >
              {visibleTools.length}/{tools.length}
            </output>
          </header>
          <Checkbox.Group
            value={selectedIds}
            onChange={onSelectionChange}
            aria-label={t("canvas.imageTools.quickTools")}
            className="grid max-h-[320px] w-full gap-1.5 overflow-y-auto pr-1"
          >
            {tools.map((tool) => (
              <label
                key={tool.id}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors hover:bg-black/[.025] dark:hover:bg-white/[.04]"
                style={{ borderColor: token.colorBorderSecondary }}
              >
                <Checkbox value={tool.id} className="m-0">
                  <span className="sr-only">{tool.title}</span>
                </Checkbox>
                <span className="shrink-0" aria-hidden="true">
                  {tool.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{tool.label}</span>
              </label>
            ))}
          </Checkbox.Group>
          <div
            className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            style={{ borderColor: token.colorBorderSecondary }}
          >
            <span className="min-w-0 text-xs text-secondary">
              {t("canvas.imageTools.showLabels")}
            </span>
            <Switch
              size="small"
              checked={showLabels}
              onChange={onShowLabelsChange}
              aria-label={t("canvas.imageTools.showLabels")}
            />
          </div>
        </section>
      </div>
    </Modal>
  );
}

function ToolbarPreview({
  items,
  showLabels,
  scrollRef,
  rangeRef,
  left,
  max,
  maxScroll,
  thumbWidth,
  onScroll,
  onScrollChange,
  label,
  imageLabel,
  background,
  elevatedBackground,
  border,
  muted,
  text,
  shadow,
}: {
  items: PreviewItem[];
  showLabels: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rangeRef: React.RefObject<HTMLInputElement | null>;
  left: number;
  max: number;
  maxScroll: number;
  thumbWidth: number;
  onScroll: () => void;
  onScrollChange: (value: number) => void;
  label: string;
  imageLabel: string;
  background: string;
  elevatedBackground: string;
  border: string;
  muted: string;
  text: string;
  shadow: string;
}) {
  return (
    <section
      className="relative flex min-h-[300px] items-center justify-center overflow-hidden rounded-lg border px-3 pb-11 pt-20"
      aria-label={label}
      style={{ background, borderColor: border }}
    >
      <div
        className="absolute inset-x-3 top-3 flex items-center gap-2 text-xs font-medium"
        style={{ color: muted }}
      >
        <span>{label}</span>
        <span className="h-px flex-1" style={{ background: border }} />
      </div>

      <div
        ref={scrollRef}
        role="group"
        aria-label={label}
        onScroll={onScroll}
        className="hide-scrollbar absolute inset-x-3 top-10 z-10 flex h-12 items-center overflow-x-auto rounded-md border px-1 text-[13px]"
        style={{
          background: elevatedBackground,
          borderColor: border,
          boxShadow: shadow,
          color: text,
        }}
      >
        {items.map((item) => (
          <ToolbarPreviewItem
            key={item.id}
            item={item}
            showLabels={showLabels}
          />
        ))}
      </div>

      <div className="flex h-44 w-full max-w-[360px] flex-col items-center justify-center text-center">
        <ImageIcon className="mb-2 size-8 opacity-60" aria-hidden="true" />
        <span className="text-sm" style={{ color: muted }}>
          {imageLabel}
        </span>
      </div>

      <input
        ref={rangeRef}
        type="range"
        min={0}
        max={max}
        value={Math.min(left, max)}
        disabled={maxScroll <= 0}
        onChange={(event) => onScrollChange(Number(event.target.value))}
        aria-label={label}
        aria-valuetext={`${Math.round(left)} / ${Math.round(maxScroll)}`}
        title={label}
        className="absolute bottom-4 left-10 right-10 h-2.5 cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-[var(--preview-thumb-width)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#8d9498] [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[#bdc4c8] [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[#bdc4c8] [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-[var(--preview-thumb-width)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#8d9498]"
        style={{ "--preview-thumb-width": `${thumbWidth}px` } as CSSProperties}
      />
    </section>
  );
}

function ToolbarPreviewItem({
  item,
  showLabels,
}: {
  item: PreviewItem;
  showLabels: boolean;
}) {
  const { token } = antdTheme.useToken();
  return (
    <Tooltip title={item.title}>
      <span
        role="img"
        aria-label={showLabels ? item.title : `${item.title}: ${item.label}`}
        className={`mx-0.5 flex h-9 shrink-0 items-center rounded-md border border-transparent px-2 ${showLabels ? "gap-2" : "justify-center"}`}
        style={{
          color: item.danger ? token.colorError : undefined,
          ...(item.active ? { borderColor: token.colorPrimary } : {}),
        }}
      >
        <span aria-hidden="true">{item.icon}</span>
        {showLabels ? (
          <span className="whitespace-nowrap">{item.label}</span>
        ) : null}
      </span>
    </Tooltip>
  );
}

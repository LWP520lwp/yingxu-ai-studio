import { useEffect, useId, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { Cpu, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  getModelIconPath,
  getModelPickerEmptyState,
  getModelPickerOptions,
  getModelPickerLabel,
} from "@/lib/model-picker";
import { cn } from "@/lib/utils";
import { refreshPlatformModels } from "@/platform/rpc";
import type { AiConfig, ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
  config: AiConfig;
  value?: string;
  onChange: (model: string) => void;
  capability?: ModelCapability;
  className?: string;
  fullWidth?: boolean;
  placeholder?: string;
  onMissingConfig?: () => void;
};

export function ModelPicker({
  config,
  value,
  onChange,
  capability,
  className,
  fullWidth = false,
  placeholder,
  onMissingConfig,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshController = useRef<AbortController | null>(null);
  const options = useMemo(
    () => getModelPickerOptions(config, value, capability),
    [capability, config, value],
  );
  const current = value || "";
  const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
  const canRefresh = capability === "image" || capability === "video";

  useEffect(() => () => refreshController.current?.abort(), []);

  useEffect(() => {
    const closeSiblingPicker = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
    };
    window.addEventListener("model-picker-open", closeSiblingPicker);
    return () =>
      window.removeEventListener("model-picker-open", closeSiblingPicker);
  }, [pickerId]);

  const refreshModels = async () => {
    if (refreshController.current) return;
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshing(true);

    try {
      const models = await refreshPlatformModels({ signal: controller.signal });
      if (controller.signal.aborted) return;
      const availableCount =
        capability === "image" || capability === "video"
          ? models[capability].filter((model) => model.available).length
          : 0;
      const kindLabel = capability === "video" ? "视频" : "图像";
      if (availableCount) {
        message.success(
          `模型状态已刷新，${availableCount} 个${kindLabel}模型可用`,
        );
      } else {
        message.info(
          `模型状态已刷新，当前暂无可用的${kindLabel}模型；请在账号池核对状态后重试`,
        );
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        message.error(
          cause instanceof Error
            ? cause.message
            : "模型状态刷新失败，请稍后重试",
        );
      }
    } finally {
      if (refreshController.current === controller) {
        refreshController.current = null;
        setRefreshing(false);
      }
    }
  };

  const openPicker = (nextOpen: boolean) => {
    if (nextOpen && !options.length && config.channelMode === "local") {
      onMissingConfig?.();
    }
    if (nextOpen) {
      window.dispatchEvent(
        new CustomEvent("model-picker-open", { detail: pickerId }),
      );
    }
    setOpen(nextOpen);
  };

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1",
        fullWidth ? "w-full" : "w-fit",
        className,
      )}
    >
      <Select
        open={open}
        value={current}
        onOpenChange={openPicker}
        onValueChange={onChange}
      >
        <SelectTrigger
          aria-label={
            current ? getModelPickerLabel(config, current) : pickerPlaceholder
          }
          className={cn(
            "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
            fullWidth
              ? "w-full min-w-0 flex-1 justify-start"
              : "min-w-0 flex-1 justify-start",
            "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
            className,
          )}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          title={
            current ? getModelPickerLabel(config, current) : pickerPlaceholder
          }
        >
          <ModelIcon model={current} />
          <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">
            {current ? getModelPickerLabel(config, current) : pickerPlaceholder}
          </span>
        </SelectTrigger>
        <SelectContent
          data-canvas-no-zoom
          className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
          position="popper"
          align="start"
          side="bottom"
          sideOffset={6}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {options.length ? (
            options.map((model) => (
              <SelectItem
                key={model}
                value={model}
                textValue={getModelPickerLabel(config, model)}
              >
                <ModelLabel config={config} model={model} />
              </SelectItem>
            ))
          ) : (
            <SelectItem value="__empty__" disabled>
              <EmptyModelLabel config={config} capability={capability} />
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {canRefresh ? (
        <button
          type="button"
          aria-label={refreshing ? "正在刷新模型状态" : "刷新模型状态"}
          aria-busy={refreshing}
          disabled={refreshing}
          title="刷新模型状态；任务结束后可重新检查，当前节点设置会保留"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-50"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => void refreshModels()}
        >
          <RefreshCw
            className={cn("size-3.5", refreshing && "animate-spin")}
            aria-hidden="true"
          />
        </button>
      ) : null}
    </span>
  );
}

function EmptyModelLabel({
  config,
  capability,
}: {
  config: AiConfig;
  capability?: ModelCapability;
}) {
  const { t } = useTranslation();
  const emptyState = getModelPickerEmptyState(config, capability);
  const values = emptyState.values?.capability
    ? { capability: t(emptyState.values.capability) }
    : undefined;
  return <>{t(emptyState.key, values)}</>;
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ModelIcon model={model} />
      <span className="truncate">{getModelPickerLabel(config, model)}</span>
    </span>
  );
}

function ModelIcon({ model }: { model: string }) {
  const icon = getModelIconPath(model);
  return icon ? (
    <img src={icon} alt="" className="size-4 shrink-0 dark:invert" />
  ) : (
    <Cpu className="size-4 shrink-0 opacity-70" aria-hidden="true" />
  );
}

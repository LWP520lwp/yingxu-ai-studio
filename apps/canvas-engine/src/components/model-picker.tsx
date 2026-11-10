import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Cpu, RefreshCw } from "lucide-react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { refreshPlatformModels } from "@/platform/rpc";

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

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const refreshController = useRef<AbortController | null>(null);
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    const canRefresh = capability === "image" || capability === "video";

    useEffect(() => () => refreshController.current?.abort(), []);
    const refresh = async () => {
        if (refreshController.current) return;
        const controller = new AbortController();
        refreshController.current = controller; setRefreshing(true);
        try {
            const models = await refreshPlatformModels({ signal: controller.signal });
            if (controller.signal.aborted) return;
            const count = canRefresh ? models[capability].filter((model) => model.available).length : 0;
            if (count) message.success(`模型状态已刷新，${count} 个${capability === "video" ? "视频" : "图像"}模型可用`);
            else message.info(`模型状态已刷新，当前暂无可用的${capability === "video" ? "视频" : "图像"}模型；请在账号池核对状态后重试`);
        } catch (cause) {
            if (!controller.signal.aborted) message.error(cause instanceof Error ? cause.message : "模型状态刷新失败，请稍后重试");
        } finally {
            if (refreshController.current === controller) refreshController.current = null;
            if (!controller.signal.aborted) setRefreshing(false);
        }
    };

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1", fullWidth ? "w-full" : "w-fit", className)}>
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 flex-1 justify-start" : "min-w-0 flex-1 justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : pickerPlaceholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : pickerPlaceholder}</span>
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
                        <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)}>
                            <ModelLabel config={config} model={model} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
        {canRefresh && <button type="button" aria-label={refreshing ? "正在刷新模型状态" : "刷新模型状态"} aria-busy={refreshing} disabled={refreshing}
            title="刷新模型状态；任务结束后可重新检查，当前节点设置会保留"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-50"
            onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={() => void refresh()}>
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        </button>}
        </span>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}

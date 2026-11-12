import type { CSSProperties } from "react";
import {
  Image as ImageIcon,
  LoaderCircle,
  MessageSquare,
  Music2,
  Play,
  Settings2,
  Square,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Button, Segmented } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import {
  audioConfigPatch,
  buildNodeConfig,
  videoConfigPatch,
} from "@/components/canvas/canvas-node-prompt-panel";
import {
  useConfigStore,
  useEffectiveConfig,
  type AiConfig,
} from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import {
  CanvasAudioSettingsPopover,
  type CanvasAudioSettingKey,
} from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasVideoSkillSelect } from "./canvas-video-skill-select";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import type {
  CanvasGenerationMode,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/types/canvas";

type InputSummary = {
  textCount: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
};

type CanvasConfigNodePanelProps = {
  node: CanvasNodeData;
  isRunning: boolean;
  inputSummary: InputSummary;
  onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
  onGenerate: (nodeId: string) => void;
  onStop: (nodeId: string) => void;
  onComposerToggle: () => void;
};

type ModeOption = {
  value: CanvasGenerationMode;
  titleKey: string;
  icon: LucideIcon;
};

const MODE_OPTIONS: readonly ModeOption[] = [
  { value: "image", titleKey: "canvas.configNode.image", icon: ImageIcon },
  { value: "text", titleKey: "canvas.configNode.text", icon: MessageSquare },
  { value: "video", titleKey: "canvas.configNode.video", icon: Video },
  { value: "audio", titleKey: "canvas.configNode.audio", icon: Music2 },
];

const SETTINGS_BUTTON_CLASS =
  "canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2";

export function CanvasConfigNodePanel({
  node,
  isRunning,
  inputSummary,
  onConfigChange,
  onGenerate,
  onStop,
  onComposerToggle,
}: CanvasConfigNodePanelProps) {
  const { t } = useTranslation();
  const globalConfig = useEffectiveConfig();
  const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const mode = node.metadata?.generationMode || "image";
  const config = buildNodeConfig(globalConfig, node, mode);
  const chipStyle = {
    background: theme.node.fill,
    borderColor: theme.node.stroke,
    color: theme.node.text,
  };
  const hasComposerContent = Boolean(
    (node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim(),
  );
  const canGenerate = canGenerateFromInputs(
    mode,
    hasComposerContent,
    inputSummary,
  );
  const updateNode = (patch: Partial<CanvasNodeMetadata>) =>
    onConfigChange(node.id, patch);

  return (
    <div
      className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm"
      style={{
        color: theme.node.text,
        overflowY: mode === "video" ? "auto" : undefined,
      }}
      onWheel={(event) => event.stopPropagation()}
    >
      <ModeSelector
        mode={mode}
        onChange={(generationMode) => updateNode({ generationMode })}
      />

      <InputSummaryBar
        counts={inputSummary}
        style={chipStyle}
        onCompose={onComposerToggle}
      />

      <div
        className="mb-2 grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_148px] items-center gap-2"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <ModelPicker
          className="canvas-compact-control h-10"
          config={config}
          value={config.model}
          onChange={(model) => updateNode({ model })}
          capability={mode}
          onMissingConfig={() => openConfigDialog(true)}
          fullWidth
        />
        <ModeSettings
          mode={mode}
          config={config}
          node={node}
          onConfigChange={updateNode}
        />
      </div>

      {mode === "video" ? (
        <CanvasVideoSkillSelect
          metadata={node.metadata}
          disabled={isRunning}
          onChange={updateNode}
        />
      ) : null}

      <GenerationAction
        isRunning={isRunning}
        canGenerate={canGenerate}
        onStop={() => onStop(node.id)}
        onGenerate={() => onGenerate(node.id)}
      />
    </div>
  );
}

export function canGenerateFromInputs(
  mode: CanvasGenerationMode,
  hasComposerContent: boolean,
  counts: InputSummary,
) {
  if (hasComposerContent) return true;
  if (mode === "audio") return counts.textCount > 0;
  return Object.values(counts).some((count) => count > 0);
}

function ModeSelector({
  mode,
  onChange,
}: {
  mode: CanvasGenerationMode;
  onChange: (mode: CanvasGenerationMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="shrink-0 text-sm font-semibold">
        {t("canvas.configNode.title")}
      </div>
      <div
        className="cursor-default"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Segmented
          size="small"
          className="canvas-config-mode !rounded-md !p-0.5"
          aria-label={t("canvas.configNode.title")}
          value={mode}
          onChange={(value) => onChange(value as CanvasGenerationMode)}
          options={MODE_OPTIONS.map(({ value, titleKey, icon: Icon }) => ({
            value,
            label: (
              <span className="inline-flex items-center gap-1">
                <Icon className="size-3.5" aria-hidden="true" />
                {t(titleKey)}
              </span>
            ),
          }))}
        />
      </div>
    </div>
  );
}

function InputSummaryBar({
  counts,
  style,
  onCompose,
}: {
  counts: InputSummary;
  style: CSSProperties;
  onCompose: () => void;
}) {
  const { t } = useTranslation();
  const chips = [
    {
      label: t("canvas.configNode.prompt"),
      value: t("canvas.configNode.items", { count: counts.textCount }),
    },
    {
      label: t("canvas.configNode.references"),
      value: t("canvas.configNode.images", { count: counts.imageCount }),
    },
    {
      label: t("canvas.configNode.videoReferences"),
      value: t("canvas.configNode.items", { count: counts.videoCount }),
    },
    {
      label: t("canvas.configNode.audioReferences"),
      value: t("canvas.configNode.items", { count: counts.audioCount }),
    },
  ];

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {chips.map(({ label, value }) => (
        <InputChip key={label} label={label} value={value} style={style} />
      ))}
      <button
        type="button"
        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]"
        style={style}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onCompose}
      >
        <Settings2 className="size-3.5" aria-hidden="true" />
        {t("canvas.configNode.compose")}
      </button>
    </div>
  );
}

function InputChip({
  label,
  value,
  style,
}: {
  label: string;
  value: string;
  style: CSSProperties;
}) {
  return (
    <div
      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]"
      style={style}
    >
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ModeSettings({
  mode,
  config,
  node,
  onConfigChange,
}: {
  mode: CanvasGenerationMode;
  config: AiConfig;
  node: CanvasNodeData;
  onConfigChange: (patch: Partial<CanvasNodeMetadata>) => void;
}) {
  switch (mode) {
    case "video":
      return (
        <CanvasVideoSettingsPopover
          config={config}
          placement="topRight"
          buttonClassName={SETTINGS_BUTTON_CLASS}
          onConfigChange={(key, value) =>
            onConfigChange(videoConfigPatch(key, value))
          }
        />
      );
    case "image":
      return (
        <CanvasImageSettingsPopover
          config={config}
          placement="topRight"
          autoAdjustOverflow={false}
          buttonClassName={SETTINGS_BUTTON_CLASS}
          onConfigChange={(key, value) =>
            onConfigChange(imageConfigPatch(key, value))
          }
        />
      );
    case "audio":
      return (
        <CanvasAudioSettingsPopover
          config={config}
          placement="topRight"
          buttonClassName={SETTINGS_BUTTON_CLASS}
          onConfigChange={(key, value) =>
            onConfigChange(
              audioConfigPatch(key as CanvasAudioSettingKey, value),
            )
          }
        />
      );
    case "text":
      return (
        <CanvasTextSettingsPopover
          config={config}
          count={node.metadata?.textCount || 1}
          placement="topRight"
          buttonClassName={SETTINGS_BUTTON_CLASS}
          onConfigChange={(_, value) =>
            onConfigChange({ reasoningEffort: value })
          }
          onCountChange={(textCount) => onConfigChange({ textCount })}
        />
      );
  }
}

function imageConfigPatch(
  key: keyof AiConfig,
  value: string,
): Partial<CanvasNodeMetadata> {
  return key === "count" ? { count: Number(value) || 1 } : { [key]: value };
}

function GenerationAction({
  isRunning,
  canGenerate,
  onStop,
  onGenerate,
}: {
  isRunning: boolean;
  canGenerate: boolean;
  onStop: () => void;
  onGenerate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="primary"
      className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"
      danger={isRunning}
      disabled={!isRunning && !canGenerate}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={isRunning ? onStop : onGenerate}
    >
      <span className="inline-flex items-center gap-1.5">
        {isRunning ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            <Square className="size-3.5 fill-current" />
            <span>{t("canvas.configNode.stop")}</span>
          </>
        ) : (
          <>
            <Play className="size-4" />
            <span>{t("canvas.configNode.generate")}</span>
          </>
        )}
      </span>
    </Button>
  );
}

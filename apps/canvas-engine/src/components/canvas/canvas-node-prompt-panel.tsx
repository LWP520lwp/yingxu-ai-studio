import { useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { GenerationControl } from "./generation-control";

import { ModelPicker } from "@/components/model-picker";
import {
  defaultConfig,
  resolveModelForCapability,
  useConfigStore,
  useEffectiveConfig,
  type AiConfig,
} from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import {
  CanvasAudioSettingsPopover,
  type CanvasAudioSettingKey,
} from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasVideoSkillSelect } from "./canvas-video-skill-select";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import {
  CanvasNodeType,
  type CanvasGenerationMode,
  type CanvasNodeData,
  type CanvasNodeMetadata,
} from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
  node: CanvasNodeData;
  isRunning: boolean;
  onPromptChange: (nodeId: string, prompt: string) => void;
  onConfigChange: (
    nodeId: string,
    patch: Partial<CanvasNodeData["metadata"]>,
  ) => void;
  onGenerate: (
    nodeId: string,
    mode: CanvasNodeGenerationMode,
    prompt: string,
  ) => void;
  onStop: (nodeId: string) => void;
  mentionReferences?: CanvasResourceReference[];
  nodes: CanvasNodeData[];
  connectedNodes?: CanvasNodeData[];
  onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
  onStartReferenceSelection?: (nodeId: string) => void;
  onImageSettingsOpenChange?: (open: boolean) => void;
  modeOverride?: CanvasNodeGenerationMode;
};

export function CanvasNodePromptPanel({
  node,
  nodes,
  isRunning,
  onPromptChange,
  onConfigChange,
  onGenerate,
  onStop,
  mentionReferences = [],
  connectedNodes = [],
  onDisconnectReference,
  onStartReferenceSelection,
  onImageSettingsOpenChange,
  modeOverride,
}: CanvasNodePromptPanelProps) {
  const { t } = useTranslation();
  const globalConfig = useEffectiveConfig();
  const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const mode = modeOverride ?? defaultMode(node.type);
  const config = buildNodeConfig(globalConfig, node, mode);
  const [prompt, setPrompt] = usePromptDraft(node);
  const [expanded, setExpanded] = useState(false);
  const hasTextContent =
    node.type === CanvasNodeType.Text &&
    Boolean(node.metadata?.content?.trim());
  const hasImageContent =
    node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
  const placeholderMode =
    mode === "image" && hasImageContent
      ? "editImage"
      : mode === "text" && hasTextContent
        ? "editText"
        : mode;
  const frameMode = mode === "video" && config.videoMode === "frames";
  const patchNode = (patch: Partial<CanvasNodeData["metadata"]>) =>
    onConfigChange(node.id, patch);
  const updatePrompt = (value: string) => {
    setPrompt(value);
    if (hasTextContent || hasImageContent)
      patchNode({ composerContent: value });
    else onPromptChange(node.id, value);
  };
  const swapFrames = () =>
    patchNode({ videoFramesReversed: !node.metadata?.videoFramesReversed });
  const submit = () => {
    const value = prompt.trim();
    if (!value || isRunning) return;
    onGenerate(node.id, mode, value);
  };

  return (
    <div
      data-canvas-no-zoom
      className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
      style={{
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {mode === "video" ? (
        <CanvasVideoSkillSelect
          metadata={node.metadata}
          disabled={isRunning}
          onChange={patchNode}
        />
      ) : null}

      <PromptSurface
        nodeId={node.id}
        nodes={nodes}
        connectedNodes={connectedNodes}
        prompt={prompt}
        references={mentionReferences}
        placeholder={t(`canvas.promptPanel.${placeholderMode}`)}
        frameMode={frameMode}
        framesReversed={node.metadata?.videoFramesReversed}
        inputClassName="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
        inputStyle={{ background: "transparent", color: theme.node.text }}
        onPromptChange={updatePrompt}
        onGenerate={submit}
        onDisconnectReference={onDisconnectReference}
        onStartReferenceSelection={onStartReferenceSelection}
        onSwapFrames={swapFrames}
      />

      <PromptActionRow
        config={config}
        mode={mode}
        node={node}
        isRunning={isRunning}
        prompt={prompt}
        theme={theme}
        onOpenEditor={() => setExpanded(true)}
        onPromptSelect={updatePrompt}
        onModelChange={(model) => patchNode({ model })}
        onMissingConfig={() => openConfigDialog(true)}
        onConfigChange={(patch) => patchNode(patch)}
        onImageSettingsOpenChange={onImageSettingsOpenChange}
        onStop={() => onStop(node.id)}
        onGenerate={submit}
      />

      <ExpandedPromptEditor
        open={expanded}
        nodeId={node.id}
        nodes={nodes}
        connectedNodes={connectedNodes}
        prompt={prompt}
        references={mentionReferences}
        placeholder={t(`canvas.promptPanel.${placeholderMode}`)}
        frameMode={frameMode}
        framesReversed={node.metadata?.videoFramesReversed}
        theme={theme}
        onClose={() => setExpanded(false)}
        onPromptChange={updatePrompt}
        onDisconnectReference={onDisconnectReference}
        onStartReferenceSelection={(targetNodeId) => {
          setExpanded(false);
          onStartReferenceSelection?.(targetNodeId);
        }}
        onSwapFrames={swapFrames}
      />
    </div>
  );
}

function usePromptDraft(node: CanvasNodeData) {
  const initialValue =
    node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
  const [prompt, setPrompt] = useState(initialValue);

  useEffect(() => {
    setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    // A generation result can update prompt metadata without changing the draft.
    // Only switching nodes should hydrate this editor from the saved prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  return [prompt, setPrompt] as const;
}

type PromptSurfaceProps = {
  nodeId: string;
  nodes: CanvasNodeData[];
  connectedNodes: CanvasNodeData[];
  prompt: string;
  references: CanvasResourceReference[];
  placeholder: string;
  frameMode: boolean;
  framesReversed?: boolean;
  inputClassName: string;
  inputStyle: React.CSSProperties;
  onPromptChange: (value: string) => void;
  onGenerate?: () => void;
  onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
  onStartReferenceSelection?: (nodeId: string) => void;
  onSwapFrames: () => void;
};

function PromptSurface({
  nodeId,
  nodes,
  connectedNodes,
  prompt,
  references,
  placeholder,
  frameMode,
  framesReversed,
  inputClassName,
  inputStyle,
  onPromptChange,
  onGenerate,
  onDisconnectReference,
  onStartReferenceSelection,
  onSwapFrames,
}: PromptSurfaceProps) {
  return (
    <>
      <CanvasNodeReferenceBar
        nodeId={nodeId}
        nodes={nodes}
        connectedNodes={connectedNodes}
        prompt={prompt}
        onDisconnect={onDisconnectReference}
        onStartSelection={onStartReferenceSelection}
        frameMode={frameMode}
        framesReversed={framesReversed}
        onSwapFrames={onSwapFrames}
      />
      <CanvasPromptChipInput
        value={prompt}
        references={references}
        onChange={onPromptChange}
        onSubmit={onGenerate}
        className={inputClassName}
        style={inputStyle}
        placeholder={placeholder}
      />
    </>
  );
}

type PromptActionRowProps = {
  config: AiConfig;
  mode: CanvasNodeGenerationMode;
  node: CanvasNodeData;
  isRunning: boolean;
  prompt: string;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onOpenEditor: () => void;
  onPromptSelect: (value: string) => void;
  onModelChange: (model: string) => void;
  onMissingConfig: () => void;
  onConfigChange: (patch: Partial<CanvasNodeData["metadata"]>) => void;
  onImageSettingsOpenChange?: (open: boolean) => void;
  onStop: () => void;
  onGenerate: () => void;
};

function PromptActionRow(props: PromptActionRowProps) {
  const { t } = useTranslation();
  const capability = props.mode;

  return (
    <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip title={t("canvas.promptPanel.expandEditor")}>
          <Button
            type="text"
            className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
            style={{ color: props.theme.node.text }}
            icon={<Maximize2 className="size-3.5" />}
            onClick={props.onOpenEditor}
            aria-label={t("canvas.promptPanel.expandEditor")}
          />
        </Tooltip>
        <CanvasPromptLibrary onSelect={props.onPromptSelect} />
        <ModelPicker
          config={props.config}
          value={props.config.model}
          onChange={props.onModelChange}
          capability={capability}
          onMissingConfig={props.onMissingConfig}
          className="max-w-[190px]"
        />
        <GenerationSettings {...props} />
      </div>
      <GenerationButton
        isRunning={props.isRunning}
        hasPrompt={Boolean(props.prompt.trim())}
        onStop={props.onStop}
        onGenerate={props.onGenerate}
      />
    </div>
  );
}

function GenerationSettings(props: PromptActionRowProps) {
  const { config, mode, node, onConfigChange, onMissingConfig } = props;
  switch (mode) {
    case "image":
      return (
        <CanvasImageSettingsPopover
          config={config}
          placement="topLeft"
          buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
          onConfigChange={(key, value) =>
            onConfigChange(
              key === "count"
                ? { count: Number(value) || 1 }
                : { [key]: value },
            )
          }
          onMissingConfig={onMissingConfig}
          onOpenChange={props.onImageSettingsOpenChange}
        />
      );
    case "video":
      return (
        <CanvasVideoSettingsPopover
          config={config}
          buttonClassName="!h-10 !max-w-[220px] !justify-start !rounded-full !px-3"
          onConfigChange={(key, value) =>
            onConfigChange(videoConfigPatch(key, value))
          }
        />
      );
    case "audio":
      return (
        <CanvasAudioSettingsPopover
          config={config}
          buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
          onConfigChange={(key, value) =>
            onConfigChange(audioConfigPatch(key, value))
          }
        />
      );
    case "text":
      return (
        <CanvasTextSettingsPopover
          config={config}
          count={node.metadata?.textCount || 1}
          onConfigChange={(_, value) =>
            onConfigChange({ reasoningEffort: value })
          }
          onCountChange={(textCount) => onConfigChange({ textCount })}
        />
      );
  }
}

function GenerationButton({
  isRunning,
  hasPrompt,
  onStop,
  onGenerate,
}: {
  isRunning: boolean;
  hasPrompt: boolean;
  onStop: () => void;
  onGenerate: () => void;
}) {
  return <GenerationControl running={isRunning} ready={hasPrompt} variant="composer" run={onGenerate} stop={onStop} />;
}

type ExpandedPromptEditorProps = Omit<
  PromptSurfaceProps,
  "inputClassName" | "inputStyle" | "onGenerate"
> & {
  open: boolean;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onClose: () => void;
  onStartReferenceSelection?: (nodeId: string) => void;
};

function ExpandedPromptEditor({
  open,
  theme,
  onClose,
  ...surface
}: ExpandedPromptEditorProps) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("canvas.promptPanel.editorTitle")}
      open={open}
      centered
      width={760}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      <div
        data-canvas-no-zoom
        className="pt-2"
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <PromptSurface
          {...surface}
          inputClassName="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
          inputStyle={{
            background: "transparent",
            borderColor: theme.toolbar.border,
            color: theme.node.text,
          }}
        />
      </div>
    </Modal>
  );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
  if (type === CanvasNodeType.Text) return "text";
  if (type === CanvasNodeType.Video) return "video";
  if (type === CanvasNodeType.Audio) return "audio";
  return "image";
}

export function buildNodeConfig(
  globalConfig: AiConfig,
  node: CanvasNodeData,
  mode: CanvasNodeGenerationMode,
): AiConfig {
  const choose = <Value,>(
    ...candidates: Array<Value | null | undefined>
  ): Value => {
    const selected = candidates.find(
      (candidate) =>
        candidate !== undefined && candidate !== null && candidate !== "",
    );
    return (selected ?? candidates.at(-1)) as Value;
  };

  return {
    ...globalConfig,
    model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
    reasoningEffort: choose(
      node.metadata?.reasoningEffort,
      globalConfig.reasoningEffort,
      defaultConfig.reasoningEffort,
    ),
    quality: choose(
      node.metadata?.quality,
      globalConfig.quality,
      defaultConfig.quality,
    ),
    size: choose(node.metadata?.size, globalConfig.size, defaultConfig.size),
    background: choose(
      node.metadata?.background,
      globalConfig.background,
      defaultConfig.background,
    ),
    videoSeconds: choose(
      node.metadata?.seconds,
      globalConfig.videoSeconds,
      defaultConfig.videoSeconds,
    ),
    vquality: choose(
      node.metadata?.vquality,
      globalConfig.vquality,
      defaultConfig.vquality,
    ),
    videoGenerateAudio: choose(
      node.metadata?.generateAudio,
      globalConfig.videoGenerateAudio,
      defaultConfig.videoGenerateAudio,
    ),
    videoWatermark: choose(
      node.metadata?.watermark,
      globalConfig.videoWatermark,
      defaultConfig.videoWatermark,
    ),
    videoMode: choose(
      node.metadata?.videoMode,
      globalConfig.videoMode,
      defaultConfig.videoMode,
    ),
    audioVoice: choose(
      node.metadata?.audioVoice,
      globalConfig.audioVoice,
      defaultConfig.audioVoice,
    ),
    audioFormat: choose(
      node.metadata?.audioFormat,
      globalConfig.audioFormat,
      defaultConfig.audioFormat,
    ),
    audioSpeed: choose(
      node.metadata?.audioSpeed,
      globalConfig.audioSpeed,
      defaultConfig.audioSpeed,
    ),
    audioInstructions: choose(
      node.metadata?.audioInstructions,
      globalConfig.audioInstructions,
      defaultConfig.audioInstructions,
    ),
    count: String(
      node.metadata?.count != null && node.metadata.count > 0
        ? node.metadata.count
        : choose(
            mode === "image" ? globalConfig.canvasImageCount : undefined,
            globalConfig.count,
            defaultConfig.count,
          ),
    ),
  };
}

export function videoConfigPatch(key: keyof AiConfig, value: string) {
  const fields: Partial<Record<keyof AiConfig, keyof CanvasNodeMetadata>> = {
    videoSeconds: "seconds",
    videoGenerateAudio: "generateAudio",
    videoWatermark: "watermark",
    videoMode: "videoMode",
  };
  return { [fields[key] ?? key]: value };
}

export function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
  if (key === "audioVoice") return { audioVoice: value };
  if (key === "audioFormat") return { audioFormat: value };
  if (key === "audioSpeed") return { audioSpeed: value };
  return { audioInstructions: value };
}

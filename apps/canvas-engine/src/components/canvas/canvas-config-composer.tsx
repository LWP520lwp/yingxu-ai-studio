import { useMemo } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { Button } from "antd";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { CONFIG_REFERENCE_PATTERN } from "@/atlas-engine/agent/config-composer";
import { useThemeStore } from "@/stores/use-theme-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import type { NodeGenerationInput } from "./canvas-node-generation";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/atlas-engine/model/resource-references";

type CanvasConfigComposerProps = {
  nodeId: string;
  nodes: CanvasNodeData[];
  value: string;
  inputs: NodeGenerationInput[];
  connectedNodes?: CanvasNodeData[];
  onChange: (value: string) => void;
  onClose: () => void;
  onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
  onStartReferenceSelection?: (nodeId: string) => void;
  onSwapVideoFrames?: () => void;
};

export { CONFIG_REFERENCE_PATTERN };

export function CanvasConfigComposer({
  nodeId,
  nodes,
  value,
  inputs,
  connectedNodes = [],
  onChange,
  onClose,
  onDisconnectReference,
  onStartReferenceSelection,
  onSwapVideoFrames,
}: CanvasConfigComposerProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const defaults = useEffectiveConfig();
  const currentNode = nodes.find((candidate) => candidate.id === nodeId);
  const isVideo = currentNode?.metadata?.generationMode === "video";
  const frameMode = isVideo && (currentNode.metadata?.videoMode || defaults.videoMode) === "frames";
  const references = useMemo(() => inputs.map((input) => asReference(input, inputs)), [inputs, i18n.language]);

  const stopCanvas = (event: MouseEvent | PointerEvent) => event.stopPropagation();

  return (
    <section
      data-canvas-no-zoom
      aria-label={t("canvas.composer.title")}
      className="w-[min(36rem,calc(100vw-2rem))] rounded-lg border p-3 shadow-xl"
      style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
      onMouseDown={stopCanvas}
      onPointerDown={stopCanvas}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="mb-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold">{t("canvas.composer.title")}</h2>
          <p className="truncate text-[11px] opacity-60">{t("canvas.composer.description")}</p>
        </div>
        <Button
          size="small"
          type="text"
          className="!h-7 !w-7 !min-w-7 !p-0"
          icon={<X className="size-3.5" />}
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        />
      </header>

      <CanvasNodeReferenceBar
        nodeId={nodeId}
        nodes={nodes}
        connectedNodes={connectedNodes}
        prompt={value}
        onDisconnect={onDisconnectReference}
        onStartSelection={onStartReferenceSelection}
        frameMode={frameMode}
        framesReversed={currentNode?.metadata?.videoFramesReversed}
        onSwapFrames={onSwapVideoFrames}
      />

      <div className="mt-2 rounded-md border px-3 py-2" style={{ borderColor: theme.toolbar.border }}>
        <CanvasPromptChipInput
          value={value}
          references={references}
          onChange={onChange}
          className="thin-scrollbar min-h-28 max-h-72 w-full overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm leading-7 outline-none"
          style={{ color: theme.node.text, cursor: "text" }}
          placeholder={t("canvas.composer.placeholder")}
        />
      </div>
    </section>
  );
}

function asReference(
  input: NodeGenerationInput,
  inputs: NodeGenerationInput[],
): CanvasResourceReference {
  const peerIndex = inputs.filter((candidate) => candidate.type === input.type).findIndex((candidate) => candidate.nodeId === input.nodeId);
  const kind = input.type === "group" ? "text" : input.type;
  const previewUrl = input.type === "image" ? input.image?.dataUrl : input.type === "video" ? input.video?.url : input.type === "audio" ? input.audio?.url : undefined;
  const text = input.type === "group"
    ? i18n.t("canvas.node.nodeCount", { count: input.children.length })
    : input.text;
  return {
    id: input.nodeId,
    nodeId: input.nodeId,
    kind,
    label: i18n.t(`canvas.composer.resources.${input.type}`, { index: Math.max(0, peerIndex) + 1 }),
    valueToken: `@[node:${input.nodeId}]`,
    title: input.title,
    previewUrl,
    text,
    active: true,
  };
}

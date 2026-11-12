import i18n from "@/i18n";
import { getNodeSpec as getRegistryNodeSpec } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";

export type CanvasNodeSpec = {
  width: number;
  height: number;
  title: string;
  metadata?: CanvasNodeMetadata;
};

type BuiltinNodeSeed = {
  width: number;
  height: number;
  titleKey: string;
  metadata?: CanvasNodeMetadata;
};

const builtinNodes = {
  [CanvasNodeType.Image]: {
    width: 340,
    height: 240,
    titleKey: "canvas.nodeTypes.image",
    metadata: { content: "", status: "idle" },
  },
  [CanvasNodeType.Text]: {
    width: 340,
    height: 240,
    titleKey: "canvas.nodeTypes.text",
    metadata: { content: "", status: "idle", fontSize: 14 },
  },
  [CanvasNodeType.Config]: {
    width: 340,
    height: 240,
    titleKey: "canvas.nodeTypes.config",
    metadata: { content: "", status: "idle", generationMode: "image" },
  },
  [CanvasNodeType.Video]: {
    width: 420,
    height: 236,
    titleKey: "canvas.nodeTypes.video",
    metadata: { content: "", status: "idle" },
  },
  [CanvasNodeType.Audio]: {
    width: 340,
    height: 120,
    titleKey: "canvas.nodeTypes.audio",
    metadata: { content: "", status: "idle" },
  },
  [CanvasNodeType.Group]: {
    width: 760,
    height: 480,
    titleKey: "canvas.nodeTypes.group",
    metadata: { status: "idle" },
  },
} satisfies Record<CanvasNodeType, BuiltinNodeSeed>;

function localizedTitle(seed: BuiltinNodeSeed) {
  return i18n.t(seed.titleKey);
}

export const NODE_DEFAULT_SIZE = Object.fromEntries(
  Object.entries(builtinNodes).map(([type, seed]) => [
    type,
    {
      width: seed.width,
      height: seed.height,
      get title() {
        return localizedTitle(seed);
      },
    },
  ]),
) as Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = Object.fromEntries(
  Object.entries(builtinNodes).map(([type, seed]) => [
    type,
    {
      width: seed.width,
      height: seed.height,
      get title() {
        return localizedTitle(seed);
      },
      metadata: seed.metadata,
    },
  ]),
) as Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: string): CanvasNodeSpec {
  const spec = isBuiltinNodeType(type)
    ? NODE_SPECS[type]
    : getRegistryNodeSpec(type);
  return {
    width: spec.width,
    height: spec.height,
    title: spec.title,
    metadata: cloneMetadata(spec.metadata),
  };
}

function isBuiltinNodeType(type: string): type is CanvasNodeType {
  return Object.hasOwn(builtinNodes, type);
}

function cloneMetadata(metadata?: CanvasNodeMetadata) {
  if (!metadata) return {};
  if (typeof structuredClone === "function") return structuredClone(metadata);
  return { ...metadata };
}

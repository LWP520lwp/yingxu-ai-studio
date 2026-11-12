import i18n from "@/i18n";
import { getNodeSpec as getRegisteredNodeSpec } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";

export type CanvasNodeSpec = {
  width: number;
  height: number;
  title: string;
  metadata?: CanvasNodeMetadata;
};

type NodeSeed = Readonly<{
  size: readonly [width: number, height: number];
  titleKey: string;
  metadata?: CanvasNodeMetadata;
}>;

const BUILT_IN_NODES: Record<CanvasNodeType, NodeSeed> = {
  [CanvasNodeType.Image]: {
    size: [340, 240],
    titleKey: "canvas.nodeTypes.image",
    metadata: { content: "", status: "idle" },
  },
  [CanvasNodeType.Text]: {
    size: [340, 240],
    titleKey: "canvas.nodeTypes.text",
    metadata: { content: "", status: "idle", fontSize: 14 },
  },
  [CanvasNodeType.Config]: {
    size: [340, 240],
    titleKey: "canvas.nodeTypes.config",
    metadata: { content: "", status: "idle", generationMode: "image" },
  },
  [CanvasNodeType.Video]: {
    size: [420, 236],
    titleKey: "canvas.nodeTypes.video",
    metadata: { content: "", status: "idle" },
  },
  [CanvasNodeType.Audio]: {
    size: [340, 120],
    titleKey: "canvas.nodeTypes.audio",
    metadata: { content: "", status: "idle" },
  },
  [CanvasNodeType.Group]: {
    size: [760, 480],
    titleKey: "canvas.nodeTypes.group",
    metadata: { status: "idle" },
  },
};

function copyMetadata(
  value: CanvasNodeMetadata | undefined,
): CanvasNodeMetadata {
  if (!value) return {};
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : { ...value };
}

function getBuiltInSpec(type: CanvasNodeType): CanvasNodeSpec {
  const seed = BUILT_IN_NODES[type];
  return {
    width: seed.size[0],
    height: seed.size[1],
    title: i18n.t(seed.titleKey),
    metadata: copyMetadata(seed.metadata),
  };
}

export const NODE_DEFAULT_SIZE = Object.fromEntries(
  Object.values(CanvasNodeType).map((type) => {
    const seed = BUILT_IN_NODES[type];
    return [
      type,
      {
        width: seed.size[0],
        height: seed.size[1],
        get title() {
          return i18n.t(seed.titleKey);
        },
      },
    ];
  }),
) as Record<CanvasNodeType, Pick<CanvasNodeSpec, "width" | "height" | "title">>;

export const NODE_SPECS = Object.fromEntries(
  Object.values(CanvasNodeType).map((type) => {
    const seed = BUILT_IN_NODES[type];
    return [
      type,
      {
        width: seed.size[0],
        height: seed.size[1],
        get title() {
          return i18n.t(seed.titleKey);
        },
        metadata: seed.metadata,
      },
    ];
  }),
) as Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: string): CanvasNodeSpec {
  if (Object.hasOwn(BUILT_IN_NODES, type)) {
    return getBuiltInSpec(type as CanvasNodeType);
  }

  const registered = getRegisteredNodeSpec(type);
  return {
    width: registered.width,
    height: registered.height,
    title: registered.title,
    metadata: copyMetadata(registered.metadata),
  };
}

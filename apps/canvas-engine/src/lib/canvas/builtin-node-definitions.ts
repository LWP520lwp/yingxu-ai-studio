import { NODE_SPECS } from "@/constant/canvas";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type {
  CanvasNodeDefinition,
  CanvasNodeResource,
} from "@/types/canvas-plugin";

type BuiltinIconMap = Record<CanvasNodeType, CanvasNodeDefinition["icon"]>;

type BuiltinNodePolicy = {
  type: CanvasNodeType;
  minimapColor?: string;
  resourceKind?: CanvasNodeResource["kind"];
  aspectRatio?: "resizable-image" | "fixed";
  hasSourceHandle?: boolean;
};

const BUILTIN_NODE_POLICIES: readonly BuiltinNodePolicy[] = [
  { type: CanvasNodeType.Text, resourceKind: "text" },
  {
    type: CanvasNodeType.Image,
    minimapColor: "#10b981",
    resourceKind: "image",
    aspectRatio: "resizable-image",
  },
  {
    type: CanvasNodeType.Video,
    minimapColor: "#f97316",
    resourceKind: "video",
    aspectRatio: "fixed",
  },
  {
    type: CanvasNodeType.Audio,
    minimapColor: "#a855f7",
    resourceKind: "audio",
  },
  {
    type: CanvasNodeType.Config,
    minimapColor: "#60a5fa",
    hasSourceHandle: false,
  },
  { type: CanvasNodeType.Group, minimapColor: "#94a3b8" },
];

export function buildBuiltinNodeDefinitions(
  icons: BuiltinIconMap,
): CanvasNodeDefinition[] {
  return BUILTIN_NODE_POLICIES.map((policy) => {
    const spec = NODE_SPECS[policy.type];
    const definition: CanvasNodeDefinition = {
      type: policy.type,
      title: spec.title,
      icon: icons[policy.type],
      defaultSize: { width: spec.width, height: spec.height },
      defaultMetadata: { ...spec.metadata },
    };

    if (policy.minimapColor) definition.minimapColor = policy.minimapColor;
    if (policy.hasSourceHandle !== undefined)
      definition.hasSourceHandle = policy.hasSourceHandle;
    if (policy.aspectRatio === "resizable-image")
      definition.keepAspectRatio = (node) => !node.metadata?.freeResize;
    if (policy.aspectRatio === "fixed") definition.keepAspectRatio = () => true;
    if (policy.resourceKind)
      definition.resource = (node) =>
        resourceForNode(policy.resourceKind!, node);

    return definition;
  });
}

export function resourceForNode(
  kind: CanvasNodeResource["kind"],
  node: CanvasNodeData,
): CanvasNodeResource | null {
  if (node.type === CanvasNodeType.Text && kind === "text") {
    const text = node.metadata?.content || node.metadata?.prompt;
    return text ? { kind, text } : null;
  }

  if (
    (node.type === CanvasNodeType.Image && kind === "image") ||
    (node.type === CanvasNodeType.Video && kind === "video") ||
    (node.type === CanvasNodeType.Audio && kind === "audio")
  ) {
    const url = node.metadata?.content;
    return url ? { kind, url } : null;
  }

  return null;
}

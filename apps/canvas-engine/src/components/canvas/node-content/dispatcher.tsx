import { CanvasNodeType } from "@/types/canvas";
import { getNodeDefinition } from "@/lib/canvas/node-registry";

import type {
  BuiltinNodeRendererMap,
  NodeContentRendererProps,
} from "./contracts";
import { resolveNodeContentRoute } from "./content-route";
import { ImageNodeContent, EmptyImageContent } from "./image-renderer";
import {
  AudioNodeContent,
  GroupNodeContent,
  VideoNodeContent,
} from "./media-renderers";
import {
  ErrorNodeContent,
  LoadingNodeContent,
  MissingPluginNodeContent,
} from "./status-renderers";
import { TextNodeContent } from "./text-renderer";

const builtinRenderers = {
  [CanvasNodeType.Text]: TextNodeContent,
  [CanvasNodeType.Image]: ImageNodeContent,
  [CanvasNodeType.Config]: EmptyImageContent,
  [CanvasNodeType.Video]: VideoNodeContent,
  [CanvasNodeType.Audio]: AudioNodeContent,
  [CanvasNodeType.Group]: GroupNodeContent,
} satisfies BuiltinNodeRendererMap;

export function NodeContent(props: NodeContentRendererProps) {
  const definition = getNodeDefinition(props.node.type);
  const route = resolveNodeContentRoute({
    node: props.node,
    isBatchRoot: props.isBatchRoot,
    hasCustomConfigContent: Boolean(props.renderNodeContent),
    hasPluginRenderer: Boolean(definition?.Content && props.pluginContext),
  });

  switch (route.kind) {
    case "custom-config":
      return props.renderNodeContent?.(props.node) ?? null;
    case "batch":
      return route.nodeType === CanvasNodeType.Image ? (
        <ImageNodeContent {...props} />
      ) : (
        <TextNodeContent {...props} />
      );
    case "status":
      return route.status === "loading" ? (
        <LoadingNodeContent theme={props.theme} />
      ) : (
        <ErrorNodeContent
          node={props.node}
          theme={props.theme}
          onRetry={props.onRetry}
        />
      );
    case "builtin": {
      const Renderer = builtinRenderers[route.nodeType];
      return <Renderer {...props} />;
    }
    case "plugin": {
      const PluginContent = definition?.Content;
      return PluginContent && props.pluginContext ? (
        <PluginContent ctx={props.pluginContext} />
      ) : (
        <MissingPluginNodeContent theme={props.theme} type={props.node.type} />
      );
    }
    case "missing-plugin":
      return (
        <MissingPluginNodeContent theme={props.theme} type={props.node.type} />
      );
  }
}

import type { ComponentType, ReactNode } from "react";

import type { CanvasAgentOp } from "@/atlas-engine/agent/canvas-operations";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasResourceKind } from "@/atlas-engine/model/resource-references";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

export interface CanvasNodeResource {
  kind: CanvasResourceKind;
  text?: string;
  url?: string;
}

export type PluginModelCapability = "image" | "video" | "text" | "audio";

export interface ModelOption {
  value: string;
  label: string;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  references?: string[];
  model?: string;
}

export interface GenerateImageOptions extends GenerateOptions {
  count?: number;
  size?: string;
}

export interface GenerateVideoOptions extends GenerateOptions {
  size?: string;
  seconds?: string;
}

export interface GenerateTextOptions {
  signal?: AbortSignal;
  model?: string;
  system?: string;
  onDelta?: (text: string) => void;
}

export interface GenerateImageResult {
  images: string[];
}

export interface GenerateVideoResult {
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface GenerateTextResult {
  text: string;
}

export interface CanvasPluginAi {
  generateImage(prompt: string, options?: GenerateImageOptions): Promise<GenerateImageResult>;
  generateVideo(prompt: string, options?: GenerateVideoOptions): Promise<GenerateVideoResult>;
  generateText(prompt: string, options?: GenerateTextOptions): Promise<GenerateTextResult>;
  listModels(capability?: PluginModelCapability): ModelOption[];
  defaultModel(capability: PluginModelCapability): string;
}

export interface CanvasNodeToolbarItem {
  id: string;
  title: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}

export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface CanvasNodeContext {
  node: CanvasNodeData;
  theme: CanvasTheme;
  scale: number;
  isSelected: boolean;
  updateMetadata(patch: CanvasNodeMetadata): void;
  updateNode(patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>): void;
  getNode(id: string): CanvasNodeData | null;
  getNodes(): CanvasNodeData[];
  getConnections(): CanvasConnection[];
  getUpstream(): CanvasNodeData[];
  getDownstream(): CanvasNodeData[];
  applyOps(ops: CanvasAgentOp[]): void;
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: unknown) => void): () => void;
  ai: CanvasPluginAi;
  openPanel(): void;
  closePanel(): void;
  storage: PluginStorage;
}

export interface CanvasPluginHost {
  getNode(id: string): CanvasNodeData | null;
  getNodes(): CanvasNodeData[];
  getConnections(): CanvasConnection[];
  getUpstream(nodeId: string): CanvasNodeData[];
  getDownstream(nodeId: string): CanvasNodeData[];
  updateNode(nodeId: string, patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>): void;
  updateMetadata(nodeId: string, patch: CanvasNodeMetadata): void;
  applyOps(ops: CanvasAgentOp[]): void;
  ai: CanvasPluginAi;
  openPanel(nodeId: string): void;
  closePanel(nodeId?: string): void;
}

export interface CanvasBuiltinPanelConfig {
  mode: "image" | "video" | "text" | "audio";
  promptPrefix?: string;
  writeBackToSelf?: boolean;
}

export interface CanvasNodeDefinition {
  type: string;
  title: string;
  icon: ReactNode;
  description?: string;
  defaultSize: { width: number; height: number };
  defaultMetadata?: CanvasNodeMetadata;
  minimapColor?: string;
  showInCreateMenu?: boolean;
  hasSourceHandle?: boolean;
  hidePanel?: boolean;
  transparentBackground?: boolean;
  autoOpenPanel?: boolean;
  useBuiltinPanel?: CanvasBuiltinPanelConfig;
  interactionToggle?: boolean;
  forceInteractive?: (node: CanvasNodeData) => boolean;
  keepAspectRatio?: (node: CanvasNodeData) => boolean;
  resource?: (node: CanvasNodeData) => CanvasNodeResource | null;
  Content?: ComponentType<{ ctx: CanvasNodeContext }>;
  Panel?: ComponentType<{ ctx: CanvasNodeContext; onClose: () => void }>;
  toolbar?: (ctx: CanvasNodeContext) => CanvasNodeToolbarItem[];
  onDoubleClick?: (ctx: CanvasNodeContext) => boolean;
}

export interface CanvasPluginApp {
  version: string;
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: unknown) => void): () => void;
  injectCSS(css: string, key?: string): () => void;
}

export interface CanvasPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  minAppVersion?: string;
  css?: string;
  nodes: CanvasNodeDefinition[];
  setup?: (app: CanvasPluginApp) => void | (() => void);
}

import type { CanvasComposition } from "@/lib/canvas/canvas-composition";

import type { Position } from "./geometry";

export enum CanvasNodeType {
  Image = "image",
  Text = "text",
  Config = "config",
  Video = "video",
  Audio = "audio",
  Group = "group",
}

export type CanvasNodeTypeId = CanvasNodeType | (string & {});
export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeImage = {
  id: string;
  status: CanvasNodeStatus;
  errorDetails?: string;
  content: string;
  storageKey?: string;
  naturalWidth: number;
  naturalHeight: number;
  bytes: number;
  mimeType: string;
};

export type CanvasNodeText = {
  id: string;
  status: CanvasNodeStatus;
  errorDetails?: string;
  content: string;
};

export type CanvasNodeMetadata = {
  content?: string;
  composerContent?: string;
  prompt?: string;
  status?: CanvasNodeStatus;
  errorDetails?: string;
  fontSize?: number;
  generationMode?: CanvasGenerationMode;
  skillId?: string;
  skillVersion?: string;
  videoSkillId?: string;
  videoSkillVersion?: string;
  videoSkillInputMode?: "instruction";
  generationType?: CanvasImageGenerationType;
  model?: string;
  reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
  size?: string;
  quality?: string;
  background?: string;
  count?: number;
  textCount?: number;
  texts?: CanvasNodeText[];
  primaryTextId?: string;
  seconds?: string;
  vquality?: string;
  generateAudio?: string;
  watermark?: string;
  videoMode?: string;
  videoFramesReversed?: boolean;
  storyWorkflow?: {
    schemaVersion: 1;
    segmentId: string;
    role:
      | "script"
      | "storyboard"
      | "character"
      | "scene"
      | "prop"
      | "image-config"
      | "video-config";
    sourceId?: string;
    sourceProfileJson?: string;
    shotsJson?: string;
    targetDuration?: 15;
    pendingVideo?: boolean;
  };
  audioVoice?: string;
  audioFormat?: string;
  audioSpeed?: string;
  audioInstructions?: string;
  references?: string[];
  naturalWidth?: number;
  naturalHeight?: number;
  freeResize?: boolean;
  images?: CanvasNodeImage[];
  primaryImageId?: string;
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
  durationMs?: number;
  videoTaskId?: string;
  videoTaskProvider?: "openai" | "gemini" | "platform";
  videoTaskProjectId?: string;
  groupId?: string;
  interactive?: boolean;
  composition?: CanvasComposition;
};

export type CanvasNodeData = {
  id: string;
  type: CanvasNodeTypeId;
  title: string;
  position: Position;
  width: number;
  height: number;
  metadata?: CanvasNodeMetadata;
};

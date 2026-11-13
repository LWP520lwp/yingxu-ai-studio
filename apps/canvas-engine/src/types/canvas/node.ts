import type { AtlasComposition } from "@/atlas-engine/workflows/video-composition";

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

export type CanvasNodeText = {
  id: string;
  content: string;
  status: CanvasNodeStatus;
  errorDetails?: string;
};

/** Image and text batches share the same result lifecycle. */
export type CanvasNodeImage = CanvasNodeText & {
  storageKey?: string;
  naturalWidth: number;
  naturalHeight: number;
  bytes: number;
  mimeType: string;
};

export type CanvasNodeContentMetadata = {
  content?: string;
  composerContent?: string;
  prompt?: string;
  status?: CanvasNodeStatus;
  errorDetails?: string;
  fontSize?: number;
};

export type CanvasNodeGenerationMetadata = {
  generationMode?: CanvasGenerationMode;
  skillId?: string;
  skillVersion?: string;
  videoSkillId?: string;
  videoSkillVersion?: string;
  videoSkillInputMode?: "instruction";
  model?: string;
  reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
  count?: number;
  textCount?: number;
};

export type CanvasImageSettingsMetadata = {
  generationType?: CanvasImageGenerationType;
  size?: string;
  quality?: string;
  background?: string;
  freeResize?: boolean;
};

export type CanvasNodeTextCollectionMetadata = {
  texts?: CanvasNodeText[];
  primaryTextId?: string;
};

export type CanvasVideoSettingsMetadata = {
  seconds?: string;
  vquality?: string;
  generateAudio?: string;
  watermark?: string;
  videoMode?: string;
  videoFramesReversed?: boolean;
  videoTaskId?: string;
  videoTaskProvider?: "openai" | "gemini" | "platform";
  videoTaskProjectId?: string;
};

export type CanvasStoryWorkflowMetadata = {
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
};

export type CanvasAudioSettingsMetadata = {
  audioVoice?: string;
  audioFormat?: string;
  audioSpeed?: string;
  audioInstructions?: string;
};

export type CanvasNodeMediaMetadata = {
  references?: string[];
  naturalWidth?: number;
  naturalHeight?: number;
  images?: CanvasNodeImage[];
  primaryImageId?: string;
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
  durationMs?: number;
};

export type CanvasNodeGroupingMetadata = {
  groupId?: string;
  interactive?: boolean;
  composition?: AtlasComposition;
};

export type CanvasNodeMetadata =
  & CanvasNodeContentMetadata
  & CanvasNodeGenerationMetadata
  & CanvasImageSettingsMetadata
  & CanvasNodeTextCollectionMetadata
  & CanvasVideoSettingsMetadata
  & CanvasStoryWorkflowMetadata
  & CanvasAudioSettingsMetadata
  & CanvasNodeMediaMetadata
  & CanvasNodeGroupingMetadata;

export type CanvasNodeData = {
  id: string;
  type: CanvasNodeTypeId;
  title: string;
  position: Position;
  width: number;
  height: number;
  metadata?: CanvasNodeMetadata;
};

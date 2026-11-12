export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
  name: string;
  capability: ModelCapability;
  script?: string;
};

export type ModelChannel = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  models: ChannelModel[];
};

export type AiConfig = {
  channelMode: "remote" | "local";
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  channels: ModelChannel[];
  model: string;
  imageModel: string;
  videoModel: string;
  textModel: string;
  audioModel: string;
  audioVoice: string;
  audioFormat: string;
  audioSpeed: string;
  audioInstructions: string;
  videoSeconds: string;
  vquality: string;
  videoGenerateAudio: string;
  videoWatermark: string;
  videoMode: string;
  videoFramesReversed?: boolean;
  videoSkillId?: string;
  videoSkillVersion?: string;
  appliedSkillId?: string;
  appliedSkillVersion?: string;
  videoSkillReviewRequired?: boolean;
  systemPrompt: string;
  reasoningEffort: ReasoningEffort;
  models: string[];
  quality: string;
  size: string;
  background: string;
  count: string;
  canvasImageCount: string;
  proxyEnabled: boolean;
  proxyUrl: string;
  nodeRegenerateBehavior: "new-node" | "overwrite";
  autoFocusOnSelect: boolean;
};

export type WebdavSyncConfig = {
  url: string;
  username: string;
  password: string;
  directory: string;
  lastSyncedAt: string;
};
export type ConfigTabKey =
  | "channels"
  | "local-proxy"
  | "preferences"
  | "prompt-sources"
  | "webdav"
  | "local-storage";

export type ChannelCredentialsImportResult = {
  status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
  channelName?: string;
};

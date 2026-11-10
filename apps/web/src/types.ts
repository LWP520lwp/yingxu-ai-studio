export type CreativeKind = "note" | "image" | "video";
export type CanvasPoint = { x: number; y: number };
export type CanvasViewport = { x: number; y: number; zoom: number };
export type CreativeData = Record<string, unknown> & {
  kind: CreativeKind;
  title: string;
  prompt: string;
  assetId?: string;
  url?: string;
  model?: string;
  width?: number;
  height?: number;
  duration?: number;
  appliedJobId?: string;
  skillId?: string;
  skillVersion?: string;
  /** Display geometry is independent from the generated media resolution. */
  displayWidth?: number;
  displayHeight?: number;
  referenceAssetIds?: string[];
  sourceNodeIds?: string[];
};
/** Schema 1 is retained for saved projects, independently from any canvas renderer. */
export type CreativeNode = {
  id: string;
  type: "creative";
  position: CanvasPoint;
  data: CreativeData;
  selected?: boolean;
  dragging?: boolean;
  resizing?: boolean;
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
  [field: string]: unknown;
};
export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  selected?: boolean;
  type?: string;
  [field: string]: unknown;
};
export type CanvasConnection = Pick<CanvasEdge, "source" | "target" | "sourceHandle" | "targetHandle">;
export type CanvasDocument = {
  schemaVersion: 1;
  nodes: CreativeNode[];
  edges: CanvasEdge[];
  viewport?: CanvasViewport;
};
export type User = {
  id: string;
  name: string;
  avatarUrl?: string;
  provider?: string;
};
export type Project = {
  id: string;
  title: string;
  revision: number;
  document?: CanvasDocument;
  createdAt: string;
  updatedAt: string;
};
export type Asset = {
  id: string;
  name: string;
  projectId?: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
};
export type Job = {
  id: string;
  status: string;
  kind: "image" | "video";
  prompt: string;
  model?: string;
  projectId: string;
  nodeId: string;
  inputRevision: number;
  resultAssetId?: string;
  resultUrl?: string;
  error?: string;
  canRecover?: boolean;
  recoveryStatus?: string;
  recoveryMessage?: string;
  createdAt: string;
  updatedAt: string;
};
export type Model = {
  id: string;
  name?: string;
  label?: string;
  provider?: "muse" | "doubao";
  available?: boolean;
  caps?: {
    supportsReferenceImages?: boolean;
    maxReferenceImages?: number;
    supportedVideoModes?: string[];
    fixedDuration?: number | null;
    durations?: number[];
    resolutions?: string[];
    fixedWidth?: number | null;
    fixedHeight?: number | null;
    supportsSizeControl?: boolean;
    watermark?: boolean;
  };
};
export type Bootstrap = {
  user: User | null;
  auth: {
    githubEnabled: boolean;
    localEnabled: boolean;
    githubLoginUrl?: string;
  };
  models: { image: (Model | string)[]; video: (Model | string)[] };
  skills: unknown[];
  integration: { name?: string; status: string; message?: string };
};

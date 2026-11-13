import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedFile } from "@/services/file-storage";
import type {
  VideoGenerationResult,
  VideoGenerationTask,
} from "@/services/api/video";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function planAtlasVideoResume(
  node: CanvasNodeData | undefined,
  model: string,
  configured: boolean,
  busy: boolean,
): { kind: "skip" } | { kind: "configure" } | { kind: "resume"; node: CanvasNodeData; task: VideoGenerationTask } {
  if (!node || node.type !== CanvasNodeType.Video || !node.metadata?.videoTaskId || node.metadata.content || busy) return { kind: "skip" };
  if (node.metadata.videoTaskProvider !== "platform" && !configured) return { kind: "configure" };
  return {
    kind: "resume",
    node,
    task: { id: node.metadata.videoTaskId, provider: node.metadata.videoTaskProvider || "platform", projectId: node.metadata.videoTaskProjectId, model },
  };
}

export function applyAtlasVideoResumeFailure(
  nodes: readonly CanvasNodeData[],
  nodeId: string,
  taskId: string,
  details: string,
  remoteTaskFailed: boolean,
): CanvasNodeData[] {
  return nodes.map((node) => node.id === nodeId && node.metadata?.videoTaskId === taskId
    ? { ...node, metadata: atlasVideoTaskFailureMetadata(node.metadata, details, remoteTaskFailed) }
    : node);
}

type AtlasNodeUpdater = (nodes: CanvasNodeData[]) => CanvasNodeData[];

export type AtlasVideoTaskPorts = Readonly<{
  waitForTask: (
    config: AiConfig,
    task: VideoGenerationTask,
    options: { signal: AbortSignal },
  ) => Promise<VideoGenerationResult>;
  storeVideo: (result: VideoGenerationResult) => Promise<UploadedFile>;
  ownsNode: (nodeId: string, controller: AbortController) => boolean;
  updateNode: (
    nodeId: string,
    controller: AbortController,
    update: AtlasNodeUpdater,
  ) => void;
  createCompletedNode: (
    node: CanvasNodeData,
    video: UploadedFile,
    metadata: CanvasNodeMetadata,
  ) => CanvasNodeData;
}>;

export type ResumeAtlasVideoTaskInput = Readonly<{
  node: CanvasNodeData;
  task: VideoGenerationTask;
  config: AiConfig;
  controller: AbortController;
  ports: AtlasVideoTaskPorts;
}>;

export async function resumeAtlasVideoTask({
  node,
  task,
  config,
  controller,
  ports,
}: ResumeAtlasVideoTaskInput): Promise<boolean> {
  assertActive(controller.signal);

  const result = await ports.waitForTask(config, task, {
    signal: controller.signal,
  });
  if (!ports.ownsNode(node.id, controller)) return false;
  assertActive(controller.signal);

  const video = await ports.storeVideo(result);
  if (!ports.ownsNode(node.id, controller)) return false;
  assertActive(controller.signal);

  ports.updateNode(node.id, controller, (nodes) =>
    nodes.map((current) =>
      current.id === node.id
        ? ports.createCompletedNode(current, video, {
            prompt: current.metadata?.prompt,
            model: config.model,
            size: config.size,
            seconds: config.videoSeconds,
            vquality: config.vquality,
            generateAudio: config.videoGenerateAudio,
            watermark: config.videoWatermark,
            videoMode: config.videoMode,
          })
        : current,
    ),
  );
  return true;
}

export function atlasVideoTaskFailureMetadata(
  metadata: CanvasNodeMetadata | undefined,
  details: string,
  remoteTaskFailed: boolean,
): CanvasNodeMetadata {
  const hasPreviousVideo = Boolean(metadata?.content);
  return {
    ...metadata,
    status: hasPreviousVideo ? "success" : "error",
    errorDetails: hasPreviousVideo ? undefined : details,
    ...(remoteTaskFailed ? { videoTaskId: undefined } : {}),
  };
}

function assertActive(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException("The video task was cancelled", "AbortError");
}

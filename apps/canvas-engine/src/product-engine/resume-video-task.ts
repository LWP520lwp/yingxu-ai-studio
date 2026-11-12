import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedFile } from "@/services/file-storage";
import type {
  VideoGenerationResult,
  VideoGenerationTask,
} from "@/services/api/video";
import { throwIfAborted } from "@/services/media-storage-runtime";
import type { CanvasNodeData } from "@/types/canvas";

type NodeUpdate = (nodes: CanvasNodeData[]) => CanvasNodeData[];

export type ResumeVideoTaskPorts = {
  waitForTask: (
    config: AiConfig,
    task: VideoGenerationTask,
    options: { signal: AbortSignal },
  ) => Promise<VideoGenerationResult>;
  storeVideo: (result: VideoGenerationResult) => Promise<UploadedFile>;
  canWrite: (nodeId: string, controller: AbortController) => boolean;
  writeNode: (nodeId: string, controller: AbortController, update: NodeUpdate) => void;
  applyVideo: (
    node: CanvasNodeData,
    video: UploadedFile,
    metadata: CanvasNodeData["metadata"],
  ) => CanvasNodeData;
};

export type ResumeVideoTaskArgs = {
  node: CanvasNodeData;
  task: VideoGenerationTask;
  config: AiConfig;
  controller: AbortController;
  ports: ResumeVideoTaskPorts;
};

export async function resumeCanvasVideoTask({
  node,
  task,
  config,
  controller,
  ports,
}: ResumeVideoTaskArgs): Promise<boolean> {
  const { signal } = controller;
  throwIfAborted(signal);
  const result = await ports.waitForTask(config, task, { signal });
  if (!ports.canWrite(node.id, controller)) return false;
  throwIfAborted(signal);

  const video = await ports.storeVideo(result);
  if (!ports.canWrite(node.id, controller)) return false;
  throwIfAborted(signal);

  ports.writeNode(node.id, controller, (nodes) =>
    nodes.map((current) =>
      current.id === node.id
        ? ports.applyVideo(current, video, {
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

export function videoTaskFailureMetadata(
  metadata: CanvasNodeData["metadata"],
  errorDetails: string,
  taskFailed: boolean,
): CanvasNodeData["metadata"] {
  const hasContent = Boolean(metadata?.content);
  return {
    ...metadata,
    status: hasContent ? "success" : "error",
    errorDetails: hasContent ? undefined : errorDetails,
    ...(taskFailed ? { videoTaskId: undefined } : {}),
  };
}

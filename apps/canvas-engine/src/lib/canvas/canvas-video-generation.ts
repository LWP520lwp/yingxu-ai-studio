import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { UploadedFile } from "@/services/file-storage";
import { throwIfAborted } from "@/services/media-storage-runtime";
import type {
  VideoGenerationResult,
  VideoGenerationTask,
} from "@/services/api/video";

export type CanvasVideoGenerationConfig = AiConfig;
export type CanvasVideoTask = VideoGenerationTask & { provider: "platform" };

export type CanvasVideoGenerationPorts = {
  createTask: (
    config: CanvasVideoGenerationConfig,
    prompt: string,
    images: ReferenceImage[],
    options: {
      signal: AbortSignal;
      videos: ReferenceVideo[];
      audios: ReferenceAudio[];
    },
  ) => Promise<CanvasVideoTask>;
  waitForTask: (
    config: CanvasVideoGenerationConfig,
    task: CanvasVideoTask,
    options: { signal: AbortSignal },
  ) => Promise<VideoGenerationResult>;
  storeVideo: (result: VideoGenerationResult) => Promise<UploadedFile>;
  getProjectId: () => string | undefined;
  writeNode: (
    nodeId: string,
    controller: AbortController,
    update: (nodes: CanvasNodeData[]) => CanvasNodeData[],
  ) => void;
  applyVideo: (
    node: CanvasNodeData,
    video: UploadedFile,
    metadata: CanvasNodeData["metadata"],
  ) => CanvasNodeData;
};

export type CompleteCanvasVideoGenerationArgs = {
  ports: CanvasVideoGenerationPorts;
  nodeId: string;
  config: CanvasVideoGenerationConfig;
  prompt: string;
  images: ReferenceImage[];
  signal: AbortSignal;
  controller: AbortController;
  metadata?: CanvasNodeData["metadata"];
  videos?: ReferenceVideo[];
  audios?: ReferenceAudio[];
};

export async function completeCanvasVideoGeneration({
  ports,
  nodeId,
  config,
  prompt,
  images,
  signal,
  controller,
  metadata = {},
  videos = [],
  audios = [],
}: CompleteCanvasVideoGenerationArgs): Promise<void> {
  throwIfAborted(signal);
  const task = await ports.createTask(config, prompt, images, {
    signal,
    videos,
    audios,
  });
  ports.writeNode(nodeId, controller, (nodes) =>
    nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            metadata: {
              ...node.metadata,
              videoTaskId: task.id,
              videoTaskProvider: "platform",
              videoTaskProjectId: ports.getProjectId(),
              model: config.model,
            },
          }
        : node,
    ),
  );

  throwIfAborted(signal);
  const result = await ports.waitForTask(config, task, { signal });
  throwIfAborted(signal);
  const video = await ports.storeVideo(result);
  throwIfAborted(signal);
  ports.writeNode(nodeId, controller, (nodes) =>
    nodes.map((node) =>
      node.id === nodeId
        ? ports.applyVideo(node, video, {
            prompt,
            model: config.model,
            ...metadata,
          })
        : node,
    ),
  );
}

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

export type AtlasVideoGenerationConfig = AiConfig;
export type AtlasVideoTask = VideoGenerationTask & { provider: "platform" };

export type AtlasVideoGenerationPorts = {
  createTask: (
    config: AtlasVideoGenerationConfig,
    prompt: string,
    images: ReferenceImage[],
    options: {
      signal: AbortSignal;
      videos: ReferenceVideo[];
      audios: ReferenceAudio[];
    },
  ) => Promise<AtlasVideoTask>;
  waitForTask: (
    config: AtlasVideoGenerationConfig,
    task: AtlasVideoTask,
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

export type CompleteAtlasVideoGenerationArgs = {
  ports: AtlasVideoGenerationPorts;
  nodeId: string;
  config: AtlasVideoGenerationConfig;
  prompt: string;
  images: ReferenceImage[];
  signal: AbortSignal;
  controller: AbortController;
  metadata?: CanvasNodeData["metadata"];
  videos?: ReferenceVideo[];
  audios?: ReferenceAudio[];
};

export async function completeAtlasVideoGeneration({
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
}: CompleteAtlasVideoGenerationArgs): Promise<void> {
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

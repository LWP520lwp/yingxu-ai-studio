import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { nanoid } from "nanoid";

import type { AiConfig } from "@/stores/use-config-store";
import type {
  CanvasConnection,
  CanvasGenerationMode,
  CanvasNodeData,
  CanvasNodeImage,
  CanvasNodeMetadata,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type {
  requestAudioGeneration,
  storeGeneratedAudio,
} from "@/services/api/audio";
import type {
  requestEdit,
  requestGeneration,
  requestImageQuestion,
} from "@/services/api/image";
import type { uploadImage } from "@/services/image-storage";
import { isVideoTaskFailed } from "@/services/api/video";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import {
  atlasAudioMetadata,
  buildAtlasAudioGenerationMetadata,
  buildAtlasImageGenerationMetadata,
  atlasImageMetadata,
} from "@/atlas-engine/model/node-factory";
import { fitAtlasNodeSize } from "@/atlas-engine/model/node-size";
import {
  buildAtlasGenerationConfig,
  findAtlasRetrySourceNode,
  hasAtlasResumableVideoTask,
  isAtlasGenerationCanceled,
  resolveAtlasMetadataReferences,
  atlasSourceNodeReferenceImages,
} from "@/atlas-engine/workflows/generation-runtime";
import {
  buildNodeGenerationContext,
  buildNodeResponseMessages,
  hydrateNodeGenerationContext,
} from "@/atlas-engine/workflows/node-generation-context";
import type { AtlasGenerationSession } from "./generation-session";
import { CanvasNodeType } from "@/types/canvas";

export type AtlasRetryMessageKey =
  | "canvas.projectPage.retryPromptMissing"
  | "canvas.projectPage.referenceMissing"
  | "canvas.projectPage.generationFailed";

type NodeUpdate = (nodes: CanvasNodeData[]) => CanvasNodeData[];
type GuardedNodeWrite = (
  nodeId: string,
  controller: AbortController,
  update: NodeUpdate,
) => void;

export type AtlasRetryDependencies = {
  effectiveConfig: AiConfig;
  nodesRef: MutableRefObject<CanvasNodeData[]>;
  connectionsRef: MutableRefObject<CanvasConnection[]>;
  generationRequests: AtlasGenerationSession;
  isAiConfigReady: (config: AiConfig, model: string) => boolean;
  openConfigDialog: (open: boolean) => void;
  pollVideoNodeTask: (node: CanvasNodeData) => Promise<void>;
  startGenerationRequest: (
    targetNodeId: string,
    originNodeId: string,
    runningId?: string,
    controller?: AbortController,
  ) => AbortController;
  finishGenerationRequest: (
    targetNodeId: string,
    controller: AbortController,
  ) => boolean;
  setNodesForGeneration: GuardedNodeWrite;
  setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
  setRunningNodeId: Dispatch<SetStateAction<string | null>>;
  completeVideoNodeTask: (
    nodeId: string,
    config: AiConfig,
    prompt: string,
    images: ReferenceImage[],
    signal: AbortSignal,
    controller: AbortController,
    metadata?: CanvasNodeMetadata,
    videos?: ReferenceVideo[],
    audios?: ReferenceAudio[],
  ) => Promise<void>;
  providers: {
    requestQuestion: typeof requestImageQuestion;
    requestAudio: typeof requestAudioGeneration;
    storeAudio: typeof storeGeneratedAudio;
    requestEdit: typeof requestEdit;
    requestGeneration: typeof requestGeneration;
    uploadImage: typeof uploadImage;
  };
  notifyError: (message: string) => void;
  notifyWarning: (message: string) => void;
  translate: (key: AtlasRetryMessageKey) => string;
};

type RetryPlan = {
  source: CanvasNodeData;
  savedImageMetadata?: CanvasNodeMetadata;
  config: AiConfig;
  context: Awaited<ReturnType<typeof hydrateNodeGenerationContext>> | null;
  prompt: string;
  useReferenceImages: boolean;
  referenceImages: ReferenceImage[];
};

type RetrySetup = Pick<RetryPlan, "source" | "savedImageMetadata" | "config">;

function generationMode(node: CanvasNodeData): CanvasGenerationMode {
  switch (node.type) {
    case CanvasNodeType.Text:
      return "text";
    case CanvasNodeType.Video:
      return "video";
    case CanvasNodeType.Audio:
      return "audio";
    default:
      return "image";
  }
}

function imageRetryConfig(
  config: AiConfig,
  metadata: CanvasNodeMetadata,
): AiConfig {
  return {
    ...config,
    model: metadata.model || config.imageModel || config.model,
    quality: metadata.quality || config.quality,
    size: metadata.size || config.size,
    background: metadata.background ?? config.background,
    count: "1",
  };
}

function prepareRetrySetup(
  node: CanvasNodeData,
  dependencies: AtlasRetryDependencies,
): RetrySetup {
  const { effectiveConfig, nodesRef, connectionsRef } = dependencies;
  const source =
    findAtlasRetrySourceNode(
      node.id,
      nodesRef.current,
      connectionsRef.current,
    ) ?? node;
  const savedImageMetadata =
    node.type === CanvasNodeType.Image ? node.metadata : undefined;
  const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
  const config =
    hasSavedImageMetadata && savedImageMetadata
      ? imageRetryConfig(effectiveConfig, savedImageMetadata)
      : {
          ...buildAtlasGenerationConfig(
            effectiveConfig,
            source,
            generationMode(node),
          ),
          count: "1",
        };

  return {
    source,
    savedImageMetadata: hasSavedImageMetadata ? savedImageMetadata : undefined,
    config,
  };
}

async function hydrateRetryPlan(
  node: CanvasNodeData,
  dependencies: AtlasRetryDependencies,
  setup: RetrySetup,
): Promise<RetryPlan> {
  const { nodesRef, connectionsRef } = dependencies;
  const { source, savedImageMetadata, config } = setup;
  const hasSavedImageMetadata = Boolean(savedImageMetadata);
  const context = hasSavedImageMetadata
    ? null
    : await hydrateNodeGenerationContext(
        buildNodeGenerationContext(
          source.id,
          nodesRef.current,
          connectionsRef.current,
          source.metadata?.prompt || node.metadata?.prompt || "",
        ),
      );
  const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
  const savedType = savedImageMetadata?.generationType;
  const useReferenceImages = savedType
    ? savedType === "edit"
    : Boolean(context?.referenceImages.length);
  const resolvedImages =
    hasSavedImageMetadata && savedImageMetadata
      ? await resolveAtlasMetadataReferences(savedImageMetadata)
      : useReferenceImages
        ? context?.referenceImages.length
          ? context.referenceImages
          : atlasSourceNodeReferenceImages(source)
        : [];

  return {
    source,
    savedImageMetadata,
    config,
    context,
    prompt,
    useReferenceImages,
    referenceImages: resolvedImages || [],
  };
}

function updateTarget(
  nodes: CanvasNodeData[],
  targetId: string,
  update: (node: CanvasNodeData) => CanvasNodeData,
) {
  return nodes.map((node) => (node.id === targetId ? update(node) : node));
}

function updateImageStatus(
  node: CanvasNodeData,
  imageId: string | undefined,
  status: "loading" | "error",
  errorDetails?: string,
): CanvasNodeData {
  return {
    ...node,
    metadata: {
      ...node.metadata,
      status:
        status === "loading"
          ? "loading"
          : node.metadata?.content
            ? "success"
            : "error",
      errorDetails:
        status === "loading"
          ? undefined
          : node.metadata?.content
            ? undefined
            : errorDetails,
      images: node.metadata?.images?.map((image) =>
        image.id === imageId
          ? {
              ...image,
              status,
              errorDetails: status === "loading" ? undefined : errorDetails,
            }
          : image,
      ),
    },
  };
}

function metadataForRetriedImage(
  metadata: CanvasNodeMetadata | undefined,
  config: AiConfig,
  references: ReferenceImage[],
  useReferenceImages: boolean,
): CanvasNodeMetadata {
  const savedType = metadata?.generationType;
  if (savedType) {
    return {
      generationType: savedType,
      model: config.model,
      size: config.size,
      quality: config.quality,
      ...(config.background ? { background: config.background } : {}),
      count: metadata?.count || 1,
      references: metadata?.references,
    };
  }
  return buildAtlasImageGenerationMetadata(
    useReferenceImages ? "edit" : "generation",
    config,
    1,
    references,
  );
}

function retriedImageNode(
  node: CanvasNodeData,
  imageId: string | undefined,
  uploaded: Awaited<
    ReturnType<AtlasRetryDependencies["providers"]["uploadImage"]>
  >,
  prompt: string,
  generationMetadata: CanvasNodeMetadata,
): CanvasNodeData {
  const output: CanvasNodeImage = {
    id: imageId || node.metadata?.primaryImageId || nanoid(),
    status: "success",
    content: uploaded.url,
    storageKey: uploaded.storageKey,
    naturalWidth: uploaded.width,
    naturalHeight: uploaded.height,
    bytes: uploaded.bytes,
    mimeType: uploaded.mimeType,
  };
  const makePrimary = !imageId || !node.metadata?.content;
  const sourceBounds = imageId ? Math.max(node.width, node.height) : 0;
  const size =
    imageId && node.metadata?.freeResize
      ? { width: node.width, height: node.height }
      : imageId
        ? fitAtlasNodeSize(
            uploaded.width,
            uploaded.height,
            sourceBounds,
            sourceBounds,
          )
        : fitAtlasNodeSize(
            uploaded.width,
            uploaded.height,
            NODE_DEFAULT_SIZE[CanvasNodeType.Image].width,
            NODE_DEFAULT_SIZE[CanvasNodeType.Image].height,
          );

  return {
    ...node,
    type: CanvasNodeType.Image,
    ...(makePrimary
      ? {
          width: size.width,
          height: size.height,
          ...(imageId
            ? {
                position: {
                  x: node.position.x + node.width / 2 - size.width / 2,
                  y: node.position.y + node.height / 2 - size.height / 2,
                },
              }
            : {}),
        }
      : {}),
    metadata: {
      ...node.metadata,
      ...(makePrimary
        ? atlasImageMetadata(uploaded)
        : { status: "success" as const }),
      images: node.metadata?.images?.map((current) =>
        current.id === output.id ? output : current,
      ),
      primaryImageId: makePrimary ? output.id : node.metadata?.primaryImageId,
      prompt,
      ...generationMetadata,
    },
  };
}

function markRetryFailure(
  node: CanvasNodeData,
  imageId: string | undefined,
  errorDetails: string,
  clearVideoTask: boolean,
) {
  const failed = updateImageStatus(node, imageId, "error", errorDetails);
  return {
    ...failed,
    metadata: {
      ...failed.metadata,
      ...(clearVideoTask ? { videoTaskId: undefined } : {}),
    },
  };
}

export async function retryAtlasCanvasNode(
  node: CanvasNodeData,
  imageId: string | undefined,
  dependencies: AtlasRetryDependencies,
): Promise<void> {
  const {
    generationRequests,
    isAiConfigReady,
    openConfigDialog,
    pollVideoNodeTask,
    startGenerationRequest,
    finishGenerationRequest,
    setNodesForGeneration,
    setNodes,
    setRunningNodeId,
    completeVideoNodeTask,
    providers,
    notifyError,
    notifyWarning,
    translate,
  } = dependencies;

  if (hasAtlasResumableVideoTask(node)) {
    await pollVideoNodeTask(node);
    return;
  }

  const setup = prepareRetrySetup(node, dependencies);
  if (!isAiConfigReady(setup.config, setup.config.model)) {
    openConfigDialog(true);
    return;
  }
  const plan = await hydrateRetryPlan(node, dependencies, setup);
  if (!plan.prompt) {
    notifyWarning(translate("canvas.projectPage.retryPromptMissing"));
    return;
  }
  if (plan.useReferenceImages && plan.referenceImages.length === 0) {
    const message = translate("canvas.projectPage.referenceMissing");
    notifyError(message);
    setNodes((current) =>
      updateTarget(current, node.id, (target) =>
        updateImageStatus(target, imageId, "error", message),
      ),
    );
    return;
  }

  const controller = startGenerationRequest(node.id, plan.source.id, node.id);
  setRunningNodeId(node.id);
  setNodesForGeneration(node.id, controller, (current) =>
    updateTarget(current, node.id, (target) =>
      updateImageStatus(target, imageId, "loading"),
    ),
  );

  try {
    if (node.type === CanvasNodeType.Text) {
      if (!plan.context) return;
      let latestText = "";
      const answer = await providers.requestQuestion(
        plan.config,
        buildNodeResponseMessages({ ...plan.context, prompt: plan.prompt }),
        (text) => {
          latestText = text;
          setNodesForGeneration(node.id, controller, (current) =>
            updateTarget(current, node.id, (target) => ({
              ...target,
              type: CanvasNodeType.Text,
              metadata: {
                ...target.metadata,
                content: text,
                status: "loading",
              },
            })),
          );
        },
        { signal: controller.signal },
      );
      setNodesForGeneration(node.id, controller, (current) =>
        updateTarget(current, node.id, (target) => ({
          ...target,
          type: CanvasNodeType.Text,
          metadata: {
            ...target.metadata,
            content: answer || latestText,
            prompt: plan.prompt,
            status: "success",
          },
        })),
      );
      return;
    }

    if (node.type === CanvasNodeType.Video) {
      await completeVideoNodeTask(
        node.id,
        plan.config,
        plan.prompt,
        plan.referenceImages,
        controller.signal,
        controller,
        {
          size: plan.config.size,
          seconds: plan.config.videoSeconds,
          vquality: plan.config.vquality,
          generateAudio: plan.config.videoGenerateAudio,
          watermark: plan.config.videoWatermark,
          videoMode: plan.config.videoMode,
        },
        plan.context?.referenceVideos || [],
        plan.context?.referenceAudios || [],
      );
      return;
    }

    if (node.type === CanvasNodeType.Audio) {
      const encoded = await providers.requestAudio(plan.config, plan.prompt, {
        signal: controller.signal,
      });
      const audio = await providers.storeAudio(
        encoded,
        plan.config.audioFormat,
      );
      setNodesForGeneration(node.id, controller, (current) =>
        updateTarget(current, node.id, (target) => ({
          ...target,
          metadata: {
            ...target.metadata,
            ...atlasAudioMetadata(audio),
            prompt: plan.prompt,
            ...buildAtlasAudioGenerationMetadata(plan.config),
          },
        })),
      );
      return;
    }

    const results = plan.useReferenceImages
      ? await providers.requestEdit(
          plan.config,
          plan.prompt,
          plan.referenceImages,
          { signal: controller.signal },
        )
      : await providers.requestGeneration(plan.config, plan.prompt, {
          signal: controller.signal,
        });
    const firstResult = results[0];
    if (!firstResult)
      throw new Error(translate("canvas.projectPage.generationFailed"));
    const uploaded = await providers.uploadImage(firstResult.dataUrl, {
      signal: controller.signal,
    });
    const metadata = metadataForRetriedImage(
      plan.savedImageMetadata,
      plan.config,
      plan.referenceImages,
      plan.useReferenceImages,
    );
    setNodesForGeneration(node.id, controller, (current) =>
      updateTarget(current, node.id, (target) =>
        retriedImageNode(target, imageId, uploaded, plan.prompt, metadata),
      ),
    );
  } catch (error) {
    if (isAtlasGenerationCanceled(error)) return;
    const details =
      error instanceof Error
        ? error.message
        : translate("canvas.projectPage.generationFailed");
    notifyError(details);
    setNodesForGeneration(node.id, controller, (current) =>
      updateTarget(current, node.id, (target) =>
        markRetryFailure(
          target,
          imageId,
          details,
          isVideoTaskFailed(error) && target.type === CanvasNodeType.Video,
        ),
      ),
    );
  } finally {
    finishGenerationRequest(node.id, controller);
    if (generationRequests.canWrite(node.id, controller))
      setRunningNodeId(null);
  }
}

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { nanoid } from "nanoid";

import type { AiConfig } from "@/stores/use-config-store";
import type {
  CanvasConnection,
  CanvasNodeData,
  CanvasNodeImage,
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
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import {
  audioMetadata,
  buildAudioGenerationMetadata,
  buildImageGenerationMetadata,
  imageMetadata,
} from "@/lib/canvas/canvas-node-factory";
import {
  buildGenerationConfig,
  findRetrySourceNode,
  hasResumableVideoTask,
  isGenerationCanceled,
  resolveMetadataReferences,
  sourceNodeReferenceImages,
} from "@/lib/canvas/canvas-generation-helpers";
import { isVideoTaskFailed } from "@/services/api/video";
import {
  buildNodeGenerationContext,
  buildNodeResponseMessages,
  hydrateNodeGenerationContext,
} from "@/components/canvas/canvas-node-generation";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType } from "@/types/canvas";
import { createCanvasGenerationSession } from "@/lib/canvas/canvas-generation-session";

export type CanvasRetryMessageKey =
  | "canvas.projectPage.retryPromptMissing"
  | "canvas.projectPage.referenceMissing"
  | "canvas.projectPage.generationFailed";

type NodeUpdate = (nodes: CanvasNodeData[]) => CanvasNodeData[];
type GuardedNodeWrite = (
  nodeId: string,
  controller: AbortController,
  update: NodeUpdate,
) => void;

export type CanvasRetryDependencies = {
  effectiveConfig: AiConfig;
  nodesRef: MutableRefObject<CanvasNodeData[]>;
  connectionsRef: MutableRefObject<CanvasConnection[]>;
  generationRequests: ReturnType<typeof createCanvasGenerationSession>;
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
    metadata?: CanvasNodeData["metadata"],
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
  translate: (key: CanvasRetryMessageKey) => string;
};

export async function retryCanvasNode(
  node: CanvasNodeData,
  imageId: string | undefined,
  dependencies: CanvasRetryDependencies,
): Promise<void> {
  const {
    effectiveConfig,
    nodesRef,
    connectionsRef,
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
    translate: t,
  } = dependencies;

  if (hasResumableVideoTask(node)) {
    await pollVideoNodeTask(node);
    return;
  }

  const sourceNode =
    findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) ||
    node;
  const savedImageMetadata =
    node.type === CanvasNodeType.Image ? node.metadata : undefined;
  const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
  const generationConfig =
    hasSavedImageMetadata && savedImageMetadata
      ? {
          ...effectiveConfig,
          model:
            savedImageMetadata.model ||
            effectiveConfig.imageModel ||
            effectiveConfig.model,
          quality: savedImageMetadata.quality || effectiveConfig.quality,
          size: savedImageMetadata.size || effectiveConfig.size,
          background:
            savedImageMetadata.background ?? effectiveConfig.background,
          count: "1",
        }
      : {
          ...buildGenerationConfig(
            effectiveConfig,
            sourceNode,
            node.type === CanvasNodeType.Text
              ? "text"
              : node.type === CanvasNodeType.Video
                ? "video"
                : node.type === CanvasNodeType.Audio
                  ? "audio"
                  : "image",
          ),
          count: "1",
        };
  if (!isAiConfigReady(generationConfig, generationConfig.model)) {
    openConfigDialog(true);
    return;
  }

  const context = hasSavedImageMetadata
    ? null
    : await hydrateNodeGenerationContext(
        buildNodeGenerationContext(
          sourceNode.id,
          nodesRef.current,
          connectionsRef.current,
          sourceNode.metadata?.prompt || node.metadata?.prompt || "",
        ),
      );
  const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
  if (!prompt) {
    notifyWarning(t("canvas.projectPage.retryPromptMissing"));
    return;
  }
  const generationType = savedImageMetadata?.generationType;
  const useReferenceImages = generationType
    ? generationType === "edit"
    : Boolean(context?.referenceImages.length);
  const retryReferenceImages =
    hasSavedImageMetadata && savedImageMetadata
      ? await resolveMetadataReferences(savedImageMetadata)
      : useReferenceImages
        ? context?.referenceImages.length
          ? context.referenceImages
          : sourceNodeReferenceImages(sourceNode)
        : [];
  if (useReferenceImages && !retryReferenceImages) {
    const referenceMissing = t("canvas.projectPage.referenceMissing");
    notifyError(referenceMissing);
    setNodes((prev) =>
      prev.map((item) =>
        item.id === node.id
          ? {
              ...item,
              metadata: {
                ...item.metadata,
                status: item.metadata?.content ? "success" : "error",
                errorDetails: item.metadata?.content
                  ? undefined
                  : referenceMissing,
                images: item.metadata?.images?.map((image) =>
                  image.id === imageId
                    ? {
                        ...image,
                        status: "error",
                        errorDetails: referenceMissing,
                      }
                    : image,
                ),
              },
            }
          : item,
      ),
    );
    return;
  }
  const retryImages = retryReferenceImages || [];

  const controller = startGenerationRequest(node.id, sourceNode.id, node.id);
  setRunningNodeId(node.id);
  setNodesForGeneration(node.id, controller, (prev) =>
    prev.map((item) =>
      item.id === node.id
        ? {
            ...item,
            metadata: {
              ...item.metadata,
              status: "loading",
              errorDetails: undefined,
              images: item.metadata?.images?.map((image) =>
                image.id === imageId
                  ? { ...image, status: "loading", errorDetails: undefined }
                  : image,
              ),
            },
          }
        : item,
    ),
  );

  try {
    if (node.type === CanvasNodeType.Text) {
      if (!context) return;
      let streamed = "";
      const answer = await providers.requestQuestion(
        generationConfig,
        buildNodeResponseMessages({ ...context, prompt }),
        (text) => {
          streamed = text;
          setNodesForGeneration(node.id, controller, (prev) =>
            prev.map((item) =>
              item.id === node.id
                ? {
                    ...item,
                    type: CanvasNodeType.Text,
                    metadata: {
                      ...item.metadata,
                      content: text,
                      status: "loading",
                    },
                  }
                : item,
            ),
          );
        },
        { signal: controller.signal },
      );
      setNodesForGeneration(node.id, controller, (prev) =>
        prev.map((item) =>
          item.id === node.id
            ? {
                ...item,
                type: CanvasNodeType.Text,
                metadata: {
                  ...item.metadata,
                  content: answer || streamed,
                  prompt,
                  status: "success",
                },
              }
            : item,
        ),
      );
      return;
    }
    if (node.type === CanvasNodeType.Video) {
      await completeVideoNodeTask(
        node.id,
        generationConfig,
        prompt,
        retryImages,
        controller.signal,
        controller,
        {
          size: generationConfig.size,
          seconds: generationConfig.videoSeconds,
          vquality: generationConfig.vquality,
          generateAudio: generationConfig.videoGenerateAudio,
          watermark: generationConfig.videoWatermark,
          videoMode: generationConfig.videoMode,
        },
        context?.referenceVideos || [],
        context?.referenceAudios || [],
      );
      return;
    }
    if (node.type === CanvasNodeType.Audio) {
      const audio = await providers.storeAudio(
        await providers.requestAudio(generationConfig, prompt, {
          signal: controller.signal,
        }),
        generationConfig.audioFormat,
      );
      setNodesForGeneration(node.id, controller, (prev) =>
        prev.map((item) =>
          item.id === node.id
            ? {
                ...item,
                metadata: {
                  ...item.metadata,
                  ...audioMetadata(audio),
                  prompt,
                  ...buildAudioGenerationMetadata(generationConfig),
                },
              }
            : item,
        ),
      );
      return;
    }

    const image = useReferenceImages
      ? await providers
          .requestEdit(generationConfig, prompt, retryImages, {
            signal: controller.signal,
          })
          .then((items) => items[0])
      : await providers
          .requestGeneration(generationConfig, prompt, {
            signal: controller.signal,
          })
          .then((items) => items[0]);
    const uploadedImage = await providers.uploadImage(image.dataUrl, {
      signal: controller.signal,
    });
    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const retryImage: CanvasNodeImage = {
      id: imageId || node.metadata?.primaryImageId || nanoid(),
      status: "success",
      content: uploadedImage.url,
      storageKey: uploadedImage.storageKey,
      naturalWidth: uploadedImage.width,
      naturalHeight: uploadedImage.height,
      bytes: uploadedImage.bytes,
      mimeType: uploadedImage.mimeType,
    };
    const generationMetadata = savedImageMetadata?.generationType
      ? {
          generationType: savedImageMetadata.generationType,
          model: generationConfig.model,
          size: generationConfig.size,
          quality: generationConfig.quality,
          ...(generationConfig.background
            ? { background: generationConfig.background }
            : {}),
          count: savedImageMetadata.count || 1,
          references: savedImageMetadata.references,
        }
      : buildImageGenerationMetadata(
          useReferenceImages ? "edit" : "generation",
          generationConfig,
          1,
          retryImages,
        );
    setNodesForGeneration(node.id, controller, (prev) =>
      prev.map((item) => {
        if (item.id !== node.id) return item;
        const makePrimary = !imageId || !item.metadata?.content;
        const edge = imageId ? Math.max(item.width, item.height) : 0;
        const imageSize =
          imageId && item.metadata?.freeResize
            ? { width: item.width, height: item.height }
            : imageId
              ? fitNodeSize(
                  uploadedImage.width,
                  uploadedImage.height,
                  edge,
                  edge,
                )
              : fitNodeSize(
                  uploadedImage.width,
                  uploadedImage.height,
                  imageConfig.width,
                  imageConfig.height,
                );
        return {
          ...item,
          type: CanvasNodeType.Image,
          ...(makePrimary
            ? {
                width: imageSize.width,
                height: imageSize.height,
                ...(imageId
                  ? {
                      position: {
                        x:
                          item.position.x +
                          item.width / 2 -
                          imageSize.width / 2,
                        y:
                          item.position.y +
                          item.height / 2 -
                          imageSize.height / 2,
                      },
                    }
                  : {}),
              }
            : {}),
          metadata: {
            ...item.metadata,
            ...(makePrimary
              ? imageMetadata(uploadedImage)
              : { status: "success" }),
            images: item.metadata?.images?.map((current) =>
              current.id === retryImage.id ? retryImage : current,
            ),
            primaryImageId: makePrimary
              ? retryImage.id
              : item.metadata?.primaryImageId,
            prompt,
            ...generationMetadata,
          },
        };
      }),
    );
  } catch (error) {
    if (isGenerationCanceled(error)) return;
    const errorDetails =
      error instanceof Error
        ? error.message
        : t("canvas.projectPage.generationFailed");
    notifyError(errorDetails);
    setNodesForGeneration(node.id, controller, (prev) =>
      prev.map((item) =>
        item.id === node.id
          ? {
              ...item,
              metadata: {
                ...item.metadata,
                status: item.metadata?.content ? "success" : "error",
                errorDetails: item.metadata?.content ? undefined : errorDetails,
                images: item.metadata?.images?.map((image) =>
                  image.id === imageId
                    ? { ...image, status: "error", errorDetails }
                    : image,
                ),
                ...(isVideoTaskFailed(error) &&
                item.type === CanvasNodeType.Video
                  ? { videoTaskId: undefined }
                  : {}),
              },
            }
          : item,
      ),
    );
  } finally {
    finishGenerationRequest(node.id, controller);
    if (generationRequests.canWrite(node.id, controller))
      setRunningNodeId(null);
  }
}

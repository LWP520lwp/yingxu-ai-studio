import type { Position } from "@/types/canvas";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import {
  audioMetadata,
  imageMetadata,
  videoMetadata,
} from "@/lib/canvas/canvas-node-factory";
import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type ImportedMediaKind = "audio" | "image" | "video";

export type MediaImportFile = Pick<File, "name" | "type">;

export type PlannedMediaUpload<TFile extends MediaImportFile> = {
  file: TFile;
  kind: ImportedMediaKind;
  position: Position;
};

export type MediaImportPlan<TFile extends MediaImportFile> = {
  replacement: (PlannedMediaUpload<TFile> & { nodeId: string }) | null;
  additions: PlannedMediaUpload<TFile>[];
};

export type MediaReplacement =
  | { fileName: string; kind: "audio"; media: UploadedFile }
  | { fileName: string; kind: "video"; media: UploadedFile }
  | { fileName: string; kind: "image"; media: UploadedImage };

type MediaImportTarget = {
  nodeId?: string | null;
  position?: Position;
} | null;

function mediaKindFor<TFile extends MediaImportFile>(
  file: TFile,
  isAudioFile: (file: TFile) => boolean,
): ImportedMediaKind | null {
  if (isAudioFile(file)) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

export function planMediaImport<TFile extends MediaImportFile>(
  files: readonly TFile[],
  target: MediaImportTarget,
  canvasCenter: Position,
  isAudioFile: (file: TFile) => boolean,
  stagger = 40,
): MediaImportPlan<TFile> {
  const accepted = files.flatMap((file) => {
    const kind = mediaKindFor(file, isAudioFile);
    return kind ? [{ file, kind }] : [];
  });
  const basePosition = target?.position || canvasCenter;
  const targetNodeId = target?.nodeId;
  const first = accepted[0];
  const replacement = targetNodeId && first
    ? {
        ...first,
        nodeId: targetNodeId,
        position: basePosition,
      }
    : null;
  const replacesNode = replacement !== null;
  const remaining = replacesNode ? accepted.slice(1) : accepted;
  const firstOffset = replacesNode ? 1 : 0;

  return {
    replacement,
    additions: remaining.map((item, index) => {
      const offset = (index + firstOffset) * stagger;
      return {
        ...item,
        position: {
          x: basePosition.x + offset,
          y: basePosition.y + offset,
        },
      };
    }),
  };
}

export function applyMediaReplacement(
  nodes: readonly CanvasNodeData[],
  nodeId: string,
  replacement: MediaReplacement,
  videoBounds = { width: 420, height: 420 },
): CanvasNodeData[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;

    if (replacement.kind === "audio") {
      const size = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
      return {
        ...node,
        type: CanvasNodeType.Audio,
        title: replacement.fileName,
        position: {
          x: node.position.x + node.width / 2 - size.width / 2,
          y: node.position.y + node.height / 2 - size.height / 2,
        },
        width: size.width,
        height: size.height,
        metadata: {
          ...node.metadata,
          ...audioMetadata(replacement.media),
          errorDetails: undefined,
        },
      };
    }

    if (replacement.kind === "video") {
      const size = fitNodeSize(
        replacement.media.width || 1280,
        replacement.media.height || 720,
        videoBounds.width,
        videoBounds.height,
      );
      return {
        ...node,
        type: CanvasNodeType.Video,
        title: replacement.fileName,
        position: {
          x: node.position.x + node.width / 2 - size.width / 2,
          y: node.position.y + node.height / 2 - size.height / 2,
        },
        width: size.width,
        height: size.height,
        metadata: {
          ...node.metadata,
          ...videoMetadata(replacement.media),
          errorDetails: undefined,
        },
      };
    }

    const size = fitNodeSize(replacement.media.width, replacement.media.height);
    return {
      ...node,
      type: CanvasNodeType.Image,
      title: replacement.fileName,
      width: size.width,
      height: size.height,
      metadata: {
        ...node.metadata,
        ...imageMetadata(replacement.media),
        errorDetails: undefined,
        freeResize: false,
        images: undefined,
        generationType: undefined,
        model: undefined,
        size: undefined,
        quality: undefined,
        count: undefined,
        references: undefined,
        primaryImageId: undefined,
      },
    };
  });
}

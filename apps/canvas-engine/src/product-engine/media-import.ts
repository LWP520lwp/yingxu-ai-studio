import type { Position } from "@/types/canvas";

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

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export const CANVAS_EXPORT_FORMAT = "yingxu-atlas" as const;
export const CANVAS_EXPORT_VERSION = 4 as const;

export interface CanvasExportFile {
  app: typeof CANVAS_EXPORT_FORMAT;
  version: typeof CANVAS_EXPORT_VERSION;
  exportedAt: string;
  projects: CanvasProjectExportItem[];
}

export interface CanvasProjectExportItem {
  project: CanvasProject;
  files: CanvasExportAsset[];
}

export interface CanvasExportAsset {
  storageKey: string;
  path: string;
  mimeType: string;
  bytes: number;
}

import { validateWorkbenchDocument } from "@/atlas-engine/document/workbench-document";
import type { AtlasCanvasProject } from "@/atlas-engine/document/project-catalog";
import { LEGACY_CANVAS_FILE_ID } from "@/lib/legacy-data-compatibility";
import type { AtlasExportAsset, AtlasProjectExportItem } from "./project-export";

const MAX_PROJECTS = 50;
const MAX_NODES = 1500;
const MAX_CONNECTIONS = 6000;
const MAX_FILES_PER_PROJECT = 6000;

export type RestoredCanvasArchiveProject = {
  project: AtlasCanvasProject;
  files: Array<{ asset: AtlasExportAsset; blob: Blob }>;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeArchivePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

function validateManifest(value: unknown): AtlasProjectExportItem[] {
  if (!record(value) || !Array.isArray(value.projects) || value.projects.length === 0 || value.projects.length > MAX_PROJECTS) {
    throw new Error("备份清单格式不正确或项目数量超出限制");
  }
  const supported = value.app === "yingxu-atlas" && value.version === 4 || value.app === LEGACY_CANVAS_FILE_ID && value.version === 3;
  if (!supported) throw new Error("不支持此画布备份格式");

  const projectIds = new Set<string>();
  for (const item of value.projects) {
    if (!record(item) || !record(item.project) || !Array.isArray(item.files)) throw new Error("备份项目结构不正确");
    const project = item.project;
    if (typeof project.id !== "string" || !project.id.trim() || projectIds.has(project.id)) throw new Error("备份中的项目标识为空或重复");
    projectIds.add(project.id);
    if (!Array.isArray(project.nodes) || project.nodes.length > MAX_NODES || !Array.isArray(project.connections) || project.connections.length > MAX_CONNECTIONS) {
      throw new Error("画布节点或连接数量超出限制");
    }
    if (item.files.length > MAX_FILES_PER_PROJECT) throw new Error("备份素材数量超出限制");
    const issues = validateWorkbenchDocument({
      id: project.id,
      title: typeof project.title === "string" ? project.title : "",
      revision: 0,
      viewport: record(project.viewport) ? project.viewport as { x: number; y: number; k: number } : { x: 0, y: 0, k: 1 },
      nodes: project.nodes as AtlasCanvasProject["nodes"],
      connections: project.connections as AtlasCanvasProject["connections"],
    });
    if (issues.length) throw new Error(`备份画布校验失败：${issues[0].message}`);

    const storageKeys = new Set<string>();
    const assetPaths = new Set<string>();
    for (const file of item.files) {
      if (!record(file) || typeof file.storageKey !== "string" || !file.storageKey.includes(":") || storageKeys.has(file.storageKey) ||
          typeof file.path !== "string" || !safeArchivePath(file.path) || file.path === "projects.json" || assetPaths.has(file.path) || typeof file.mimeType !== "string" ||
          !Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0) throw new Error("备份素材索引不正确");
      storageKeys.add(file.storageKey);
      assetPaths.add(file.path);
    }
  }
  return value.projects as AtlasProjectExportItem[];
}

export async function readCanvasArchive(zip: Map<string, Blob>): Promise<RestoredCanvasArchiveProject[]> {
  const manifest = zip.get("projects.json");
  if (!manifest) throw new Error("备份缺少 projects.json 清单");
  const projects = validateManifest(JSON.parse(await manifest.text()));
  return projects.map(({ project, files }) => ({
    project,
    files: files.flatMap((asset) => {
      const blob = zip.get(asset.path);
      if (!blob) throw new Error(`备份素材“${asset.path}”缺失`);
      if (blob.size !== asset.bytes) throw new Error(`素材“${asset.path}”大小与清单不一致`);
      return [{ asset, blob: blob.type ? blob : blob.slice(0, blob.size, asset.mimeType) }];
    }),
  }));
}

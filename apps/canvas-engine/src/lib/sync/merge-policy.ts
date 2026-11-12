import type {
  CanvasDeletedProject,
  CanvasProject,
} from "@/stores/canvas/use-canvas-store";

export type CanvasSyncData = {
  projects: CanvasProject[];
  deleted: CanvasDeletedProject[];
};

export function mergeByTimestamp<T extends { id?: string }>(
  local: readonly T[],
  remote: readonly T[],
  timeField: string,
): T[] {
  const records = new Map<string, T>();
  for (const item of remote) {
    if (item.id) records.set(item.id, item);
  }
  for (const item of local) {
    if (!item.id) continue;
    const current = records.get(item.id);
    if (
      !current ||
      readTimestamp(item, timeField) >= readTimestamp(current, timeField)
    ) {
      records.set(item.id, item);
    }
  }
  return [...records.values()].sort(
    (left, right) =>
      readTimestamp(right, timeField) - readTimestamp(left, timeField) ||
      compareIds(left.id, right.id),
  );
}

export function mergeCanvasSyncData(
  local: CanvasSyncData,
  remote: CanvasSyncData,
): CanvasSyncData {
  const tombstones = new Map<string, CanvasDeletedProject>();
  for (const item of [...(remote.deleted || []), ...(local.deleted || [])]) {
    if (!item.id || !item.deletedAt) continue;
    const current = tombstones.get(item.id);
    if (!current || compareTimestamp(item.deletedAt, current.deletedAt) >= 0) {
      tombstones.set(item.id, item);
    }
  }

  const projects = mergeByTimestamp(
    local.projects || [],
    remote.projects || [],
    "updatedAt",
  ).filter((project) => {
    const deletedAt = tombstones.get(project.id)?.deletedAt;
    if (!deletedAt) return true;
    if (readTimestamp(project, "updatedAt") <= timestampValue(deletedAt))
      return false;
    tombstones.delete(project.id);
    return true;
  });

  return {
    projects,
    deleted: [...tombstones.values()].sort((left, right) =>
      compareIds(left.id, right.id),
    ),
  };
}

function readTimestamp(value: object, field: string) {
  const record = value as Record<string, unknown>;
  const item = record[field];
  if (typeof item === "number" && Number.isFinite(item)) return item;
  if (typeof item === "string") return timestampValue(item);
  return 0;
}

function timestampValue(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareTimestamp(left: string, right: string) {
  return (
    timestampValue(left) - timestampValue(right) || left.localeCompare(right)
  );
}

function compareIds(left = "", right = "") {
  return left.localeCompare(right);
}

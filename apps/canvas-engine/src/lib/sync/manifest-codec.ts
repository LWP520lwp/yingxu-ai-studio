import { isSupportedFileId, PRODUCT_FILE_ID } from "@/lib/product-identity";

export type SyncDomainKey =
  "canvas" | "assets" | "image-workbench" | "video-workbench";

export type SyncManifestFile = {
  storageKey: string;
  path: string;
  mimeType: string;
  bytes: number;
};

export type SyncManifest<T> = {
  app: string;
  version: 1;
  domain: SyncDomainKey;
  exportedAt: string;
  data: T;
  files: SyncManifestFile[];
};

const storageKeyPattern =
  /^[a-z][a-z0-9._-]{0,63}:[^\s\\/\u0000-\u001f]{1,512}$/i;

export function decodeSyncManifest<T>(
  serialized: string,
  domain: SyncDomainKey,
  emptyData: T,
  now = new Date().toISOString(),
): SyncManifest<T> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    throw new Error("Invalid WebDAV manifest JSON");
  }

  if (!isRecord(candidate)) throw new Error("Invalid WebDAV manifest shape");
  if (!isSupportedFileId(candidate.app) || candidate.domain !== domain) {
    throw new Error("WebDAV manifest identity does not match this domain");
  }
  if (candidate.version !== undefined && candidate.version !== 1) {
    throw new Error("Unsupported WebDAV manifest version");
  }

  const data = normalizeDomainData(candidate.data, domain, emptyData);
  const files = normalizeManifestFiles(candidate.files);

  return {
    app: PRODUCT_FILE_ID,
    version: 1,
    domain,
    exportedAt:
      typeof candidate.exportedAt === "string" &&
      Number.isFinite(Date.parse(candidate.exportedAt))
        ? candidate.exportedAt
        : now,
    data,
    files,
  };
}

function normalizeDomainData<T>(
  value: unknown,
  domain: SyncDomainKey,
  emptyData: T,
): T {
  if (!isRecord(value))
    throw new Error("WebDAV manifest data must be an object");

  if (domain === "canvas") {
    const projects = arrayField(
      value.projects ?? emptyRecord(emptyData).projects ?? [],
      "projects",
    );
    const deleted = arrayField(value.deleted ?? [], "deleted");
    assertRecords(projects, "projects");
    assertRecords(deleted, "deleted");
    for (const project of projects) {
      if (typeof project.id !== "string" || !project.id) {
        throw new Error(
          "WebDAV manifest contains a canvas project without an id",
        );
      }
    }
    for (const item of deleted) {
      if (
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(item.deletedAt))
      ) {
        throw new Error(
          "WebDAV manifest contains an invalid project tombstone",
        );
      }
    }
    return {
      ...value,
      projects,
      deleted,
    } as T;
  }

  const collection = domain === "assets" ? "assets" : "logs";
  const items = arrayField(value[collection], collection);
  assertRecords(items, collection);
  if (
    domain === "assets" &&
    items.some((item) => typeof item.id !== "string" || !item.id)
  ) {
    throw new Error("WebDAV manifest contains an asset without an id");
  }
  return {
    ...emptyRecord(emptyData),
    ...value,
    [collection]: items,
  } as T;
}

function normalizeManifestFiles(value: unknown): SyncManifestFile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("WebDAV manifest files must be an array");

  const unique = new Map<string, SyncManifestFile>();
  for (const item of value) {
    if (!isRecord(item))
      throw new Error("WebDAV manifest contains an invalid media entry");
    const { storageKey, path, mimeType, bytes } = item;
    if (
      typeof storageKey !== "string" ||
      !storageKeyPattern.test(storageKey) ||
      typeof path !== "string" ||
      !isSafeRelativePath(path) ||
      typeof mimeType !== "string" ||
      mimeType.length > 255 ||
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0
    ) {
      throw new Error("WebDAV manifest contains unsafe media metadata");
    }
    if (!unique.has(storageKey))
      unique.set(storageKey, { storageKey, path, mimeType, bytes });
  }
  return [...unique.values()];
}

function isSafeRelativePath(path: string) {
  if (
    !path ||
    path.length > 2048 ||
    path.startsWith("/") ||
    path.includes("\\")
  ) {
    return false;
  }
  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.includes(":") &&
      !/[\u0000-\u001f]/.test(segment),
  );
}

function arrayField(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`WebDAV manifest ${name} must be an array`);
  return value;
}

function assertRecords(
  values: unknown[],
  field: string,
): asserts values is Record<string, unknown>[] {
  if (values.some((value) => !isRecord(value))) {
    throw new Error(`WebDAV manifest ${field} entries must be objects`);
  }
}

function emptyRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

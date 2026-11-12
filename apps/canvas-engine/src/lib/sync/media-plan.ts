import type { SyncManifestFile } from "@/lib/sync/manifest-codec";

export type LocalMediaDescriptor = {
  storageKey: string;
  bytes: number;
  mimeType: string;
};

const storageKeyPattern =
  /^[a-z][a-z0-9._-]{0,63}:[^\s\\/\u0000-\u001f]{1,512}$/i;

export function collectMediaStorageKeys(value: unknown): string[] {
  const found = new Set<string>();
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];

  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (isMediaStorageKey(current)) found.add(current);
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (isRecord(current)) {
      const storageKey = current.storageKey;
      if (typeof storageKey === "string" && isMediaStorageKey(storageKey)) {
        found.add(storageKey);
      }
    }
    for (const item of Array.isArray(current)
      ? current
      : Object.values(current)) {
      pending.push(item);
    }
  }

  return [...found].sort((left, right) => left.localeCompare(right));
}

export function isMediaStorageKey(value: string) {
  return storageKeyPattern.test(value);
}

export function planMediaDownloads(
  storageKeys: readonly string[],
  localKeys: ReadonlySet<string>,
  remoteFiles: readonly SyncManifestFile[],
): SyncManifestFile[] {
  const byKey = new Map(remoteFiles.map((file) => [file.storageKey, file]));
  return storageKeys.flatMap((storageKey) => {
    if (localKeys.has(storageKey)) return [];
    const remote = byKey.get(storageKey);
    return remote ? [remote] : [];
  });
}

export function mediaNeedsUpload(
  local: LocalMediaDescriptor,
  remote: SyncManifestFile | undefined,
) {
  return (
    !remote ||
    remote.bytes !== local.bytes ||
    remote.mimeType !== local.mimeType
  );
}

function isRecord(value: object): value is Record<string, unknown> {
  return !Array.isArray(value);
}

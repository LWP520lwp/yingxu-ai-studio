import { createScopedStorage } from "@/lib/localforage-storage";
import type { PluginStorage } from "@/types/canvas-plugin";

type StoredEntry =
  | { version: 1; kind: "value"; value: unknown }
  | { version: 1; kind: "removed" };

const entries = createScopedStorage("atlas_plugin_entries_v1");
const pending = new Map<string, Promise<void>>();

/** Reads and mutations share an owner queue, including across adapter instances. */
function inOrder<T>(owner: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(owner) ?? Promise.resolve()).then(operation);
  const settled = result.then(
    () => {},
    () => {},
  );
  pending.set(owner, settled);
  void settled.then(() => {
    if (pending.get(owner) === settled) pending.delete(owner);
  });
  return result;
}

export function createAtlasPluginStorage(owner: string): PluginStorage {
  // Legacy names replaced every punctuation character with an underscore.
  // Only names without underscores have a provably unique previous owner.
  const legacy = /^[a-zA-Z0-9]+$/.test(owner)
    ? createScopedStorage(`plugin_${owner}`)
    : undefined;
  const address = (key: string) => JSON.stringify([owner, key]);

  return {
    get: <T = unknown>(key: string) =>
      inOrder(owner, async () => {
        const recordKey = address(key);
        const entry = await entries.getItem<StoredEntry>(recordKey);
        if (entry !== null) {
          if (
            entry.version !== 1 ||
            (entry.kind !== "value" && entry.kind !== "removed")
          ) {
            throw new Error("Unsupported plugin storage record");
          }
          return entry.kind === "value" ? (entry.value as T) : null;
        }
        const previous = legacy ? await legacy.getItem<T>(key) : null;
        if (previous !== null) {
          await entries.setItem<StoredEntry>(recordKey, {
            version: 1,
            kind: "value",
            value: previous,
          });
        }
        return previous;
      }),
    set: (key, value) =>
      inOrder(owner, async () => {
        await entries.setItem<StoredEntry>(address(key), {
          version: 1,
          kind: "value",
          value,
        });
      }),
    remove: (key) =>
      inOrder(owner, async () => {
        if (legacy) {
          // A marker prevents the unchanged legacy database from restoring a deletion.
          await entries.setItem<StoredEntry>(address(key), {
            version: 1,
            kind: "removed",
          });
        } else {
          await entries.removeItem(address(key));
        }
      }),
  };
}

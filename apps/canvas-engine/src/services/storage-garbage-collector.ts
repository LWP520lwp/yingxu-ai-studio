import { mapConcurrent } from "@/lib/async-pool";

type EnumerableStorage = {
  iterate: (visit: (value: unknown, key: string) => void) => Promise<unknown>;
};

/** Read all references before scheduling any removal; a failed scan never deletes data. */
export async function collectStorageGarbage(options: {
  retained: Set<string>;
  references?: readonly EnumerableStorage[];
  collect?: (value: unknown, retained: Set<string>) => unknown;
  stores: readonly {
    storage: EnumerableStorage;
    remove: (key: string) => Promise<unknown>;
  }[];
  concurrency?: number;
}) {
  const { retained, collect, stores } = options;
  if (collect) {
    await Promise.all((options.references ?? []).map((storage) =>
      storage.iterate((value) => { collect(value, retained); }),
    ));
  }
  const removals: Array<() => Promise<unknown>> = [];
  for (const { storage, remove } of stores) {
    await storage.iterate((_value, key) => {
      if (!retained.has(key)) removals.push(() => remove(key));
    });
  }
  await mapConcurrent(removals, options.concurrency ?? 4, (remove) => remove());
}

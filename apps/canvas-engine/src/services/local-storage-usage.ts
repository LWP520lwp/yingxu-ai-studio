import { getCurrentStorageDatabaseName } from "@/lib/localforage-storage";

export type IndexedDbStoreUsage = { name: string; records: number; bytes: number };
export type IndexedDbDatabaseUsage = { name: string; version: number; bytes: number; stores: IndexedDbStoreUsage[] };
export type LocalStorageUsage = {
  usage: number;
  quota: number | null;
  contentBytes: number;
  databases: IndexedDbDatabaseUsage[];
};

export async function readLocalStorageUsage(): Promise<LocalStorageUsage> {
  const [estimate, name] = await Promise.all([browserEstimate(), getCurrentStorageDatabaseName()]);
  const databases = await readExistingDatabase(name).then((item) => [item]).catch(() => []);
  const contentBytes = databases.reduce((sum, database) => sum + database.bytes, 0);
  return {
    usage: finiteNonNegative(estimate?.usage) ?? contentBytes,
    quota: finiteNonNegative(estimate?.quota) ?? null,
    contentBytes,
    databases,
  };
}

async function browserEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

async function readExistingDatabase(name: string): Promise<IndexedDbDatabaseUsage> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable");
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === name)) return emptyDatabase(name);
  }
  const database = await openDatabase(name);
  try {
    const stores = Array.from(database.objectStoreNames);
    if (stores.length === 0) return { ...emptyDatabase(name), version: database.version };

    const transaction = database.transaction(stores, "readonly");
    const usage = await Promise.all(stores.map((storeName) => countStore(transaction.objectStore(storeName))));
    usage.sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name));
    return {
      name,
      version: database.version,
      bytes: usage.reduce((sum, store) => sum + store.bytes, 0),
      stores: usage,
    };
  } finally {
    database.close();
  }
}

function openDatabase(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    let wasCreated = false;
    request.onupgradeneeded = (event) => {
      if ((event as IDBVersionChangeEvent).oldVersion !== 0) return;
      wasCreated = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      if (wasCreated) {
        request.result.close();
        void removeDatabase(name);
        reject(new Error("Database did not exist"));
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Database could not be opened"));
  });
}

function removeDatabase(name: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

function countStore(store: IDBObjectStore): Promise<IndexedDbStoreUsage> {
  return new Promise((resolve, reject) => {
    let records = 0;
    let bytes = 0;
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("Storage scan failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ name: store.name, records, bytes });
        return;
      }
      records += 1;
      bytes += estimateValueBytes(cursor.value);
      cursor.continue();
    };
  });
}

function estimateValueBytes(value: unknown): number {
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  try {
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    return new TextEncoder().encode(encoded ?? "").byteLength;
  } catch {
    return 0;
  }
}

function emptyDatabase(name: string): IndexedDbDatabaseUsage {
  return { name, version: 0, bytes: 0, stores: [] };
}

function finiteNonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

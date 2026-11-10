import type { CanvasDocument } from "./types";
type Draft = {
  id: string;
  baseRevision: number;
  document: CanvasDocument;
  updatedAt: number;
};
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("frameflow-drafts", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function writeDraft(value: Draft) {
  const connection = await db();
  const transaction = connection.transaction("drafts", "readwrite");
  transaction.objectStore("drafts").put(value);
}
export async function readDraft(id: string): Promise<Draft | undefined> {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const request = connection
      .transaction("drafts")
      .objectStore("drafts")
      .get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

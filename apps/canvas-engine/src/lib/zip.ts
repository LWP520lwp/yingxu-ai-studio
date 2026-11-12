import { unzipSync, zipSync } from "fflate";

export type ZipFile = {
  name: string;
  data: BlobPart;
};

export async function createZip(files: readonly ZipFile[]): Promise<Blob> {
  const entries = await Promise.all(
    files.map(async ({ name, data }) => {
      const path = normalizeEntryName(name);
      const bytes = new Uint8Array(await new Blob([data]).arrayBuffer());
      return [path, bytes] as const;
    }),
  );
  const names = new Set<string>();
  for (const [name] of entries) {
    if (names.has(name)) throw new Error(`ZIP 中存在重复文件名：${name}`);
    names.add(name);
  }

  const archive = zipSync(Object.fromEntries(entries), { level: 0 });
  return new Blob([archive], { type: "application/zip" });
}

export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  return new Map(
    Object.entries(entries).map(([name, content]) => [
      normalizeEntryName(name),
      new Blob([content]),
    ]),
  );
}

function normalizeEntryName(name: string): string {
  if (typeof name !== "string") throw new Error("ZIP 文件名必须是文本");
  const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.includes("\0"))
    throw new Error("ZIP 文件名不能为空或包含空字符");
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized))
    throw new Error("ZIP 文件名必须是相对路径");
  if (normalized.split("/").some((part) => part === ".."))
    throw new Error("ZIP 文件名不能越过归档根目录");
  return normalized;
}

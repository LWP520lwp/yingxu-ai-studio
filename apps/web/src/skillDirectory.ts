import { zipSync } from "fflate";

/** Package only files explicitly selected by the user; never read arbitrary local paths. */
export async function packageSkillDirectory(files: readonly File[]): Promise<File & { skippedFiles: number }> {
  if (!files.length || files.length > 2048) throw new Error("请选择包含技能配方的文件夹，最多检查 2048 个文件");
  const entries: Record<string, Uint8Array> = Object.create(null);
  let bytes = 0;
  let root = "skill";
  let skippedFiles = 0;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split("/");
    if (/^[a-z]:|^[\\/]/i.test(path) || path.includes("\\") || parts.some((part) => !part || part === "." || part === "..") || path in entries) throw new Error("技能文件夹中包含无效或重复路径");
    if (!/\.(md|json)$/i.test(path)) { skippedFiles++; continue; }
    if (Object.keys(entries).length >= 64) throw new Error("技能配方及参考文档最多 64 个文件");
    if (file.size > 256 * 1024) throw new Error(`单文件不能超过 256 KiB：${file.name}`);
    bytes += file.size;
    if (bytes > 2 * 1024 * 1024) throw new Error("技能文件夹展开后不能超过 2 MiB");
    root = parts.length > 1 ? parts[0] : root;
    entries[path] = new Uint8Array(await file.arrayBuffer());
  }
  if (!Object.keys(entries).some((path) => /(^|\/)(SKILL\.md|skill\.json|manifest\.json)$/i.test(path))) throw new Error("文件夹中需要 SKILL.md、skill.json 或 manifest.json");
  const zip = zipSync(entries, { level: 6 });
  if (zip.byteLength > 2 * 1024 * 1024) throw new Error("打包后超过 2 MiB，请移除与配方无关的大文件");
  return Object.assign(new File([new Uint8Array(zip)], `${root}.zip`, { type: "application/zip" }), { skippedFiles });
}

import { File } from "node:buffer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { packageSkillDirectory } from "./skillDirectory";

beforeAll(() => { vi.stubGlobal("File", File); });
function file(path: string, text = "技能配方") {
  const result = new File([text], path.split("/").at(-1)!);
  Object.defineProperty(result, "webkitRelativePath", { value: path });
  return result as unknown as globalThis.File;
}
describe("user selected Skill folders", () => {
  it("preserves Unicode directory names, nested reference files and the full recipe", async () => {
    const recipe = "拍摄指令".repeat(2100);
    const packed = await packageSkillDirectory([file("汽车电影/SKILL.md", recipe), file("汽车电影/references/光线.md", "自然光")]);
    expect(packed.name).toBe("汽车电影.zip");
    const entries = unzipSync(new Uint8Array(await packed.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["汽车电影/SKILL.md", "汽车电影/references/光线.md"]);
    expect(strFromU8(entries["汽车电影/SKILL.md"])).toBe(recipe);
  });
  it.each(["../SKILL.md", "folder/../SKILL.md", "C:/SKILL.md", "/SKILL.md", "folder\\SKILL.md", "folder//SKILL.md"])("rejects unsafe paths: %s", async (path) => {
    await expect(packageSkillDirectory([file(path)])).rejects.toThrow("无效或重复路径");
  });
  it("rejects duplicate paths and folders without a recipe entry", async () => {
    await expect(packageSkillDirectory([file("a/SKILL.md"), file("a/SKILL.md")])).rejects.toThrow("重复路径");
    await expect(packageSkillDirectory([file("a/notes.md")])).rejects.toThrow("需要 SKILL.md");
  });
  it("bounds file count, individual size and aggregate expanded size before compression", async () => {
    await expect(packageSkillDirectory([])).rejects.toThrow("请选择");
    await expect(packageSkillDirectory(Array.from({ length: 65 }, (_, i) => file(`a/${i}.md`)))).rejects.toThrow("64 个文件");
    await expect(packageSkillDirectory([file("a/SKILL.md", "a".repeat(256 * 1024 + 1))])).rejects.toThrow("256 KiB");
    await expect(packageSkillDirectory(Array.from({ length: 9 }, (_, i) => file(i ? `a/${i}.md` : "a/SKILL.md", "a".repeat(256 * 1024))))).rejects.toThrow("2 MiB");
  });
  it("packs an extracted Skill from a parent folder while skipping PDFs, ZIPs and scripts without reading them", async () => {
    const skipped = [file("汽车/手册.pdf"), file("汽车/原包.zip"), file("汽车/tools/run.py")];
    skipped.forEach((value) => { Object.defineProperty(value, "size", { value: 12 * 1024 * 1024 }); Object.defineProperty(value, "arrayBuffer", { value: () => { throw new Error("must not read"); } }); });
    const packed = await packageSkillDirectory([file("汽车/完整包/SKILL.md"), file("汽车/完整包/references/规则.md"), ...skipped]);
    expect(packed.skippedFiles).toBe(3);
    expect(Object.keys(unzipSync(new Uint8Array(await packed.arrayBuffer())))).toEqual(["汽车/完整包/SKILL.md", "汽车/完整包/references/规则.md"]);
  });
});

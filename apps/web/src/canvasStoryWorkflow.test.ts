import { describe, expect, it } from "vitest";
import { coreLabels, editableStory, emptyStoryDocument, exportStoryText, storyCanvasPayload, storyStyle, type StoryCharacter, type StoryDocument, type StorySegment, type StoryShot } from "./storyWorkflowModel";

const character = (id = "actor"): StoryCharacter => ({ id, name: "陈青", aliases: ["小陈"], locked: true, core: Object.fromEntries(Object.keys(coreLabels).map((key) => [key, "固定形象"])) as StoryCharacter["core"], clothing: { upper: "灰衣", lower: "长裤", shoes: "白鞋", accessories: "手表" }, personality: "冷静", voice: "自然女声", assumptions: [], imagePrompt: "全身白底", threeViewPrompt: "三视图" });
const scene = { id: "room", name: "仓库", aliases: [], time: "早晨", weather: "晴", lighting: "侧光", space: "通道", elements: "金属门", imagePrompt: "实景" };
const prop = { id: "key", name: "钥匙", material: "金属", size: "小", appearance: "银色", imagePrompt: "白底钥匙" };
function fixture(): { document: StoryDocument; segment: StorySegment } {
  const shots: StoryShot[] = Array.from({ length: 5 }, (_, index) => ({ start: index * 3, end: (index + 1) * 3, duration: 3, shotType: "中景", camera: "平移", visibleAction: "接钥匙", sound: "金属声", narration: "无", sceneId: "room", sceneDetail: "清晨仓库门口", dialogue: index ? [] : [{ characterId: "actor", text: "慢一点。" }], characters: [{ characterId: "actor", position: "左侧", posture: "站立", action: "接过", wardrobe: "灰衣长裤" }], propIds: ["key"] }));
  const segment: StorySegment = { id: "segment", number: 1, script: "她接过钥匙。", createdAt: "2026-11-10T00:00:00Z", castIds: ["actor"], shots, startState: null, style: storyStyle, formattedPrompt: "（固定风格）\n出镜角色汇总：陈青\n五镜头" };
  const document = { ...emptyStoryDocument(), characters: [character(), character("unused")], scenes: [scene], props: [prop], segments: [segment] };
  return { document, segment };
}

describe("canvas continuous screenplay boundary", () => {
  it("applies only referenced assets and retains the original script without starting media jobs", () => {
    const { document, segment } = fixture();
    const value = storyCanvasPayload(document, segment);
    expect(value.characters.map((person) => person.id)).toEqual(["actor"]);
    expect(value.scenes).toEqual([scene]); expect(value.props).toEqual([prop]);
    expect(value.script).toBe("她接过钥匙。"); expect(value.shots).toHaveLength(5);
    expect(value.shots[0].videoPrompt).toContain("目标时长3秒，0s–3s");
    expect(value.shots[0].videoPrompt).toContain("自然女声");
    expect(value.shots[0].imagePrompt).toContain("固定形象");
    expect(value).not.toHaveProperty("job"); expect(value).not.toHaveProperty("generate");
  });
  it("rejects any incorrect shot count or timing and missing referenced profiles", () => {
    const { document, segment } = fixture();
    expect(() => storyCanvasPayload(document, { ...segment, shots: segment.shots.slice(0, 4) })).toThrow("五个3秒");
    expect(() => storyCanvasPayload(document, { ...segment, shots: segment.shots.map((shot, index) => index === 2 ? { ...shot, end: 10 } : shot) })).toThrow("五个3秒");
    expect(() => storyCanvasPayload({ ...document, scenes: [] }, segment)).toThrow("档案已缺失");
    expect(() => storyCanvasPayload({ ...document, characters: [] }, segment)).toThrow("档案已缺失");
    expect(() => storyCanvasPayload({ ...document, props: [] }, segment)).toThrow("档案已缺失");
  });
  it("uses a historical archive snapshot even after the editable profiles have changed", () => {
    const { document, segment } = fixture();
    segment.archiveSnapshot = { characters: [character()], scenes: [scene], props: [prop] };
    document.characters = [{ ...character(), name: "另一个名字", voice: "另一个音色" }];
    const value = storyCanvasPayload(document, segment);
    expect(value.characters[0].name).toBe("陈青"); expect(value.shots[0].videoPrompt).toContain("自然女声");
    expect(value.shots[0].videoPrompt).not.toContain("另一个音色");
  });
  it("exports pure storyboard output and never lets editable fields overwrite server history", () => {
    const { document, segment } = fixture();
    expect(exportStoryText(document, segment)).toBe(segment.formattedPrompt);
    expect(exportStoryText({ ...document, segments: [segment, { ...segment, formattedPrompt: "下一段" }] })).toBe(`${segment.formattedPrompt}\n\n下一段`);
    expect(editableStory(document)).not.toHaveProperty("segments"); expect(editableStory(document)).not.toHaveProperty("lastState");
  });
});

export const storyStyle = "真人写实，生成视频不要字幕，有音效，无音乐，运镜丝滑，人物动作流畅，环境衔接流畅，分镜衔接前面的分镜，参考前面的分镜，配音说话自然，有符合语境的停顿、气口，情绪起伏精准，感情色彩饱满，绝对禁止机械朗读、生硬播音腔";
export const coreLabels = { age: "年龄", country: "国家", era: "时代", gender: "性别", features: "五官", face: "脸型", hairColor: "发色", hairStyle: "发型", eyeColor: "瞳色", build: "身型" };
export type StoryCharacter = { id: string; name: string; aliases: string[]; locked: boolean; core: Record<keyof typeof coreLabels, string>; clothing: { upper: string; lower: string; shoes: string; accessories: string }; personality: string; voice: string; assumptions: string[]; imagePrompt: string; threeViewPrompt: string };
export type StoryScene = { id: string; name: string; aliases: string[]; time: string; weather: string; lighting: string; space: string; elements: string; imagePrompt: string };
export type StoryProp = { id: string; name: string; material: string; size: string; appearance: string; imagePrompt: string };
export type StoryActorState = { characterId: string; position: string; posture: string; action: string; wardrobe: string };
export type StoryShot = { start: number; end: number; duration: 3; shotType: string; camera: string; visibleAction: string; sound: string; narration: "无"; sceneId: string; sceneDetail: string; dialogue: { characterId: string; text: string }[]; characters: StoryActorState[]; propIds: string[] };
export type StoryEndState = { segmentId: string; sceneId: string; sceneDetail: string; characters: StoryActorState[]; propIds: string[]; visibleAction: string };
export type StorySegment = { id: string; number: number; script: string; createdAt: string; castIds: string[]; shots: StoryShot[]; startState: StoryEndState | null; style: string; formattedPrompt: string; archiveSnapshot?: Pick<StoryDocument, "characters" | "scenes" | "props"> };
export type StoryDocument = { schemaVersion: 1; title: string; world: string; novel: string; paragraph: string; model: string; characters: StoryCharacter[]; scenes: StoryScene[]; props: StoryProp[]; segments: StorySegment[]; lastState: StoryEndState | null };
export type StorySnapshot = { revision: number; document: StoryDocument; updatedAt?: string };
export type StoryTask = { id: string; operation: "extract" | "segment" | "first"; model: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; stage: string; error?: string; resultRevision?: number; createdAt: string; updatedAt: string };
export type StoryApplyPayload = {
  title: string; segmentId: string; script: string; formattedPrompt: string;
  shots: (StoryShot & { imagePrompt: string; videoPrompt: string })[];
  characters: StoryCharacter[]; scenes: StoryScene[]; props: StoryProp[];
};
export const emptyStoryDocument = (): StoryDocument => ({ schemaVersion: 1, title: "连续剧本", world: "", novel: "", paragraph: "", model: "", characters: [], scenes: [], props: [], segments: [], lastState: null });
export function editableStory(document: StoryDocument) {
  return { title: document.title, world: document.world, novel: document.novel, paragraph: document.paragraph, model: document.model, characters: document.characters, scenes: document.scenes, props: document.props };
}
export const storyKey = (document: StoryDocument) => JSON.stringify(editableStory(document));
export const storyTaskActive = (task: StoryTask) => task.status === "queued" || task.status === "running";
export const storyStages: Record<string, string> = { queued: "等待模型任务", starting: "准备模型与上下文", extracting: "提取并核对角色、场景与道具", planning: "生成五个连续镜头", validating: "校验时间、档案引用与延续状态", completed: "结果已保存", failed: "任务失败", cancelled: "已取消" };

/** Canvas import is a reviewable node description. It never starts generation by itself. */
export function storyCanvasPayload(document: StoryDocument, segment: StorySegment): StoryApplyPayload {
  if (segment.shots.length !== 5 || segment.shots.some((shot, index) => shot.start !== index * 3 || shot.end !== (index + 1) * 3)) throw new Error("分镜不满足五个3秒镜头，不能应用到画布。");
  const archive = segment.archiveSnapshot || document;
  const characterIds = new Set(segment.shots.flatMap((shot) => shot.characters.map((actor) => actor.characterId)));
  const sceneIds = new Set(segment.shots.map((shot) => shot.sceneId));
  const propIds = new Set(segment.shots.flatMap((shot) => shot.propIds));
  const characters = archive.characters.filter((character) => characterIds.has(character.id));
  const scenes = archive.scenes.filter((scene) => sceneIds.has(scene.id));
  const props = archive.props.filter((prop) => propIds.has(prop.id));
  if (characters.length !== characterIds.size || scenes.length !== sceneIds.size || props.length !== propIds.size) throw new Error("分镜引用的档案已缺失，请重新读取工作流。");
  const shots = segment.shots.map((shot) => {
    const identities = shot.characters.map((actor) => {
      const person = characters.find((character) => character.id === actor.characterId);
      if (!person) throw new Error("分镜角色档案已缺失，请重新读取工作流。");
      return `${person.name}（${Object.values(person.core).join("，")}；衣着${actor.wardrobe}；${actor.position}，${actor.posture}，${actor.action}）`;
    }).join("；");
    const speech = shot.dialogue.map((line) => {
      const character = characters.find((person) => person.id === line.characterId);
      if (!character || !shot.characters.some((actor) => actor.characterId === line.characterId)) throw new Error("分镜台词的角色未出镜，请重新读取工作流。");
      return `${character.name}（音色：${character.voice}）：${line.text}`;
    }).join("；") || "无台词";
    return { ...shot, imagePrompt: `真人写实，${shot.sceneDetail}。${identities}。${shot.shotType}，${shot.visibleAction}。无字幕无水印。`, videoPrompt: `（${segment.style || storyStyle}）\n目标时长3秒，${shot.start}s–${shot.end}s。${shot.shotType}；运镜：${shot.camera}；场景：${shot.sceneDetail}；${identities}；可视化动作：${shot.visibleAction}；环境与动作音：${shot.sound}；旁白：无；台词：${speech}。` };
  });
  return { title: `${document.title} · 第${segment.number}段`, segmentId: segment.id, script: segment.script, formattedPrompt: segment.formattedPrompt, shots, characters, scenes, props };
}
export function exportStoryText(document: StoryDocument, segment?: StorySegment) { return (segment ? [segment] : document.segments).map((value) => value.formattedPrompt).join("\n\n"); }

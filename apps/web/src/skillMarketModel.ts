import type { SkillDefinition } from "./SkillMarket";

export type MarketCategory = "all" | "image" | "video" | "composition" | "advertising" | "film" | "character" | "education" | "illustration" | "space";
export type MarketCollection = "all" | "installed" | "favorites" | "imported";

const themes: Record<string, { category: MarketCategory; label: string; input: string; output: string; scope: string }> = {
  "product-shot": { category: "advertising", label: "商业广告", input: "产品描述 · 可选产品参考图", output: "单镜头广告视频候选", scope: "围绕产品的一个卖点安排主体、材质、光线与克制运镜，适合产品展示与短广告镜头。" },
  "character-sheet": { category: "character", label: "角色设计", input: "身份 · 服装 · 配色与外观设定", output: "角色造型参考图", scope: "探索角色轮廓与服装层次，整理同一角色的多个视角。精确多视图一致性仍需人工检查。" },
  "cinema-camera": { category: "film", label: "影视镜头", input: "场景情绪 · 主体 · 运镜要求", output: "连续运镜视频候选", scope: "以一次推进、跟随或环绕组织空间和情绪，保持主体、轴线与视线连续。" },
  "cinema-vfx": { category: "film", label: "电影特效", input: "镜头描述 · 可选主体参考图", output: "特效视频镜头候选", scope: "将光效、粒子或烟雾组织成有起因、释放和环境反馈的单个镜头，保持主体与场景连续。" },
  "science-visual": { category: "education", label: "教育科普", input: "一个科学概念 · 已核对事实", output: "讲解用候选配图", scope: "将结构、比例或因果关系转成便于讲解的单幅画面。输出需要事实复核，可用于后续科普视频配图。" },
  "storybook-scene": { category: "illustration", label: "插画绘本", input: "单个故事情节 · 角色与画风", output: "单页绘本候选插画", scope: "让动作、表情与环境共同表达故事里的一个瞬间，为后期排版预留留白。" },
  "space-concept": { category: "space", label: "空间概念", input: "空间用途 · 材质 · 光线与视角", output: "空间氛围概念图", scope: "探索建筑或室内的透视、尺度和材质关系，用于视觉概念讨论，不能替代施工或工程设计。" },
  "fight-video": { category: "film", label: "动作设计", input: "文字情节 · 可选角色参考图", output: "连贯动作视频候选", scope: "将追逐、交手和攻防情节转成短镜头，突出动作因果、人物站位与镜头连续性。" },
  "image-create": { category: "illustration", label: "图像创作", input: "画面描述 · 可选参考图片", output: "图片候选素材", scope: "适合概念设计、场景探索和分镜配图。先生成候选，再选择素材加入画布。" },
  "image-to-video": { category: "film", label: "动态镜头", input: "已有图片 · 动作与镜头描述", output: "视频候选素材", scope: "将静态分镜、角色或场景图发展成动态镜头，逐个预览并选择视频片段。" },
  "storyboard-to-video": { category: "film", label: "作品合成", input: "分镜脚本 · 多个镜头素材", output: "完整视频作品（规划中）", scope: "面向多镜头、旁白、字幕与成片输出的流程规划，完整合成尚未开放。" },
};
const editorialOrder = ["product-shot", "character-sheet", "cinema-camera", "cinema-vfx", "fight-video", "science-visual", "storybook-scene", "space-concept", "image-to-video", "image-create", "storyboard-to-video"];

export function filterMarketSkills(skills: SkillDefinition[], category: MarketCategory, search: string, collection: MarketCollection = "all") {
  const query = search.trim().toLocaleLowerCase();
  return skills.filter((skill) =>
    (category === "all" || category === skill.capability || skill.category === category || themes[skill.id]?.category === category) &&
    (collection === "all" || (collection === "installed" && skill.installed) || (collection === "favorites" && skill.favorite) || (collection === "imported" && skill.source === "imported")) &&
    (!query || [skill.name, skill.description, themes[skill.id]?.label, ...(skill.tags || [])].join(" ").toLocaleLowerCase().includes(query)),
  ).sort((a, b) => {
    const first = editorialOrder.indexOf(a.id), second = editorialOrder.indexOf(b.id);
    return (first < 0 ? editorialOrder.length : first) - (second < 0 ? editorialOrder.length : second);
  });
}

export function canApplySkill(skill: SkillDefinition) {
  return skill.status === "available" && skill.installed === true && !skill.updateAvailable &&
    skill.installedVersion === skill.recipeVersion && (skill.capability === "image" || skill.capability === "video");
}

type PresentationSkill = Pick<SkillDefinition, "id" | "capability"> & Partial<Pick<SkillDefinition, "name" | "sourceId" | "source" | "category">>;

const capabilityLabels = { image: "图像创作", video: "视频创作", composition: "组合工作流" };
const coverPalettes = [
  ["#102c35", "#27647a", "#a7d8e4"], ["#2a263c", "#65507f", "#d0bce6"],
  ["#21302d", "#477566", "#c2ddbf"], ["#38271f", "#8b5b41", "#edc9a2"],
  ["#263143", "#4a6892", "#c0d1ef"], ["#352532", "#88546c", "#e7bed3"],
] as const;

function escapeCoverText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}
function coverTitle(value: string) {
  const characters = Array.from(value.trim());
  return escapeCoverText(characters.length > 18 ? `${characters.slice(0, 17).join("")}…` : characters.join(""));
}

/** Private packages keep a local cover even when this deployment has no generated artwork for them. */
function packageCover(skill: PresentationSkill) {
  const identity = skill.sourceId || skill.id;
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  const [background, middle, accent] = coverPalettes[hash % coverPalettes.length];
  const label = capabilityLabels[skill.capability];
  const name = coverTitle(skill.name || label);
  const category = coverTitle(skill.category?.trim() || label);
  const variant = hash % 3;
  const artwork = variant === 0
    ? `<circle cx="820" cy="325" r="145" fill="none" stroke="${accent}" stroke-width="2"/><circle cx="820" cy="325" r="105" fill="none" stroke="${accent}" stroke-width="26" opacity=".14"/><path d="M660 400 820 215 950 380" fill="none" stroke="${accent}" stroke-width="3"/>`
    : variant === 1
      ? `<g fill="none" stroke="${accent}" stroke-width="2"><rect x="665" y="166" width="175" height="218" rx="9" transform="rotate(-12 752 275)"/><rect x="740" y="210" width="175" height="218" rx="9" transform="rotate(11 827 319)"/></g><circle cx="827" cy="316" r="37" fill="${accent}" opacity=".24"/>`
      : `<g fill="none" stroke="${accent}" stroke-width="2"><path d="M670 220h250M670 300h250M670 380h250" opacity=".3"/><path d="M690 220v160m80-160v160m80-160v160" opacity=".3"/><path d="m680 370 74-116 70 66 83-132" stroke-width="5"/></g><circle cx="907" cy="188" r="8" fill="${accent}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576" viewBox="0 0 1024 576"><rect width="1024" height="576" fill="${background}"/><path d="M640 0h384v576H780L620 260Z" fill="${middle}" opacity=".5"/><path d="M0 482h1024M68 0v576" stroke="${accent}" opacity=".12"/><g opacity=".6">${artwork}</g><rect x="94" y="109" width="46" height="4" rx="2" fill="${accent}"/><text x="94" y="161" fill="${accent}" font-family="system-ui,sans-serif" font-size="20">${escapeCoverText(label)}</text><text x="90" y="295" fill="#f5f5f0" font-family="system-ui,sans-serif" font-size="43" font-weight="600">${name}</text><text x="94" y="345" fill="${accent}" font-family="system-ui,sans-serif" font-size="20">${category}</text><text x="94" y="520" fill="${accent}" font-family="system-ui,sans-serif" font-size="15">SKILL / ${String(hash % 10000).padStart(4, "0")}</text></svg>`;
  // TextEncoder also replaces lone surrogate input, keeping the image valid for any imported title.
  return `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`;
}

export function skillPresentation(skill: PresentationSkill) {
  const builtin = Object.hasOwn(themes, skill.id);
  const theme = builtin ? themes[skill.id] : {
    category: "all" as const, label: capabilityLabels[skill.capability],
    input: "创作文字 · 按需添加参考素材", output: "待预览的候选素材", scope: "按技能配方准备创作配置，确认后生成候选素材。",
  };
  const automotive = [skill.sourceId, skill.id].some((id) => id === "ayu-cinematic-auto-visual" || id === "automotive-director");
  const common = {
    ...theme,
    cover: builtin ? `/skill-covers/${skill.id}-v2.webp` : automotive ? "/skill-covers/automotive-director-v2.webp" : packageCover(skill),
    coverLabel: builtin || automotive ? "AI 创作示例" : "个人创作配方",
    steps: [
      `准备${theme.input.replaceAll(" · ", "、")}，也可以先在文字节点写下创意。`,
      "安装后应用到当前画布，检查带入的提示词、可用模型和画面参数。",
      "按需连接参考素材，确认提交生成，预览候选后选择保留。",
    ],
    note: "应用技能只准备提示词与生成配置，由你确认后提交。模型能力与参考图支持以当前账号池为准。",
  };
  if (!["fight-video", "image-create", "image-to-video", "storyboard-to-video"].includes(skill.id)) return common;
  if (skill.id === "fight-video") return {
    ...common,
    input: "文字情节 · 可选角色参考图",
    output: "连贯动作视频候选",
    scope: "适合将文字里的追逐、交手和攻防情节转成短镜头，突出动作因果、人物站位与镜头连续性。",
    steps: ["在文字节点写下人物、环境和动作情节。", "选中“使用 Skill → 打斗技巧”，将节点文字带入视频配置。", "检查动作编排、可用模型和时长，确认后生成并预览视频。"],
    note: "技能把你的文字与动作设计约束组合成提示词。仅规划影视动作，不自动提交生成；需要时可连接角色参考图。",
  };
  if (skill.id === "image-create") return {
    ...common,
    input: "画面描述 · 可选参考图片",
    output: "图片候选素材",
    scope: "适合概念设计、场景探索和分镜配图。可先生成多种方向，再选择素材加入画布。",
    steps: ["在画布填写画面描述，按需连接参考图片。", "选择可用模型、画面比例与生成参数。", "确认提交生成，预览候选图片后加入画布。"],
    note: "使用技能会创建图像配置节点；模型与参考图支持情况以账号池提供的能力为准。",
  };
  if (skill.id === "image-to-video") return {
    ...common,
    input: "已有图片 · 动作与镜头描述",
    output: "视频候选素材",
    scope: "适合将静态分镜、角色或场景图发展成动态镜头，逐个预览并选择视频片段。",
    steps: ["将已有图片连接到画布的视频配置节点。", "填写动作和镜头描述，选择模型、比例及视频时长。", "确认提交生成，预览视频候选并加入画布。"],
    note: "需要至少一张图片。首尾参考帧与时长选项取决于所选模型，安装本身不会开始生成。",
  };
  return {
    ...common,
    input: "分镜脚本 · 多个镜头素材",
    output: "完整视频作品（规划中）",
    scope: "面向多镜头、旁白、字幕与成片输出的完整流程，当前仅展示流程规划。",
    steps: ["整理资料与脚本，规划各镜头内容。", "逐个生成并确认图片、视频候选素材。", "组合音画、旁白和字幕，完成成片输出（规划中）。"],
    note: "完整分镜合成尚未开放，当前无法安装或自动批量执行。已有单镜头创作可使用图像与视频技能。",
  };
}

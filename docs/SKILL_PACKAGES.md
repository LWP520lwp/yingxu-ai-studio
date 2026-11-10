# 导入个人 Skill

在「Skill 库 → 导入 Skill」上传 ZIP、JSON 或 SKILL.md。导入成功后会自动安装，只保存在当前账号下；在「我的导入」查看、收藏、卸载或重新安装。

也可点击「选择技能文件夹」，在系统选择器中选中本机目录，例如本次已验收的 `E:/尚硅谷前端/AI 汽车电影感影像·导演 Skill 1.0`。浏览器只读取你明确选择的文件夹内的 Markdown/JSON 并保留相对目录；PDF、现成ZIP、脚本与媒体会跳过并显示数量。已选择的目录会在浏览器中整理成上传包，网站不会根据输入的任意磁盘路径读取部署服务器文件。目录最多检查2048项、最多保留64个文本文件，单个256KiB、合计2MiB；后端仍按下文的核心配方和参考文档限制校验。

视频类 Skill 会出现在视频生成选择器的「我的导入」分组。在画布中点击「导入 / 管理 Skill」打开技能库，返回后点击「刷新技能」即可读取新配方。选择后填写镜头文字、按需连接参考图，再提交生成。图片类 Skill 可以从技能库应用到画布。

安装或导入不会自动生成媒体。你的账号池或模型渠道需要已经接通，模型能力、时长和参考图限制以当前渠道为准。

## JSON 格式

可直接下载网站中的 [JSON 示例](../apps/web/public/skill-examples/orbit-explainer.skill.json)。例如：

```json
{
  "id": "orbit-explainer",
  "name": "轨道讲解",
  "description": "把轨道运动概念编排为连续的科学示意镜头。",
  "capability": "video",
  "version": "1.0.0",
  "tags": ["科普", "连续镜头"],
  "promptTemplate": "用户内容：{{text}}\n先交代空间关系，再跟随主体运动。保持轨道方向和光照连续。",
  "defaults": { "width": 1280, "height": 720, "duration": 8 }
}
```

- `id`：小写字母开头，最多 64 位，可包含数字、连字符。未填写时根据名称生成。
- `name`：1–100 字符。`description` 最多 1200 字符。
- `capability`：`image` 或 `video`。省略时采用导入界面选择的用途。
- `version` / `recipeVersion`：三段数字版本，默认 `1.0.0`。修改已导入配方时提高版本号。
- `promptTemplate`：1–12000 字符，包含自动追加的用户文字占位符。`{{text}}` 是唯一动态占位符，提交时替换为用户文字；没有该占位符时会在配方末尾追加用户文字。最终配方与镜头内容组合也不能超过 12000 字符，较长配方需要相应缩短镜头文字。
- `defaults`：可选 `width`、`height`（64–4096）、`duration`（2–20 秒）和平台模型标识 `model`。实际生成仍须满足所选渠道约束。
- `tags`：最多 12 项，每项不超过 40 字符。

也支持平台的完整声明式 manifest：`inputSchema` 仅允许 `projectId`、`nodeId`、`prompt`、`model`、`width`、`height`、`duration`、`referenceAssetIds`；`recipe` 仅可描述 `POST /api/jobs` 的 `generation-job`，`schemaVersion=1`，且 `kind` 与用途一致。若需要参考图，在 `inputSchema.required` 加入 `referenceAssetIds`。

## SKILL.md 格式

可直接下载 [Markdown 示例](../apps/web/public/skill-examples/SKILL.md)。

```markdown
---
name: cinematic-action
displayName: 连贯动作镜头
description: 编排清楚的动作起因、攻防关系和环境反馈。
capability: video
version: 1.0.0
---
# 动作方法
用户内容：{{text}}
先交代人物站位，再安排一次动作的起因、接触与收势。
保持角色外观、镜头轴线与运动方向连续。
```

元信息支持普通单行文本与 `|` / `>` 文本块。未填写元信息时使用正文的一级标题作为名称，导入界面选择用途。正文完整作为创作方法，最终仍由用户确认生成。

## ZIP 与保存规则

ZIP 内可使用一层或多层目录，包含一个 `skill.json` / `manifest.json`，或一个 `SKILL.md`。若 JSON 与 Markdown 同时存在，JSON 为配方来源，Markdown 作为附属文件忽略。

常见完整技能文件夹可保留主文档同级的 `references/` 与 `templates/` 目录。其中的 `.md` 原文会完整保存在私有配方的 `recipe.referenceDocuments` 中，在技能详情查看；每文最大 64 KiB，最多 63 份。它们用作可查阅的参考材料，当前生成仅组合核心配方与镜头文字，不会把所有附件自动塞入模型。`agents/openai.yaml`、脚本、PDF 和其他附件不参与执行；可留在 ZIP 中，并计入忽略文件数。

上传最大 2 MiB；ZIP 最大 64 个条目，单文件最大 256 KiB，展开内容合计最大 2 MiB；JSON 或 Markdown 配方最大 64 KiB。绝对路径、`..`、Windows 驱动器路径、重复路径和多个候选配方会被拒绝。

平台只解析文字配方与允许的参数，不解压到磁盘、不执行脚本、不安装依赖、不访问包中的 URL。附属文件不进入运行环境；不会自动调用其他工具或接入账号。

每个账号最多导入 100 个不同的个人 Skill。相同来源与版本、相同配方重复导入可安全重试；同版本内容不一致时返回版本冲突。私有 Skill 不能覆盖内置 Skill，另一账号导入同名配方也会获得独立标识。安装状态、收藏、详情、生成任务的技能身份均按当前登录账号校验。卸载只移除安装状态，个人配方仍保留，可重新安装。

导入每个账号每 60 秒最多 12 次。触及限制时会显示剩余重试秒数；等待后可重试，不需要修改文件。格式不符时会返回具体字段或大小问题，应按提示修正，连续重试同一无效包也会计入次数。

已验证「阿宇电影感汽车视觉 CV1.0」完整包：原 ZIP 约 23 KiB、16 个文件，核心正文 8266 字符，可保留 13 份参考/模板 Markdown，忽略 2 个非配方文件。原目录与包均无需修改。其导演流程作为创作配方保存，平台不会把包内“必须按顺序执行”等文字当作平台操作权限。

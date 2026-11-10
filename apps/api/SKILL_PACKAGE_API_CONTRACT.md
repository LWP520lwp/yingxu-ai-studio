# 私有 Skill 包 API

## 导入

`POST /api/workspace/skill-imports`

- 需要平台登录会话、可信 Origin 与 `X-Workbench-Request: 1`。
- `multipart/form-data`：`file` 为 ZIP / JSON / Markdown；`capability=image|video` 为省略用途时的默认值，默认 `video`。
- 单账号每分钟最多 12 次导入。文件上限 2 MiB；每账号最多 100 个不同来源的个人 Skill。
- 仅解析声明式 prompt recipe。核心配方上限 12000 字符（含自动追加的用户文字占位符）；最终配方与用户内容组合仍受生成任务 12000 字符限制。不会提取或执行包内脚本，不进行 URL 读取。
- 成功 `200`，返回 Skill 详情，并已自动安装当前版本。

```json
{
  "id": "private-<48 hex>",
  "name": "轨道讲解",
  "description": "说明",
  "capability": "video",
  "status": "available",
  "recipeVersion": "1.0.0",
  "source": "imported",
  "visibility": "private",
  "sourceId": "orbit-explainer",
  "sourceFormat": "json",
  "installed": true,
  "installedVersion": "1.0.0",
  "ignoredFiles": 0,
  "includedDocuments": 0,
  "inputSchema": {},
  "recipe": {}
}
```

`sourceFormat`、`ignoredFiles` 和 `includedDocuments` 用于本次导入回执；后续目录/详情不保证包含这三个字段。`ignoredFiles` 不包含目录条目，只统计实际忽略的文件。`includedDocuments` 为保存的参考文档数量。

ZIP 选中主 `SKILL.md` 或 JSON 所在目录下，`references/**/*.md` 与 `templates/**/*.md` 会保存为 `recipe.referenceDocuments`：键为相对路径，值为完整 UTF-8 原文。每文最多 64 KiB，最多 63 份，累计仍受 ZIP 展开 2 MiB 限制。其他文件（包括脚本与 `agents/openai.yaml`）忽略。参考文档按路径排序，保存在本人私有配方中；读取详情时返回，目录摘要不返回 recipe。它们不预先拼进生成提示词，不执行其中的命令或主动读取链接。

格式与示例见 `docs/SKILL_PACKAGES.md`。

错误：`400 INVALID_REQUEST`（文件/配方格式、路径或大小）、`401`（未登录）、`403`（来源头）、`409 SKILL_VERSION_CONFLICT`（同版本配方不同）、`409 SKILL_LIBRARY_FULL`、`429 RATE_LIMITED`（速率，正文含 `retryAfterSeconds` 且响应头含 `Retry-After`）、`503 REDIS_UNAVAILABLE`（限流不可用或结果未确认，不能当成用户操作过频）。

## 目录与既有接口

`GET /api/skills` 仍返回数组。匿名访问只含内置技能，登录访问合并本人私有技能。

`GET /api/skills/{id}`、`PUT|DELETE /api/workspace/skills/{id}`、`PUT|DELETE /api/workspace/skill-favorites/{id}`、`GET /api/workspace/skills` 继续使用原有结构。目录/详情新增 `source=builtin|imported`、`visibility=public|private`，私有详情含 `sourceId`。

个人 Skill ID 为服务端根据 owner 与源 id 生成的独立标识，不能指定内置 ID。其他账号或匿名读取、安装、收藏此私有 ID 都返回 `404`。安装必须提供当前 `recipeVersion`；同一版本配方永久不变。

## 生成任务来源

`POST /api/jobs` 新增可选的 `skillId`、`skillVersion`，必须成对提供。

```json
{ "skillId": "private-<48 hex>", "skillVersion": "1.0.0" }
```

客户端先以已安装配方组合 `promptTemplate + 用户文字 + 参考图约束`，把最终 prompt 与真实 `referenceAssetIds` 一起提交。服务端在调用任何模型前，校验此账号能读取技能、当前版本已安装、用途与任务 kind 一致，以及必需参考图存在。缺失安装或过期版本返回 `409`，外来私有 ID 返回 `404`，输入不足返回 `400`。任务仅使用平台本来支持的模型渠道。

未使用 Skill 的原有任务字段与请求序列化保持兼容；幂等键逻辑继续生效。Skill 字段保存在任务原始 request JSON 中，不发送给第三方作为凭据。

数据库迁移：`V13__private_skill_packages.sql`，持久化 owner 与私有 Skill 定义的映射；配方仍使用不可变的 `skill_definition`，安装和收藏复用原表。

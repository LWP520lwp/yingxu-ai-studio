# 平台 API 与操作约定

此参考适用于仓库内的多模态画布生成流程。接口源文件为 `apps/api/API_CONTRACT.md`，初始核查日期 2026-11-09；持续实现时应以该契约与服务返回为准。

## 地址与认证

开发前端通过同源 `/api` 代理到本项目后端；本次隔离开发后端示例为 `http://localhost:8088/api`，前端为 `http://localhost:5178`。生产地址由部署配置决定，不硬编码开发端口。

浏览器请求携带平台会话，例如 `credentials: "include"`。发生 401 时引导用户通过平台支持的 GitHub OAuth／正式登录建立会话，不能伪造成功或退回无鉴权调用。开发本机会话仅在 dev profile 且回环访问时可用。CLI 只有在已获授权且具备合法平台会话时才能使用已有会话容器；不要借用旧 Muse 部署凭据。

`GET /api/bootstrap` 可公开读取应用状态，其中 `user` 可为 `null`。`models.image`、`models.video` 和 `integration` 是当前服务能力描述；它们不代表真实生成测试结果。不要直接访问上游账号列表、密钥、Cookie 或管理接口。

## 任务创建

```http
POST /api/jobs
Content-Type: application/json
Idempotency-Key: <唯一逻辑提交ID>
```

```json
{
  "projectId": "<平台项目ID>",
  "nodeId": "<已保存的画布节点ID>",
  "kind": "image",
  "prompt": "用户授权的生成提示词",
  "model": "<当前服务返回的图片模型ID>",
  "width": 1024,
  "height": 1024,
  "duration": 5,
  "referenceAssetIds": []
}
```

视频使用 `kind: "video"` 和服务支持的视频模型；图生视频的 `referenceAssetIds` 指向已经上传到平台的图片资产。图片任务不依赖 `duration`；以当前服务的字段校验为准。不要因某个通用参数存在就声称所有模型支持它。

返回 HTTP 202 和任务对象。相同幂等键、相同请求返回原任务；相同键与不同内容返回 409。409 后先确认意图，不把相同键用于不同提示词。

任务常见字段：`id,status,kind,model,projectId,nodeId,inputRevision,resultAssetId,resultUrl,error,createdAt,updatedAt`。

## 等待与失败

- `GET /api/jobs/{id}` 查询任务；`GET /api/jobs?projectId=...` 在断线后核对。
- `GET /api/events` 为已认证 SSE；监听 `job` 事件，并用任务 ID 过滤。
- 非终态包括 `queued,running,waiting_provider,cancel_requested`。
- `succeeded` 取结果资产；`failed,cancelled` 展示实际状态；`unknown_external` 表示外部执行结果尚无法确定，保留任务等待核实。
- 轮询建议从 2–5 秒起，按任务阶段退避，单次等待设置上限；达到上限后交回任务 ID，后续可继续查询同一任务。
- `POST /api/jobs/{id}/cancel` 请求尽力取消，不承诺已发生的上游工作一定取消。

## 素材和画布

`POST /api/assets` 使用 multipart：`file` 和可选 `projectId`；返回平台资产。受保护媒体地址形如 `/api/assets/{id}/content`，访问需要平台会话。

任务不会自动改写项目文档。应用流程：

1. `GET /api/projects/{id}` 获取最新 `{revision,document}`。
2. 按实际前端文档 schema 定位 `nodeId`，加入结果资产候选。保持原素材和其他节点。
3. 将选择后的内容以 `PUT /api/projects/{id}` 保存：`{baseRevision,title,document}`。
4. 发生 `REVISION_CONFLICT`／409 时重新读取并合并候选，不能用旧文档盲目覆盖。

初版项目文档是有大小边界的 JSON。具体节点属性由前端 schema 定义；本 skill 不发明 `candidateVersionId`、`apply-job` 等不存在的端点或字段。候选的核心关联由任务的 `projectId,nodeId,inputRevision,resultAssetId` 提供。

## 上游适配说明

平台服务端可配置本机 Muse 生成池 `http://127.0.0.1:18610`，以及服务端 API key。端口 3000 是 MuseCanvas Web，不是生成池 API。不要从浏览器绕过本项目后端直连生成池。

详见仓库 `context/research/2026-11-09-local-muse-integration.md`。该调研只验证协议与只读可用性，没有证明任何生成任务成功，也没有证明 5000 人同时生成的容量。

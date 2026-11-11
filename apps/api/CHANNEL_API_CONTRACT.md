# 个人生成渠道

所有接口要求登录，采用平台现有 Origin / X-Workbench-Request 校验。仅操作当前用户的渠道，跨用户资源返回 404。

| 接口 | 行为 |
|---|---|
| GET /api/channels | `{channels:[{id,name,baseUrl,apiFormat,enabled,hasKey,models}]}`，不含凭证 |
| GET /api/channels/models | `{models:[{id,name,channelId,model,capability,available,connected}]}`；当前用户的安全模型配置目录 |
| GET /api/models/text | `{models:[{id,name,available,...}]}`；当前用户可见的文本模型目录，供科普与画布连续分镜使用，包含Muse文本及个人文本渠道 |
| PUT /api/channels | 新建或修改；输入 `{id?,name,baseUrl,apiFormat:"openai"|"ark",enabled,apiKey?,models:[{name,capability}]}`，返回安全单条 |
| DELETE /api/channels/{id} | 删除本人渠道，已有素材保留，使用旧渠道的任务停止追踪 |
| POST /api/channels/{id}/models | 用已保存的服务端凭证读取协议对应的模型目录（OpenAI `/v1/models` 或 Ark `/api/v3/models`）；返回 `{models:[{name,capability,source,requiresConfirmation}]}`，不自动启用或持久化发现结果 |
| PUT /api/workspace/skill-favorites/{id} | 收藏目录中的 Skill，按当前用户持久化 |
| DELETE /api/workspace/skill-favorites/{id} | 取消收藏，与是否安装相互独立 |

每个用户最多20个渠道，每渠道最多100个模型。名称最长80字符，模型ID最长64字符，允许字母数字及 `._/-`，以字母或数字开头。Key 不回传；修改时留空保留原Key，切换服务域名必须重填。个人渠道仅允许HTTPS443公网地址；本机Muse仍通过管理员导入及账号池接入。

模型能力 `capability` 可保存为 `text`（科普与连续分镜文本规划）、`vision`（图像理解配置）、`image`（图像生成）、`video`（视频生成）。`vision` 目前仅保存配置，未接通画布图像理解调用，因此目录中 `connected=false`、`available=false`；不会混入文本规划或图像生成选择器。`GET /api/models/text` 只返回文本能力的安全目录。

发现接口会保留合法但不认识的模型 ID，其 `capability="unknown"`、`source="unknown"`，不会将未知模型当作文本模型，也不会直接丢弃。已配置能力优先于供应商元数据和名称建议。`source` 为 `configured`、`provider`、`name-hint` 或 `unknown`；只有 `configured` 返回 `requiresConfirmation=false`，其余均须用户核对后选择。名称建议不等同于服务能力验证。保存接口拒绝 `unknown`，浏览器应只提交已选择且已确认能力的模型。

主工作台可独立打开 `ModelSettings`，不要求项目或画布已加载。组件保存连接后获取模型，使用既有服务端凭证发起请求；新建或替换 Key 后即清空输入框。保存成功调用 `onChanged` 刷新 `/bootstrap` 及文本模型目录，弹层保持打开以继续调整。画布原生配置使用相同接口，保留其原有入口与能力。

模型目录中的ID为 `channel:<UUID>:<upstreamModel>`；调用 `/api/jobs` 时使用完整ID，不传Key。OpenAI 兼容图片使用 JSON `POST /v1/images/generations`，视频使用 multipart `POST /v1/videos`，轮询 `GET /v1/videos/{id}`。豆包 Ark 图片使用 JSON `POST /api/v3/images/generations`，Seedance 视频使用官方 JSON `POST /api/v3/contents/generations/tasks`，轮询同路径加任务 ID；任务完成后读取返回的媒体地址。地址已带 `/v1` 或 `/api/v3` 时不重复拼接。

生成接口支持文生图与文生视频，文本接口支持科普脚本与画布连续分镜规划；自建渠道不支持参考图、Gemini、自定义脚本、画布文本／图像理解生成和音频生成。模型尺寸和时长还需满足供应商约束。任务入队固定渠道ID及配置指纹，修改地址或密钥后不将旧任务改投新渠道。提交结果不确定时不会重放付费请求。取消只停止本地追踪，不能保证供应商停止计费。

远程API不跟随认证重定向；下载跨域资源不携带Key，拒绝非公网地址、非法媒体以及超过100MB的文件。生成结果经过素材类型检测和原子状态校验后成为候选素材，不覆盖较新的画布编辑。

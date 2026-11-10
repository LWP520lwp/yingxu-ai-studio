# 科普短视频自动制作接口

这套功能使用独立的科普草稿、版本与后台制作任务，不覆盖创意画布。默认由视频模型生成连续动态分镜与原生讲解，再拼接为成片。所有接口需要本人登录会话，写接口沿用现有同源变更请求头。

## 草稿契约

```json
{
  "schemaVersion": 1,
  "topic": "为什么天空呈蓝色",
  "title": "观察天空",
  "audience": "teen",
  "structure": "explain",
  "aspectRatio": "16:9",
  "models": {"text":"muse-service-spark","video":"muse-service-video"},
  "sources": [
    {"id":"source_1","title":"用户提供的资料标题","url":"https://example.org/source","excerpt":"用户提供的原文摘录"}
  ],
  "scenes": [
    {"id":"scene_1","role":"explain","narration":"用户核对后的简短讲稿。","visualPrompt":"可选参考图片描述","videoPrompt":"描述连续动作、过程变化与自然运镜。","sourceIds":["source_1"],"verified":false}
  ]
}
```

`audience` 支持 children/teen/general；`structure` 支持 misconception/experiment/explain；`role` 支持 hook/explain/experiment/question；画面比例支持 16:9、9:16、1:1。`assetId?` 是参考图片或历史画面，`videoAssetId?` 必须是真正的视频素材。素材须属于本人且不得跨项目使用；动态模式不会把图片作为成片分镜。

草稿可附带 `models: {text?: string, image?: string, video?: string}`，保存规划、参考图和动态视频的模型标识（最多120字符），不保存API凭据。旧草稿无需此字段。删除渠道后保留原选择并提示重新选择，实际执行校验本人渠道和模型能力。模型配置弹窗原位打开，不切换到画布。

草稿允许空主题、标题、来源字段及尚未写完的讲稿，方便自动保存；URL 作为不执行、不抓取的文本保存。制作时要求每幕讲稿非空、已关联来源、所用来源标题与摘录完整，并且 verified 为 true。网址可留空以引用本地教材/用户讲稿；填写时须为无账号密码的完整HTTP(S)网址，不联网验证它。该字段只代表创作者声明已核对，不表示机器认证了事实。计划接口无权设置它。

最多 12 条来源、6 幕。草稿每幕讲稿可保存400字符、合计1400字符以兼容旧稿；动态制作另要求每幕不超过 `min(45,videoDuration*3)` 字符，为自然停顿留出空间。15秒分镜最多45字。最终实际视频和来源片尾总时长不得超过180秒。

## 路由

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | /api/science/capabilities | 制作能力，见部署说明 |
| GET | /api/projects/{id}/science | `{revision,document,updatedAt?}`；初始 revision 0 |
| PUT | 同上 | `{baseRevision,document}` → 最新快照；冲突 409 `SCIENCE_REVISION_CONFLICT` + currentRevision |
| POST | /api/projects/{id}/science/plan | `{document,model?}` → `{document,source:'model'|'source',summary}`，不直接保存 |
| POST | /api/projects/{id}/science/runs | `{revision,productionMode?,videoModel?,videoDuration?,audioMode?,generateMissingVideos?}` → 202 任务记录 |
| GET | 同上 | `{runs:[...]}`，最近 30 条 |
| GET | /api/projects/{id}/science/runs/{runId} | 本人任务记录 |

文本规划支持Muse文本模型和已有自建渠道 `channel:<id>:<model>`。只使用提供的材料，优先规划4–6幕连续15秒视频，资料较少可更少，每幕讲稿最多45字，`videoPrompt` 描述动作、过程与运镜。天体、微观和机制画面须标明科学可视化示意，不冒充真实摄录或实验证据。返回结构不允许新造来源、核对状态或素材ID，全部 verified=false。未选文本模型时只拆分提供的文字，最多保留六幕，不从空主题编造知识。

`productionMode` 缺省为 `muse_video`，`audioMode` 为 `muse_native`，`videoDuration` 缺省15秒、范围5–20秒。缺失分幕视频时须显式 `generateMissingVideos:true` 才会使用模型额度，并选择 `videoModel`（可默认读取草稿 models.video）。已有视频全部绑定时不需要模型。固定豆包视频模型仅接受10秒、16:9横屏。实际创建 `kind:video` 任务并请求中文原生讲解；参考图仅指导生成，不替代动态视频。

原图文离线配音仅保留为显式 `productionMode:"image_narration"`，使用 `voiceId,generateMissingImages,imageModel?` 和 `audioMode:"offline_narration"`。声线来自当前部署发现结果，不固定假定Windows。图文模式不能冒充Muse原生动态视频。

## 状态与结果

任务记录含 id、revision、status、stage、error、createdAt、updatedAt，新增 productionMode、videoModel、videoDuration、audioMode、captionTiming、videoJobs（sceneId→jobId）、resolvedVideos（sceneId→assetId），以及可能为空的 resultAssetId/resultUrl、subtitleAssetId/subtitleUrl、narrationAssetId/narrationUrl、timeline。imageJobs、resolvedAssets保留为旧模式字段。原生模式不生成单独的离线旁白素材，narrationAssetId为空。

status 为 queued/running/waiting_videos/waiting_images/succeeded/failed；动态 stage 为 queued/generating_videos/waiting_videos/validating_videos/assembling/rendering/completed/failed。字幕与结果均为本人私有素材 URL；字幕下载名为 `.srt`、MIME 为 text/plain。timeline 为实际合成文档，可供检查；不提供独立手动剪辑工作台。

视频经ffprobe检查真实视频流、有效画面时长与原生音轨，按实际画面长度拼接并保留原声。音轨比画面长时，不用音轨时长补黑或冻结画面。缺原生音轨会明确失败并保留已取得视频，不静默替换TTS或图片轮播。音轨存在不代表中文旁白已逐字验收，仍需试听。所有科学内容分镜都是真正的视频，末尾另附4秒来源卡，最终输出H.264/AAC MP4。

动态字幕 `captionTiming:"scene"` 是按整幕区间生成的讲稿草稿，不是ASR转写或逐词对齐，必须对照模型发声及科学表述核对。旧离线模式 `captionTiming:"speech"` 根据每句实测配音时长累计，也不是字级强制对齐。

同一版本和制作参数的活跃/成功任务返回原记录；失败后再次点击制作才创建新任务。有效已完成片段按本人、项目、模型、完整提示词、时长、尺寸与参考图内容指纹缓存，在重试中复用，不跨用户或项目。单次制作幂等提交，外部状态不明时不自动重发。每人最多两个活跃制作任务；MySQL单例锁保证跨API实例最多一条科普制作正在执行。等待视频/图片超过24小时、执行租约超时会明确失败并保留素材。这不是5000人同时生成的吞吐保证。

## 部署

默认动态模式只需要可用的视频提供方与FFmpeg/ffprobe，不依赖离线TTS、不要求Windows。账号会话与密钥保留在服务端。能力接口除离线兼容字段ttsAvailable/voices/message外，提供renderAvailable、defaultProductionMode:"muse_video"、productionModes:["muse_video","image_narration"]、nativeAudioRequiresValidation:true、nativeCaptionTiming:"scene"。能力存在不表示当前提供方额度、人机验证或原声结果已经验收。

还需要带 libx264/AAC/libass 的 FFmpeg 与 ffprobe，默认 PATH，支持 FFMPEG_BIN/FFPROBE_BIN 或 app.ffmpeg-bin/app.ffprobe-bin。源材料无需 ASR；未来导入用户录音转写需另配中文 ASR 模型，此版没有假称已转写。

后台状态保存于Flyway V10的独立科普表，以及V16新增的视频设置和片段缓存。app.scheduler-enabled=false停止自动派发。新任务固定草稿快照，继续编辑不会改变已排队版本。临时文件按任务隔离并清理，讲稿和提示词不会作为shell源码执行，密钥沿用服务端渠道配置。

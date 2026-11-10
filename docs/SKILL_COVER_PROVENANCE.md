# Skill 封面来源记录

日期：2026-11-10（Asia/Shanghai）。本记录保留前一版三份真人风格 WebP 的历史来源；它们已退出当前 Skill 市场封面映射。当前封面见下方的新版本记录。

## 当前封面：按用途区分的12幅场景

根据用户对重复人物裁切和通用占位图的反馈，新版为11个内置技能及汽车导演导入技能分别配置独立场景，文件为 `apps/web/public/skill-covers/{skill-id}-v2.webp`。广告、角色三视图、雨夜运镜、粒子特效、动作编排、光学科普、绘本、空间、舞蹈动态、创意景观、分镜组图和汽车各有不同画面，不再共用原双人肖像。

这些场景实际通过已配置的 Muse 服务生成，非 `image_gen` 工具产物。共提交3个独立异步图像任务，每张原图包含4个不同场景；均为2048×1152 WebP，经目检后按实际场景边界分别裁切、缩放为12张960×540 WebP，当前合计624,102字节。第三张原图的左右分界高度不同，已按实际画面分别处理；分镜组图采用留边保留三个镜头。没有将一次生成的相同肖像裁成不同技能封面。

完整原图、提示词与裁切清单单独留存，不随源码分发。三组场景分别为：

- 第一组：产品广告、角色设计、电影运镜、电影特效。
- 第二组：打斗技巧、科普概念、绘本、空间。
- 第三组：图生视频、文生图、分镜、汽车导演。

人物均按虚构成年人设定生成；封面为创作示例，不代表相应技能已经生成同等视频或支持所有表现效果。个人导入的其他技能使用按名称与来源标识生成的本地题签，不再误用文生图封面，不自动产生新的模型请求。旧版原图和裁切文件保留供已有素材记录及历史核验使用。

## 历史封面

## 生成来源

三份封面均派生自**本项目实际通过 Muse 服务生成的一张图片**，不是 `image_gen` 工具的产物，也不是从参考网站下载的封面。生成经用户授权，于2026-11-10约21:04发出一次 `POST /v1/images/tasks`；取得任务ID后只轮询、下载同一任务，没有为三个封面分别生成三次。

请求参数为 `model=muse-image`、`n=1`、`size=1280x720`、`aspect_ratio=16:9`、`response_format=url`、`async=true`、`timeout=600`。**请求尺寸与真实输出不同**：实际文件为2048×1152的WebP、283,200字节；RIFF声明长度与文件长度一致。上游错误声明text/plain，按实际字节确认格式后保存。

人物设定是约25岁的虚构成年中国男女，没有提供真实肖像或名人身份。提示词明确要求原创人物、不近似名人或已知真人；此说明记录生成意图和来源，不表示已对所有现存人物做相似度检索。

历史原图 `original-skill-cover.webp` 已单独归档。原图由左侧成年男性、右侧成年女性的独立半身肖像组成，采用自然窗光、暖灰背景；原图目检无文字、标识或水印。

## 精确原始提示词

以下为实际提交的完整英文提示词，按生成代理保留的原文记录，没有补写成另一版提示词：

```text
Create an original photorealistic cinematic editorial diptych poster with two fictional young adult Chinese people, aged around 25. Left half: a Chinese man in a contemporary black jacket and white shirt, confident natural expression, half body portrait. Right half: a Chinese woman in a contemporary white jacket with black top, confident natural expression, half body portrait. Balanced independent portraits, clear gap at the center, soft natural window daylight, neutral warm grey studio background, tasteful premium photography, realistic skin texture, vertical portrait composition within each half. No fighting, no weapons. No text, no letters, no logos, no watermark. Both subjects must be invented and must not resemble any celebrity or real known person.
```

## 派生文件与使用位置

由同一原图在本地派生封面，复用人物和摄影风格；没有新增模型调用。下表像素、大小和SHA-256已直接读取当前文件核对；未记录未核实的裁切坐标或处理参数。

| 文件 | 实际尺寸 | 大小 | Skill 库使用 |
| --- | --- | --- | --- |
| `apps/web/public/skill-covers/realistic-cast.webp` | 1280×720 | 69,068字节 | `fight-video`、`image-to-video` |
| `apps/web/public/skill-covers/realistic-character.webp` | 960×600 | 26,338字节 | `character-sheet` |
| `apps/web/public/skill-covers/realistic-director.webp` | 960×600 | 26,154字节 | `cinema-camera` |

映射见 [skillMarketModel.ts](../apps/web/src/skillMarketModel.ts)。封面是 Skill 的视觉入口，不表示该 Skill 已生成视频或已复现封面人物一致性。

| 文件 | SHA-256 |
| --- | --- |
| 原图 `original-skill-cover.webp` | `99ff49301b522fde7a1c99d277bbf9eae6a459b6bc4a3acc0276523ecdf7272a` |
| `realistic-cast.webp` | `73a884e2d8d8316356e6a803cbbac8edc350d5141ca8ad9e77cd1cf1d32bbe6d` |
| `realistic-character.webp` | `bf692a467a76b1266ab79340edc4597f8ed8095c742879ecd7edd9a194ad4133` |
| `realistic-director.webp` | `4af3e9fd74da31b2f44fba262aa681098ee2f02c81b8ec91703fc90890350482` |

生成过程与显示核验记录单独归档。本记录不包含访问密钥、Cookie、账号身份或原始个人诊断内容。

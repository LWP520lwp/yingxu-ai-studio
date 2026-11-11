# 多模态 AI 创意工作台

公开仓库：<https://github.com/LWP520lwp/yingxu-ai-studio>

以可编辑 AI 画布组织资料、图片、视频和创作任务，逐步实现从素材到分镜与作品的完整工作流。当前仓库提供独立的 React Web 和 Java API，本地持久化使用 **MySQL＋Redis**。

从 GitHub 克隆后部署到自己的服务器，见 **[自托管部署指南](docs/SELF_HOSTING.md)**：提供生产 Dockerfile、同源 HTTPS 网关、MySQL/Redis 持久卷、随机配置初始化及 GitHub OAuth。GitHub Ubuntu CI 已验证生产镜像构建、空卷启动、登录和数据持久化，详见[发布验证](https://github.com/LWP520lwp/yingxu-ai-studio/actions/runs/42945444758)。GitHub Pages 无法运行本项目的后端与视频处理。生产镜像不包含作者的账号或密钥；真实生成需自备模型渠道与额度。

## 当前实现与边界

- 平台前端：React、TypeScript、Vite；创作画布是迁入的独立 React 子应用。API：Java 21、Spring Boot、Spring Security、JDBC、Flyway。
- MySQL 保存用户、项目、项目版本、素材与生成任务；Redis 用于会话、缓存及请求限流。服务不使用 H2 或内存数据代替 MySQL。
- 原生画布通过 `/api/projects/{id}/canvas-engine` 在 MySQL 保存完整 `CanvasProject` 快照，独立修订号用于并发冲突检查。原项目文档和修订号保留；节点、连线、分组、视口、聊天会话及扩展字段不转换成旧版画布结构。
- Skill 市场提供用途分类、搜索、收藏、详情、安装／移除和应用到画布；涵盖产品广告、角色设定、电影运镜、打斗技巧、电影特效、教育科普、绘本与空间概念。文字工具条、视频配置与 Agent 生成区均可选择视频 Skill，组合镜头文字与参考图；安装或准备不会自动提交生成。定义版本、个人安装及收藏关系保存在 MySQL，`storyboard-to-video@0.1.0` 仍为规划中。
- 首页分别管理画布草稿和科普短视频草稿，支持搜索、分页、新建及继续编辑；列表按对应文档的保存时间排序，返回首页不预加载创作工作区。
- 独立“科普短视频”模块支持资料摘录、逐幕来源关联、可编辑分镜与创作者核对。默认由 Muse 逐幕生成有实际运动的视频与原生中文讲解，再合成 H.264/AAC MP4；不会用静态图片轮播补齐缺失视频。没有原生音轨、视频时长不足或生成失败会明确报错并保留已生成素材。SRT 是按镜头编排的字幕草稿，尚未进行中文 ASR 或逐字对齐，需要核对。配置文本渠道后可由模型整理讲稿，没有渠道时只整理已有资料。旧 `image_narration` 接口保留离线配音兼容，不是默认制作方式。最多6幕，成片上限180秒；真实生成需要部署者或用户自己的模型额度。
- 设置入口统一打开创作配置中心：生成渠道、默认模型/偏好、提示词来源、WebDAV 与本地数据。可按用户添加自己的 OpenAI 兼容公网 HTTPS 渠道，Key 仅加密保存在服务端；接入 `/images/generations` 和异步 `/videos`，暂不支持自建渠道参考图及 Gemini。配置导出不含 API Key 和 WebDAV 密码。画布中的信息按钮打开“关于映序”。
- 左侧头像菜单可进入 Skill 市场、我的账号池、设置或退出。部署启用账号池后，每位登录用户均可添加及管理自己的 Muse／豆包网页账号；跨用户管理请求返回 404。面板提供来源与状态筛选、搜索、可调度／忙碌／待处理统计，豆包国内账号有独立接入、登录及检测入口。特殊本地 Muse 服务凭据由部署管理员导入并加密保存，所有者可主动共享此服务通道的调用额度；其他用户只看到共享可调度／忙碌数量，看不到凭据或账号信息。豆包真实生成适配尚未完成。
- 公开平台由部署者配置一个 GitHub OAuth App，访客直接使用各自的 GitHub 账号登录，无需自建 OAuth App。首次登录自动建立独立平台账号，项目、素材和 Skill 安装归各账号所有；本地开发登录仅作回环调试，生产环境不开放。
- 支持部署者单独启用私有评审账号：随机口令只写入仓库之外的受限文件，服务端仅保存 PBKDF2 哈希。评审身份具备普通创作权限，无管理员权限；关闭或更换凭据后旧会话失效，配置方式见 [自托管部署](docs/SELF_HOSTING.md)。
- 模型服务地址、密钥和能力发现由服务端配置。未配置或不可用的能力应如实显示，不把固定演示结果当成真实生成。
- 画布图片／视频生成通过平台 RPC 进入现有任务接口和账号池；文本与音频生成功能尚未接通，音频上传和播放保留。画布 UI 可操作、模型目录可读取不代表真实 AI 生成已经验收。
- 生成任务通过持久状态和有界执行器处理，结果作为新的候选素材，不直接覆盖较新的画布编辑；项目保存采用版本检查。
- 本地素材保存在专属磁盘目录，访问经过 API 会话授权。画布与科普制作使用独立 MySQL 文档及修订号；科普真实视频合成已实现。对象存储直传、CDN、多实例任务分发与跨实例事件广播仍需后续实现及验证。
- **尚未完成 5000 人并发压测。** 5000 在线用户、5000 持久连接、1000 次/秒业务请求和 5000 个同时执行的生成任务是不同指标，不能相互替代。

详细接口见 [平台 API](apps/api/API_CONTRACT.md)、[账号池](apps/api/POOL_API_CONTRACT.md)、[个人渠道](apps/api/CHANNEL_API_CONTRACT.md) 和 [科普制作](apps/api/SCIENCE_VIDEO_API_CONTRACT.md)。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 画布源码迁移与构建

画布的 React Web 源码从 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的固定版本 [9cd3deacbcc598361807afc16c059a80dd18b6f9](https://github.com/basketikun/infinite-canvas/tree/9cd3deacbcc598361807afc16c059a80dd18b6f9) 迁入 `apps/canvas-engine`，保留上游 MIT 许可，并在此基础上适配平台项目、素材、模型目录、生成任务和保存协议。上游版权为 `Copyright (c) 2026 basketikun`；完整许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [apps/canvas-engine/LICENSE](apps/canvas-engine/LICENSE)。项目中唯一运行的画布源码为 `apps/canvas-engine`。

子应用由 Vite 构建到 `apps/web/public/canvas-engine`，平台以同源 `/canvas-engine/index.html` iframe 加载。两侧使用检查窗口来源、origin 和项目 scope 的 `postMessage` RPC；平台负责会话、上传、任务与 MySQL 快照，子应用不保存提供方密钥。子应用的 React、样式和状态保持独立，部署时须一同提供 `/canvas-engine/` 静态资源及平台 `/api/`。

迁入原生节点、圆点连线、框内文字、悬浮工具条、分组、素材/提示词面板、小地图与图片裁剪等功能，并补充本地 Muse 定制版的整理布局和多视频合成预览。整理布局保留组内相对位置；合成节点支持按顺序播放、上下排序、入出点、逐段音量，可导出包含真实素材、编排 JSON 和离线播放器的 ZIP，当前不渲染单个 MP4、不混合 BGM。原版独立 Codex/Claude Agent 会话入口由平台 Skill 市场替代。

在仓库根目录安装和构建全部前端：

```powershell
npm.cmd ci
# 先构建画布子应用，再构建平台 Web；最终产物为 apps/web/dist。
npm.cmd run build

# 仅刷新开发服务器使用的画布静态资源。
npm.cmd run build:canvas
```

画布构建产物由源码重新生成，已加入 Git 忽略。开发期间修改 `apps/canvas-engine` 后需运行 `build:canvas` 并刷新页面；`apps/web` 的 Vite 开发服务器不会直接编译子应用源码。

## Windows 本机启动

本机预览可直接双击根目录的 **[一键启动.cmd](一键启动.cmd)**，完成后自动打开 <http://localhost:5178/>。启动器复用健康服务，并补启动缺失的服务；详细步骤与日志位置见 **[启动说明.md](启动说明.md)**。以下脚本供手动配置与维护使用。

脚本仅设置其自身及子进程的环境，不修改全局 PATH 或 JAVA_HOME，不修改已安装的数据库服务。数据、日志和 portable Java 都在 E 盘专属目录。

默认端口：

| 服务 | 地址 |
|---|---|
| Web | `http://localhost:5178` |
| API | `http://localhost:8088/api/bootstrap` |
| 独立 MySQL | `127.0.0.1:3308`，数据库 `workbench` |
| 独立 Redis | `127.0.0.1:6381` |

8081、5173 的已有本机进程不会被修改或停止。

在仓库根目录的 PowerShell 中运行：

```powershell
# 首次安装官方 Temurin 21 portable，下载与 SHA256 校验均在 E 盘进行。
.\scripts\install-java.ps1

# 初始化并启动专属 MySQL/Redis；首次创建带随机凭据的 .env.local。
.\scripts\start-infra.ps1

# 构建后端与画布子应用、在仓库根安装缺失的 workspace 依赖，并隐藏窗口启动两端。
.\scripts\start-dev.ps1
```

已经完成后端打包时可以使用：

```powershell
.\scripts\start-dev.ps1 -SkipBuild

# 同时启动本机浏览器 worker；默认仅启动 API/Web。
.\scripts\start-dev.ps1 -SkipBuild -WithBrowserWorker

# 其他端口须同时调整 GitHub OAuth 回调配置。
.\scripts\start-dev.ps1 -ApiPort 8090 -FrontendPort 5180

# Windows 会锁定正在运行的 jar；仅重建/重启 API，保持前端和基础设施。
.\scripts\restart-api.ps1
# 已在 API 停止后完成打包时：
.\scripts\restart-api.ps1 -SkipBuild

# 只停止本脚本记录、且 PID/可执行文件/启动时间仍匹配的应用进程。
.\scripts\stop-dev.ps1

# 也停止独立记录的本机浏览器 worker。
.\scripts\stop-dev.ps1 -WithBrowserWorker
```

`start-dev.ps1` 每次启动前都会运行 `build:canvas`，确保静态画布资源存在且对应当前源码；`-SkipBuild` 只跳过 Maven 后端打包。画布构建失败时不会启动 API/Web。脚本发现目标端口已占用会退出，不停止已有服务。

日志目录为 `E:/codex/runtime/creative-workbench/logs`。MySQL 数据目录为该 runtime 下的 `mysql/data`，Redis 数据位于 `redis/`。`.env.local` 和含凭据配置文件设有本机受限 ACL，不提交 Git；不要在报错截图或日志中输出其内容。

前端通过 npm workspaces 管理，统一使用根 `package-lock.json` 与根 `node_modules`；不要在 `apps/web` 单独运行安装或创建第二份 lockfile。启动脚本优先读取根目录的 Vite，兼容依赖位于 workspace 内的安装布局。Vite 的 API 代理使用 `VITE_API_TARGET`，脚本会按实际 API 端口设置它，例如 `http://127.0.0.1:8088`。

本机脚本默认复用现有的 MySQL 8.0.31 和 Windows Redis 3.2.100 二进制，但使用独立端口与数据目录。**Windows Redis 仅用于这次本机开发兼容性验证；生产环境应使用受维护的 Linux Redis。** Java 是官方 Temurin 21.0.13+9，固定包 SHA256 在安装脚本中校验。

如更换机器，先参照 `.env.example` 调整 `MYSQL_BASEDIR`、`REDIS_SERVER`、`MAVEN_CMD` 和专属 runtime 路径。脚本不会扫描或读取其他项目的环境文件。

## 模型服务、账号池与 GitHub 登录

在 `.env.local` 设置需要的配置，重启 API：

```dotenv
MUSE_BASE_URL=http://127.0.0.1:18610
MUSE_API_KEY=
MUSE_LOCAL_KEY_ENABLED=false
MUSE_LOCAL_POOL_URL=http://127.0.0.1:18610
MUSE_MEDIA_ALLOWED_HOSTS=
POOL_OVERVIEW_ENABLED=
POOL_OVERVIEW_OWNER_IDS=
BROWSER_WORKER_URL=http://127.0.0.1:8091
BROWSER_WORKER_TOKEN=
BROWSER_INTERACTIVE_LOGIN_ENABLED=false
POOL_CREDENTIAL_MASTER_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=
```

`GITHUB_CLIENT_ID` 与 `GITHUB_CLIENT_SECRET` 是**平台部署者**在 GitHub 一次注册 OAuth App 后填写的服务端配置，不是每个访客需要提供的配置。平台按 GitHub 稳定数字 ID 绑定账号；改昵称或 GitHub 用户名后仍使用原平台账号，不按昵称或邮箱合并不同用户。登录仅获取公开身份资料，不请求私有邮箱、仓库或其他额外权限，也不保留 GitHub access token。

GitHub OAuth 开发回调默认使用 `http://localhost:${APP_PORT}/login/oauth2/code/github`（默认端口 8088），也可显式填写 `GITHUB_REDIRECT_URI`，必须与 GitHub OAuth App 注册值一致。登录入口和回调都使用这个固定来源，不根据 Vite 代理的 Host 推导；本机前端统一从 `http://localhost:5178` 打开，以保持会话 Cookie 的主机一致。生产环境使用 `APP_PROFILE=prod`、公开的 HTTPS `FRONTEND_URL`、同源反向代理及 `SESSION_COOKIE_SECURE=true`，并将 `GITHUB_REDIRECT_URI` 固定为该公开来源下的 `/login/oauth2/code/github`；回调不接受凭据、query 或 fragment。OAuth App 的 client secret 和模型提供方凭据只放在后端环境；不要添加到以 `VITE_` 开头的变量中。实际支持的模型和调用协议以集成实现及提供方当前能力为准。

生成结果下载默认仅允许模型服务自身来源。若提供方返回外部 CDN 地址，应在 `MUSE_MEDIA_ALLOWED_HOSTS` 中填写经核实的精确主机名，以逗号分隔；不支持通配符，外部地址仅接受 HTTPS 443，并拒绝非公开地址。配置为空时不会自动信任任意返回的下载链接。真实生成与 CDN 允许列表仍需凭实际提供方配置联调，未配置时不能声称已完成生成验证。

原安装的 `scripts/Manage.ps1` 曾生成本机中转服务的 `poolKey`；它不是 Muse 或豆包官方 API Key，也不会替用户取得供应商凭据。新项目不创建或轮换原安装的 Key。Muse 与豆包网页会话由本机 browser worker 的独立持久浏览器配置管理，用户须在可见窗口完成登录与验证。worker 的安装和启动方式见 [apps/browser-worker/README.md](apps/browser-worker/README.md)；可在其所属桌面会话运行 `start-browser-worker.ps1`，或向 `start-dev.ps1` 显式传入 `-WithBrowserWorker`。API 与 worker 必须使用同一个随机 `BROWSER_WORKER_TOKEN`，worker 绑定 `127.0.0.1`，不能通过公网反向代理暴露。`BROWSER_INTERACTIVE_LOGIN_ENABLED` 默认关闭，仅在专用桌面会话及本机管理访问已配置后显式启用。

账号池允许已登录用户查看自己的 Muse／豆包登录状态、创建网页账号、检查/关闭浏览器窗口及停用账号。账号停用会保留数据库记录和磁盘 profile。提供的状态只表示 worker 所见的浏览器界面，不保证账号额度或实际生成可用；当前 Doubao 生图/生视频通道不可用。远程访问会打开部署机器上的浏览器窗口，自托管者应在可操作该桌面的环境中完成网页登录。

模型目录来自本机账号池，而非读取旧版服务的 `/v1/models`：`muse-image`、`muse-video` 使用已检查的 Muse 网页账号；`muse-service-image`、`muse-service-video` 使用已导入的 Muse 服务密钥；`doubao-image`、`doubao-video` 暂时标为不可用。网页登录路线目前把尺寸和时长作为任务元数据传递，尚未验证网页控件会按要求生效。参考图和任务提交仍由服务端校验；没有实际账号联调时，不应宣称已验证真实生成。

如需使用特殊 Muse 服务密钥路线，必须设置独立的 Base64 编码 32 字节 `POOL_CREDENTIAL_MASTER_KEY`。若要从本机 MuseProvider 导入已有密钥，还需显式启用 `MUSE_LOCAL_KEY_ENABLED=true`，并将 `MUSE_LOCAL_POOL_URL` 设置为与 `MUSE_BASE_URL` 相同的字面回环来源；导入后数据库只保存 AES-GCM 密文。妥善备份主密钥，丢失或更换后现有密文无法解密。不要把此密钥或 worker bearer token 放进 `VITE_` 变量。

`POOL_OVERVIEW_ENABLED` 留空时跟随开发 profile；生产默认关闭，部署者显式设为 `true` 后，每位登录用户都可管理自己的账号。只有“从宿主导入本地 Muse 服务凭据”要求回环访问及本机开发身份、`POOL_OVERVIEW_OWNER_IDS` 授权或 `ROLE_ADMIN`；此授权不限制个人账号 CRUD。旧版无所有者的账号只迁给明确的本机开发身份，不归首次访问的 GitHub 用户。服务账号默认私有，所有者主动开启共享后才向其他登录用户提供调用；撤回共享立即阻止其他用户继续租用或轮询此通道。计数来自数据库账号状态，不代表真实剩余额度、并发数或生成成功，密钥始终保存在服务端。

## Docker 基础设施替代方案

`compose.yaml` 提供 MySQL 8.4 与 Linux Redis 7.4 的独立卷、健康检查和仅回环端口映射；RabbitMQ 使用可选 `workers` profile。它是基础设施启动配置，**当前不等于已经实现生产集群或 RabbitMQ 消费者**。

先在 `.env.local` 设置强随机凭据，再运行：

```powershell
docker compose --env-file .env.local up -d

# 后续开发消息队列 worker 时启用。
docker compose --env-file .env.local --profile workers up -d
```

Docker 与本机独立服务默认使用相同端口，不能同时启动；切换前需要有计划地停止自己启动的对应服务或修改端口。MySQL 8.0 本机 datadir 不可直接挂到 MySQL 8.4 容器，应使用逻辑备份/恢复迁移。Redis 镜像版本与开源许可证应按最终分发方式重新核对。

## 验证与容量验收

2026-11-11 本机三轮回归的基线为 `f625abc`；后续修复提交 `ae4011b` 在独立 GitHub Ubuntu 环境完成验证，公开结果见 [GitHub Actions](https://github.com/LWP520lwp/yingxu-ai-studio/actions/runs/42945444758)。

| 项目 | 已确认结果 |
|---|---|
| 本机前端回归 | 三轮各99项通过；画布类型检查与生产构建通过 |
| 浏览器 worker | 三轮各11项通过 |
| 部署初始化脚本 | 三轮各7项通过 |
| 本机后端第三轮 | 报告218项，0失败、0错误，2项按运行条件跳过 |
| 独立 Ubuntu CI | Web、API、containers 三个任务全部成功；API 使用真实 MySQL 8.4＋Redis 7.4 |
| 生产容器验证 | 两个镜像构建、中文音频/字体/FFmpeg 检查、空卷启动、经 Nginx 的评审登录、Redis会话、MySQL保存与版本冲突、退出登录通过 |

编排包先点击“导出编排包 ZIP”打包，再点击真实“下载编排包 ZIP”链接；修改编排会使旧链接失效。打包内容已自动化解包核验，但当前内嵌浏览器工具不支持 iframe 内 Blob 下载，未确认实际下载落盘。

本机 Muse 动态视频与原声链路已另行验证；CI 不消费模型额度，不承担供应商生成质量验收。上述检查不包含公网域名的 Caddy TLS、真实 GitHub OAuth 回调或5000人并发压测。其他部署仍需使用自己的账号核对模型能力、讲解内容与音画质量；接口可达、模型发现与健康状态不替代这些检查。

常规验证：

```powershell
. .\scripts\common.ps1
Import-WorkbenchEnvironment
Push-Location .\apps\api
& $env:MAVEN_CMD test
Pop-Location

# 在仓库根依次构建画布与平台 Web。
npm.cmd run build
```

专属开发实例已运行时，可在仓库根执行接口验收：

```powershell
node.exe scripts/smoke-test.mjs
```

该脚本仅供这套独立的本机开发实例使用，检查回环地址与开发登录开关，**不要用于生产环境**。每次会保留一个“工作台接口验收”项目及 PNG 素材供检查，结束时移除仅由本次临时新增的 Skill 安装并退出测试会话。它检查会话、目录与安装、项目修订冲突、上传回读、流量池聚合、豆包无效参数拦截和 SSE 就绪事件；不会提交真实生成。最近结果写入 `context/verification/latest-smoke.json`。

5000 人目标必须在生产构建和明确硬件上单独验收，至少包含：

1. 5000 独立用户身份、真实规模项目/素材元数据，记录数据量与缓存冷热状态。
2. 在线与业务请求分开建模；独立测试持久事件连接及断线重连，避免只压公开的 bootstrap 接口。
3. 读项目、保存画布、提交任务、读取进度的混合负载；保存应检查版本冲突，不用同一个项目和会话代替所有用户。
4. 生成任务队列、供应商配额、任务恢复、重复投递及局部修改正确性单独验证；不能用接受请求速度代表生成完成速度。
5. 记录吞吐、p95/p99、错误率、MySQL 连接数/慢查询、Redis 延迟、队列等待时间、CPU、内存和带宽，并做持续负载与故障恢复测试。

开发服务器、当前本地磁盘素材服务和单实例任务执行器不能直接视为已经通过上述验收。

# 自托管部署

这套部署运行完整 Web、Java API、MySQL、Redis 和 FFmpeg，科普制作默认使用 Muse 生成的动态视频和原声。平台启动不依赖作者电脑的 `localhost:3000`、Muse 会话或私人密钥；实际 AI 生成需要自备模型渠道和额度。GitHub 用来保存代码；**GitHub Pages 不能运行 Java、MySQL、Redis 或视频处理进程**，应把仓库部署到自己的 Linux 服务器或支持 Docker Compose 的主机。

## 准备

- Docker Engine 24+ 与 Docker Compose v2；首次构建需要联网访问官方镜像、npm、Maven、Ubuntu 软件源。
- 自己的公开域名，DNS 指向服务器，公网80/443端口可达。部署包含 Caddy 自动申请/续期 HTTPS 证书。已有网关的用户可复用相同 Web/API 镜像，但需保留同源 `/api`、`/oauth2`、`/login` 及 SSE 流式代理。
- Node.js22+ 仅用于生成首次部署配置；不会启动另一个应用服务。
- 建议从4核、8GB内存开始验证本地视频处理；实际容量由素材、媒体时长、模型配额与并发设置决定，本配置不等于5000人并发认证。

## 首次启动

在克隆后的仓库根目录执行，把域名替换成自己的：

```sh
node scripts/init-deployment.mjs --origin https://studio.example.com
```

脚本创建 **`.env.production.local`**，为数据库用户、数据库root、Redis和凭据加密各生成独立随机值；Linux权限为600，Windows使用当前用户/SYSTEM/Administrators受限ACL。文件已由 `.env.*.local` 规则忽略。脚本不会打印密钥、覆盖现有文件或轮换正在使用的加密主密钥。

在 GitHub → Settings → Developer settings → OAuth Apps 注册一个由**部署者**管理的 OAuth App：

| GitHub 表单 | 填写内容 |
| --- | --- |
| Homepage URL | `https://studio.example.com` |
| Authorization callback URL | `https://studio.example.com/login/oauth2/code/github` |

把该应用的 Client ID 和新生成的 Client Secret 填入 `.env.production.local` 的 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`。它们不是访客的个人访问令牌。每一位访客随后直接使用各自的 GitHub 账号登录，**不用各自注册 OAuth App**。本平台只取公开身份，不请求访客仓库权限，也不保留GitHub access token。

### 私有评审入口

可另外创建一个只向评委提供的普通创作账号，也可以在尚未配置 GitHub OAuth 的封闭评审部署中单独使用。仓库没有默认评审口令，不提供公开注册。凭据文件必须放在仓库之外：

```sh
node scripts/init-reviewer.mjs --env-file .env.production.local --credentials-file /private/yingshu/reviewer.txt
```

Windows 本机预览改用 `--env-file .env.local --credentials-file E:/私密评审资料/reviewer.txt`。脚本生成随机用户名、36字符随机密码及600000次 PBKDF2-SHA256 哈希；环境文件只存哈希，独立凭据文件保存账号密码并限制文件权限。命令只显示文件路径。现有配置或凭据文件不会被覆盖。`.env` 中的哈希保留脚本写入的单引号，避免 Compose 把 `$` 当作插值。

登录页在部署启用此身份后显示评审入口；它没有管理员权限。错误验证受 Redis 限流，累计5次失败暂停15分钟；改动或清空配置后重启 API，会撤销旧评审会话。账号密码、报名材料和演示附件应独立保管，不放进仓库、镜像或公开 Issue。生产环境至少需要配置 GitHub OAuth 或有效的私有评审身份之一。

配置完成后一条命令启动：

```sh
docker compose --env-file .env.production.local -f compose.production.yaml up -d --build
```

然后访问配置的HTTPS域名。首次构建会先构建画布和Web，再构建Java及原生媒体环境。缺少必填数据库、认证或加密配置时，Compose或API入口会明确拒绝启动。

可以只检查配置；使用 `--quiet` 避免把解析后的密钥输出到终端：

```sh
docker compose --env-file .env.production.local -f compose.production.yaml config --quiet
docker compose --env-file .env.production.local -f compose.production.yaml ps
```

## 部署后可用的能力

- 独立画布与科普草稿、项目素材、Skill、GitHub登录和账号隔离。
- 科普制作默认使用 `muse_video`：按分镜调用所选 Muse 视频模型，要求真实运动和原生中文讲解，校验音轨与时长后合成 H.264/AAC MP4；也可以绑定本人已有的合格视频。缺少视频或原声时明确失败，保留已完成的生成结果供重试复用。
- 动态视频的 SRT 是依据镜头时段和讲稿生成的字幕草稿，需对照实际语音核对；当前没有 ASR 转写、逐字强制对齐或机器事实认证。创作者需要核对资料、画面科学性和原生旁白内容。
- 旧 `image_narration` API 保留图文配音兼容。仅该模式使用 Windows 慧慧或 Linux **eSpeak NG“中文 · 本地基础音色”**，后者音色偏机械；`SCIENCE_TTS_PROVIDER` 支持 `auto`、`sapi`、`espeak`，`SCIENCE_ESPEAK_BIN` 可指定路径。它不替代默认 Muse 视频与原声，也不自动下载声音模型。
- 图片/视频/文本大模型需要部署者或登录用户在配置中心接入自己的兼容渠道及API Key。仓库和镜像**不带作者账号的额度、Cookie或供应商凭据**。没有模型配置时，登录、草稿、画布与已有素材管理仍可运行；AI 生成会显示未配置。没有文本模型时可以整理已有讲稿，不从空主题编造科学结论。

个人生成渠道的Key只加密存于API端MySQL，前端构建不读取 `.env.production.local`。镜像构建上下文通过 `.dockerignore` 排除全部环境文件、权重、运行数据和本机产物。

网页账号池的交互登录依赖可操作的专用桌面浏览器，并不是普通无桌面Linux容器能完成的功能。本Compose默认关闭浏览器交互账号池，不开放浏览器worker公网端口；如需自托管网页账号会话，请按照 `apps/browser-worker/README.md` 部署独立私有worker，并由本人完成登录。账号池界面出现或会话登录成功不等于供应商生成已可用。

## 数据、更新与运维

| 持久卷 | 内容 |
| --- | --- |
| `mysql-data` | 用户、草稿、版本、任务、字幕结果、加密凭据 |
| `redis-data` | 会话和缓存 |
| `media` | 私有图片、音视频、字幕及临时媒体处理目录 |
| `caddy-data` / `caddy-config` | TLS证书与网关状态 |

数据库、Redis、API和Web均未映射宿主公网端口，公网只有网关80/443。数据库网络为内部网络；API使用UID10001、只读根文件系统和单独可写媒体卷。Nginx为哈希资源设置长缓存、HTML不缓存，支持101MB请求体、120秒长请求，SSE禁用缓冲并保持连接。上传流式转发，Java multipart临时文件放在媒体卷的专用目录，大媒体响应禁用代理磁盘缓存，避免100MB素材挤满容器的小型临时内存盘。

`APP_SSE_MAX_CONNECTIONS` 默认10000，`APP_SSE_MAX_CONNECTIONS_PER_USER` 默认8；超过事件连接上限时返回429。这是资源保护阈值，实际可承载人数仍须在目标服务器压测。MySQL迁移回调在每个新迁移前比对数据库默认排序规则与已有 `app_user.id`，必要时只调整数据库默认值，避免新空库在 V8/V14 创建外键时因排序规则不同而失败；它不转换已有表，也不改动历史迁移校验和。数据库账号需要该数据库的常规建表、迁移和 ALTER 权限。

更新前备份MySQL、媒体卷、加密主密钥及OAuth配置；加密主密钥丢失后，旧服务凭据不能解密。保留原配置文件，拉取代码后重新运行同一条 `up -d --build`。Flyway自动校验/迁移数据库，失败时不要删除已有数据库规避错误。

停止服务可用 `docker compose --env-file .env.production.local -f compose.production.yaml stop`。日常升级不要加 `down -v`，该选项会移除持久卷。排错时检查服务健康状态和本机日志，不把 `.env.production.local`、会话或供应商Key贴到公开Issue。

## 可复现检查与当前验证边界

- `node --test scripts/init-deployment.test.mjs scripts/init-reviewer.test.mjs`：验证域名约束、独立随机密钥、私有评审密码哈希、受限文件与不覆盖已有配置；已在本机Windows执行通过。
- `.github/workflows/ci.yml`：前端测试/完整构建、MySQL8.4+Redis7.4真实后端测试、Ubuntu eSpeak中文配音集成测试，以及两个生产镜像构建。API镜像build会实际生成中文WAV，并用FFmpeg/ffprobe和已安装中文字体完成中文字幕H.264样片检查。容器任务还从空卷启动生产配置，经 Nginx 验证画布静态资源、关闭开发登录、私有评审登录、Redis会话、MySQL项目保存与版本冲突、退出登录。该冷启动检查只绑定 CI 回环端口，不运行公网 Caddy TLS，也不消费模型额度。
- 后续修复提交 `ae4011b` 的 [GitHub Ubuntu CI](https://github.com/dgasdasd/yingxu-ai-studio/actions/runs/42863488976) 已全部成功：Web、API、containers 三个任务通过，包含真实 MySQL 8.4＋Redis 7.4 后端测试、两个生产镜像构建、原生媒体检查、空卷启动及经 Nginx 的私有评审登录与持久化验证。本机三轮回归基线为 `f625abc`：前端每轮99项、浏览器 worker 每轮11项、部署脚本每轮7项通过；后端第三轮报告218项，0失败、0错误，2项按运行条件跳过。
- 本机 Muse 动态视频与原声链路已单独验证；CI 不消费模型额度。CI通过不代表已验证公网域名的 Caddy TLS、真实 GitHub OAuth 回调、供应商生成质量或5000人并发。其他部署须使用自己的账号核对模型能力、讲解内容与音画质量。
- 本仓库保留第三方许可证及声明；分发或修改时应遵循根目录及各组件的许可证。

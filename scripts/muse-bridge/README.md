# 本机 Muse 的私有连接

当 Muse 只提供 Windows 运行包时，可将现有本机服务连接到 Linux 网站。桌面代理仅监听回环地址，SSH 使用独立受限账号将请求通过远端 Unix socket 送到桌面。Node.js sidecar 与 API 共用网络命名空间，仅在 API 容器内的 `127.0.0.1:18610` 接收请求。无需新增公网生成端口。

桌面、Muse 服务和连接进程必须保持运行。此连接不等于 Muse 已独立部署到 Linux；电脑休眠、断网或退出后暂时不能生成。监督进程会自动重连，重连不会自动重新提交生成任务。

`run.mjs` 从仓库外私有 JSON 配置读取独立 bridge token、SSH 密钥路径、已核验的 known_hosts 路径、服务器及 socket。不得提交配置或密钥。配置字段：`token`、`upstreamBase`、`advertisedBase`、`listenPort`、`identityFile`、`knownHostsFile`、`remoteHost`、`remoteUser`、`remoteSocket`，可选 `sshExecutable`、`pidFile`。

```sh
node scripts/muse-bridge/run.mjs /private/bridge.json
node --test scripts/muse-bridge/relay.test.mjs
```

云端使用独立 bridge token，真实 Muse 密钥仅在本机从受信任回环接口读取。代理仅转发模型目录、文本、图像及视频生成、任务查询、媒体下载、精简额度查询。管理、Cookie、密钥、账号登录、更新及任意 URL 请求均不开放。额度结果去除账号身份、原始网页文字和服务配置。未设置 CORS，也不向网页下发凭据。

SSH 使用独立的无 shell 用户，禁用 PTY、agent 和本地转发，并使用预先核验的主机密钥。Ubuntu OpenSSH 的远端 Unix socket 也会检查转发许可；可设 `AllowTcpForwarding remote`、`AllowStreamLocalForwarding remote`，再用 `PermitListen 127.0.0.1:18611` 将 TCP 监听严格限定在一个回环端口，实际桥接仍使用 Unix socket。不要开放任意地址或公网监听。

socket 目录应归专用用户所有，权限 `0700`，并设 `StreamLocalBindMask 0177`、`StreamLocalBindUnlink yes`。sidecar 必须以该用户的 UID/GID 运行，挂载 socket 目录后不发布宿主端口，配置内存、进程和日志上限。仅以 root 运行并删除全部 capabilities 时，并不能访问其他用户的私有目录。API 继续使用登录校验、加密服务账号、共享开关及任务调度限额。

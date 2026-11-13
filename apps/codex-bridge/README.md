# Codex 画布连接

这是映序自有的本机连接服务，通过官方 Codex app-server 的 JSONL 协议读取登录状态、模型列表及结构化画布方案。它不包含 Codex 的实现代码。

## 启动

需要 Node.js 22.12 以上和可用的 Codex CLI。先在终端执行 `codex login`，再从项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File apps/codex-bridge/start.ps1
```

终端会显示地址和一次性会话令牌。在画布顶部打开 **Codex**，填写地址和令牌，点击“连接并读取模型”。选择本机账号可用的模型后，输入创作要求。Codex 返回节点及连接方案，点击“确认加入画布”才会修改草稿。规划本身使用所选 Codex 账号的额度；连接检查不会发起生成。

服务仅监听 `127.0.0.1`，默认端口 `4599`。默认允许的页面来源是 `http://localhost:5178`。如果使用其他本机端口，在启动前设置：

```powershell
$env:CODEX_BRIDGE_ORIGINS = 'http://localhost:5178,http://localhost:3000'
$env:CODEX_BRIDGE_PORT = '4599'
```

若可执行文件不在 PATH 中，可设置 `CODEX_BIN` 为实际 `codex.exe` 路径，再运行 `node apps/codex-bridge/src/server.mjs`。启动脚本会自动使用 `Get-Command` 找到的版本。停止服务后令牌失效；不要把该令牌或 Codex 登录资料上传到仓库。浏览器仅将本次连接资料保存在 sessionStorage 中。

## 工作边界

- 只发送节点标题、文本节点内容、提示词和节点关系，媒体内容、存储密钥和配置凭据不会进入画布上下文。常见令牌格式会在发送前脱敏。
- 每次请求使用空临时工作目录与临时线程，要求只读沙箱、禁止网络、关闭 shell、补丁、Web 搜索、应用及已配置的 MCP 服务。服务端权限请求一律拒绝。各 Codex 版本的功能开关和企业策略可能不同；这不是独立的操作系统隔离容器，不能用于运行不受信任的任意代码。
- 方案只能新增限定类型的节点和新节点之间的连接，不能返回删除操作、任意元数据、素材地址或可执行命令。
- 只新增文字和生成配置，图片及视频需在画布中另外确认生成。
- 一次只允许一个连接检查或规划请求。停止、关面板、换项目会取消请求并回收子进程，不自动重试收费生成。
- 该桥接服务应在每位使用者自己的电脑上运行，不应共享部署者的 Codex 登录会话。公网 HTTPS 页面访问本机 HTTP 服务还受浏览器的本地网络权限约束；若浏览器不允许，请在本机工作台使用此功能。

协议文档：<https://developers.openai.com/codex/app-server/>

## 检查

```powershell
node --test apps/codex-bridge/test/*.test.mjs
```

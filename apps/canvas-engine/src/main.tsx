import { waitForPlatformInit } from "./platform/rpc";
import type { DocumentSession } from "./platform/document";

function setStartupStatus(root: HTMLElement, message: string) {
  root.setAttribute("aria-busy", "true");
  root.dataset.startup = "loading";
  root.textContent = message;
  root.style.cssText = "min-height:100vh;padding:32px;color:#dbe7f2;background:#101923;font:14px system-ui;display:grid;place-items:center";
}

function showStartupFailure(root: HTMLElement, error: unknown) {
  root.replaceChildren();
  root.removeAttribute("aria-busy");
  root.dataset.startup = "error";
  root.style.cssText = "min-height:100vh;padding:32px;color:#dbe7f2;background:#101923;font:14px system-ui;display:grid;place-items:center";

  const content = document.createElement("section");
  content.setAttribute("role", "alert");
  content.style.cssText = "width:min(100%,520px);display:grid;gap:12px";
  const title = document.createElement("h1");
  title.textContent = "画布暂时无法启动";
  title.style.cssText = "margin:0;font-size:20px;font-weight:600";
  const detail = document.createElement("p");
  detail.textContent = error instanceof Error ? error.message : "画布启动失败，请检查工作台连接后重试。";
  detail.style.cssText = "margin:0;color:#aebdca;line-height:1.6;overflow-wrap:anywhere";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "重试连接";
  retry.style.cssText = "justify-self:start;padding:8px 14px;border:1px solid #456075;border-radius:6px;color:#e6f1f7;background:#1a2a38;cursor:pointer";
  retry.addEventListener("click", () => { void bootCanvas(root); }, { once: true });
  content.append(title, detail, retry);
  root.append(content);
}

async function bootCanvas(root: HTMLElement) {
  let session: DocumentSession | null = null;
  try {
    setStartupStatus(root, "正在连接创作工作台…");
    const init = await waitForPlatformInit();

    setStartupStatus(root, "正在恢复画布文档…");
    const { initializePlatformDocument } = await import("./platform/document");
    session = await initializePlatformDocument(init);

    setStartupStatus(root, "正在加载模型与账号配置…");
    const { initializePlatformConfig } = await import("./stores/use-config-store");
    await initializePlatformConfig(init);

    setStartupStatus(root, "正在打开画布…");
    const { mountCanvas } = await import("./platform/mount");
    mountCanvas(init, session);
    root.removeAttribute("aria-busy");
    root.dataset.startup = "ready";
  } catch (error) {
    session?.dispose();
    showStartupFailure(root, error);
  }
}

const root = document.getElementById("root");
if (root) void bootCanvas(root);

import { waitForPlatformInit } from "./platform/rpc";

async function start() {
    const init = await waitForPlatformInit();
    const { initializePlatformDocument } = await import("./platform/document");
    const session = await initializePlatformDocument(init);
    const { initializePlatformConfig } = await import("./stores/use-config-store");
    await initializePlatformConfig(init);
    const { mountCanvas } = await import("./platform/mount");
    mountCanvas(init, session);
}
void start().catch((error) => {
    const root = document.getElementById("root");
    if (root) {
        root.textContent = error instanceof Error ? error.message : "画布加载失败，请重新打开项目。";
        root.style.cssText = "padding:32px;color:#eee;background:#191919;height:100vh;font:14px system-ui";
    }
});

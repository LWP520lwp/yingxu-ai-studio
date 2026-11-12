import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "../styles/globals.css";
import "../i18n";
import { AppProviders } from "../components/layout/app-providers";
import CanvasProjectPage from "../pages/canvas/project";
import { notifyPlatformStatus, type PlatformInit } from "./rpc";
import { useDocumentSyncState } from "./document";
import { openPlatformAction, platformActionForPath } from "./navigation";
import { decodeHostCommand, FlushRequestLedger } from "./host-command-controller";

type DocumentSession = { flush: () => Promise<boolean>; retry: () => Promise<boolean>; dispose: () => void; projectId: string };
function SyncStatus({ session }: { session: DocumentSession }) {
    const state = useDocumentSyncState();
    return <div className="absolute bottom-1 right-3 z-[80] flex items-center gap-2 rounded px-2 py-1 text-[11px]" style={{ background: "var(--background)", color: state.phase === "error" || state.phase === "conflict" ? "#e9b59b" : "var(--muted-foreground)" }} role="status">
        {state.message}{state.phase === "error" && <button onClick={() => void session.retry()}>重试保存</button>}
    </div>;
}
export function mountCanvas(init: PlatformInit, session: DocumentSession) {
    document.body.style.fontFamily = '"PingFang SC","Microsoft YaHei",sans-serif';
    const router = createMemoryRouter([{ path: "/canvas/:id", element: <><CanvasProjectPage /><SyncStatus session={session} /></> }, { path: "*", element: null }], { initialEntries: [`/canvas/${init.project.id}`] });
    createRoot(document.getElementById("root")!).render(<AppProviders><RouterProvider router={router} /></AppProviders>);
    let active = true;
    let flushing: Promise<boolean> | null = null;
    const commitEditor = () => flushSync(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    const capture = () => {
        const detail = { projectId: init.project.id, captured: false };
        window.dispatchEvent(new CustomEvent("frameflow:capture-document", { detail }));
        return detail.captured;
    };
    const flush = (): Promise<boolean> => {
        if (!active) return Promise.resolve(false);
        if (flushing) return flushing;
        flushing = (async () => {
            // Commit a focused editor before synchronously capturing nodes and the debounced viewport.
            commitEditor();
            if (!capture()) {
                useDocumentSyncState.setState({ phase: "error", message: "画布编辑区尚未就绪，请等待加载完成后再保存" });
                return false;
            }
            return session.flush();
        })().finally(() => { flushing = null; });
        return flushing;
    };
    const flushRequests = new FlushRequestLedger();
    const receiveCommand = (event: MessageEvent) => {
        const command = decodeHostCommand(event, { parent, origin: window.location.origin, scopeId: init.scopeId });
        if (!command) return;
        if (command.command === "flush") {
            const requestId = command.requestId;
            const request = flushRequests.run(requestId, flush);
            void request.then((saved) => {
                if (!active || !requestId) return;
                parent.postMessage({ type: "frameflow:command-response", scopeId: init.scopeId, id: requestId, command: "flush", ok: saved,
                    result: { saved }, error: saved ? undefined : { message: useDocumentSyncState.getState().message || "画布尚未保存，请检查同步状态" } }, window.location.origin);
            }).catch((error) => {
                if (!active || !requestId) return;
                const message = error instanceof Error ? error.message : "画布保存失败，请检查同步状态";
                useDocumentSyncState.setState({ phase: "error", message });
                parent.postMessage({ type: "frameflow:command-response", scopeId: init.scopeId, id: requestId, command: "flush", ok: false, result: { saved: false }, error: { message } }, window.location.origin);
            });
        }
        if (command.command === "export") void import("../lib/canvas/canvas-export").then(async ({ exportCanvasProjects }) => {
            const { useCanvasStore } = await import("../stores/canvas/use-canvas-store");
            const project = useCanvasStore.getState().openProject(init.project.id);
            if (project) await exportCanvasProjects([project], project.title);
        }).catch((error) => notifyPlatformStatus(error instanceof Error ? error.message : "导出失败，请重试"));
        if (command.command === "upload") document.querySelector<HTMLInputElement>('input[type="file"]')?.click();
    };
    window.addEventListener("message", receiveCommand);
    window.addEventListener("pagehide", () => {
        commitEditor();
        capture();
        active = false;
        flushRequests.clear();
        window.removeEventListener("message", receiveCommand);
        session.dispose();
    }, { once: true });
    void router.subscribe((state) => {
        const action = platformActionForPath(state.location.pathname, init.project.id);
        if (!action) return;
        void router.navigate(`/canvas/${init.project.id}`, { replace: true });
        void openPlatformAction(action).catch((error) => notifyPlatformStatus(error instanceof Error ? error.message : "页面暂时无法打开，请重试"));
    });
}

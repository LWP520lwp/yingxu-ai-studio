import { platformRequest } from "./rpc";

export type PlatformAction = "home" | "projects" | "newProject" | "skills" | "pool" | "settings";

export async function openPlatformAction(action: PlatformAction) {
    await platformRequest("platform.action", { action });
}

/** Embedded routes belong to the host; the iframe keeps its one active canvas. */
export function platformActionForPath(pathname: string, projectId: string): PlatformAction | null {
    const path = pathname.replace(/\/+$/, "") || "/";
    if (path === `/canvas/${projectId}`) return null;
    if (path === "/") return "home";
    if (path === "/skills") return "skills";
    if (path === "/pool") return "pool";
    if (path === "/settings" || path === "/config") return "settings";
    return "projects";
}

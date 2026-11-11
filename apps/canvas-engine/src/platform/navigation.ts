import { platformRequest } from "./rpc";

export type PlatformAction = "home" | "projects" | "newProject" | "skills" | "pool" | "settings";

const ACTIONS = new Set<PlatformAction>(["home", "projects", "newProject", "skills", "pool", "settings"]);

/** Ask the host to switch workspace context without navigating the iframe. */
export async function openPlatformAction(action: PlatformAction) {
    if (!ACTIONS.has(action)) throw new Error("此画布入口尚未接入工作台");
    await platformRequest("platform.action", { action });
}

/** The host owns routes; the embedded editor only keeps its active project. */
export function platformActionForPath(pathname: string, projectId: string): PlatformAction | null {
    const path = pathname.replace(/\/+$/, "") || "/";
    const exact: Record<string, PlatformAction> = { "/": "home", "/skills": "skills", "/pool": "pool", "/settings": "settings", "/config": "settings" };
    if (path === `/canvas/${projectId}`) return null;
    return exact[path] || "projects";
}

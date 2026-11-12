import { PLUGIN_REGISTRY_URL } from "@/constant/env";

// An official registry item whose entry has been resolved to an absolute URL.
export type OfficialPluginEntry = {
    id: string;
    name: string;
    version: string;
    description?: string;
    icon?: string;
    url: string;
};

type RawEntry = { id?: string; name?: string; version?: string; description?: string; icon?: string; entry?: string; url?: string };
type RawManifest = { plugins?: RawEntry[] };

// Fetch the official registry and resolve relative entries against its URL for the existing URL installation flow.
export async function fetchOfficialPlugins(registryUrl: string = PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {
    const manifestUrl = toHttpUrl(registryUrl);
    if (!manifestUrl) throw new Error(i18n.t("canvas.pluginErrors.registryFailed", { status: "invalid URL" }));
    const response = await fetch(manifestUrl, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(i18n.t("canvas.pluginErrors.registryFailed", { status: response.status }));
    let data: RawManifest;
    try {
        data = (await response.json()) as RawManifest;
    } catch {
        throw new Error(i18n.t("canvas.pluginErrors.registryFailed", { status: "invalid JSON" }));
    }
    const list = Array.isArray(data?.plugins) ? data.plugins : [];
    const byId = new Map<string, OfficialPluginEntry>();
    for (const item of list) {
        if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
        const id = item.id.trim();
        if (!id || byId.has(id)) continue;
        const rawUrl = typeof item.url === "string" && item.url.trim() ? item.url : item.entry;
        if (typeof rawUrl !== "string" || !rawUrl.trim()) continue;
        const url = toHttpUrl(rawUrl, manifestUrl);
        if (!url) continue;
        byId.set(id, {
            id,
            name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : id,
            version: typeof item.version === "string" && item.version.trim() ? item.version.trim() : "0.0.0",
            description: typeof item.description === "string" ? item.description : undefined,
            icon: typeof item.icon === "string" ? item.icon : undefined,
            url,
        });
    }
    return [...byId.values()];
}

function toHttpUrl(value: string, base?: string): string | null {
    try {
        const url = base ? new URL(value, base) : new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
        return null;
    }
}

// Compare semantic versions: positive means a is newer, negative means b is newer, and zero means equal.
// Compare numeric major.minor.patch components only and ignore non-numeric parts such as prerelease labels.
function compareSemver(a: string, b: string): number {
    const parse = (v: string) => v.split(".").map((part) => parseInt(part, 10) || 0);
    const [pa, pb] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

// Return whether the remote version is newer than the installed version.
export function hasUpgrade(installedVersion: string, remoteVersion: string): boolean {
    return compareSemver(remoteVersion, installedVersion) > 0;
}
import i18n from "@/i18n";

import type { OfficialPluginEntry } from "./official-registry";

export type CatalogPhase = "idle" | "loading" | "ready" | "failed";

export type PluginCatalogSession = {
  phase: CatalogPhase;
  revision: number;
  entries: OfficialPluginEntry[];
  error: string | null;
};

export type PluginCatalogEvent =
  | { type: "refresh"; revision: number }
  | { type: "loaded"; revision: number; entries: OfficialPluginEntry[] }
  | { type: "failed"; revision: number; error: string }
  | { type: "closed" };

export const initialPluginCatalogSession: PluginCatalogSession = {
  phase: "idle",
  revision: 0,
  entries: [],
  error: null,
};

export function reducePluginCatalogSession(
  session: PluginCatalogSession,
  event: PluginCatalogEvent,
): PluginCatalogSession {
  switch (event.type) {
    case "refresh":
      if (event.revision <= session.revision) return session;
      return {
        ...session,
        phase: "loading",
        revision: event.revision,
        error: null,
      };
    case "loaded":
      if (event.revision !== session.revision) return session;
      return {
        ...session,
        phase: "ready",
        entries: event.entries,
        error: null,
      };
    case "failed":
      if (event.revision !== session.revision) return session;
      return { ...session, phase: "failed", error: event.error };
    case "closed":
      return {
        ...session,
        phase: session.entries.length ? "ready" : "idle",
        revision: session.revision + 1,
        error: null,
      };
  }
}

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;

export type CanvasNodeViewMode = "list" | "grid";

export type CanvasSidePanelLifecycle = {
  panelOpen: boolean;
  panelMounted: boolean;
  panelClosing: boolean;
};

export type CanvasSidePanelEvent = "open" | "close" | "finish-close";
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function createCanvasSidePanelLifecycle(open: boolean): CanvasSidePanelLifecycle {
  return { panelOpen: open, panelMounted: open, panelClosing: false };
}

export function transitionCanvasSidePanel(
  state: CanvasSidePanelLifecycle,
  event: CanvasSidePanelEvent,
): CanvasSidePanelLifecycle {
  if (event === "open") {
    if (state.panelOpen && state.panelMounted && !state.panelClosing) return state;
    return { panelOpen: true, panelMounted: true, panelClosing: false };
  }

  if (event === "close") {
    if (!state.panelMounted || state.panelClosing) return state;
    return { panelOpen: false, panelMounted: true, panelClosing: true };
  }

  if (!state.panelClosing || state.panelOpen) return state;
  return { panelOpen: false, panelMounted: false, panelClosing: false };
}

export function clampCanvasSidePanelWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
  return Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, value));
}

export function normalizeCanvasNodeViewMode(value: unknown): CanvasNodeViewMode {
  return value === "grid" ? "grid" : "list";
}

export function readCanvasSidePanelPreference(storage: PreferenceStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeCanvasSidePanelPreference(storage: PreferenceStorage | null, key: string, value: string): boolean {
  try {
    storage?.setItem(key, value);
    return Boolean(storage);
  } catch {
    return false;
  }
}

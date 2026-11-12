import { create } from "zustand";

import {
  CANVAS_SIDE_PANEL_DEFAULT_WIDTH,
  CANVAS_SIDE_PANEL_MAX_WIDTH,
  CANVAS_SIDE_PANEL_MIN_WIDTH,
  CANVAS_SIDE_PANEL_MOTION_MS,
  clampCanvasSidePanelWidth,
  createCanvasSidePanelLifecycle,
  normalizeCanvasNodeViewMode,
  readCanvasSidePanelPreference,
  transitionCanvasSidePanel,
  writeCanvasSidePanelPreference,
  type CanvasNodeViewMode,
} from "@/lib/canvas/canvas-side-panel-state";

export {
  CANVAS_SIDE_PANEL_DEFAULT_WIDTH,
  CANVAS_SIDE_PANEL_MAX_WIDTH,
  CANVAS_SIDE_PANEL_MIN_WIDTH,
  CANVAS_SIDE_PANEL_MOTION_MS,
};
export type { CanvasNodeViewMode };
export type CanvasSidePanelTab = "canvas" | "assets" | "prompts";

const WIDTH_KEY = "canvas-side-panel-width";
const OPEN_KEY = "canvas-side-panel-open";
const NODE_VIEW_KEY = "canvas-side-panel-node-view";

let closeTimer: ReturnType<typeof setTimeout> | null = null;
let closeGeneration = 0;

type CanvasSidePanelStore = ReturnType<
  typeof createCanvasSidePanelLifecycle
> & {
  width: number;
  nodeViewMode: CanvasNodeViewMode;
  activeTab: CanvasSidePanelTab;
  setWidth: (width: number) => void;
  setNodeViewMode: (mode: CanvasNodeViewMode) => void;
  setActiveTab: (tab: CanvasSidePanelTab) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
};

function preferenceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function storedValue(key: string) {
  return readCanvasSidePanelPreference(preferenceStorage(), key);
}

function initialWidth() {
  const stored = storedValue(WIDTH_KEY);
  if (stored === null) return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
  const value = Number(stored);
  return Number.isFinite(value)
    ? clampCanvasSidePanelWidth(value)
    : CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
}

function initialOpen() {
  return storedValue(OPEN_KEY) !== "0";
}

function initialNodeView() {
  return normalizeCanvasNodeViewMode(storedValue(NODE_VIEW_KEY));
}

function cancelCloseTimer() {
  closeGeneration += 1;
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = null;
  return closeGeneration;
}

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>(
  (set, get) => ({
    ...createCanvasSidePanelLifecycle(initialOpen()),
    width: initialWidth(),
    nodeViewMode: initialNodeView(),
    activeTab: "canvas",
    setWidth: (width) => set({ width: clampCanvasSidePanelWidth(width) }),
    setActiveTab: (activeTab) => set({ activeTab }),
    setNodeViewMode: (mode) => {
      const nextMode = normalizeCanvasNodeViewMode(mode);
      writeCanvasSidePanelPreference(
        preferenceStorage(),
        NODE_VIEW_KEY,
        nextMode,
      );
      set({ nodeViewMode: nextMode });
    },
    openPanel: () => {
      cancelCloseTimer();
      writeCanvasSidePanelPreference(preferenceStorage(), OPEN_KEY, "1");
      set((state) => transitionCanvasSidePanel(state, "open"));
    },
    closePanel: () => {
      const state = get();
      const closing = transitionCanvasSidePanel(state, "close");
      if (closing === state) return;

      const generation = cancelCloseTimer();
      writeCanvasSidePanelPreference(preferenceStorage(), OPEN_KEY, "0");
      set(closing);
      closeTimer = setTimeout(() => {
        if (generation !== closeGeneration) return;
        closeTimer = null;
        set((current) => transitionCanvasSidePanel(current, "finish-close"));
      }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () =>
      get().panelOpen ? get().closePanel() : get().openPanel(),
  }),
);

export type AtlasPanelId = "canvas" | "assets" | "prompts";

export type AtlasTopBarIcon =
  | "home"
  | "projects"
  | "create"
  | "canvas"
  | "assets"
  | "prompts"
  | "import"
  | "export"
  | "shortcuts";

export type AtlasTopBarAction =
  | "home"
  | "projects"
  | "create"
  | "panel-canvas"
  | "panel-assets"
  | "panel-prompts"
  | "import"
  | "export"
  | "shortcuts";

export type AtlasPanelTab = {
  id: AtlasPanelId;
  icon: AtlasTopBarIcon;
  labelKey: string;
};

export type AtlasMenuEntry = {
  id: string;
  icon: AtlasTopBarIcon;
  labelKey: string;
  action: AtlasTopBarAction;
};

export const atlasPanelTabs: readonly AtlasPanelTab[] = [
  { id: "canvas", icon: "canvas", labelKey: "canvas.sidePanel.canvas" },
  { id: "assets", icon: "assets", labelKey: "canvas.sidePanel.assets" },
  { id: "prompts", icon: "prompts", labelKey: "canvas.sidePanel.prompts" },
];

const navigationActions: readonly AtlasMenuEntry[] = [
  { id: "home", icon: "home", labelKey: "canvas.home", action: "home" },
  { id: "projects", icon: "projects", labelKey: "canvas.projects", action: "projects" },
  { id: "create", icon: "create", labelKey: "canvas.create", action: "create" },
];

const panelActions: readonly AtlasMenuEntry[] = atlasPanelTabs.map((tab) => ({
  id: `panel-${tab.id}`,
  icon: tab.icon,
  labelKey: tab.labelKey,
  action: `panel-${tab.id}` as AtlasTopBarAction,
}));

const utilityActions: readonly AtlasMenuEntry[] = [
  { id: "import", icon: "import", labelKey: "canvas.importAsset", action: "import" },
  { id: "export", icon: "export", labelKey: "canvas.exportCurrent", action: "export" },
  { id: "shortcuts", icon: "shortcuts", labelKey: "canvas.shortcuts", action: "shortcuts" },
];

export const atlasTopBarMenuGroups: readonly (readonly AtlasMenuEntry[])[] = [
  navigationActions,
  panelActions,
  utilityActions,
];

export function atlasTopBarActionIds() {
  return atlasTopBarMenuGroups.flatMap((group) => group.map(({ id }) => id));
}

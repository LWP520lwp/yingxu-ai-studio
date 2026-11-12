export type CanvasTopBarPanel = "canvas" | "assets" | "prompts";

export type CanvasTopBarIcon =
  | "home"
  | "projects"
  | "create"
  | "canvas"
  | "assets"
  | "prompts"
  | "import"
  | "export"
  | "shortcuts";

export type CanvasTopBarCommand =
  | "home"
  | "projects"
  | "create"
  | "panel-canvas"
  | "panel-assets"
  | "panel-prompts"
  | "import"
  | "export"
  | "shortcuts";

export interface CanvasTopBarPanelTab {
  id: CanvasTopBarPanel;
  icon: CanvasTopBarIcon;
  labelKey: string;
}

export interface CanvasTopBarMenuItem {
  id: string;
  icon: CanvasTopBarIcon;
  labelKey: string;
  command: CanvasTopBarCommand;
}

export const canvasTopBarPanelTabs: readonly CanvasTopBarPanelTab[] = [
  { id: "canvas", icon: "canvas", labelKey: "canvas.sidePanel.canvas" },
  { id: "assets", icon: "assets", labelKey: "canvas.sidePanel.assets" },
  { id: "prompts", icon: "prompts", labelKey: "canvas.sidePanel.prompts" },
];

export const canvasTopBarMenuGroups: readonly (readonly CanvasTopBarMenuItem[])[] =
  [
    [
      { id: "home", icon: "home", labelKey: "canvas.home", command: "home" },
      {
        id: "projects",
        icon: "projects",
        labelKey: "canvas.projects",
        command: "projects",
      },
      {
        id: "create",
        icon: "create",
        labelKey: "canvas.create",
        command: "create",
      },
    ],
    canvasTopBarPanelTabs.map(({ id, icon, labelKey }) => ({
      id: `panel-${id}`,
      icon,
      labelKey,
      command: `panel-${id}` as CanvasTopBarCommand,
    })),
    [
      {
        id: "import",
        icon: "import",
        labelKey: "canvas.importAsset",
        command: "import",
      },
      {
        id: "export",
        icon: "export",
        labelKey: "canvas.exportCurrent",
        command: "export",
      },
      {
        id: "shortcuts",
        icon: "shortcuts",
        labelKey: "canvas.shortcuts",
        command: "shortcuts",
      },
    ],
  ];

export function canvasTopBarMenuActionIds() {
  return canvasTopBarMenuGroups.flatMap((group) => group.map(({ id }) => id));
}

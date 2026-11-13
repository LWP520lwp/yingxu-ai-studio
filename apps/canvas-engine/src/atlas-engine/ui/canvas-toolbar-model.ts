export type CanvasToolbarCommand =
  | "pan"
  | "undo"
  | "redo"
  | "focus"
  | "tidy"
  | "audit"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "config"
  | "group"
  | "extensions"
  | "upload"
  | "appearance"
  | "delete"
  | "clear";

export type CanvasToolbarSection = {
  id: "workflow" | "create" | "project";
  commands: Array<{ id: CanvasToolbarCommand; disabled?: boolean }>;
};

export function toggleCanvasTool(current: "select" | "pan") {
  return current === "pan" ? "select" : "pan";
}

export function canvasToolbarSections(input: {
  canUndo: boolean;
  canRedo: boolean;
  extensionCount: number;
  selectedCount: number;
}): CanvasToolbarSection[] {
  const workflow: CanvasToolbarSection["commands"] = [
    { id: "pan" },
    { id: "undo", disabled: !input.canUndo },
    { id: "redo", disabled: !input.canRedo },
    { id: "focus", disabled: input.selectedCount === 0 },
    { id: "tidy" },
    { id: "audit" },
  ];
  const create: CanvasToolbarSection["commands"] = [
    { id: "text" },
    { id: "image" },
    { id: "video" },
    { id: "audio" },
    { id: "config" },
    { id: "group" },
  ];
  if (input.extensionCount > 0) create.push({ id: "extensions" });

  const project: CanvasToolbarSection["commands"] = [
    { id: "upload" },
    { id: "appearance" },
  ];
  if (input.selectedCount > 0) project.push({ id: "delete" });
  project.push({ id: "clear" });

  return [
    { id: "workflow", commands: workflow },
    { id: "create", commands: create },
    { id: "project", commands: project },
  ];
}

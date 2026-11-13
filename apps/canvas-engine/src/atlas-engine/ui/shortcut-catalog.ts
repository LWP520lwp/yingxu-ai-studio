export type CanvasShortcutEntry = {
  id: string;
  keys: string[];
  description: string;
};

export function canvasShortcutCatalog(translate: (key: string) => string): CanvasShortcutEntry[] {
  return [
    { id: "pan", keys: [translate("canvas.shortcut.dragCanvas")], description: translate("canvas.shortcut.pan") },
    { id: "zoom", keys: [translate("canvas.shortcut.wheel")], description: translate("canvas.shortcut.zoom") },
    { id: "zoom-precise", keys: [translate("canvas.shortcut.zoomSlider")], description: translate("canvas.shortcut.preciseZoom") },
    { id: "box-select", keys: ["Shift", translate("canvas.shortcut.drag")], description: translate("canvas.shortcut.boxSelect") },
    { id: "extend-selection", keys: ["Shift / Ctrl / Cmd", translate("canvas.shortcut.click")], description: translate("canvas.shortcut.addSelection") },
    { id: "select-all", keys: ["Ctrl / Cmd", "A"], description: translate("canvas.shortcut.selectAll") },
    { id: "copy-paste", keys: ["Ctrl / Cmd", "C / V"], description: translate("canvas.shortcut.copyPaste") },
    { id: "group", keys: ["Ctrl / Cmd", "G"], description: translate("canvas.shortcut.group") },
    { id: "ungroup", keys: ["Ctrl / Cmd", "Shift", "G"], description: translate("canvas.shortcut.ungroup") },
    { id: "undo", keys: ["Ctrl / Cmd", "Z"], description: translate("canvas.undo") },
    { id: "redo-shift", keys: ["Ctrl / Cmd", "Shift", "Z"], description: translate("canvas.redo") },
    { id: "redo-y", keys: ["Ctrl / Cmd", "Y"], description: translate("canvas.redo") },
    { id: "delete", keys: ["Delete / Backspace"], description: translate("canvas.shortcut.delete") },
    { id: "escape", keys: ["Esc"], description: translate("canvas.shortcut.escape") },
    { id: "upload", keys: [translate("canvas.shortcut.dropMedia")], description: translate("canvas.shortcut.upload") },
  ];
}

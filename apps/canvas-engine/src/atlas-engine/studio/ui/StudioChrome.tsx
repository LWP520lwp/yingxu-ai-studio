import { useEffect, useRef, useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import {
  ArrowLeft,
  AudioLines,
  Check,
  CircleHelp,
  Code2,
  Copy,
  Download,
  FolderOpen,
  Frame,
  Fullscreen,
  Grid2X2,
  Hand,
  ImagePlus,
  Layers3,
  Map,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Settings2,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Upload,
  Video,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStudioCopy, type StudioCopyKey } from "./copy";
import "./studio.css";

export type StudioChromeProps = {
  title: string;
  onRename: (value: string) => void;
  children: ReactNode;
  tool: "select" | "pan";
  onTool: (tool: "select" | "pan") => void;
  onCreate: (type: string) => void;
  onCommand: (command: string) => void;
  undo: boolean;
  redo: boolean;
  nodeCount: number;
  selectedCount: number;
  scale: number;
  background: "lines" | "dots" | "none";
  onBackground: (value: "lines" | "dots" | "none") => void;
  onScale: (value: number) => void;
  notice: string;
  inspector?: ReactNode;
  codexOpen: boolean;
  onCodex: () => void;
};

type ToolButtonProps = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
};
function ToolButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  className,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      className={cn("studio-icon-button", active && "is-active", className)}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}

const creationTools: {
  type: string;
  label: StudioCopyKey;
  icon: LucideIcon;
}[] = [
  { type: "text", label: "text", icon: Type },
  { type: "image", label: "image", icon: ImagePlus },
  { type: "video", label: "video", icon: Video },
  { type: "audio", label: "audio", icon: AudioLines },
  { type: "config", label: "config", icon: Sparkles },
  { type: "group", label: "group", icon: Frame },
];
const documentCommands: {
  command: string;
  label: StudioCopyKey;
  icon: LucideIcon;
}[] = [
  { command: "tidy", label: "tidy", icon: Grid2X2 },
  { command: "group", label: "group", icon: Layers3 },
  { command: "ungroup", label: "ungroup", icon: Ungroup },
  { command: "duplicate", label: "duplicate", icon: Copy },
  { command: "audit", label: "audit", icon: Workflow },
  { command: "language", label: "language", icon: CircleHelp },
  { command: "theme", label: "theme", icon: Wrench },
];

export function StudioChrome(props: StudioChromeProps) {
  const c = useStudioCopy();
  const [name, setName] = useState(props.title);
  const [inspectorVisible, setInspectorVisible] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 850,
  );
  const cancelRename = useRef(false);
  useEffect(() => setName(props.title), [props.title]);
  const commitName = () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      setName(props.title);
      return;
    }
    const value = name.trim();
    if (value && value !== props.title) props.onRename(value);
    setName(value || props.title);
  };
  const zoom = (value: number) =>
    props.onScale(Math.min(3, Math.max(0.1, value)));
  return (
    <main className="studio-workspace" data-studio-workspace>
      <header className="studio-project-bar">
        <div className="studio-project-identity">
          <ToolButton
            label={c.home}
            icon={ArrowLeft}
            onClick={() => props.onCommand("home")}
          />
          <div className="studio-project-mark" aria-hidden="true">
            <Layers3 size={19} strokeWidth={1.7} />
          </div>
          <div className="studio-project-caption">
            <span className="studio-eyebrow">{c.workspace}</span>
            <input
              className="studio-project-title"
              value={name}
              aria-label={c.projectName}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  cancelRename.current = true;
                  setName(props.title);
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        </div>
        <div
          className="studio-project-commands"
          role="toolbar"
          aria-label={c.projectActions}
        >
          <div className="studio-history-pair">
            <ToolButton
              label={c.undo}
              icon={Undo2}
              onClick={() => props.onCommand("undo")}
              disabled={!props.undo}
            />
            <ToolButton
              label={c.redo}
              icon={Redo2}
              onClick={() => props.onCommand("redo")}
              disabled={!props.redo}
            />
          </div>
          <button
            type="button"
            className={cn(
              "studio-codex-button",
              props.codexOpen && "is-active",
            )}
            onClick={props.onCodex}
            aria-pressed={props.codexOpen}
            title={c.codexHint}
          >
            <Code2 size={17} strokeWidth={1.7} aria-hidden="true" />
            <span>{c.codex}</span>
            <span className="studio-codex-dot" aria-hidden="true" />
          </button>
          <ToolButton
            label={c.settings}
            icon={Settings2}
            onClick={() => props.onCommand("settings")}
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="studio-icon-button"
                type="button"
                aria-label={c.more}
                title={c.more}
              >
                <MoreHorizontal size={19} strokeWidth={1.7} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="studio-command-menu"
                align="end"
                sideOffset={8}
                collisionPadding={12}
              >
                <DropdownMenu.Label className="studio-menu-label">
                  {c.workspace}
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={props.background}
                  onValueChange={(value) => {
                    if (value === "lines" || value === "dots" || value === "none")
                      props.onBackground(value);
                  }}
                  aria-label={c.background}
                >
                  {(["lines", "dots", "none"] as const).map((value) => (
                    <DropdownMenu.RadioItem
                      key={value}
                      value={value}
                      className="studio-menu-item"
                    >
                      <span aria-hidden="true" style={{ width: 16 }}>
                        {props.background === value ? <Check size={16} /> : null}
                      </span>
                      <span>{c[value]}</span>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator className="studio-menu-separator" />
                <DropdownMenu.Item
                  className="studio-menu-item"
                  onSelect={() => props.onCommand("merge")}
                >
                  <Video size={16} />
                  <span>
                    {c.video} · {c.group}
                  </span>
                </DropdownMenu.Item>
                {documentCommands.map(({ command, label, icon: Icon }) => (
                  <DropdownMenu.Item
                    key={command}
                    className="studio-menu-item"
                    onSelect={() => props.onCommand(command)}
                  >
                    <Icon size={16} strokeWidth={1.7} />
                    <span>{c[label]}</span>
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator className="studio-menu-separator" />
                <DropdownMenu.Item
                  className="studio-menu-item studio-danger"
                  onSelect={() => props.onCommand("clear")}
                >
                  <Trash2 size={16} />
                  {c.clear}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            type="button"
            className="studio-export-button"
            onClick={() => props.onCommand("export")}
          >
            <Download size={16} strokeWidth={1.7} />
            <span>{c.export}</span>
          </button>
          {props.inspector && (
            <ToolButton
              label={inspectorVisible ? c.closeInspector : c.openInspector}
              icon={inspectorVisible ? PanelRightClose : PanelRightOpen}
              onClick={() => setInspectorVisible((value) => !value)}
              className="studio-inspector-toggle"
            />
          )}
        </div>
      </header>
      <div className="studio-editor-layout">
        <nav className="studio-tool-rail" aria-label={c.tools}>
          <div className="studio-tool-cluster">
            <ToolButton
              label={`${c.select} · V`}
              icon={MousePointer2}
              active={props.tool === "select"}
              onClick={() => props.onTool("select")}
            />
            <ToolButton
              label={`${c.pan} · H`}
              icon={Hand}
              active={props.tool === "pan"}
              onClick={() => props.onTool("pan")}
            />
          </div>
          <div className="studio-rail-divider" />
          <div className="studio-tool-cluster" aria-label={c.create}>
            {creationTools.map(({ type, label, icon }) => (
              <ToolButton
                key={type}
                label={c[label]}
                icon={icon}
                onClick={() => props.onCreate(type)}
              />
            ))}
          </div>
          <div className="studio-rail-divider" />
          <div className="studio-tool-cluster">
            <ToolButton
              label={c.upload}
              icon={Upload}
              onClick={() => props.onCommand("upload")}
            />
            <ToolButton
              label={c.assets}
              icon={FolderOpen}
              onClick={() => props.onCommand("assets")}
            />
            <ToolButton
              label={c.plugins}
              icon={Wrench}
              onClick={() => props.onCommand("plugins")}
            />
          </div>
          <span className="studio-rail-signature" aria-hidden="true">
            YX
          </span>
        </nav>
        <section className="studio-canvas-region" aria-label={c.workspace}>
          {props.children}
          {props.selectedCount > 1 && (
            <div
              className="studio-selection-strip"
              role="toolbar"
              aria-label={c.multiSelection}
            >
              <span className="studio-selection-count">
                {props.selectedCount} {c.selected}
              </span>
              <ToolButton
                label={c.group}
                icon={Layers3}
                onClick={() => props.onCommand("group")}
              />
              <ToolButton
                label={c.ungroup}
                icon={Ungroup}
                onClick={() => props.onCommand("ungroup")}
              />
              <ToolButton
                label={c.duplicate}
                icon={Copy}
                onClick={() => props.onCommand("duplicate")}
              />
              <ToolButton
                label={`${c.video} · ${c.group}`}
                icon={Video}
                onClick={() => props.onCommand("merge")}
              />
              <ToolButton
                label={c.delete}
                icon={Trash2}
                onClick={() => props.onCommand("delete")}
              />
            </div>
          )}
        </section>
        {props.inspector && inspectorVisible && (
          <aside className="studio-inspector-region" aria-label={c.inspector}>
            {props.inspector}
          </aside>
        )}
      </div>
      <footer className="studio-status-bar">
        <div className="studio-save-status" role="status" aria-live="polite">
          <Check size={13} strokeWidth={1.7} />
          <span>{props.notice || c.saveReady}</span>
        </div>
        <div className="studio-status-counts">
          <span>
            {props.nodeCount} {c.items}
          </span>
          {props.selectedCount > 0 && (
            <span>
              {props.selectedCount} {c.selected}
            </span>
          )}
        </div>
        <span className="studio-keyboard-hint">{c.help}</span>
        <div className="studio-zoom-tools" role="group" aria-label={c.zoom}>
          <ToolButton
            label={c.minimap}
            icon={Map}
            onClick={() => props.onCommand("minimap")}
          />
          <ToolButton
            label={c.fit}
            icon={Fullscreen}
            onClick={() => props.onCommand("fit")}
          />
          <div className="studio-footer-divider" />
          <ToolButton
            label={c.zoomOut}
            icon={Minus}
            onClick={() => zoom(props.scale / 1.2)}
          />
          <select
            aria-label={c.zoom}
            value={Math.round(props.scale * 100)}
            onChange={(event) => zoom(Number(event.target.value) / 100)}
          >
            {[
              ...new Set([
                25,
                50,
                75,
                100,
                150,
                200,
                Math.round(props.scale * 100),
              ]),
            ]
              .sort((a, b) => a - b)
              .map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
          </select>
          <ToolButton
            label={c.zoomIn}
            icon={Plus}
            onClick={() => zoom(props.scale * 1.2)}
          />
        </div>
      </footer>
    </main>
  );
}

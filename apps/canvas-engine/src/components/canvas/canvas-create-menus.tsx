import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  ImageIcon,
  List,
  Music2,
  Settings2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  listAtlasNodeDefinitions as listNodeDefinitions,
  useAtlasNodeRegistryVersion as useNodeRegistryVersion,
} from "@/atlas-engine/model/node-registry";
import { getNodeSpec } from "@/constant/canvas";
import {
  CanvasNodeType,
  type ConnectionHandle,
  type Position,
} from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

export type PendingConnectionCreate = {
  connection: ConnectionHandle;
  position: Position;
};

type BuiltinCreateType =
  | CanvasNodeType.Image
  | CanvasNodeType.Text
  | CanvasNodeType.Config
  | CanvasNodeType.Video
  | CanvasNodeType.Audio;

type Translate = (key: string) => string;

type CreateMenuEntry<T extends string = string> = {
  id: string;
  type: T;
  icon: ReactNode;
  title: string;
  description?: string;
};

type ConnectionCommandDefinition = {
  type: BuiltinCreateType;
  icon: LucideIcon;
  titleKey: string;
  descriptionKey?: string;
};

const CONNECTION_COMMANDS: readonly ConnectionCommandDefinition[] = [
  {
    type: CanvasNodeType.Text,
    icon: List,
    titleKey: "canvas.createMenu.text",
    descriptionKey: "canvas.createMenu.textDescription",
  },
  {
    type: CanvasNodeType.Image,
    icon: ImageIcon,
    titleKey: "canvas.createMenu.image",
  },
  {
    type: CanvasNodeType.Video,
    icon: Video,
    titleKey: "canvas.createMenu.video",
  },
  {
    type: CanvasNodeType.Audio,
    icon: Music2,
    titleKey: "canvas.createMenu.audio",
  },
  {
    type: CanvasNodeType.Config,
    icon: Settings2,
    titleKey: "canvas.createMenu.config",
    descriptionKey: "canvas.createMenu.configDescription",
  },
];

export function buildConnectionCreateEntries(
  translate: Translate,
): CreateMenuEntry<BuiltinCreateType>[] {
  return CONNECTION_COMMANDS.map(
    ({ type, icon, titleKey, descriptionKey }) => ({
      id: type,
      type,
      icon: createElement(icon, { className: "size-4" }),
      title: translate(titleKey),
      ...(descriptionKey ? { description: translate(descriptionKey) } : {}),
    }),
  );
}

export function visibleCreateMenuDefinitions(
  definitions: readonly CanvasNodeDefinition[],
): CanvasNodeDefinition[] {
  return definitions.filter(
    (definition) => definition.showInCreateMenu !== false,
  );
}

function inverseZoom(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? 1 / scale : 1;
}

export function ConnectionCreateMenu({
  pending,
  scale = 1,
  onCreate,
  onClose,
}: {
  pending: PendingConnectionCreate;
  scale?: number;
  onCreate: (type: BuiltinCreateType) => void;
  onClose: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const entries = buildConnectionCreateEntries((key) => t(key));
  useMenuKeyboard(menuRef, onClose);

  return (
    <div
      ref={menuRef}
      className="absolute z-[120] w-[240px] rounded-2xl border p-2 shadow-2xl backdrop-blur"
      data-connection-create-menu
      role="menu"
      style={{
        left: pending.position.x,
        top: pending.position.y,
        transform: `scale(${inverseZoom(scale)})`,
        transformOrigin: "top left",
        background: theme.node.panel,
        borderColor: theme.node.stroke,
        color: theme.node.text,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuHeading
        theme={theme}
        label={t("canvas.createMenu.fromNode")}
        onClose={onClose}
      />
      <div className="grid gap-0.5" role="presentation">
        {entries.map((entry) => (
          <ConnectionCreateOption
            key={entry.id}
            theme={theme}
            icon={entry.icon}
            title={entry.title}
            description={entry.description}
            onClick={() => onCreate(entry.type)}
          />
        ))}
      </div>
    </div>
  );
}

export function ConnectionCreateOption({
  theme,
  icon,
  title,
  description,
  onClick,
}: {
  theme: CanvasTheme;
  icon: ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-1"
      style={{ color: theme.node.text, outlineColor: theme.node.activeStroke }}
      onClick={onClick}
      onMouseEnter={(event) =>
        (event.currentTarget.style.background = theme.node.fill)
      }
      onMouseLeave={(event) =>
        (event.currentTarget.style.background = "transparent")
      }
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        style={{ background: theme.node.fill, color: theme.node.muted }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium leading-5">
          {title}
        </span>
        {description ? (
          <span
            className="mt-0.5 block truncate text-xs"
            style={{ color: theme.node.muted }}
          >
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function NodeCreateMenu({
  position,
  scale = 1,
  onCreate,
  onClose,
}: {
  position: Position;
  scale?: number;
  onCreate: (type: string) => void;
  onClose: () => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const registryVersion = useNodeRegistryVersion((state) => state.version);
  const menuRef = useRef<HTMLDivElement>(null);
  const definitions = useMemo(
    () => visibleCreateMenuDefinitions(listNodeDefinitions()),
    [registryVersion],
  );

  useMenuKeyboard(menuRef, onClose);

  useEffect(() => {
    const dismissWhenOutside = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu && !menu.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", dismissWhenOutside, true);
    return () =>
      document.removeEventListener("pointerdown", dismissWhenOutside, true);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute z-[120] max-h-[70vh] w-[240px] overflow-y-auto rounded-2xl border p-2 shadow-2xl backdrop-blur thin-scrollbar"
      data-canvas-no-zoom
      role="menu"
      style={{
        left: position.x,
        top: position.y,
        transform: `scale(${inverseZoom(scale)})`,
        transformOrigin: "top left",
        background: theme.node.panel,
        borderColor: theme.node.stroke,
        color: theme.node.text,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuHeading
        theme={theme}
        label={t("canvas.createMenu.select")}
        onClose={onClose}
      />
      <div className="grid gap-0.5" role="presentation">
        {definitions.map((definition) => (
          <ConnectionCreateOption
            key={definition.type}
            theme={theme}
            icon={definition.icon}
            title={getNodeSpec(definition.type).title}
            description={definition.description}
            onClick={() => onCreate(definition.type)}
          />
        ))}
      </div>
    </div>
  );
}

function MenuHeading({
  theme,
  label,
  onClose,
}: {
  theme: CanvasTheme;
  label: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-1.5 flex items-center justify-between px-1">
      <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
        {label}
      </span>
      <button
        type="button"
        className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:bg-white/10 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1"
        style={{ outlineColor: theme.node.activeStroke }}
        onClick={onClose}
        aria-label={t("canvas.createMenu.close")}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function useMenuKeyboard(
  menuRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const buttons = [
        ...menu.querySelectorAll<HTMLButtonElement>(
          'button[role="menuitem"]:not(:disabled)',
        ),
      ];
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (
        !buttons.length ||
        !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      )
        return;

      event.preventDefault();
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) %
              buttons.length;
      buttons[next].focus();
    };

    menu.addEventListener("keydown", handleKeyDown);
    menu
      .querySelector<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      )
      ?.focus();
    return () => menu.removeEventListener("keydown", handleKeyDown);
  }, [menuRef, onClose]);
}

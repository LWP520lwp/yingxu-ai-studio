import { useSyncExternalStore, type ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import {
  Copy,
  Fullscreen,
  Redo2,
  Trash2,
  Type,
  Undo2,
  Unplug,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StudioSession } from "./studio-document";

type Props = {
  session: StudioSession;
  children: ReactNode;
  onCommand: (command: string) => void;
  onCreate: (type: string) => void;
  onBeforeOpen: () => void;
  onClose: () => void;
};

/** Resolve the clicked object before opening, so an old selection cannot be deleted by accident. */
export function StudioContextMenu({
  session,
  children,
  onCommand,
  onCreate,
  onBeforeOpen,
  onClose,
}: Props) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const count = state.selection.size;
  const word = (cn: string, en: string) => (zh ? cn : en);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className="studio-context-surface"
          onContextMenuCapture={(event) => {
            // Text fields and native media controls retain their own editing menus.
            if (
              event.target instanceof Element &&
              event.target.closest(
                "input,textarea,select,[contenteditable='true'],[role='textbox'],video,audio",
              )
            )
              event.stopPropagation();
          }}
          onContextMenu={(event) => {
            onBeforeOpen();
            const target =
              event.target instanceof Element ? event.target : null;
            const nodeId = target
              ?.closest("[data-node-id]")
              ?.getAttribute("data-node-id");
            const edgeId = target
              ?.closest("[data-connection-id]")
              ?.getAttribute("data-connection-id");
            if (nodeId) {
              if (!session.snapshot().selection.has(nodeId))
                session.select([nodeId]);
            } else session.select([], edgeId || null);
          }}
        >
          {children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="studio-command-menu"
          aria-label={word("画布右键菜单", "Canvas context menu")}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClose();
          }}
        >
          <ContextMenu.Label className="studio-menu-label">
            {count
              ? word(`已选择 ${count} 个节点`, `${count} selected`)
              : state.edge
                ? word("参考连接", "Reference connection")
                : word("画布操作", "Canvas actions")}
          </ContextMenu.Label>
          {count > 0 ? (
            <>
              <ContextMenu.Item
                className="studio-menu-item"
                onSelect={() => onCommand("duplicate")}
              >
                <Copy size={16} aria-hidden="true" />
                <span>{word("创建副本", "Duplicate")}</span>
              </ContextMenu.Item>
              <ContextMenu.Item
                className="studio-menu-item"
                onSelect={() => onCommand("fit")}
              >
                <Fullscreen size={16} aria-hidden="true" />
                <span>{word("聚焦所选", "Focus selection")}</span>
              </ContextMenu.Item>
              <ContextMenu.Separator className="studio-menu-separator" />
              <ContextMenu.Item
                className="studio-menu-item studio-danger"
                onSelect={() => onCommand("delete")}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>
                  {count === 1
                    ? word("删除节点", "Delete node")
                    : word(
                        `删除所选 ${count} 个节点`,
                        `Delete ${count} selected nodes`,
                      )}
                </span>
              </ContextMenu.Item>
            </>
          ) : state.edge ? (
            <ContextMenu.Item
              className="studio-menu-item studio-danger"
              onSelect={() => onCommand("delete")}
            >
              <Unplug size={16} aria-hidden="true" />
              <span>{word("断开连接", "Disconnect")}</span>
            </ContextMenu.Item>
          ) : (
            <>
              <ContextMenu.Item
                className="studio-menu-item"
                onSelect={() => onCreate("text")}
              >
                <Type size={16} aria-hidden="true" />
                <span>{word("新建文本", "New text")}</span>
              </ContextMenu.Item>
              <ContextMenu.Separator className="studio-menu-separator" />
              <ContextMenu.Item
                className="studio-menu-item"
                disabled={!state.undo}
                onSelect={() => onCommand("undo")}
              >
                <Undo2 size={16} aria-hidden="true" />
                <span>{word("撤销", "Undo")}</span>
              </ContextMenu.Item>
              <ContextMenu.Item
                className="studio-menu-item"
                disabled={!state.redo}
                onSelect={() => onCommand("redo")}
              >
                <Redo2 size={16} aria-hidden="true" />
                <span>{word("重做", "Redo")}</span>
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

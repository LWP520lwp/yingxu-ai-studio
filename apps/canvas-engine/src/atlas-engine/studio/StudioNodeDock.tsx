import { useEffect, useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import {
  Copy,
  Crop,
  Download,
  Expand,
  FolderOpen,
  Image,
  MoreHorizontal,
  Save,
  Scissors,
  Settings2,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { studioNodePlacement } from "./studio-node-placement";
import "./studio-node-dock.css";

type Props = {
  node: CanvasNodeData;
  viewport: ViewportTransform;
  size: { width: number; height: number };
  composer: ReactNode;
  onMode: (mode: "image" | "video") => void;
  onAction: (action: string, node: CanvasNodeData) => void;
  onAssets: () => void;
};

export function StudioNodeDock({
  node,
  viewport,
  size,
  composer,
  onMode,
  onAction,
  onAssets,
}: Props) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const word = (cn: string, en: string) => (zh ? cn : en);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [node.id]);
  const place = studioNodePlacement(node, viewport, size);
  if (!place) return null;
  const hasContent = Boolean(node.metadata?.content);
  const choose = (mode: "image" | "video") => {
    onMode(mode);
    setExpanded(true);
  };
  const mediaActions =
    node.type === "image" && hasContent
      ? ([
          ["crop", word("裁剪画面", "Crop"), Crop],
          ["split", word("切成分镜", "Split frames"), Scissors],
          ["upscale", word("放大图像", "Upscale"), Expand],
        ] as const)
      : node.type === "video" && hasContent
        ? ([
            ["capture-start", word("提取首帧", "Extract first frame"), Image],
            ["capture-end", word("提取尾帧", "Extract last frame"), Image],
          ] as const)
        : [];
  return (
    <div
      className="studio-node-dock"
      style={{ left: place.x, top: place.y, width: place.width }}
      data-node-dock={node.id}
    >
      <div
        className="studio-node-quickbar"
        role="toolbar"
        aria-label={word("节点快捷操作", "Node actions")}
      >
        {node.type !== "group" && (
          <>
            <button
              type="button"
              onClick={() => choose("image")}
              aria-pressed={
                expanded && node.metadata?.generationMode === "image"
              }
            >
              <Image size={16} />
              <span>{word("生成图像", "Image")}</span>
            </button>
            <button
              type="button"
              onClick={() => choose("video")}
              aria-pressed={
                expanded && node.metadata?.generationMode === "video"
              }
            >
              <Video size={16} />
              <span>{word("生成视频", "Video")}</span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={word("节点创作参数", "Node settings")}
          title={word("节点创作参数", "Node settings")}
        >
          <Settings2 size={16} />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={word("更多节点操作", "More node actions")}
              title={word("更多节点操作", "More node actions")}
            >
              <MoreHorizontal size={17} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="studio-command-menu"
              collisionPadding={12}
              sideOffset={8}
            >
              <DropdownMenu.Item
                className="studio-menu-item"
                onSelect={onAssets}
              >
                <FolderOpen size={16} />
                {word("打开资产库", "Open assets")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="studio-menu-item"
                onSelect={() => onAction("upload", node)}
              >
                <Upload size={16} />
                {word("上传素材", "Upload media")}
              </DropdownMenu.Item>
              {hasContent && ["text", "image", "video"].includes(node.type) && (
                <DropdownMenu.Item
                  className="studio-menu-item"
                  onSelect={() => onAction("saveAsset", node)}
                >
                  <Save size={16} />
                  {word("收藏到资产库", "Save to assets")}
                </DropdownMenu.Item>
              )}
              {hasContent && (
                <DropdownMenu.Item
                  className="studio-menu-item"
                  onSelect={() => onAction("download", node)}
                >
                  <Download size={16} />
                  {word("下载素材", "Download")}
                </DropdownMenu.Item>
              )}
              {mediaActions.map(([action, label, Icon]) => (
                <DropdownMenu.Item
                  key={action}
                  className="studio-menu-item"
                  onSelect={() => onAction(action, node)}
                >
                  <Icon size={16} />
                  {label}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="studio-menu-separator" />
              <DropdownMenu.Item
                className="studio-menu-item"
                onSelect={() => onAction("duplicate", node)}
              >
                <Copy size={16} />
                {word("创建副本", "Duplicate")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="studio-menu-item studio-danger"
                onSelect={() => onAction("delete", node)}
              >
                <Trash2 size={16} />
                {word("删除节点", "Delete node")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {expanded && (
        <section
          className="studio-node-composer"
          aria-label={word("节点创作面板", "Node composer")}
          style={{
            maxHeight: place.panelHeight,
            height: Math.min(430, place.panelHeight),
            ...(place.panelBelow ? { top: 54 } : { bottom: 54 }),
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setExpanded(false);
            }
          }}
        >
          <button
            className="studio-node-composer-close"
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={word("收起节点创作面板", "Close node composer")}
          >
            <X size={16} />
          </button>
          {composer}
        </section>
      )}
    </div>
  );
}

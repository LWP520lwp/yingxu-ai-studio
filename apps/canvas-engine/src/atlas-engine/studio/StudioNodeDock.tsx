import { useEffect, useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import {
  Copy,
  Camera,
  Crop,
  Download,
  Expand,
  FolderOpen,
  Image,
  MoreHorizontal,
  Save,
  Scissors,
  Settings2,
  Sparkles,
  Link2,
  Trash2,
  Upload,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { studioNodePlacement } from "./studio-node-placement";
import "./studio-node-dock.css";

export type StudioNodeSection =
  "compose" | "skills" | "references" | "properties";
type Props = {
  node: CanvasNodeData;
  viewport: ViewportTransform;
  size: { width: number; height: number };
  composer: (
    section: StudioNodeSection,
    onAction: Props["onAction"],
  ) => ReactNode;
  onMode: (mode: "image" | "video") => void;
  onAction: (action: string, node: CanvasNodeData) => void;
  onAssets: () => void;
  onReveal: (id: string) => void;
};

export function StudioNodeDock({
  node,
  viewport,
  size,
  composer,
  onMode,
  onAction,
  onAssets,
  onReveal,
}: Props) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const word = (cn: string, en: string) => (zh ? cn : en);
  const [expanded, setExpanded] = useState(
    ["config", "image", "video"].includes(node.type),
  );
  const [section, setSection] = useState<StudioNodeSection>("compose");
  useEffect(() => {
    if (["config", "image", "video"].includes(node.type)) onReveal(node.id);
  }, [node.id, node.type, onReveal, size.width, size.height]);
  const place = studioNodePlacement(node, viewport, size);
  if (!place) return null;
  const hasContent = Boolean(node.metadata?.content);
  const generationMode =
    node.metadata?.generationMode ||
    (node.type === "video" ? "video" : "image");
  const choose = (mode: "image" | "video") => {
    onMode(mode);
    setSection("compose");
    setExpanded(true);
    onReveal(node.id);
  };
  const openSection = (next: StudioNodeSection) => {
    if (
      next === "skills" &&
      node.metadata?.generationMode !== "video" &&
      node.type !== "video"
    )
      onMode("video");
    setSection(next);
    setExpanded(true);
    onReveal(node.id);
  };
  const dispatch: Props["onAction"] = (action, target) => {
    if (action === "node-skills") openSection("skills");
    else if (action === "node-references") openSection("references");
    else onAction(action, target);
  };
  const mediaActions =
    node.type === "image" && hasContent
      ? ([
          ["crop", word("裁剪画面", "Crop"), Crop],
          ["mask", word("局部重绘", "Inpaint"), WandSparkles],
          ["angle", word("改变视角", "Change view"), Camera],
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
    <div className="studio-node-dock" data-node-dock={node.id}>
      <div
        className="studio-node-quickbar"
        style={{ left: place.x, top: place.y, width: place.width }}
        role="toolbar"
        aria-label={word("节点快捷操作", "Node actions")}
      >
        {node.type !== "group" && (
          <>
            <button
              type="button"
              onClick={() => choose("image")}
              aria-pressed={expanded && generationMode === "image"}
            >
              <Image size={16} />
              <span>{word("生成图像", "Image")}</span>
            </button>
            <button
              type="button"
              onClick={() => choose("video")}
              aria-pressed={expanded && generationMode === "video"}
            >
              <Video size={16} />
              <span>{word("生成视频", "Video")}</span>
            </button>
          </>
        )}
        {node.type !== "group" && (
          <button
            type="button"
            onClick={() => openSection("skills")}
            aria-pressed={expanded && section === "skills"}
            title={word("使用导演 Skill", "Use a director Skill")}
          >
            <Sparkles size={15} />
            <span>Skill</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => openSection("references")}
          aria-label={word("节点参考素材", "Node references")}
          title={word("参考素材与首尾帧", "References and first/last frames")}
          aria-pressed={expanded && section === "references"}
        >
          <Link2 size={16} />
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
                onSelect={() => openSection("properties")}
              >
                <Settings2 size={16} />
                {word("节点属性", "Node properties")}
              </DropdownMenu.Item>
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
              {node.type === "text" && (
                <DropdownMenu.Item
                  className="studio-menu-item"
                  disabled={!node.metadata?.content?.trim()}
                  onSelect={() => onAction("prepare-video", node)}
                >
                  <Video size={16} />
                  {word("以此创作视频", "Create video from text")}
                </DropdownMenu.Item>
              )}
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
            left: place.panelX,
            top: place.panelY,
            width: place.panelWidth,
            height: place.panelHeight,
          }}
          data-composer-side={place.panelBelow ? "below" : "above"}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setExpanded(false);
            }
          }}
        >
          <header className="studio-node-composer-header">
            <span title={node.title}>
              {section === "skills"
                ? word("导演 Skill", "Director Skills")
                : section === "references"
                  ? word("参考素材", "References")
                  : section === "properties"
                    ? word("节点属性", "Node properties")
                    : node.metadata?.generationMode === "video" ||
                        node.type === "video"
                      ? word("视频创作", "Video creation")
                      : word("图像创作", "Image creation")}
            </span>
            <button
              className="studio-node-composer-close"
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={word("收起节点创作面板", "Close node composer")}
            >
              <X size={16} />
            </button>
          </header>
          {section !== "compose" && (
            <nav
              className="studio-node-composer-tabs"
              aria-label={word("节点创作功能", "Node tools")}
            >
              {(["compose", "skills", "references"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={section === tab}
                  onClick={() => openSection(tab)}
                >
                  {tab === "compose"
                    ? word("创作", "Create")
                    : tab === "skills"
                      ? "Skill"
                      : word("参考", "References")}
                </button>
              ))}
            </nav>
          )}
          {composer(section, dispatch)}
        </section>
      )}
    </div>
  );
}

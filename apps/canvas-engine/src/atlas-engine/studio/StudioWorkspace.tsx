import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Modal } from "antd";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { saveAs } from "file-saver";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { getPlatformInit, platformRequest } from "@/platform/rpc";
import { openPlatformAction } from "@/platform/navigation";
import {
  prepareTextVideo,
  selectImageModel,
  selectVideoModel,
} from "@/platform/skill-video";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { AtlasCanvasViewport } from "@/atlas-engine/surface/AtlasCanvasViewport";
import {
  getAtlasNodeDefinition,
  useAtlasNodeRegistryVersion,
} from "@/atlas-engine/model/node-registry";
import { ensurePluginsLoaded } from "@/atlas-engine/plugins/loader";
import type {
  CanvasGenerationMode,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/types/canvas";
import {
  StudioSession,
  STUDIO_ZOOM_LIMITS,
  fitStudioView,
  makeStudioNode,
  studioId,
  type StudioDocument,
  type StudioPort,
} from "./studio-document";
import { createStudioTasks } from "./studio-tasks";
import { createStudioMedia } from "./studio-media";
import { StudioScene } from "./StudioScene";
import { StudioContextMenu } from "./StudioContextMenu";
import { StudioNodeDock, type StudioNodeSection } from "./StudioNodeDock";
import { studioNodeEditingView } from "./studio-node-placement";
import { StudioNodeDrafts } from "./StudioNodeDrafts";
import { StudioChrome } from "./ui/StudioChrome";
import { StudioInspector } from "./ui/StudioInspector";
import { useStudioGestures } from "./useStudioGestures";
import {
  studioCompositionNode,
  studioExtensionContent,
  studioPluginContext,
} from "./studio-plugins";
import { installStudioHost } from "./studio-host";
import { createStudioCamera } from "./studio-camera";
import { createStudioSaveQueue } from "./studio-save-queue";
import type { CodexCanvasPlan } from "./codex-plan";
import "./studio-workspace.css";

const CodexPanel = lazy(() =>
  import("./CodexStudioPanel").then((module) => ({
    default: module.CodexStudioPanel,
  })),
);
const Library = lazy(() => import("./StudioLibrary"));
const Dialogs = lazy(() => import("./StudioDialogs"));
const Sequence = lazy(() =>
  import("./StudioSequence").then((module) => ({
    default: module.StudioSequence,
  })),
);
const Plugins = lazy(() =>
  import("@/components/canvas/canvas-plugin-manager-modal").then((module) => ({
    default: module.CanvasPluginManagerModal,
  })),
);
type EditOperation = "crop" | "split" | "upscale" | "angle" | "mask";
const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      "input,textarea,select,[contenteditable=true],[role=dialog],[role=menu],.ant-modal",
    ),
  );

export default function StudioWorkspace({
  projectId,
  initial,
}: {
  projectId: string;
  initial: StudioDocument;
}) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const word = (cn: string, en: string) => (zh ? cn : en);
  const [session] = useState(() => new StudioSession(initial));
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const doc = state.document;
  const title = useCanvasStore(
    (store) =>
      store.projects.find((project) => project.id === projectId)?.title || "",
  );
  const config = useEffectiveConfig();
  const configRef = useRef(config);
  configRef.current = config;
  const theme = useThemeStore((store) => store.theme);
  useAtlasNodeRegistryVersion((store) => store.version);
  const [tool, setTool] = useState<"select" | "pan">("pan");
  const [notice, setNotice] = useState("");
  const [library, setLibrary] = useState(() => window.innerWidth >= 1000);
  const [drafts, setDrafts] = useState(false);
  const [referenceTarget, setReferenceTarget] = useState<string | undefined>();
  const [plugins, setPlugins] = useState(false);
  const [codex, setCodex] = useState(false);
  const [overview, setOverview] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<CanvasNodeData | null>(null);
  const [edit, setEdit] = useState<{
    node: CanvasNodeData;
    operation: EditOperation;
  } | null>(null);
  const [pluginPanel, setPluginPanel] = useState<string | null>(null);
  const keyboardPort = useRef<{ id: string; side: string } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const replace = useRef<string | undefined>(undefined);
  const uploadReference = useRef<string | undefined>(undefined);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const reducedMotion = useReducedMotion();
  const [cameraMoving, setCameraMoving] = useState(false);
  const camera = useMemo(
    () =>
      createStudioCamera({
        read: () => session.read().viewport,
        write: session.moveViewport,
        active: setCameraMoving,
      }),
    [session],
  );
  const navigate = useCallback(
    (view: StudioDocument["viewport"]) => {
      camera.move(view, sizeRef.current, Boolean(reducedMotion));
    },
    [camera, reducedMotion],
  );
  const life = useRef(true);
  const scope = useRef(getPlatformInit()?.scopeId);
  const alive = useCallback(
    () =>
      life.current &&
      session.alive() &&
      (!scope.current ||
        (getPlatformInit()?.scopeId === scope.current &&
          getPlatformInit()?.project.id === projectId)),
    [session, projectId],
  );
  const port = useMemo<StudioPort>(
    () => ({
      read: session.read,
      change: session.change,
      insert: session.insert,
      alive,
      notice: setNotice,
    }),
    [session, alive],
  );
  const tasks = useMemo(
    () => createStudioTasks(port, () => configRef.current),
    [port],
  );
  const media = useMemo(
    () =>
      createStudioMedia(port, () => configRef.current, {
        center: () => {
          const view = session.read().viewport;
          return {
            x: (sizeRef.current.width / 2 - view.x) / view.k,
            y: (sizeRef.current.height / 2 - view.y) / view.k,
          };
        },
      }),
    [port],
  );
  const gestures = useStudioGestures({
    session,
    containerRef: surface,
    tool,
    configTitle: word("图像创作", "Image creation"),
    onStart: camera.stop,
  });
  const persist = useCallback(() => {
    if (alive()) {
      const current = session.read();
      useCanvasStore.getState().updateProject(projectId, {
        ...current,
        backgroundMode:
          current.backgroundMode === "none" ? "blank" : current.backgroundMode,
      });
    }
  }, [alive, projectId, session]);
  const saveQueue = useMemo(() => createStudioSaveQueue(persist), [persist]);
  useEffect(() => {
    let previous = session.read();
    const unsubscribe = session.subscribe(() => {
      const current = session.read();
      if (current === previous) return;
      previous = current;
      saveQueue.schedule();
    });
    const flush = () => saveQueue.flush();
    const hidden = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unsubscribe();
      saveQueue.flush();
      saveQueue.dispose();
      camera.stop();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [camera, session, saveQueue]);
  useEffect(() => {
    life.current = true;
    tasks.resume();
    void ensurePluginsLoaded().catch((reason) =>
      setNotice(String(reason.message)),
    );
    const capture = (event: Event) => {
      const request = (
        event as CustomEvent<{ projectId: string; captured: boolean }>
      ).detail;
      if (request?.projectId === projectId && alive()) {
        persist();
        request.captured = true;
      }
    };
    window.addEventListener("frameflow:capture-document", capture);
    return () => {
      persist();
      life.current = false;
      tasks.dispose();
      media.dispose();
      window.removeEventListener("frameflow:capture-document", capture);
    };
  }, [alive, media, persist, projectId, tasks]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const center = () => {
    const view = session.read().viewport;
    return {
      x: (size.width / 2 - view.x) / view.k,
      y: (size.height / 2 - view.y) / view.k,
    };
  };
  const fit = (onlySelected = false) => {
    const current = session.read();
    navigate(
      fitStudioView(
        onlySelected && state.selection.size
          ? current.nodes.filter((node) => state.selection.has(node.id))
          : current.nodes,
        size.width,
        size.height,
      ),
    );
  };
  const revealComposer = useCallback(
    (id: string) => {
      if (gestures.isActive()) return;
      const current = session.read();
      const node = current.nodes.find((entry) => entry.id === id);
      if (!node) return;
      const view = studioNodeEditingView(
        node,
        current.viewport,
        sizeRef.current,
      );
      if (view !== current.viewport) navigate(view);
    },
    [session, navigate, gestures.isActive],
  );
  const focusDraft = (id: string) => {
    const node = session.read().nodes.find((entry) => entry.id === id);
    if (!node) return;
    session.select([id]);
    navigate(
      studioNodeEditingView(
        node,
        fitStudioView([node], size.width, size.height),
        size,
      ),
    );
    if (window.innerWidth < 1000) setDrafts(false);
  };
  const zoom = (scale: number) => {
    const k = Math.min(3, Math.max(0.12, scale));
    const point = center();
    navigate({
      x: size.width / 2 - point.x * k,
      y: size.height / 2 - point.y * k,
      k,
    });
  };
  const create = (type: string) => {
    const point = center();
    const names: Record<string, string> = {
      text: word("创作笔记", "Creative note"),
      image: word("图像素材", "Image material"),
      video: word("视频素材", "Video material"),
      audio: word("声音素材", "Sound material"),
      config: word("图像创作", "Image creation"),
      group: word("创作分组", "Creative group"),
    };
    const definition = getAtlasNodeDefinition(type);
    const node = makeStudioNode(
      type,
      point.x - 170,
      point.y - 110,
      names[type] || definition?.title || type,
      type === "config" ? { generationMode: "image" } : {},
    );
    if (definition) {
      node.width = definition.defaultSize.width;
      node.height = definition.defaultSize.height;
      node.metadata = { ...definition.defaultMetadata };
    }
    session.insert([node]);
    if (["config", "image", "video"].includes(node.type))
      navigate(
        studioNodeEditingView(node, session.read().viewport, sizeRef.current),
      );
    setTool("pan");
  };
  const report = (reason: unknown) => {
    if (
      alive() &&
      !(reason instanceof DOMException && reason.name === "AbortError")
    )
      setNotice(reason instanceof Error ? reason.message : String(reason));
  };
  const saveAsset = (node: CanvasNodeData) => {
    const meta = node.metadata || {};
    const base = {
      title: node.title,
      coverUrl: "",
      tags: [],
      source: "canvas",
    };
    if (node.type === "text")
      useAssetStore.getState().addAsset({
        ...base,
        kind: "text",
        data: { content: meta.content || "" },
      });
    else if (node.type === "image" || node.type === "video") {
      const data = {
        storageKey: meta.storageKey,
        width: meta.naturalWidth || node.width,
        height: meta.naturalHeight || node.height,
        bytes: meta.bytes || 0,
        mimeType:
          meta.mimeType || (node.type === "image" ? "image/png" : "video/mp4"),
      };
      if (!meta.content) return;
      useAssetStore.getState().addAsset(
        node.type === "image"
          ? {
              ...base,
              coverUrl: meta.content,
              kind: "image",
              data: { ...data, dataUrl: meta.content },
            }
          : { ...base, kind: "video", data: { ...data, url: meta.content } },
      );
    } else return;
    setNotice(word("已收进素材架", "Saved to materials"));
  };
  const action = (name: string, node: CanvasNodeData) => {
    if (name === "assets-reference") {
      setReferenceTarget(node.id);
      setDrafts(false);
      setLibrary(true);
      return;
    }
    if (name === "upload-reference") {
      uploadReference.current = node.id;
      replace.current = undefined;
      file.current?.click();
      return;
    }
    if (name === "skill-market" || name === "skill-import") {
      void openPlatformAction(
        name === "skill-import" ? "skillImport" : "skills",
      ).catch(report);
      return;
    }
    if (name === "codex") {
      setCodex(true);
      return;
    }
    if (name.startsWith("port:")) {
      const side = name.slice(5);
      const previous = keyboardPort.current;
      if (previous && previous.side !== side) {
        const ok =
          side === "target"
            ? session.connect(previous.id, node.id)
            : session.connect(node.id, previous.id);
        keyboardPort.current = null;
        setNotice(
          ok
            ? word("已建立参考连接", "Reference connected")
            : word(
                "无法建立此连接，请检查重复或循环引用",
                "This connection would duplicate or cycle a reference",
              ),
        );
      } else {
        keyboardPort.current = { id: node.id, side };
        setNotice(
          word(
            "现在聚焦另一个节点的相对端口，按回车完成连接",
            "Focus the opposite port on another node and press Enter",
          ),
        );
      }
      return;
    }
    if (["crop", "split", "upscale", "angle", "mask"].includes(name)) {
      if (node.metadata?.content)
        setEdit({ node, operation: name as EditOperation });
      return;
    }
    if (name.startsWith("disconnect:")) {
      const id = name.slice(11);
      session.change((current) => ({
        ...current,
        connections: current.connections.filter((edge) => edge.id !== id),
      }));
      return;
    }
    if (name.startsWith("primary:")) {
      const image = node.metadata?.images?.find(
        (item) => item.id === name.slice(8),
      );
      if (image)
        session.metadata(node.id, {
          primaryImageId: image.id,
          content: image.content,
          storageKey: image.storageKey,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        });
      return;
    }
    if (name === "preview") {
      if (node.metadata?.content) setPreview(node);
      return;
    }
    if (name === "duplicate") {
      session.clone(new Set([node.id]));
      return;
    }
    if (name === "delete") {
      tasks.stop(node.id);
      session.remove(new Set([node.id]));
      return;
    }
    if (name === "group") {
      session.group(word("创作分组", "Creative group"));
      return;
    }
    if (name === "ungroup") {
      session.ungroup();
      return;
    }
    if (name === "saveAsset") {
      saveAsset(node);
      return;
    }
    if (name === "upload") {
      uploadReference.current = undefined;
      replace.current = node.id;
      file.current?.click();
      return;
    }
    if (name === "settings") {
      void openPlatformAction("settings").catch(report);
      return;
    }
    if (name === "capture-start" || name === "capture-end") {
      void media
        .capture(node, name === "capture-start" ? "start" : "end")
        .catch(report);
      return;
    }
    if (name === "reverse") {
      setNotice(
        word(
          "图像理解通道尚未接入，请在配置中接入支持图像识别的模型。",
          "Configure an image understanding provider before analysing an image.",
        ),
      );
      return;
    }
    if (name === "download") {
      const meta = node.metadata;
      if (!meta?.content) return;
      if (node.type === "text") {
        saveAs(
          new Blob([meta.content], { type: "text/plain;charset=utf-8" }),
          `${node.title}.txt`,
        );
        return;
      }
      const extension =
        node.type === "image" ? "png" : node.type === "audio" ? "mp3" : "mp4";
      void (
        meta.storageKey
          ? node.type === "image"
            ? getImageBlob(meta.storageKey)
            : getMediaBlob(meta.storageKey)
          : fetch(meta.content).then((response) => {
              if (!response.ok) throw new Error("素材下载失败");
              return response.blob();
            })
      )
        .then((blob) => {
          if (!blob) throw new Error("素材已不存在");
          saveAs(blob, `${node.title}.${extension}`);
        })
        .catch(report);
      return;
    }
    if (name === "prepare-video") {
      const controller = new AbortController();
      void prepareTextVideo({
        sourceNodeId: node.id,
        projectId,
        selected: null,
        signal: controller.signal,
        getSourceNode: () =>
          session.read().nodes.find((item) => item.id === node.id),
        isCurrentProject: alive,
      })
        .then((result) => {
          if (!alive()) return;
          const target = makeStudioNode(
            "config",
            result.source.position.x + result.source.width + 120,
            result.source.position.y,
            word("视频创作", "Video creation"),
            result.metadata,
          );
          session.insert(
            [target],
            [{ id: studioId(), fromNodeId: node.id, toNodeId: target.id }],
          );
        })
        .catch(report);
    }
  };
  const command = (name: string) => {
    if (name === "home") {
      persist();
      void openPlatformAction("home").catch(report);
    } else if (name === "settings")
      void openPlatformAction("settings").catch(report);
    else if (name === "codex") setCodex(true);
    else if (name === "undo") session.undo();
    else if (name === "redo") session.redo();
    else if (name === "duplicate") session.clone();
    else if (name === "delete") {
      for (const id of session.snapshot().selection) tasks.stop(id);
      session.remove();
    } else if (name === "group")
      session.group(word("创作分组", "Creative group"));
    else if (name === "ungroup") session.ungroup();
    else if (name === "fit") fit(true);
    else if (name === "tidy") {
      session.tidy();
      fit();
    } else if (name === "upload") {
      uploadReference.current = undefined;
      replace.current = undefined;
      file.current?.click();
    } else if (name === "assets") {
      setReferenceTarget(undefined);
      setDrafts(false);
      setLibrary((value) => !value);
    } else if (name === "drafts") {
      setLibrary(false);
      setReferenceTarget(undefined);
      setDrafts((value) => !value);
    } else if (name === "skills" || name === "workflow")
      void openPlatformAction(name).catch(report);
    else if (name === "plugins") setPlugins(true);
    else if (name === "minimap") setOverview((value) => !value);
    else if (name === "theme")
      useThemeStore.getState().setTheme(theme === "dark" ? "light" : "dark");
    else if (name === "language") void i18n.changeLanguage(zh ? "en" : "zh");
    else if (name === "audit") {
      const missing = doc.nodes.filter(
        (node) =>
          node.type === "config" &&
          !(
            node.metadata?.composerContent ||
            node.metadata?.prompt ||
            ""
          ).trim(),
      );
      setNotice(
        missing.length
          ? word(
              `${missing.length} 个创作节点还没有输入内容`,
              `${missing.length} creation nodes need instructions`,
            )
          : word("节点与引用连接检查通过", "Nodes and references checked"),
      );
    } else if (name === "clear")
      Modal.confirm({
        title: word("清空当前画布？", "Clear this canvas?"),
        content: word(
          "本次操作可以撤销，草稿名称会保留。",
          "You can undo this action.",
        ),
        onOk: () => {
          for (const node of session.read().nodes) tasks.stop(node.id);
          session.change((current) => ({
            ...current,
            nodes: [],
            connections: [],
          }));
        },
      });
    else if (name === "export") {
      persist();
      const project = useCanvasStore.getState().openProject(projectId);
      if (project)
        void import("@/atlas-engine/workflows/project-export")
          .then((module) =>
            module.exportAtlasProjects([project], project.title),
          )
          .catch(report);
    } else if (name === "merge") {
      const point = center();
      const node = studioCompositionNode(
        doc.nodes.filter((item) => state.selection.has(item.id)),
        point.x,
        point.y,
      );
      if (node) session.insert([node]);
      else
        setNotice(word("请选择至少两个视频素材", "Select at least two clips"));
    }
  };
  const handlers = useRef({ command, center, fit, report });
  handlers.current = { command, center, fit, report };
  useEffect(() => {
    const stop = installStudioHost({
      session,
      projectId,
      scopeId: scope.current || "",
      alive,
      center: () => handlers.current.center(),
      fit: () => handlers.current.fit(),
      rename: (name) =>
        useCanvasStore.getState().renameProject(projectId, name),
      command: (name) => handlers.current.command(name),
      notice: setNotice,
    });
    if (scope.current && parent !== window)
      parent.postMessage(
        { type: "frameflow:mounted", scopeId: scope.current },
        location.origin,
      );
    return stop;
  }, [alive, projectId, session]);
  const clipboard = useRef<{
    nodes: CanvasNodeData[];
    connections: StudioDocument["connections"];
  } | null>(null);
  const clipboardToken = useRef("");
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (editable(event.target) || event.altKey) return;
      const modifier = event.ctrlKey || event.metaKey;
      const value = event.key.toLowerCase();
      let name = "";
      if (modifier && value === "z") name = event.shiftKey ? "redo" : "undo";
      else if (modifier && value === "y") name = "redo";
      else if (modifier && value === "d") name = "duplicate";
      else if (modifier && value === "s") {
        event.preventDefault();
        persist();
        setNotice(word("已更新草稿，等待同步完成", "Draft updated; syncing"));
        return;
      } else if (modifier && value === "a") {
        event.preventDefault();
        session.select(session.read().nodes.map((node) => node.id));
        return;
      } else if (
        modifier &&
        value === "c" &&
        session.snapshot().selection.size
      ) {
        const picked = session.snapshot().selection;
        clipboard.current = structuredClone({
          nodes: session.read().nodes.filter((node) => picked.has(node.id)),
          connections: session
            .read()
            .connections.filter(
              (edge) =>
                picked.has(edge.fromNodeId) && picked.has(edge.toNodeId),
            ),
        });
        return;
      } else if (modifier) return;
      else if (value === "delete" || value === "backspace") name = "delete";
      else if (value === "escape") {
        gestures.cancel();
        session.select([]);
        setEdit(null);
        return;
      } else if (value === "v") {
        setTool("pan");
        return;
      } else if (value === "h") {
        setTool("pan");
        return;
      } else if (value === "t") {
        create("text");
        return;
      } else if (value === "f") name = "fit";
      if (name) {
        event.preventDefault();
        handlers.current.command(name);
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (editable(event.target)) return;
      if (event.clipboardData?.files.length) {
        event.preventDefault();
        void media.importFiles(event.clipboardData.files).catch(report);
        return;
      }
      if (
        clipboard.current &&
        event.clipboardData?.getData("application/x-yingxu-studio") ===
          clipboardToken.current
      ) {
        event.preventDefault();
        const source = clipboard.current;
        const ids = new Map(source.nodes.map((node) => [node.id, studioId()]));
        const nodes = structuredClone(source.nodes).map((node) => ({
          ...node,
          id: ids.get(node.id)!,
          position: { x: node.position.x + 64, y: node.position.y + 64 },
          metadata: {
            ...node.metadata,
            groupId: ids.get(node.metadata?.groupId || ""),
            status:
              node.metadata?.status === "loading"
                ? ("idle" as const)
                : node.metadata?.status,
            videoTaskId: undefined,
            prompt: node.metadata?.prompt?.replace(
              /@\[node:([^\]]+)\]/g,
              (_, id: string) => `@[node:${ids.get(id) || id}]`,
            ),
            composerContent: node.metadata?.composerContent?.replace(
              /@\[node:([^\]]+)\]/g,
              (_, id: string) => `@[node:${ids.get(id) || id}]`,
            ),
          },
        }));
        session.insert(
          nodes,
          source.connections.map((edge) => ({
            id: studioId(),
            fromNodeId: ids.get(edge.fromNodeId)!,
            toNodeId: ids.get(edge.toNodeId)!,
          })),
        );
        clipboard.current = {
          nodes,
          connections: session
            .read()
            .connections.filter(
              (edge) =>
                nodes.some((node) => node.id === edge.fromNodeId) &&
                nodes.some((node) => node.id === edge.toNodeId),
            ),
        };
        return;
      }
      const text = event.clipboardData?.getData("text/plain");
      if (!text?.trim()) return;
      event.preventDefault();
      const point = handlers.current.center();
      session.insert([
        makeStudioNode(
          "text",
          point.x,
          point.y,
          word("粘贴的文本", "Pasted text"),
          { content: text.slice(0, 100_000) },
        ),
      ]);
    };
    const copy = (event: ClipboardEvent) => {
      if (
        editable(event.target) ||
        !session.snapshot().selection.size ||
        !clipboard.current ||
        !event.clipboardData
      )
        return;
      event.preventDefault();
      clipboardToken.current = studioId();
      event.clipboardData.setData(
        "application/x-yingxu-studio",
        clipboardToken.current,
      );
      event.clipboardData.setData(
        "text/plain",
        clipboard.current.nodes
          .map((node) => node.metadata?.content || node.title)
          .join("\n"),
      );
    };
    window.addEventListener("keydown", key);
    window.addEventListener("paste", paste);
    window.addEventListener("copy", copy);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("paste", paste);
      window.removeEventListener("copy", copy);
    };
  });
  const applyPlan = (plan: CodexCanvasPlan) => {
    if (!alive()) return;
    const point = center();
    const mapping = new Map(plan.nodes.map((node) => [node.id, studioId()]));
    const nodes = plan.nodes.map((value) => ({
      ...makeStudioNode(
        value.type,
        value.x + point.x,
        value.y + point.y,
        value.title,
        {
          content: value.type === "text" ? value.content : undefined,
          prompt: value.prompt,
          composerContent: value.prompt,
          generationMode: value.mode,
        },
      ),
      id: mapping.get(value.id)!,
    }));
    session.insert(
      nodes,
      plan.connections.map((edge) => ({
        id: studioId(),
        fromNodeId: mapping.get(edge.from)!,
        toNodeId: mapping.get(edge.to)!,
      })),
    );
    fit();
    setNotice(
      word(
        "Codex 规划已加入画布，生成任务等待你确认",
        "Codex plan added; generation awaits your confirmation",
      ),
    );
  };
  const selected =
    doc.nodes.find((node) => state.selection.has(node.id)) || null;
  const extension = pluginPanel
    ? doc.nodes.find((node) => node.id === pluginPanel)
    : null;
  const Panel = extension
    ? getAtlasNodeDefinition(extension.type)?.Panel
    : null;
  const context = (node: CanvasNodeData) =>
    studioPluginContext(session, node, {
      config,
      theme,
      open: setPluginPanel,
      generate: (id, mode, prompt) => {
        void tasks.generate(id, mode, prompt).catch(report);
      },
    });
  const generate = (id: string, mode: CanvasGenerationMode, prompt: string) => {
    const node = session.read().nodes.find((item) => item.id === id);
    const catalog = getPlatformInit()?.models;
    if (node && catalog && (mode === "image" || mode === "video")) {
      const selectedModel =
        mode === "image"
          ? selectImageModel(catalog.image, node.metadata?.model)
          : selectVideoModel(catalog.video, node.metadata?.model);
      if (selectedModel)
        session.metadata(id, { model: `platform::${selectedModel.id}` });
    }
    void tasks.generate(id, mode, prompt).catch(report);
  };
  const inspectorFor = (section?: StudioNodeSection, onAction = action) => (
    <StudioInspector
      section={section}
      compact={Boolean(section)}
      node={selected}
      nodes={doc.nodes}
      connections={doc.connections}
      selectedCount={state.selection.size}
      busy={selected ? tasks.isRunning(selected.id) : false}
      onPatch={(id, patch) => session.patch(id, patch)}
      onMetadata={(id, patch) => session.metadata(id, patch)}
      onAction={onAction}
      onGenerate={generate}
      onStop={(id) => tasks.stop(id)}
    />
  );
  const inspector = inspectorFor();
  return (
    <StudioChrome
      title={title}
      onRename={(name) => {
        useCanvasStore.getState().renameProject(projectId, name);
        void platformRequest("platform.action", {
          action: "renameProject",
          title: name,
        }).catch(report);
      }}
      tool={tool}
      onTool={setTool}
      onCreate={create}
      onCommand={command}
      undo={state.undo}
      redo={state.redo}
      nodeCount={doc.nodes.length}
      selectedCount={state.selection.size}
      scale={doc.viewport.k}
      background={doc.backgroundMode}
      onBackground={(backgroundMode) =>
        session.change((current) => ({ ...current, backgroundMode }))
      }
      onScale={zoom}
      notice={notice}
      codexOpen={codex}
      onCodex={() => setCodex((value) => !value)}
      libraryOpen={library}
      draftsOpen={drafts}
      drafts={
        drafts && (
          <StudioNodeDrafts
            nodes={doc.nodes}
            selection={state.selection}
            onFocus={focusDraft}
            onClose={() => setDrafts(false)}
            onCreate={create}
          />
        )
      }
      library={
        library && (
          <Suspense
            fallback={
              <div className="studio-library-loading" role="status">
                {word("正在读取素材…", "Loading materials…")}
              </div>
            }
          >
            <Library
              embedded
              referenceOnly={Boolean(referenceTarget)}
              nodes={doc.nodes}
              insertLabel={
                referenceTarget
                  ? word("添加为节点参考", "Add as reference")
                  : undefined
              }
              onUpload={() => {
                uploadReference.current = referenceTarget;
                replace.current = undefined;
                file.current?.click();
              }}
              onClose={() => {
                setLibrary(false);
                setReferenceTarget(undefined);
              }}
              onInsert={async (payload) => {
                const target = referenceTarget;
                if (
                  target &&
                  payload.kind !== "image" &&
                  payload.kind !== "text"
                )
                  throw new Error(
                    word(
                      "请选择图片或文字作为参考素材。",
                      "Choose an image or text reference.",
                    ),
                  );
                const inserted = await media.insertAsset(payload, target);
                if (!inserted)
                  throw new Error(
                    word(
                      "素材未能加入画布，请检查文件后重试。",
                      "Could not add this asset. Check the file and retry.",
                    ),
                  );
                if (
                  target &&
                  session.read().nodes.some((node) => node.id === target)
                ) {
                  session.select([target]);
                  setNotice(
                    word(
                      "素材已加入并连接到当前节点",
                      "Material added and connected to this node",
                    ),
                  );
                }
              }}
            />
          </Suspense>
        )
      }
      inspector={
        <>
          {inspector}
          {Panel && extension && (
            <section className="studio-extension-panel">
              <button type="button" onClick={() => setPluginPanel(null)}>
                {word("关闭扩展面板", "Close extension")}
              </button>
              <Panel
                ctx={context(extension)}
                onClose={() => setPluginPanel(null)}
              />
            </section>
          )}
        </>
      }
    >
      <StudioContextMenu
        session={session}
        onCommand={command}
        onCreate={create}
        onBeforeOpen={gestures.cancel}
        onClose={() => surface.current?.focus({ preventScroll: true })}
      >
        <AtlasCanvasViewport
          containerRef={surface}
          viewport={doc.viewport}
          tool={tool}
          backgroundMode={
            doc.backgroundMode === "none" ? "blank" : doc.backgroundMode
          }
          onViewportChange={session.moveViewport}
          onInteractionStart={camera.stop}
          animating={cameraMoving}
          zoomLimits={STUDIO_ZOOM_LIMITS}
          gesture={gestures.interaction}
          onCanvasDeselect={() => session.select([])}
          onCanvasMouseDown={gestures.onCanvasDown}
          onCanvasDoubleClick={(event) => {
            if (
              !(event.target instanceof Element) ||
              !event.target.closest("[data-node-id]")
            )
              create("text");
          }}
          onDrop={(event) => {
            event.preventDefault();
            void media.importFiles(event.dataTransfer.files).catch(report);
          }}
        >
          <StudioScene
            document={doc}
            selection={state.selection}
            edge={state.edge}
            size={size}
            wire={gestures.wire}
            marquee={gestures.marquee}
            interaction={gestures.interaction}
            onNodeDown={gestures.onNodeDown}
            onConnect={gestures.onConnect}
            onResize={gestures.onResize}
            onSelect={(id) => session.select([id])}
            onEdge={(id) => session.select([], id)}
            onTitle={(id, name) => session.patch(id, { title: name })}
            onContent={(id, content) => session.metadata(id, { content })}
            onAction={action}
            renderExtension={(node) =>
              node.type === "platform:composition" ? (
                <Suspense fallback={null}>
                  <Sequence
                    node={node}
                    nodes={doc.nodes}
                    connections={doc.connections}
                    onMetadata={(patch) => session.metadata(node.id, patch)}
                  />
                </Suspense>
              ) : (
                studioExtensionContent(node, context(node))
              )
            }
          />
        </AtlasCanvasViewport>
      </StudioContextMenu>
      {selected && state.selection.size === 1 && (
        <StudioNodeDock
          key={selected.id}
          node={selected}
          viewport={doc.viewport}
          size={size}
          moving={Boolean(gestures.interaction)}
          composer={inspectorFor}
          onMode={(generationMode) =>
            session.metadata(selected.id, {
              generationMode,
              ...(selected.metadata?.generationMode !== generationMode
                ? { model: undefined }
                : {}),
            })
          }
          onAction={action}
          onAssets={() => {
            setReferenceTarget(undefined);
            setDrafts(false);
            setLibrary(true);
          }}
          onReveal={revealComposer}
        />
      )}
      {!doc.nodes.length && (
        <section className="studio-welcome">
          <span className="studio-welcome-index">01 / CREATIVE SPACE</span>
          <h1>{word("把想法连成作品。", "Connect ideas. Create stories.")}</h1>
          <p>
            {word(
              "从一段文字、一张参考图开始，让素材与模型在画布上协作。",
              "Start with a note or a reference. Connect materials to a creative model.",
            )}
          </p>
          <div>
            <button onClick={() => create("text")}>
              {word("写下想法", "Write an idea")}
            </button>
            <button onClick={() => setCodex(true)}>
              {word("与 Codex 规划", "Plan with Codex")}
            </button>
          </div>
          <small>
            {word(
              "底部创建节点 · 拖动两侧端口建立连接 · 空格拖动画布",
              "Create below · Link side ports · Hold Space to pan",
            )}
          </small>
        </section>
      )}
      {overview && (
        <aside className="studio-document-map">
          <header>
            {word("画布导航", "Canvas navigator")}
            <button
              onClick={() => setOverview(false)}
              aria-label={word("关闭导航", "Close navigator")}
            >
              ×
            </button>
          </header>
          <input
            placeholder={word("搜索节点…", "Find a node…")}
            aria-label={word("搜索节点", "Find a node")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div>
            {doc.nodes
              .filter((node) =>
                node.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((node) => (
                <button key={node.id} onClick={() => focusDraft(node.id)}>
                  <span>{node.type.toUpperCase()}</span>
                  {node.title}
                </button>
              ))}
          </div>
        </aside>
      )}
      <input
        ref={file}
        type="file"
        hidden
        multiple
        accept="image/*,video/*,audio/*"
        onChange={(event) => {
          if (event.target.files) {
            const target = uploadReference.current;
            const uploads = Array.from(event.target.files).filter(
              (file) => !target || file.type.startsWith("image/"),
            );
            if (target && uploads.length !== event.target.files.length)
              setNotice(
                word(
                  "参考素材仅支持图片；视频和音频请作为独立素材上传。",
                  "Use images as generation references. Import video and audio as separate materials.",
                ),
              );
            void media
              .importFiles(uploads, replace.current, target)
              .then((inserted) => {
                if (
                  !inserted ||
                  !target ||
                  !alive() ||
                  !session.read().nodes.some((node) => node.id === target)
                )
                  return;
                session.select([target]);
              })
              .catch(report);
          }
          uploadReference.current = undefined;
          replace.current = undefined;
          event.target.value = "";
        }}
      />
      <Suspense fallback={null}>
        {plugins && <Plugins open onClose={() => setPlugins(false)} />}
        {codex && (
          <CodexPanel
            open
            onClose={() => setCodex(false)}
            projectId={projectId}
            snapshot={{ nodes: doc.nodes, connections: doc.connections }}
            onApply={applyPlan}
          />
        )}
        {(edit || preview) && (
          <Dialogs
            edit={edit}
            onClose={() => setEdit(null)}
            onConfirm={(node, operation, params) => {
              void media.edit(node, operation, params).catch(report);
            }}
            preview={preview}
            onPreviewClose={() => setPreview(null)}
          />
        )}
      </Suspense>
    </StudioChrome>
  );
}

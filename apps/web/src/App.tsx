import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  Atom,
  House,
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  CloudCheck,
  DownloadSimple,
  FilmStrip,
  FolderSimple,
  GearSix,
  GithubLogo,
  ImageSquare,
  Lightning,
  MagnifyingGlass,
  NotePencil,
  Plus,
  SignOut,
  Sparkle,
  SquaresFour,
  Stack,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api, ApiError, json, message } from "./api";
import {
  Empty,
  finished,
  jobNames,
  Modal,
  cn,
} from "./components";
import type { CanvasEngineHandle } from "./CanvasEngine";
const CanvasEngine = lazy(() => import("./CanvasEngine").then((module) => ({ default: module.CanvasEngine })));
const CanvasStoryWorkflow = lazy(() => import("./CanvasStoryWorkflow").then((module) => ({ default: module.CanvasStoryWorkflow })));
import { assembledPrompt, canvasInputs } from "./canvasInputs";
import {
  displaySize,
  emptyDocument,
  readDocument,
  serializeDocument,
  useCanvas,
} from "./store";
import { readDraft, writeDraft } from "./drafts";
import { AccountMenu } from "./AccountMenu";
import { ReviewerLogin } from "./ReviewerLogin";
import { Home } from "./Home";
import { useDraftLibrary } from "./useDraftLibrary";
import type { DraftKind, DraftSummary } from "./draftLibraryModel";
import { DraftMenu, WorkspaceBoundary, WorkspaceLoader } from "./WorkspaceNavigation";
import type { ScienceStudioHandle } from "./ScienceStudio";
const ScienceStudio = lazy(() => import("./ScienceStudio").then((module) => ({ default: module.ScienceStudio })));
const PoolPanel = lazy(() => import("./PoolPanel").then((module) => ({ default: module.PoolPanel })));
const ModelSettings = lazy(() => import("./ModelSettings").then((module) => ({ default: module.ModelSettings })));
import type { ExecutableSkill, SkillDefinition } from "./SkillMarket";
const SkillMarket = lazy(() => import("./SkillMarket").then((module) => ({ default: module.SkillMarket })));
import { findModel, modelId, modelPatch, validateModel } from "./models";
import { prepareSkill } from "./skillRecipe";
import type { Asset, Bootstrap, CanvasPoint, CreativeData, CreativeKind, CreativeNode, Job, Project } from "./types";

type Mode = "home" | "science" | "canvas" | "image" | "assets" | "jobs";
const views: { id: Mode; label: string; icon: typeof Sparkle }[] = [
  { id: "home", label: "主页", icon: House },
  { id: "science", label: "科普短视频", icon: Atom },
  { id: "canvas", label: "创作画布", icon: SquaresFour },
];

export default function App() {
  return <Workbench />;
}
function Workbench() {
  const canvas = useCanvas();
  const engineRef = useRef<CanvasEngineHandle>(null);
  const [readyCanvasProject, setReadyCanvasProject] = useState("");
  const scienceRef = useRef<ScienceStudioHandle>(null);
  const [openedWorkspaces, setOpenedWorkspaces] = useState<Record<string, string>>({});
  const workspaceTransition = useRef(false);
  const navigationSequence = useRef(0);
  const pendingEngineCommand = useRef<{ projectId: string; command: string; payload: unknown } | null>(null);
  const [engineCommandVersion, setEngineCommandVersion] = useState(0);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const authEpoch = useRef(0);
  const authTransition = useRef(false);
  const sessionUser = useRef<string | null | undefined>(undefined);
  const refreshSequence = useRef(0);
  const catalogRefreshSequence = useRef(0);
  const [bootError, setBootError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [scienceHeading, setScienceHeading] = useState({ projectId: "", title: "" });
  const projectRef = useRef(project);
  projectRef.current = project;
  const projectLoadSequence = useRef(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [mode, setMode] = useState<Mode>("home");
  const [leftTab, setLeftTab] = useState<"canvas" | "assets" | "skills">("canvas");
  const draftLibrary = useDraftLibrary(bootstrap?.user?.id, mode === "home");
  const [modal, setModal] = useState<
    "login" | "skills" | "pool" | "settings" | "story" | null
  >(null);
  const [settingsCapability, setSettingsCapability] = useState<"text" | "vision" | "image" | "video">("text");
  const [modelCatalogVersion, setModelCatalogVersion] = useState(0);
  const openModelSettings = (capability: "text" | "vision" | "image" | "video" = "text") => {
    if (!bootstrap?.user) { setModal("login"); return; }
    setSettingsCapability(capability);
    setModal("settings");
  };
  const openSettings = () => openModelSettings();
  const [busy, setBusy] = useState("");
  const [recoveringJobs, setRecoveringJobs] = useState<Set<string>>(new Set());
  const recoveryRequests = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const pendingProjectSave = useRef<Promise<Project | null> | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const referenceUploadNode = useRef<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(new Set<string>());
  const selected = canvas.document.nodes.find((node) => node.selected);
  const selectedModel =
    selected && selected.data.kind !== "note"
      ? findModel(
          bootstrap?.models[selected.data.kind],
          selected.data.model ||
            (selected.data.kind === "video" ? "muse-video" : "muse-image"),
        )
      : undefined;
  const dirty = canvas.editVersion !== canvas.savedVersion;
  const activeJobs = jobs.filter((job) => !finished(job)).length;
  useEffect(() => {
    if (project && ["canvas", "science"].includes(mode))
      setOpenedWorkspaces((opened) => opened[mode] === project.id ? opened : { ...opened, [mode]: project.id });
  }, [mode, project?.id]);
  const dispatchPendingCanvasCommand = useCallback(() => {
    const pending = pendingEngineCommand.current;
    if (pending && projectRef.current?.id === pending.projectId && engineRef.current?.isReady()) {
      engineRef.current.command(pending.command, pending.payload);
      pendingEngineCommand.current = null;
    }
  }, []);
  useEffect(() => {
    dispatchPendingCanvasCommand();
  }, [project?.id, engineCommandVersion, dispatchPendingCanvasCommand]);
  const latestJobs = useMemo(
    () =>
      Object.fromEntries([...jobs].reverse().map((job) => [job.nodeId, job])),
    [jobs],
  );

  const loadProject = useCallback(async (id: string) => {
    const epoch = authEpoch.current;
    const sequence = ++projectLoadSequence.current;
    const next = await api<Project>(`/projects/${id}`);
    if (epoch !== authEpoch.current || sequence !== projectLoadSequence.current)
      return;
    let document = readDocument(next.document);
    try {
      const draft = await readDraft(id);
      if (
        epoch !== authEpoch.current ||
        sequence !== projectLoadSequence.current
      )
        return;
      if (
        draft &&
        draft.baseRevision === next.revision &&
        draft.updatedAt > Date.parse(next.updatedAt) &&
        JSON.stringify(draft.document) !== JSON.stringify(document)
      ) {
        document = readDocument(draft.document);
        setNotice("已恢复本机尚未同步的草稿，请检查后保存。");
      }
    } catch {
      /* Local recovery must not block the durable project. */
    }
    if (epoch !== authEpoch.current || sequence !== projectLoadSequence.current)
      return;
    projectRef.current = next;
    setProject(next);
    setConflict(false);
    setError("");
    setReferenceId("");
    setJobs([]);
    setAssets([]);
    useCanvas.getState().load(document);
    if (JSON.stringify(document) !== JSON.stringify(next.document))
      useCanvas.setState({ editVersion: 1 });
    localStorage.setItem("frameflow:last-project", id);
    const owner = sessionUser.current;
    const current = () =>
      epoch === authEpoch.current &&
      sequence === projectLoadSequence.current &&
      owner === sessionUser.current &&
      projectRef.current?.id === id;
    const [nextJobs, nextAssets] = await Promise.all([
      api<Job[]>(`/jobs?projectId=${id}`),
      api<Asset[]>(`/assets?projectId=${id}`),
    ]);
    if (!current()) return;
    setJobs((items) => {
      if (!current()) return items;
      const merged = new Map(
        nextJobs.filter((job) => job.projectId === id).map((job) => [job.id, job]),
      );
      for (const job of items) {
        if (job.projectId !== id) continue;
        const fetched = merged.get(job.id);
        if (!fetched || (Date.parse(job.updatedAt) || 0) >= (Date.parse(fetched.updatedAt) || 0))
          merged.set(job.id, job);
      }
      return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    });
    setAssets((items) => {
      if (!current()) return items;
      const merged = new Map(
        nextAssets.filter((asset) => asset.projectId === id).map((asset) => [asset.id, asset]),
      );
      for (const asset of items)
        if (asset.projectId === id) merged.set(asset.id, asset);
      return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    });
  }, []);

  const refresh = useCallback(async () => {
    let epoch = authEpoch.current;
    const sequence = ++refreshSequence.current;
    const current = () =>
      epoch === authEpoch.current && sequence === refreshSequence.current;
    setBootError("");
    try {
      const data = await api<Bootstrap>("/bootstrap");
      if (!current()) return;
      const owner = data.user?.id || null;
      if (sessionUser.current !== undefined && sessionUser.current !== owner) {
        if (!authTransition.current) epoch = ++authEpoch.current;
        projectLoadSequence.current += 1;
        projectRef.current = null;
        setProject(null);
        setProjects([]);
        setJobs([]);
        setAssets([]);
        setBusy("");
        setSaving(false);
        setConnected(false);
        setReferenceId("");
        setNotice("");
        setConflict(false);
        setOpenedWorkspaces({});
        pendingEngineCommand.current = null;
        useCanvas.getState().load(emptyDocument());
      }
      sessionUser.current = owner;
      setBootstrap(data);
      if (data.user) {
        const list = await api<Project[]>("/projects");
        if (!current()) return;
        setProjects(list);
        // Opening the library must not download or initialize every editor.
        // A document is loaded only after the user opens its own draft.
        if (!list.some((item) => item.id === projectRef.current?.id)) {
          projectLoadSequence.current += 1;
          projectRef.current = null;
          setProject(null);
          setJobs([]);
          setAssets([]);
          useCanvas.getState().load(emptyDocument());
        }
      } else {
        projectLoadSequence.current += 1;
        projectRef.current = null;
        setProject(null);
        setProjects([]);
        setJobs([]);
        setAssets([]);
        useCanvas.getState().load(emptyDocument());
      }
    } catch (cause) {
      if (current()) setBootError(message(cause));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshGenerationCatalog = useCallback(async () => {
    const epoch = authEpoch.current;
    const sequence = ++catalogRefreshSequence.current;
    try {
      const next = await api<Bootstrap>("/bootstrap");
      if (epoch !== authEpoch.current || sequence !== catalogRefreshSequence.current) return;
      setBootstrap((current) => current?.user?.id === next.user?.id ? next : current);
      setModelCatalogVersion((version) => version + 1);
    } catch (cause) {
      if (epoch === authEpoch.current && sequence === catalogRefreshSequence.current)
        setError(message(cause));
    }
  }, []);

  useEffect(() => {
    if (!bootstrap?.user) return;
    const epoch = authEpoch.current;
    let active = true;
    const current = () => active && epoch === authEpoch.current;
    const source = new EventSource("/api/events", { withCredentials: true });
    const reconcile = () => {
      const id = projectRef.current?.id;
      if (id)
        api<Job[]>(`/jobs?projectId=${id}`)
          .then((data) => {
            if (current() && projectRef.current?.id === id) setJobs(data);
          })
          .catch(() => {});
    };
    source.onopen = () => {
      if (!current()) return;
      setConnected(true);
      reconcile();
    };
    source.onerror = () => {
      if (current()) setConnected(false);
    };
    source.addEventListener("reconcile", reconcile);
    source.addEventListener("job", (event) => {
      try {
        if (!current()) return;
        const job = JSON.parse((event as MessageEvent).data) as Job;
        if (job.projectId !== projectRef.current?.id) return;
        setJobs((current) => [
          job,
          ...current.filter((item) => item.id !== job.id),
        ]);
        if (job.status === "succeeded") {
          setNotice("新的生成结果已就绪，可在生成记录中预览并加入画布。");
          api<Asset[]>(`/assets?projectId=${job.projectId}`)
            .then((data) => {
              if (current() && projectRef.current?.id === job.projectId)
                setAssets(data);
            })
            .catch(() => {});
        }
      } catch {
        /* Reconnect reconciliation is authoritative. */
      }
    });
    const fallback = window.setInterval(() => {
      if (source.readyState !== EventSource.OPEN && !document.hidden)
        reconcile();
    }, 20000);
    return () => {
      active = false;
      source.close();
      window.clearInterval(fallback);
    };
  }, [bootstrap?.user?.id]);

  const save = useCallback(async (): Promise<Project | null> => {
    if (pendingProjectSave.current) return pendingProjectSave.current;
    const epoch = authEpoch.current;
    const current = projectRef.current;
    if (!current || conflict) return null;
    setSaving(true);
    setError("");
    const version = useCanvas.getState().editVersion;
    const document = serializeDocument();
    const operation = (async () => { try {
      const saved = await api<Project>(`/projects/${current.id}`, {
        method: "PUT",
        body: json({
          baseRevision: current.revision,
          title: current.title,
          document,
        }),
      });
      if (
        epoch === authEpoch.current &&
        projectRef.current?.id === current.id
      ) {
        // Preserve a title typed while this save was in flight.
        const updated = { ...saved, title: projectRef.current.title };
        projectRef.current = updated;
        setProject(updated);
        useCanvas.getState().markSaved(version);
        setProjects((items) =>
          items.map((item) =>
            item.id === saved.id ? { ...saved, title: updated.title } : item,
          ),
        );
      }
      return epoch === authEpoch.current ? saved : null;
    } catch (cause) {
      if (
        epoch === authEpoch.current &&
        projectRef.current?.id === current.id
      ) {
        if (cause instanceof ApiError && cause.status === 409)
          setConflict(true);
        setError(message(cause));
      }
      return null;
    } finally {
      pendingProjectSave.current = null;
      if (epoch === authEpoch.current) setSaving(false);
    } })();
    pendingProjectSave.current = operation;
    return operation;
  }, [conflict]);
  useEffect(() => {
    if (!project || !dirty || conflict) return;
    void writeDraft({
      id: project.id,
      baseRevision: project.revision,
      document: serializeDocument(),
      updatedAt: Date.now(),
    }).catch(() => {});
    const timer = window.setTimeout(() => {
      void save();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    canvas.editVersion,
    canvas.savedVersion,
    project?.id,
    project?.revision,
    project?.title,
    dirty,
    conflict,
    save,
  ]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        useCanvas.getState().editVersion !== useCanvas.getState().savedVersion
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  async function flushWorkspace() {
    if (scienceRef.current && !(await scienceRef.current.save()))
      throw new Error("科普草稿尚未保存，请完成同步后重试。");
    if (engineRef.current && !(await engineRef.current.flush()))
      throw new Error("画布草稿尚未保存，请完成同步后重试。");
    if (pendingProjectSave.current && !(await pendingProjectSave.current))
      throw new Error("项目保存失败，请检查同步状态后重试。");
    const state = useCanvas.getState();
    if (projectRef.current && state.editVersion !== state.savedVersion) {
      if (!(await save()) || useCanvas.getState().editVersion !== useCanvas.getState().savedVersion)
        throw new Error("仍有未同步的修改，请等待保存后重试。");
    }
  }

  async function createProject(
    document = emptyDocument(),
    title = "未命名创作",
    saveCurrent = true,
    draftKind?: DraftKind,
    destination: DraftKind = draftKind || "canvas",
  ) {
    if (workspaceTransition.current) return null;
    if (!bootstrap?.user || authTransition.current) {
      setModal("login");
      return null;
    }
    workspaceTransition.current = true;
    navigationSequence.current += 1;
    setBusy("project");
    const epoch = authEpoch.current;
    setError("");
    try {
      if (saveCurrent) await flushWorkspace();
      if (epoch !== authEpoch.current) return null;
      const created = draftKind
        ? { id: (await api<DraftSummary>("/drafts", { method: "POST", body: json({ kind: draftKind, title }) })).projectId }
        : await api<Project>("/projects", { method: "POST", body: json({ title, document }) });
      if (epoch !== authEpoch.current) return null;
      await loadProject(created.id);
      const loaded = projectRef.current;
      if (epoch !== authEpoch.current || loaded?.id !== created.id) return null;
      setProjects((items) => [loaded, ...items.filter((item) => item.id !== loaded.id)]);
      if (draftKind) localStorage.setItem(`frameflow:draft:${bootstrap.user.id}:${draftKind}`, loaded.id);
      setMode(destination);
      return loaded;
    } catch (cause) {
      if (epoch === authEpoch.current) setError(message(cause));
      return null;
    } finally {
      workspaceTransition.current = false;
      if (epoch === authEpoch.current) setBusy("");
    }
  }
  async function switchProject(id: string) {
    const epoch = authEpoch.current;
    if (authTransition.current || workspaceTransition.current) return false;
    if (projectRef.current?.id === id) return true;
    workspaceTransition.current = true; setBusy("project");
    try {
      await flushWorkspace();
      if (epoch !== authEpoch.current) return false;
      await loadProject(id);
      return epoch === authEpoch.current && projectRef.current?.id === id;
    } catch (cause) {
      if (epoch === authEpoch.current) setError(message(cause));
      return false;
    } finally {
      workspaceTransition.current = false;
      if (epoch === authEpoch.current) setBusy("");
    }
  }
  function addCanvasNode(kind: CreativeKind, data: Partial<CreativeData> = {}, position?: CanvasPoint) {
    if (position) return canvas.add(kind, data, position);
    const nodes = useCanvas.getState().document.nodes;
    const size = displaySize({
      id: "insertion-preview", type: "creative", position: { x: 0, y: 0 },
      data: { kind, title: "", prompt: "", ...data },
    });
    const anchor = nodes.filter((node) => node.selected).at(-1) || nodes.at(-1);
    const middle = { x: 260, y: 220 };
    const point = anchor ? {
      x: anchor.position.x + displaySize(anchor).width + 96,
      y: anchor.position.y + (displaySize(anchor).height - size.height) / 2,
    } : { x: middle.x - size.width / 2, y: middle.y - size.height / 2 };
    // Keep space for ports and curved connections without moving existing objects.
    for (let attempt = 0; attempt <= nodes.length; attempt++) {
      const occupied = nodes.filter((node) => {
        const other = displaySize(node);
        return point.x < node.position.x + other.width + 32 &&
          point.x + size.width + 32 > node.position.x &&
          point.y < node.position.y + other.height + 32 &&
          point.y + size.height + 32 > node.position.y;
      });
      if (!occupied.length) break;
      point.x = Math.max(...occupied.map((node) => node.position.x + displaySize(node).width)) + 96;
    }
    return canvas.add(kind, data, point);
  }
  async function addNode(kind: CreativeKind, position?: { x: number; y: number }) {
    if (!bootstrap?.user || authTransition.current) {
      setModal("login");
      return;
    }
    const epoch = authEpoch.current;
    if (!projectRef.current && !(await createProject())) return;
    if (epoch !== authEpoch.current) return;
    addCanvasNode(kind, {}, position);
    setMode("canvas");
    setReferenceId("");
  }
  async function generateFromNote(id: string) {
    const note = useCanvas.getState().document.nodes.find((item) => item.id === id);
    if (!note || note.data.kind !== "note" || !note.data.prompt.trim()) return;
    if (!bootstrap?.user || authTransition.current) {
      setModal("login");
      return;
    }
    const imageId = addCanvasNode("image", {
      title: `${note.data.title || "灵感笔记"} · 图片`,
      prompt: "",
    }, { x: note.position.x + 420, y: note.position.y });
    canvas.connect({ source: note.id, target: imageId, sourceHandle: "output", targetHandle: "input" });
    setMode("canvas");
    setInspectorOpen(false);
    await generate(imageId);
  }
  async function authenticateLocal(credentials?: { username: string; password: string }) {
    if (authTransition.current) return;
    authTransition.current = true;
    navigationSequence.current += 1;
    const epoch = ++authEpoch.current;
    setBusy("login");
    setError("");
    try {
      await api(credentials ? "/auth/reviewer" : "/auth/local", { method: "POST", body: json(credentials || {}) });
      if (epoch !== authEpoch.current) return;
      setModal(null);
      await refresh();
    } catch (cause) {
      if (epoch === authEpoch.current) setError(message(cause));
    } finally {
      if (epoch === authEpoch.current) {
        authTransition.current = false;
        setBusy("");
      }
    }
  }
  async function generate(id: string, transientNode?: CreativeNode) {
    if (authTransition.current) return;
    const epoch = authEpoch.current;
    const currentProject = projectRef.current;
    let node = transientNode || useCanvas.getState().document.nodes.find((item) => item.id === id);
    if (
      !currentProject ||
      !node ||
      node.data.kind === "note" ||
      submitting.current.has(id)
    )
      return;
    if (!assembledPrompt(transientNode ? [] : canvasInputs(useCanvas.getState().document, id).notes, node.data.prompt)) {
      setError("填写提示词，或连接一个有内容的文字框。");
      return;
    }
    submitting.current.add(id);
    setBusy(id);
    setError("");
    try {
      // Freeze all current inputs before the backend creates its input revision.
      if (
        !transientNode &&
        useCanvas.getState().editVersion !==
          useCanvas.getState().savedVersion &&
        !(await save())
      )
        throw new Error("请等待画布保存完成后重试。");
      if (projectRef.current?.id !== currentProject.id)
        throw new Error("项目已切换，请在当前项目重新提交。");
      if (epoch !== authEpoch.current) return;
      if (
        !transientNode &&
        useCanvas.getState().editVersion !== useCanvas.getState().savedVersion
      )
        throw new Error("最新编辑仍在同步，请保存完成后再生成。");
      const document = useCanvas.getState().document;
      node = transientNode || document.nodes.find((item) => item.id === id);
      if (!node || node.data.kind === "note")
        throw new Error("目标节点已移除或改变。");
      const inputs = transientNode ? { notes: [], imageIds: [], pendingImages: 0, videos: 0 } : canvasInputs(document, id);
      if (inputs.pendingImages > 0) throw new Error("请先为连入的图片框生成或上传图片，再执行下游任务。");
      if (inputs.videos > 0) throw new Error("当前生成接口支持文字和图片参考，请先断开视频输入。");
      const references = [
        ...new Set([
          ...(!transientNode && referenceId && selected?.id === id ? [referenceId] : []),
          ...(node.data.referenceAssetIds || []),
          ...inputs.imageIds,
        ]),
      ];
      validateModel(
        findModel(
          bootstrap?.models[node.data.kind],
          node.data.model ||
            (node.data.kind === "video" ? "muse-video" : "muse-image"),
        ),
        node.data,
        references.length,
      );
      if (node.data.skillId === "image-to-video" && !references.length)
        throw new Error(
          "图生视频技能需要至少一张参考图。请先上传素材或从图片节点连线。",
        );
      const payload = {
        projectId: currentProject.id,
        nodeId: id,
        kind: node.data.kind,
        prompt: assembledPrompt(inputs.notes, node.data.prompt),
        model:
          node.data.model ||
          (node.data.kind === "video" ? "muse-video" : "muse-image"),
        width: node.data.width || 1024,
        height: node.data.height || 1024,
        duration: node.data.duration || 5,
        referenceAssetIds: references,
        ...(node.data.kind === "video" ? { videoMode: node.data.videoMode || "reference" } : {}),
        skillId: node.data.skillId,
        skillVersion: node.data.skillVersion,
      };
      const submissionKey = `frameflow:submission:${currentProject.id}:${id}`;
      const fingerprint = json(payload);
      const pending = JSON.parse(
        sessionStorage.getItem(submissionKey) || "null",
      ) as { fingerprint: string; key: string } | null;
      if (pending && pending.fingerprint !== fingerprint)
        throw new Error(
          "上次提交结果尚未确认。请按原参数重试，以免重复生成；确认后再修改参数。",
        );
      const key = pending?.key || crypto.randomUUID();
      sessionStorage.setItem(submissionKey, json({ fingerprint, key }));
      let job: Job;
      try {
        job = await api<Job>("/jobs", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: fingerprint,
        });
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          cause.status >= 400 &&
          cause.status < 500 &&
          cause.status !== 408
        )
          sessionStorage.removeItem(submissionKey);
        throw cause;
      }
      sessionStorage.removeItem(submissionKey);
      if (epoch !== authEpoch.current) return;
      if (projectRef.current?.id === currentProject.id)
        setJobs((current) => [
          job,
          ...current.filter((item) => item.id !== job.id),
        ]);
      setNotice(transientNode ? "短视频任务已进入队列。" : "任务已保存并进入队列。你可以继续编辑画布。");
    } catch (cause) {
      if (epoch === authEpoch.current) setError(message(cause));
    } finally {
      submitting.current.delete(id);
      if (epoch === authEpoch.current) setBusy("");
    }
  }
  async function upload(file: File, position?: { x: number; y: number }, addToCanvas = mode === "canvas", referenceNodeId?: string | null) {
    if (!bootstrap?.user || authTransition.current) {
      setModal("login");
      return;
    }
    let current = projectRef.current;
    const epoch = authEpoch.current;
    if (!current) current = await createProject();
    if (!current || epoch !== authEpoch.current) return;
    if (!addToCanvas) setMode(mode);
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", current.id);
      const asset = await api<Asset>("/assets", { method: "POST", body: form });
      if (epoch !== authEpoch.current) return;
      if (projectRef.current?.id !== current.id) {
        setNotice("素材已保存到原项目，切回该项目即可查看。");
        return;
      }
      setAssets((items) => [asset, ...items]);
      if (referenceNodeId && asset.mimeType.startsWith("image/")) {
        const target = useCanvas.getState().document.nodes.find((item) => item.id === referenceNodeId);
        if (target) canvas.patch(target.id, { referenceAssetIds: [...new Set([...(target.data.referenceAssetIds || []), asset.id])] });
      }
      if (
        addToCanvas &&
        (asset.mimeType.startsWith("image/") || asset.mimeType.startsWith("video/"))
      ) {
        addCanvasNode(asset.mimeType.startsWith("video/") ? "video" : "image", {
          title: file.name,
          assetId: asset.id,
          url: asset.url,
        }, position);
        setMode("canvas");
      }
      setNotice("素材已上传并保存。");
    } catch (cause) {
      if (epoch === authEpoch.current) setError(message(cause));
    } finally {
      if (epoch === authEpoch.current) setBusy("");
    }
  }
  async function uploadFiles(files: File[], position?: { x: number; y: number }, referenceNodeId?: string | null) {
    for (const [index, file] of files.entries()) {
      const offset = position ? { x: position.x + index * 28, y: position.y + index * 28 } : undefined;
      await upload(file, offset, !referenceNodeId && mode === "canvas", referenceNodeId);
    }
  }
  function applyJob(job: Job) {
    if (job.projectId !== projectRef.current?.id) {
      setError("这个结果属于其他项目，请切换到对应项目。");
      return;
    }
    if (!job.resultUrl) return;
    pendingEngineCommand.current = { projectId: job.projectId, command: "insert", payload: { kind: job.kind, title: "生成结果", url: job.resultUrl, prompt: job.prompt, assetId: job.resultAssetId } };
    setEngineCommandVersion((value) => value + 1);
    setMode("canvas");
    setNotice("已将结果加入画布。");
  }
  async function recoverJob(job: Job) {
    if (recoveryRequests.current.has(job.id) || job.projectId !== projectRef.current?.id) return;
    const epoch = authEpoch.current;
    recoveryRequests.current.add(job.id);
    setRecoveringJobs(new Set(recoveryRequests.current));
    setError("");
    try {
      const result = await api<Job>(`/jobs/${job.id}/recover`, { method: "POST", body: json({}), signal: AbortSignal.timeout(110000) });
      if (epoch !== authEpoch.current || projectRef.current?.id !== job.projectId) return;
      setJobs((items) => items.map((item) => item.id === result.id ? result : item));
      setNotice(result.recoveryMessage || "已重新查询原任务，没有重新提交生成。");
      const nextAssets = await api<Asset[]>(`/assets?projectId=${job.projectId}`);
      if (epoch === authEpoch.current && projectRef.current?.id === job.projectId) setAssets(nextAssets);
    } catch (cause) {
      if (epoch === authEpoch.current && projectRef.current?.id === job.projectId) setError(message(cause));
    } finally {
      recoveryRequests.current.delete(job.id);
      if (epoch === authEpoch.current) setRecoveringJobs(new Set(recoveryRequests.current));
    }
  }
  function exportCanvas() {
    const url = URL.createObjectURL(
      new Blob([json(serializeDocument())], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project?.title || "创作画布"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importCanvas(file: File) {
    const epoch = authEpoch.current;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("画布文件不能超过 5MB");
      const document = readDocument(JSON.parse(await file.text()));
      if (epoch !== authEpoch.current) return;
      await createProject(document, file.name.replace(/\.json$/i, ""));
    } catch (cause) {
      if (epoch === authEpoch.current) setError(message(cause));
    }
  }
  async function useSkill(id: ExecutableSkill, definition: SkillDefinition) {
    if (!bootstrap?.user || authTransition.current) {
      setModal("login");
      return;
    }
    if (definition.id !== id) throw new Error("技能详情不匹配，请刷新市场。");
    const epoch = authEpoch.current;
    const prepared = prepareSkill(definition);
    const currentProject = projectRef.current || (await createProject());
    if (epoch !== authEpoch.current) return;
    if (!currentProject)
      throw new Error("暂时无法准备创作画布，请检查项目保存和连接状态后重试。");
    if (projectRef.current?.id !== currentProject.id) return;
    // Project creation may need one React commit before the native engine ref exists.
    pendingEngineCommand.current = { projectId: currentProject.id, command: "skill", payload: { ...prepared, title: definition.name } };
    setEngineCommandVersion((value) => value + 1);
    setNotice(`已将“${definition.name}” v${definition.recipeVersion} 加入画布，填写提示词后确认生成。${prepared.requiresReference ? "请选中参考图片使用，或把图片连到配置框左侧圆点。" : ""}`);
    setReferenceId("");
    setMode("canvas");
    setModal(null);
  }

  async function logout() {
    if (authTransition.current || workspaceTransition.current) return;
    authTransition.current = true;
    navigationSequence.current += 1;
    setBusy("logout");
    try { await flushWorkspace(); }
    catch (cause) {
      authTransition.current = false; setBusy(""); setError(message(cause));
      return;
    }
    ++authEpoch.current;
    sessionUser.current = null;
    projectLoadSequence.current += 1;
    setBootstrap((previous) => (previous ? { ...previous, user: null } : null));
    setProject(null);
    projectRef.current = null;
    setProjects([]);
    setJobs([]);
    setAssets([]);
    setConnected(false);
    setSaving(false);
    setBusy("");
    setConflict(false);
    setNotice("");
    setMode("home");
    setOpenedWorkspaces({});
    pendingEngineCommand.current = null;
    canvas.load(emptyDocument());
    setModal(null);
    try {
      await api("/auth/logout", { method: "POST" });
      await refresh();
    } catch (cause) {
      setError(message(cause));
      await refresh();
    } finally {
      authTransition.current = false;
    }
  }

  async function returnToLibrary(kind?: DraftKind) {
    if (workspaceTransition.current || authTransition.current) return;
    workspaceTransition.current = true;
    navigationSequence.current += 1;
    setBusy("navigation");
    setError("");
    if (kind) draftLibrary.setKind(kind);
    setMode("home");
    try {
      await flushWorkspace();
      // The library needs summaries only; release saved editors and their media/iframe memory.
      setOpenedWorkspaces({});
    } catch (cause) { setError(message(cause)); }
    finally { workspaceTransition.current = false; setBusy(""); }
  }
  async function showJobHistory() {
    if (!projectRef.current || workspaceTransition.current || authTransition.current) return;
    const epoch = authEpoch.current;
    workspaceTransition.current = true;
    navigationSequence.current += 1;
    setBusy("navigation");
    try {
      await flushWorkspace();
      if (epoch === authEpoch.current) setMode("jobs");
    } catch (cause) { if (epoch === authEpoch.current) setError(message(cause)); }
    finally { workspaceTransition.current = false; if (epoch === authEpoch.current) setBusy(""); }
  }
  async function openDraft(draft: DraftSummary) {
    navigationSequence.current += 1;
    if (await switchProject(draft.projectId)) {
      localStorage.setItem(`frameflow:draft:${bootstrap?.user?.id}:${draft.kind}`, draft.projectId);
      setMode(draft.kind);
      return true;
    }
    return false;
  }
  async function newDraft(kind: DraftKind) {
    return createProject(emptyDocument(), kind === "canvas" ? "未命名画布" : "未命名科普短视频", true, kind);
  }
  async function enterMode(destination: DraftKind) {
    if (workspaceTransition.current || authTransition.current) return false;
    const navigation = ++navigationSequence.current;
    if (!bootstrap?.user) { setModal("login"); return false; }
    const epoch = authEpoch.current;
    try {
      const page = await api<{items: DraftSummary[]}>(`/drafts?kind=${destination}&limit=1`);
      if (epoch !== authEpoch.current || navigation !== navigationSequence.current) return false;
      const remembered = localStorage.getItem(`frameflow:draft:${bootstrap.user.id}:${destination}`);
      if (remembered && projects.some((item) => item.id === remembered)) {
        if (!(await switchProject(remembered))) return false;
        setMode(destination); return true;
      } else if (page.items[0]) return openDraft(page.items[0]);
      else return Boolean(await newDraft(destination));
    } catch (cause) { if (epoch === authEpoch.current) setError(message(cause)); return false; }
  }
  const wideMode = ["home", "science", "canvas", "jobs"].includes(mode);
  const navigating = ["project", "navigation", "logout"].includes(busy);
  const view = views.find((item) => item.id === mode) || { label: mode === "jobs" ? "生成记录" : mode === "assets" ? "素材库" : "图像创作" };
  return (
    <><div className="workbench" inert={navigating} aria-busy={navigating}>
      <aside className="rail" aria-label="主导航">
        <a className="brand-mark" href="/" aria-label="映序首页" onClick={(event) => { event.preventDefault(); void returnToLibrary(); }}>
          <Stack size={26} weight="duotone" />
          <span className="brand-wordmark">映序<small>创作工作空间</small></span>
        </a>
        <span className="rail-section-label">工作空间</span>
        <div className="rail-links">
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={cn("rail-button", mode === id && "active")}
              onClick={() => { if (id === "home") void returnToLibrary(); else if (id === "canvas" || id === "science") void enterMode(id); }}
              aria-label={label}
              title={label}
            >
              <Icon size={23} weight={mode === id ? "fill" : "regular"} />
              <span>
                {label}
              </span>
            </button>
          ))}
          <div className="rail-drafts"><span className="rail-section-label">我的草稿</span>
            <button className="rail-button" onClick={() => void returnToLibrary("canvas")} title="画布草稿"><FolderSimple size={21}/><span>画布草稿</span></button>
            <button className="rail-button" onClick={() => void returnToLibrary("science")} title="科普草稿"><FilmStrip size={21}/><span>科普草稿</span></button>
          </div>
        </div>
        <button
          className="rail-button"
          onClick={openSettings}
          aria-label="工作台设置"
        >
          <GearSix size={23} />
          <span>设置</span>
        </button>
        <AccountMenu
          user={bootstrap?.user || null}
          onAccount={() => setModal("login")}
          onPool={() => setModal("pool")}
          onSkills={() => setModal("skills")}
          onSettings={openSettings}
          onLogout={() => void logout()}
        />
      </aside>
      <aside className={cn("project-sidebar", wideMode && "project-sidebar-hidden")}>
        <button className="workspace-name" onClick={() => void returnToLibrary("canvas")}><FolderSimple size={17}/><span>画布草稿</span><ArrowRight size={14}/></button>
        <div className="canvas-library-tabs" role="tablist" aria-label="工作区内容">
          {([
            ["canvas", "画布"],
            ["assets", "素材"],
            ["skills", "提示词库"],
          ] as const).map(([tab, label]) => (
            <button key={tab} role="tab" aria-selected={leftTab === tab} className={leftTab === tab ? "active" : ""} onClick={() => setLeftTab(tab)}>{label}</button>
          ))}
        </div>
        {leftTab === "canvas" && <>
        <div className="sidebar-label">画布元素 <span>{canvas.document.nodes.length}</span></div>
        <label className="project-search">
          <MagnifyingGlass size={15} />
          <input
            placeholder="搜索节点"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="project-list">
          {canvas.document.nodes
            .filter((item) => item.data.title.toLowerCase().includes(search.toLowerCase()))
            .map((item) => (
              <button key={item.id} className={cn("project-item", item.selected && "active")} onClick={() => { canvas.select([item.id]); setInspectorOpen(false); }}>
                {item.data.kind === "video" ? <FilmStrip size={16} /> : item.data.kind === "image" ? <ImageSquare size={16} /> : <NotePencil size={16} />}
                <span className="truncate">{item.data.title || "未命名素材"}</span>
              </button>
            ))}
          {!canvas.document.nodes.length && (
            <p className="sidebar-empty">画布暂无节点。<br />从底部工具栏添加笔记、图像或视频。</p>
          )}
        </div>
        </>}
        {leftTab === "assets" && <>
          <div className="sidebar-label">项目素材 <span>{assets.length}</span></div>
          <label className="project-search"><MagnifyingGlass size={15} /><input placeholder="搜索素材" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="project-list asset-sidebar-list">
            {assets.filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase())).map((asset) => (
              <button key={asset.id} className="project-item" onClick={() => {
                addCanvasNode(asset.mimeType.startsWith("video/") ? "video" : "image", { title: asset.name, assetId: asset.id, url: asset.url });
                setMode("canvas"); setLeftTab("canvas");
              }}>
                {asset.mimeType.startsWith("video/") ? <FilmStrip size={16} /> : <ImageSquare size={16} />}
                <span className="truncate">{asset.name}</span>
              </button>
            ))}
            {!assets.length && <p className="sidebar-empty">上传图片或视频，将它们加入画布。</p>}
          </div>
          <button className="sidebar-add" onClick={() => fileInput.current?.click()}><UploadSimple size={15} />上传素材</button>
        </>}
        {leftTab === "skills" && <>
          <div className="sidebar-label">创作技能 <span>Skill</span></div>
          <div className="sidebar-prompt-copy"><strong>从创作方案开始</strong><p>浏览可运行的图像生成、视频生成和分镜技能。</p></div>
          <button className="sidebar-add" onClick={() => setModal("skills")}><Lightning size={15} />打开 Skill 市场</button>
        </>}
        <div className="sidebar-bottom">
          <button onClick={() => setModal("skills")}>
            <Lightning size={17} weight="fill" />
            <span>Skill 市场</span>
            <ArrowRight size={15} />
          </button>
          <button onClick={() => setMode("jobs")}>
            <ClockCounterClockwise size={16} />
            <span>生成记录</span>
            <ArrowRight size={15} />
          </button>
          <div className="integration-dot">
            <span
              className={cn(
                "status-dot",
                bootstrap?.integration.status === "configured" && "online",
              )}
            />
            {bootstrap?.integration.status === "configured"
              ? "生成服务已配置"
              : "生成服务待配置"}
          </div>
        </div>
      </aside>
      <main className="main-workspace">
        <header className="workspace-header">
          <div className="breadcrumb">
            <div className={cn("compact-project-menu", wideMode && "visible")}>
              <DraftMenu disabled={busy === "project"} onLibrary={(kind) => void returnToLibrary(kind)} onNew={(kind) => void newDraft(kind)}/>
            </div>
            <span className="muted">{mode === "home" ? "工作空间" : view.label}</span>
            <span>/</span>
            {mode === "home" ? <strong>映序 · 创作工作空间</strong> : mode === "science" ? <strong>{scienceHeading.projectId === project?.id ? scienceHeading.title || "未命名科普短视频" : "科普短视频"}</strong> : project ? (
              <input
                className="project-title"
                aria-label="项目名称"
                maxLength={200}
                disabled={mode === "canvas" && readyCanvasProject !== project.id}
                title={mode === "canvas" && readyCanvasProject !== project.id ? "画布载入后可以修改名称" : undefined}
                value={project.title}
                onChange={(event) => {
                  const next = { ...project, title: event.target.value };
                  projectRef.current = next;
                  setProject(next);
                  useCanvas.setState((state) => ({
                    editVersion: state.editVersion + 1,
                  }));
                }}
              />
            ) : (
              <strong>新的灵感，由此开始</strong>
            )}
          </div>
          <div className="header-actions">
            {mode !== "home" && <button className="button subtle library-return" onClick={() => void returnToLibrary(mode === "science" ? "science" : "canvas")}><FolderSimple size={16}/>返回草稿</button>}
            {mode === "canvas" && project && (
              <span className="save-status" style={{display:"none"}}>
                {saving ? <CircleNotch size={15} /> : <CloudCheck size={16} />}
              {conflict
                  ? "版本冲突"
                  : saving
                    ? "保存中"
                    : dirty
                      ? "待同步"
                      : "已保存"}
              </span>
            )}
            <button
              className="button subtle"
              onClick={() => setModal("skills")}
            >
              <Sparkle size={16} />
              Skill 市场
            </button>
            {project && mode !== "home" && mode !== "jobs" && <button className="button subtle" onClick={() => void showJobHistory()} disabled={Boolean(busy)}>
              <ClockCounterClockwise size={16} />生成记录
            </button>}
            {mode === "canvas" && (
              <button className="button secondary" disabled={!project || !bootstrap?.user || readyCanvasProject !== project.id} onClick={() => setModal("story")}>
                <FilmStrip size={16} />分镜 Agent
              </button>
            )}
            {mode === "canvas" && (
              <button className="button secondary canvas-import-button" onClick={() => engineRef.current?.command("upload")}>
                <UploadSimple size={15} />
                上传素材
              </button>
            )}
            {mode === "canvas" && <>
              <button
                className="button secondary"
                onClick={() => engineRef.current?.command("export")}
                disabled={!project}
              >
                <DownloadSimple size={16} />
                导出画布
              </button>
              <button
                className="button primary"
                onClick={() => engineRef.current?.command("save")}
                disabled={!project || saving || conflict}
              >
                <CloudCheck size={16} />
                保存
              </button>
            </>}
          </div>
        </header>
        {!wideMode && <div className="view-heading">
          <div>
            <span className="view-eyebrow">
              {mode === "image"
                ? "IMAGE STUDIO"
                : mode === "assets"
                    ? "PROJECT ASSETS"
                    : "GENERATION HISTORY"}
            </span>
            <h1>{view.label}</h1>
          </div>
          <div className="view-tools">
            {<button
              className="button secondary"
              onClick={() => importInput.current?.click()}
            >
              <UploadSimple size={15} />
              导入画布
            </button>}
            {<button
              className="button secondary"
              onClick={() => fileInput.current?.click()}
              disabled={busy === "upload"}
            >
              <Plus size={16} />
              上传素材
            </button>}
          </div>
        </div>}
        {(error || bootError || conflict) && (
          <div className="message-bar error" role="alert">
            <WarningCircle size={18} />
            <span>
              {bootError
                ? `服务暂未连接：${bootError}`
                : conflict
                  ? "服务器已有更新版本。本机编辑已保留，请另存副本或重新加载。"
                  : error}
            </span>
            {bootError && <button onClick={() => void refresh()}>重试</button>}
            {conflict && (
              <>
                <button
                  onClick={() =>
                    void createProject(
                      serializeDocument(),
                      `${project?.title} · 副本`,
                      false,
                    )
                  }
                >
                  另存副本
                </button>
                <button onClick={() => project && void loadProject(project.id)}>
                  重新加载
                </button>
              </>
            )}
          </div>
        )}
        {notice && (
          <div className="message-bar notice" role="status">
            <CheckCircle size={17} />
            <span>{notice}</span>
            <button onClick={() => setNotice("")} aria-label="关闭通知">
              关闭
            </button>
          </div>
        )}
        <div className="editor-layout">
          <WorkspaceBoundary name={view.label} resetKey={`${bootstrap?.user?.id}:${project?.id}:${mode}`}><section className="editor-main">
            {mode === "home" && <Home drafts={draftLibrary.items} draftKind={draftLibrary.kind} draftQuery={draftLibrary.query}
              draftLoading={!bootstrap || draftLibrary.loading} draftError={draftLibrary.error} draftHasMore={draftLibrary.hasMore}
              currentProjectId={project?.id} signedIn={Boolean(bootstrap?.user)} onDraftKind={draftLibrary.setKind} onDraftQuery={draftLibrary.setQuery}
              onLoadMore={() => void draftLibrary.loadMore()} onNewDraft={(kind) => void newDraft(kind)} onDraft={(draft) => void openDraft(draft)} onRenameDraft={draftLibrary.rename}
              onStart={(destination) => void newDraft(destination)}/>}
            {project && bootstrap?.user && (mode === "canvas" || openedWorkspaces.canvas === project.id) && <Suspense fallback={mode === "canvas" ? <WorkspaceLoader name="创作画布"/> : null}>
              <div className="canvas-container" style={{ display: mode === "canvas" ? "block" : "none" }}>
                <CanvasEngine
                  key={`${bootstrap.user.id}:${project.id}`}
                  ref={engineRef}
                  project={project}
                  userId={bootstrap.user.id}
                  models={bootstrap.models}
                  onCatalogChange={refreshGenerationCatalog}
                  onModels={(models) => {
                    catalogRefreshSequence.current += 1;
                    setBootstrap((current) => current && current.user?.id === bootstrap.user?.id ? { ...current, models } : current);
                    setModelCatalogVersion((version) => version + 1);
                  }}
                  onReady={dispatchPendingCanvasCommand}
                  onReadinessChange={(ready) => setReadyCanvasProject(ready ? project.id : "")}
                  assets={assets}
                  legacyDocument={canvas.document}
                  onRename={(title) => {
                    const current = projectRef.current;
                    if (!current || current.title === title) return;
                    const next = { ...current, title };
                    projectRef.current = next;
                    setProject(next);
                    useCanvas.setState((state) => ({ editVersion: state.editVersion + 1 }));
                  }}
                  onAsset={(asset) => setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)])}
                  onJob={(job) => setJobs((items) => [job, ...items.filter((item) => item.id !== job.id)])}
                  onAction={(action) => {
                    if (action === "home" || action === "projects") void returnToLibrary("canvas");
                    else if (action === "newProject") void newDraft("canvas");
                    else if (action === "skills") setModal("skills");
                    else if (action === "pool") setModal("pool");
                    else openSettings();
                  }}
                />
              </div>
            </Suspense>}
            {mode === "canvas" && (!project || !bootstrap?.user) && <Empty icon={SquaresFour} title="打开你的创作画布" detail="创建或打开画布草稿，连接你的文字、图像与镜头。"><button className="button primary" onClick={() => void newDraft("canvas")}>{bootstrap?.user ? "新建画布" : "登录"}</button></Empty>}
            {project && bootstrap?.user && (mode === "science" || openedWorkspaces.science === project.id) && <Suspense fallback={mode === "science" ? <WorkspaceLoader name="科普短视频"/> : null}>
              <ScienceStudio key={`${bootstrap.user.id}:${project.id}`} ref={scienceRef} project={project} active={mode === "science"} assets={assets} models={bootstrap.models} modelCatalogVersion={modelCatalogVersion}
                onTitle={(title) => setScienceHeading({ projectId: project.id, title })}
                onUpload={() => fileInput.current?.click()} onSettings={openModelSettings}
                onAsset={(asset) => setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)])}/>
            </Suspense>}
            {mode === "science" && (!project || !bootstrap?.user) && <Empty icon={Atom} title="制作你的科普短视频" detail="从可靠资料出发，组织讲解并自动配音与合成。"><button className="button primary" onClick={() => void enterMode("science")}>{bootstrap?.user ? "新建项目" : "登录"}</button></Empty>}
            {mode === "image" && (
              <div className="studio-view">
                <div className="studio-preview">
                  {selected?.data.url && selected.data.kind === "image" ? (
                    <img src={selected.data.url} alt={selected.data.title} />
                  ) : (
                    <Empty
                      icon={mode === "image" ? ImageSquare : FilmStrip}
                      title={
                        mode === "image"
                          ? "从一句描述，到一幅画面"
                          : "让画面开始讲述"
                      }
                      detail={
                        mode === "image"
                          ? "创建图像节点，在右侧设置提示词与画面比例。"
                          : "创建视频节点，可连接图片素材作为参考。"
                      }
                    >
                      <button
                        className="button primary"
                        onClick={() => void addNode(mode)}
                      >
                        <Plus size={16} />
                        创建{mode === "image" ? "图像" : "视频"}节点
                      </button>
                    </Empty>
                  )}
                </div>
                <div className="studio-history">
                  <h2>
                    最近生成{" "}
                    <span>
                      {jobs.filter((job) => job.kind === mode).length}
                    </span>
                  </h2>
                  <div className="result-strip">
                    {jobs
                      .filter((job) => job.kind === mode)
                      .map((job) => (
                        <button
                          className="mini-result"
                          key={job.id}
                          onClick={() =>
                            job.status === "succeeded" && applyJob(job)
                          }
                        >
                          {job.resultUrl ? (
                            job.kind === "image" ? (
                              <img src={job.resultUrl} alt={job.prompt} />
                            ) : (
                              <FilmStrip size={26} />
                            )
                          ) : (
                            <Sparkle size={24} />
                          )}
                          <span>{jobNames[job.status] || job.status}</span>
                        </button>
                      ))}
                    {!jobs.some((job) => job.kind === mode) && (
                      <p className="muted">生成结果会保存在项目中。</p>
                    )}
                  </div>
                </div>
              </div>
            )}
            {mode === "assets" && (
              <div className="library-view">
                {!assets.length ? (
                  <Empty
                    icon={Stack}
                    title="素材，从这里汇集"
                    detail="上传参考图、音频或视频，为创作建立上下文。"
                  >
                    <button
                      className="button primary"
                      onClick={() => fileInput.current?.click()}
                    >
                      <UploadSimple size={16} />
                      上传素材
                    </button>
                  </Empty>
                ) : (
                  <div className="asset-grid">
                    {assets.map((asset) => (
                      <article className="asset-card" key={asset.id}>
                        <div>
                          {asset.mimeType.startsWith("image/") ? (
                            <img
                              src={asset.url}
                              alt={asset.name}
                              loading="lazy"
                            />
                          ) : asset.mimeType.startsWith("video/") ? (
                            <video
                              src={asset.url}
                              controls
                              preload="metadata"
                            />
                          ) : (
                            <Stack size={32} />
                          )}
                        </div>
                        <strong className="truncate">{asset.name}</strong>
                        <span>{(asset.size / 1024 / 1024).toFixed(2)} MB</span>
                        <button
                          className="button secondary"
                          disabled={!/^(image|video)\//.test(asset.mimeType)}
                          onClick={() => {
                            addCanvasNode(
                              asset.mimeType.startsWith("video/")
                                ? "video"
                                : "image",
                              {
                                title: asset.name,
                                assetId: asset.id,
                                url: asset.url,
                              },
                            );
                            setMode("canvas");
                          }}
                        >
                          加入画布
                          <ArrowRight size={14} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode === "jobs" && (
              <div className="library-view">
                {!jobs.length ? (
                  <Empty
                    icon={ClockCounterClockwise}
                    title="每次创作，都有记录"
                    detail="生成任务、候选结果与失败原因会保存在这里。"
                  >
                    <button
                      className="button primary"
                      onClick={() => void addNode("image")}
                    >
                      开始创作
                      <ArrowRight size={16} />
                    </button>
                  </Empty>
                ) : (
                  <div className="job-list">
                    {jobs.map((job) => (
                      <article className="job-card" key={job.id}>
                        <div className="job-preview">
                          {job.resultUrl && job.kind === "image" ? (
                            <img src={job.resultUrl} alt={job.prompt} />
                          ) : job.kind === "video" ? (
                            <FilmStrip size={30} />
                          ) : (
                            <ImageSquare size={30} />
                          )}
                        </div>
                        <div className="job-detail">
                          <div>
                            <strong>
                              {job.kind === "video" ? "视频生成" : "图像生成"}
                            </strong>
                            <span className={`job-status ${job.status}`}>
                              {jobNames[job.status] || job.status}
                            </span>
                          </div>
                          <p>{job.prompt}</p>
                          <small>
                            {new Date(job.createdAt).toLocaleString("zh-CN")} ·{" "}
                            {job.model}
                          </small>
                          {job.error && (
                            <p className="job-error">{job.error}</p>
                          )}
                        </div>
                        <div className="job-actions">
                          {job.canRecover && <button className="button secondary" disabled={recoveringJobs.has(job.id)} onClick={() => void recoverJob(job)} title="只查询原任务并取回结果，不重新提交生成">
                            {recoveringJobs.has(job.id) ? "正在查询原任务…" : "重新查询结果"}
                          </button>}
                          {job.status === "succeeded" && (
                            <>
                              <button
                                className="button primary"
                                onClick={() => applyJob(job)}
                              >
                                加入画布
                              </button>
                              {job.resultUrl && (
                                <a
                                  className="button secondary"
                                  href={job.resultUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ArrowSquareOut size={15} />
                                  查看
                                </a>
                              )}
                            </>
                          )}
                          {!finished(job) && (
                            <button
                              className="button secondary"
                              onClick={async () => {
                                try {
                                  const updated = await api<Job>(
                                    `/jobs/${job.id}/cancel`,
                                    { method: "POST" },
                                  );
                                  setJobs((items) =>
                                    items.map((item) =>
                                      item.id === updated.id ? updated : item,
                                    ),
                                  );
                                } catch (cause) {
                                  setError(message(cause));
                                }
                              }}
                            >
                              取消任务
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section></WorkspaceBoundary>
          {mode === "image" && (
            <aside className="inspector">
              <div className="inspector-heading">
                <span>
                  <Sparkle size={17} />
                  画布创作设置
                </span>
                <button className="icon-button" aria-label="收起生成参数" onClick={() => setInspectorOpen(false)}><X size={16} /></button>
              </div>
              {selected ? (
                <div className="inspector-form">
                  <label>
                    节点名称
                    <input
                      value={selected.data.title}
                      maxLength={100}
                      onChange={(event) =>
                        canvas.patch(selected.id, { title: event.target.value })
                      }
                    />
                  </label>
                  <label className="prompt-label">
                    {selected.data.kind === "note"
                      ? "灵感与内容"
                      : "描述你想创作的画面"}
                    <textarea
                      aria-label="创作提示词"
                      value={selected.data.prompt}
                      maxLength={6000}
                      placeholder={
                        selected.data.kind === "video"
                          ? "描述主体、场景、动作和镜头运动…"
                          : selected.data.kind === "image"
                            ? "描述主体、构图、光线与风格…"
                            : "写下需要表达的内容，连接到生成节点后会作为创作上下文。"
                      }
                      onChange={(event) =>
                        canvas.patch(selected.id, {
                          prompt: event.target.value,
                        })
                      }
                    />
                    <span className="character-count">
                      {selected.data.prompt.length} / 6000
                    </span>
                  </label>
                  {selected.data.kind !== "note" && (
                    <>
                      <label>
                        生成模型
                        <select
                          value={
                            selected.data.model ||
                            (selected.data.kind === "video"
                              ? "muse-video"
                              : "muse-image")
                          }
                          onChange={(event) => {
                            canvas.patch(
                              selected.id,
                              modelPatch(
                                findModel(
                                  bootstrap?.models[
                                    selected.data.kind as "image" | "video"
                                  ],
                                  event.target.value,
                                ),
                              ),
                            );
                            setReferenceId("");
                          }}
                        >
                          {(bootstrap?.models[selected.data.kind]?.length
                            ? bootstrap.models[selected.data.kind]
                            : [
                                selected.data.kind === "video"
                                  ? "muse-video"
                                  : "muse-image",
                              ]
                          ).map((model) => (
                            <option
                              key={modelId(model)}
                              value={modelId(model)}
                              disabled={
                                typeof model !== "string" &&
                                model.available === false
                              }
                            >
                              {typeof model === "string"
                                ? model
                                : model.name || model.label || model.id}
                              {typeof model !== "string" &&
                              model.available === false
                                ? "（暂不可用）"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedModel?.provider === "doubao" && (
                        <p className="model-capability-note">
                          豆包通道不支持参考图。
                          {selected.data.kind === "video"
                            ? "视频固定 10 秒、720p。"
                            : "生成图片带有豆包水印。"}
                        </p>
                      )}
                      <label>
                        画面比例
                        <div className="ratio-options">
                          {[
                            { label: "1:1", width: 1024, height: 1024 },
                            { label: "16:9", width: 1280, height: 720 },
                            { label: "9:16", width: 720, height: 1280 },
                            { label: "4:3", width: 1024, height: 768 },
                          ].map((ratio) => (
                            <button
                              key={ratio.label}
                              disabled={
                                !!selectedModel?.caps?.fixedWidth ||
                                selectedModel?.caps?.supportsSizeControl ===
                                  false
                              }
                              className={cn(
                                selected.data.width === ratio.width &&
                                  selected.data.height === ratio.height &&
                                  "active",
                              )}
                              onClick={() => canvas.patch(selected.id, ratio)}
                            >
                              {ratio.label}
                            </button>
                          ))}
                        </div>
                      </label>
                      {selected.data.kind === "video" && (
                        <label>
                          视频时长
                          <select
                            value={selected.data.duration || 5}
                            disabled={!!selectedModel?.caps?.fixedDuration}
                            onChange={(event) =>
                              canvas.patch(selected.id, {
                                duration: Number(event.target.value),
                              })
                            }
                          >
                            <option value={5}>5 秒</option>
                            <option value={8}>8 秒</option>
                            <option value={10}>10 秒</option>
                          </select>
                        </label>
                      )}
                      <label>
                        参考素材
                        <select
                          value={referenceId}
                          disabled={
                            selectedModel?.caps?.supportsReferenceImages ===
                            false
                          }
                          onChange={(event) =>
                            setReferenceId(event.target.value)
                          }
                        >
                          <option value="">使用画布连线中的图片</option>
                          {assets
                            .filter((asset) =>
                              asset.mimeType.startsWith("image/"),
                            )
                            .map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="reference-hint">
                        <span className="reference-line" />
                        <p>
                          {selectedModel?.caps?.supportsReferenceImages ===
                          false
                            ? "当前模型不支持参考图；已有图片连线需移除后再生成。"
                            : "将图片节点连接到当前节点，生成时会自动使用参考素材。"}
                        </p>
                      </div>
                      <button
                        className="button primary generate-button"
                        disabled={
                          busy === selected.id ||
                          !selected.data.prompt.trim() ||
                          (!!latestJobs[selected.id] &&
                            !finished(latestJobs[selected.id]))
                        }
                        onClick={() => void generate(selected.id)}
                      >
                        <Sparkle size={18} weight="fill" />
                        {busy === selected.id
                          ? "正在提交…"
                          : latestJobs[selected.id] &&
                              !finished(latestJobs[selected.id])
                            ? jobNames[latestJobs[selected.id].status]
                            : selected.data.kind === "image"
                              ? "生成图像"
                              : "生成视频"}
                        <ArrowRight size={17} />
                      </button>
                      {latestJobs[selected.id]?.status === "succeeded" && (
                        <button
                          className="button secondary"
                          onClick={() => applyJob(latestJobs[selected.id])}
                        >
                          将最新结果加入画布
                          <ArrowDown size={16} />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="delete-node"
                    onClick={() => canvas.remove(selected.id)}
                  >
                    <Trash size={15} />
                    移除节点
                  </button>
                </div>
              ) : (
                <div className="inspector-empty">
                  <span>
                    <Sparkle size={25} weight="thin" />
                  </span>
                  <h3>选中一个节点</h3>
                  <p>
                    在这里编辑提示词、调整参数，
                    <br />
                    或为画面开启下一步创作。
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => setModal("skills")}
                  >
                    <Lightning size={16} />
                    探索创作技能
                  </button>
                </div>
              )}
              <div className="inspector-footnote">
                <span className={cn("status-dot", connected && "online")} />
                {connected ? "任务进度实时同步" : "等待连接工作台"}
                <span>
                  {activeJobs
                    ? `${activeJobs} 个任务进行中`
                    : "编辑与生成独立运行"}
                </span>
              </div>
            </aside>
          )}
        </div>
        <footer className="workspace-footer">
          <span>映序工作空间</span>
          <span>{assets.length} 项素材</span>
        </footer>
      </main>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,audio/*,.pdf,.docx,.txt"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          const target = referenceUploadNode.current;
          referenceUploadNode.current = null;
          if (files.length) void uploadFiles(files, undefined, target);
          event.target.value = "";
        }}
      />
      <input
        ref={importInput}
        type="file"
        hidden
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importCanvas(file);
          event.target.value = "";
        }}
      />
      <Modal
        open={modal === "login"}
        onOpenChange={(open) => setModal(open ? "login" : null)}
        title={bootstrap?.user ? "你的工作空间" : "登录，保存每一次灵感"}
        description={
          bootstrap?.user
            ? "账户与创作会话。"
            : "登录后即可管理画布、素材和生成记录。"
        }
      >
        {bootstrap?.user ? (
          <div className="account-info">
            <span className="account-avatar">
              {bootstrap.user.name.slice(0, 1)}
            </span>
            <strong>{bootstrap.user.name}</strong>
            <p>
              {bootstrap.user.provider === "github"
                ? "GitHub 账户"
                : bootstrap.user.provider === "reviewer" ? "受邀访问账号" : "本机开发会话"}
            </p>
            <button className="button secondary" onClick={() => void logout()}>
              <SignOut size={17} />
              退出登录
            </button>
          </div>
        ) : (
          <div className="login-options">
            <a
              className={cn(
                "button github-button",
                !bootstrap?.auth.githubEnabled && "disabled",
              )}
              href={
                bootstrap?.auth.githubEnabled
                  ? bootstrap.auth.githubLoginUrl ||
                    "/oauth2/authorization/github"
                  : undefined
              }
              aria-disabled={!bootstrap?.auth.githubEnabled}
            >
              <GithubLogo size={21} weight="fill" />
              使用 GitHub 继续
              <ArrowRight size={17} />
            </a>
            {!bootstrap?.auth.githubEnabled && (
              <p className="config-note">
                GitHub 登录等待服务端配置 OAuth 应用。密钥不会进入浏览器。
              </p>
            )}
            {bootstrap?.auth.localEnabled && (
              <>
                <div className="login-divider">
                  <span>本机开发环境</span>
                </div>
                <button
                  className="button secondary"
                  onClick={() => void authenticateLocal()}
                  disabled={busy === "login"}
                >
                  {busy === "login" ? "正在进入…" : "进入本机工作空间"}
                </button>
                <p className="config-note">
                  仅在本机开发模式开放；生产环境关闭此入口。
                </p>
              </>
            )}
            <ReviewerLogin busy={busy === "login"} onAuthenticate={authenticateLocal}/>
            {error && (
              <p className="job-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
      <WorkspaceBoundary name="功能面板" resetKey={`${bootstrap?.user?.id}:${modal}`}><Suspense fallback={<div className="panel-loading" role="status">正在打开面板…</div>}>
      {modal === "skills" && <SkillMarket
        open={modal === "skills"}
        onOpenChange={(open) => { setModal(open ? "skills" : null); if (!open) void refreshGenerationCatalog(); }}
        signedIn={!!bootstrap?.user}
        sessionKey={bootstrap?.user?.id || null}
        onLogin={() => setModal("login")}
        onUse={useSkill}
      />}
      {modal === "pool" && <PoolPanel
        open={modal === "pool"}
        onOpenChange={(open) => { setModal(open ? "pool" : null); if (!open) void refreshGenerationCatalog(); }}
        signedIn={!!bootstrap?.user}
        sessionKey={bootstrap?.user?.id || null}
        onLogin={() => setModal("login")}
      />}
      {modal === "settings" && bootstrap?.user && <ModelSettings
        key={bootstrap.user.id}
        open
        onOpenChange={(open) => setModal(open ? "settings" : null)}
        onChanged={refreshGenerationCatalog}
        initialCapability={settingsCapability}
      />}
      {modal === "story" && mode === "canvas" && project && bootstrap?.user && <CanvasStoryWorkflow
        key={`${bootstrap.user.id}:${project.id}`}
        open
        onOpenChange={(open) => setModal(open ? "story" : null)}
        projectId={project.id}
        modelCatalogVersion={modelCatalogVersion}
        onSettings={() => openModelSettings("text")}
        onApply={async (payload) => {
          const epoch = authEpoch.current;
          const projectId = project.id;
          if (projectRef.current?.id !== projectId || !engineRef.current?.isReady()) throw new Error("画布尚未就绪，请稍后重试。");
          const applied = await engineRef.current.request("storyWorkflow", payload);
          if (epoch !== authEpoch.current || projectRef.current?.id !== projectId) return;
          if (!applied) throw new Error("分镜尚未确认加入画布，请检查画布状态后重试。");
          if (!await engineRef.current?.flush()) throw new Error("分镜已加入当前画布，服务器保存尚未确认，请留在当前草稿重试保存。");
          if (epoch !== authEpoch.current || projectRef.current?.id !== projectId) return;
          setNotice("分镜、原文和素材档案已加入并保存到画布，可检查连接后生成。");
          setModal(null);
        }}
      />}
      </Suspense></WorkspaceBoundary>
    </div>{navigating && <div className="workspace-transition" role="status"><CircleNotch size={18} className="spin"/>正在保存并切换，请稍候…</div>}</>
  );
}

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowRight, Atom, BookOpen, CheckCircle, Clock, DownloadSimple, FilmStrip, MagicWand, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { api, ApiError, json, message } from "./api";
import { cn } from "./components";
import { modelId } from "./models";
import type { Asset, Bootstrap, Project } from "./types";
import "./science-studio.css";

type Source = { id: string; title: string; url: string; excerpt: string };
type Scene = { id: string; role: "hook" | "explain" | "experiment" | "question"; narration: string; visualPrompt: string; videoPrompt?: string; assetId?: string; videoAssetId?: string; sourceIds: string[]; verified: boolean };
type ScienceDocument = { schemaVersion: 1; topic: string; title: string; audience: "children" | "teen" | "general"; structure: "misconception" | "experiment" | "explain"; aspectRatio: "16:9" | "9:16" | "1:1"; models?: { text?: string; image?: string; video?: string }; sources: Source[]; scenes: Scene[] };
type Snapshot = { revision: number; document: ScienceDocument };
type ScienceRun = { productionMode?: string; captionTiming?: string; resolvedVideos?: Record<string, string>; narrationUrl?: string; id: string; status: string; stage?: string; error?: string; resultAssetId?: string; resultUrl?: string; subtitleUrl?: string; createdAt: string };
type Props = { project: Project; active: boolean; assets: Asset[]; models: Bootstrap["models"]; modelCatalogVersion?: number; onAsset: (asset: Asset) => void; onUpload: () => void; onSettings: (capability?: "text" | "image" | "video") => void; onTitle?: (title: string) => void };
const emptyDocument = (): ScienceDocument => ({ schemaVersion: 1, topic: "", title: "", audience: "general", structure: "misconception", aspectRatio: "9:16", sources: [], scenes: [] });
const roles: Record<Scene["role"], string> = { hook: "悬念 / 误区", explain: "原理解释", experiment: "观察 / 小实验", question: "思考追问" };
const stageNames: Record<string, string> = { queued: "等待开始", resolving_videos: "正在准备动态片段", generating_videos: "Muse 正在生成分镜视频与原声", waiting_videos: "等待分镜视频", validating_videos: "正在检查视频与原声音轨", resolving_images: "正在准备配图", generating_images: "等待生成配图", waiting_images: "等待生成配图", synthesizing: "逐句生成中文配音", assembling: "正在编排片段、字幕与来源片尾", rendering: "正在合成 MP4", completed: "成片已保存", succeeded: "成片已保存", failed: "制作失败" };
const statusNames: Record<string, string> = { queued: "等待制作", waiting_videos: "等待动态视频", waiting_images: "等待配图", running: "正在制作", succeeded: "制作完成", failed: "制作失败" };
const topicExamples = [
  { label: "月球同面", topic: "为什么月球总用同一面朝向地球？", title: "月球为什么总是这一面" },
  { label: "天空颜色", topic: "晴朗的天空为什么呈现蓝色？", title: "天空的蓝色从哪里来" },
  { label: "声音传播", topic: "为什么在月球上不能直接听到对方说话？", title: "声音也需要一座桥" },
];
// Canonical order prevents server JSON normalization from creating false dirtiness.
export const documentKey = (doc: ScienceDocument) => json({ schemaVersion: doc.schemaVersion, topic: doc.topic, title: doc.title, audience: doc.audience, structure: doc.structure, aspectRatio: doc.aspectRatio, models: { text: doc.models?.text || undefined, image: doc.models?.image || undefined, video: doc.models?.video || undefined }, sources: doc.sources.map(({ id, title, url, excerpt }) => ({ id, title, url: url || "", excerpt })), scenes: doc.scenes.map(({ id, role, narration, visualPrompt, videoPrompt, assetId, videoAssetId, sourceIds, verified }) => ({ id, role, narration, visualPrompt, videoPrompt: videoPrompt || undefined, assetId: assetId || undefined, videoAssetId: videoAssetId || undefined, sourceIds, verified })) });

export type ScienceStudioHandle = { save: () => Promise<boolean> };
export const ScienceStudio = forwardRef<ScienceStudioHandle, Props>(function ScienceStudio(props, ref) {
  const [document, setDocument] = useState<ScienceDocument>(emptyDocument);
  const current = useRef(document); current.current = document;
  const [revision, setRevision] = useState(0); const revisionRef = useRef(0);
  const [saved, setSaved] = useState(""); const savedRef = useRef("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [planning, setPlanning] = useState(false);
  const [planSummary, setPlanSummary] = useState("");
  const [textModels, setTextModels] = useState<{ id: string; name: string; available: boolean }[]>([]);
  const [videoDuration, setVideoDuration] = useState(15);
  const [generateVideos, setGenerateVideos] = useState(false);
  const [runs, setRuns] = useState<ScienceRun[]>([]);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const controller = useRef(new AbortController());
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  useEffect(() => { if (loaded) callbacks.current.onTitle?.(document.title); }, [loaded, document.title]);
  const base = `/projects/${props.project.id}/science`;
  const dirty = documentKey(document) !== saved;
  const images = props.assets.filter((asset) => asset.mimeType.startsWith("image/"));
  const videos = props.assets.filter((asset) => asset.mimeType.startsWith("video/"));
  const textModel = document.models?.text || "";
  const imageModel = document.models?.image || modelId(props.models.image.find((model) => typeof model === "string" || model.available !== false) || props.models.image[0] || "");
  const textModelAvailable = !textModel || textModels.some((model) => model.id === textModel && model.available);
  const videoModel = document.models?.video || modelId(props.models.video.find((model) => (typeof model === "string" || model.provider !== "doubao") && (typeof model === "string" || model.available !== false)) || props.models.video[0] || "");
  const videoSpec = props.models.video.find((model) => modelId(model) === videoModel);
  const videoModelAvailable = Boolean(videoSpec && (typeof videoSpec === "string" || videoSpec.available !== false));
  const durationOptions = typeof videoSpec === "object" && videoSpec.caps?.fixedDuration ? [videoSpec.caps.fixedDuration] : typeof videoSpec === "object" && videoSpec.caps?.durations?.length ? videoSpec.caps.durations.filter((duration) => duration >= 5 && duration <= 20) : [5, 10, 15, 20];
  const duration = durationOptions.includes(videoDuration) ? videoDuration : durationOptions[0] || 15;
  const narrationLimit = Math.min(45, duration * 3);
  const longScenes = document.scenes.filter((scene) => scene.narration.length > narrationLimit).length;
  const activeRun = runs.find((run) => ["queued", "running", "waiting_images", "waiting_videos"].includes(run.status));
  const completedRun = runs.find((run) => run.status === "succeeded" && run.resultUrl && run.productionMode === "muse_video");
  const missingVideos = document.scenes.filter((scene) => !videos.some((video) => video.id === scene.videoAssetId)).length;
  const checkedScenes = document.scenes.filter((scene) => scene.verified && scene.sourceIds.length).length;
  const narrationLength = document.scenes.reduce((sum, scene) => sum + scene.narration.length, 0);

  function videoSelector(label: string) {
    return <select aria-label={label} value={videoModel} onChange={(event) => patch({ models: { ...current.current.models, video: event.target.value } })}>
      {!props.models.video.length && <option value="">尚未配置视频模型</option>}
      {videoModel && !videoSpec && <option value={videoModel} disabled>原模型已移除，请重新选择</option>}
      {props.models.video.map((model) => <option key={modelId(model)} value={modelId(model)} disabled={typeof model !== "string" && model.available === false}>{typeof model === "string" ? model : model.name || model.id}{typeof model !== "string" && model.available === false ? " · 不可用" : ""}</option>)}
    </select>;
  }

  const load = useCallback(async () => {
    setError(""); setLoaded(false);
    const signal = controller.current.signal;
    try {
      const snapshot = await api<Snapshot>(base, { signal });
      if (signal.aborted) return;
      current.current = snapshot.document; setDocument(snapshot.document);
      revisionRef.current = snapshot.revision; setRevision(snapshot.revision);
      savedRef.current = documentKey(snapshot.document); setSaved(savedRef.current);
      setConflict(false); setLoaded(true);
    } catch (cause) { if (!signal.aborted) setError(message(cause)); }
  }, [base]);
  useEffect(() => {
    const lifetime = new AbortController(); controller.current = lifetime;
    void load();
    void api<{ runs: ScienceRun[] }>(`${base}/runs`, { signal: lifetime.signal }).then((result) => { if (!lifetime.signal.aborted) setRuns(result.runs); }).catch((cause) => { if (!lifetime.signal.aborted) setError(message(cause)); });
    return () => lifetime.abort();
  }, [base, load]);
  useEffect(() => {
    if (!props.active) return;
    const request = new AbortController();
    void Promise.allSettled([
      api<{ models: { id: string; name: string; available: boolean }[] }>("/models/text", { signal: request.signal }).then((result) => { if (!request.signal.aborted) setTextModels(result.models); }),
    ]).then((results) => { const failure = results.find((result) => result.status === "rejected"); if (!request.signal.aborted && failure?.status === "rejected") setError(message(failure.reason)); });
    return () => request.abort();
  }, [props.active, props.modelCatalogVersion]);

  const save = useCallback(async (): Promise<boolean> => {
    if (pendingSave.current) { const ok = await pendingSave.current; return ok && (documentKey(current.current) === savedRef.current || save()); }
    if (!loaded) return documentKey(current.current) === (savedRef.current || documentKey(emptyDocument()));
    if (conflict || controller.current.signal.aborted) return false;
    if (documentKey(current.current) === savedRef.current) return true;
    const document = current.current; const signal = controller.current.signal;
    setSaving(true);
    const operation = (async () => {
      try {
        const result = await api<Snapshot>(base, { method: "PUT", body: json({ baseRevision: revisionRef.current, document }), signal });
        if (signal.aborted) return false;
        revisionRef.current = result.revision; setRevision(result.revision);
        savedRef.current = documentKey(result.document); setSaved(savedRef.current);
        if (documentKey(current.current) === documentKey(document)) { current.current = result.document; setDocument(result.document); }
        return true;
      } catch (cause) { if (!signal.aborted) { setError(message(cause)); if (cause instanceof ApiError && cause.status === 409) setConflict(true); } return false; }
      finally { pendingSave.current = null; if (!signal.aborted) setSaving(false); }
    })();
    pendingSave.current = operation;
    const ok = await operation;
    return ok && (documentKey(current.current) === savedRef.current || save());
  }, [base, conflict, loaded]);
  useImperativeHandle(ref, () => ({ save }), [save]);
  useEffect(() => { if (!loaded || !dirty || conflict) return; const timer = setTimeout(() => void save(), 900); return () => clearTimeout(timer); }, [document, loaded, dirty, conflict, save]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (documentKey(current.current) !== savedRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function change(next: ScienceDocument) { current.current = next; setDocument(next); setNotice(""); setError(""); }
  function patch(values: Partial<ScienceDocument>) { change({ ...current.current, ...values }); }
  function patchScene(id: string, values: Partial<Scene>) {
    patch({ scenes: current.current.scenes.map((scene) => scene.id === id ? { ...scene, ...values, verified: ["narration", "sourceIds", "videoPrompt", "assetId", "videoAssetId"].some((field) => field in values) ? false : values.verified ?? scene.verified } : scene) });
  }
  function patchSource(id: string, values: Partial<Source>) {
    patch({ sources: current.current.sources.map((source) => source.id === id ? { ...source, ...values } : source), scenes: current.current.scenes.map((scene) => scene.sourceIds.includes(id) ? { ...scene, verified: false } : scene) });
  }
  async function plan() {
    setPlanning(true); setError(""); setPlanSummary("");
    const document = current.current; const signal = controller.current.signal;
    try {
      const result = await api<{ document: ScienceDocument; source: string; summary: string }>(`${base}/plan`, { method: "POST", body: json({ document, model: textModel || undefined }), signal: AbortSignal.any([signal, AbortSignal.timeout(105000)]) });
      if (signal.aborted) return;
      if (documentKey(current.current) !== documentKey(document)) throw new Error("规划期间资料发生变化，请根据最新资料重新整理。");
      change(result.document); setPlanSummary(result.summary); setStep(2);
    } catch (cause) { if (!signal.aborted) setError(message(cause)); }
    finally { if (!signal.aborted) setPlanning(false); }
  }
  async function createRun() {
    if (creating || activeRun) return;
    setCreating(true); setError("");
    const signal = controller.current.signal;
    try {
      if (!(await save())) throw new Error("请先保存分镜文档，再开始制作。");
      const result = await api<ScienceRun>(`${base}/runs`, { method: "POST", body: json({ revision: revisionRef.current, productionMode: "muse_video", videoModel, videoDuration: duration, audioMode: "muse_native", generateMissingVideos: generateVideos }), signal });
      if (!signal.aborted) { setRuns((items) => [result, ...items.filter((item) => item.id !== result.id)]); setStep(3); }
    } catch (cause) { if (!signal.aborted) setError(message(cause)); }
    finally { if (!signal.aborted) setCreating(false); }
  }
  useEffect(() => {
    if (!activeRun) return;
    let polling = false;
    const signal = controller.current.signal;
    const poll = async () => {
      if (polling) return; polling = true;
      try {
        const run = await api<ScienceRun>(`${base}/runs/${activeRun.id}`, { signal });
        if (signal.aborted) return;
        setRuns((items) => items.map((item) => item.id === run.id ? run : item));
        if (run.status === "succeeded") {
          const assets = await api<Asset[]>(`/assets?projectId=${callbacks.current.project.id}`, { signal });
          if (!signal.aborted) { assets.forEach(callbacks.current.onAsset); setNotice("分镜视频、原声与成片已保存。请播放检查画面、讲解和字幕，字幕时间为分镜草稿。"); }
        }
      } catch (cause) { if (!signal.aborted) setError(message(cause)); }
      finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 2500); return () => clearInterval(timer);
  }, [activeRun?.id, base]);

  return <section className="science-studio" aria-label="科普短视频制作" style={{ display: props.active ? undefined : "none" }}>
    <header className="science-header"><div><span className="science-symbol"><Atom size={23}/></span><div><h1>科普短视频制作</h1><p>从可信资料出发，让 Muse 生成动态画面与自然讲解。</p></div></div><span className="science-save">{!loaded ? "正在载入…" : saving ? "保存中…" : dirty ? "等待保存" : `已保存 · v${revision}`}</span></header>
    <div className="science-features"><span><BookOpen size={15}/>讲稿关联证据来源</span><span><MagicWand size={15}/>面向受众组织讲解</span><span><Clock size={15}/>动态视频与模型原声</span></div>
    <nav className="science-steps" aria-label="科普制作步骤">{([{ id: 1, title: "主题与资料", detail: "提供可信内容" }, { id: 2, title: "分镜与核对", detail: "让每幕有据可查" }, { id: 3, title: "自动制作", detail: "动态片段 · 原声 · 成片" }] as const).map((item) => <button key={item.id} aria-pressed={step === item.id} className={cn(step === item.id && "active")} onClick={() => setStep(item.id)}><span>0{item.id}</span><strong>{item.title}</strong><small>{item.detail}</small></button>)}</nav>
    {error && <div className="science-error" role="alert"><WarningCircle size={17}/><span>{error}</span>{(!loaded || conflict) && <button className="button secondary" onClick={() => void load()}>{conflict ? "读取最新版本" : "重新载入"}</button>}</div>}
    {notice && <div className="science-notice" role="status"><CheckCircle size={16}/>{notice}</div>}
    {!loaded && !error ? <p className="science-loading">正在载入科普项目…</p> : null}
    {loaded && step === 1 && <div className="science-planning">
      <section className="science-topic"><h2>今天，解释什么？</h2><label className="science-field">视频主题<input aria-label="视频主题" aria-describedby="science-topic-hint" value={document.topic} maxLength={200} placeholder="例如：为什么月球总用同一面朝向地球？" onChange={(event) => patch({ topic: event.target.value })}/><small id="science-topic-hint">写清这个视频想解释的问题。</small></label><label className="science-field">成片标题<input aria-label="成片标题" aria-describedby="science-title-hint" value={document.title} maxLength={200} placeholder="对应标题：月球为什么总是这一面" onChange={(event) => patch({ title: event.target.value })}/><small id="science-title-hint">展示在草稿库和成片中，可与主题采用不同表述。</small></label>
        <div className="science-topic-examples" aria-label="主题与标题示例"><span>试试选题</span><div>{topicExamples.map((example) => <button key={example.label} type="button" title={`主题：${example.topic}\n标题：${example.title}`} onClick={() => patch({ topic: example.topic, title: example.title })}>{example.label}</button>)}</div><small>点击填入对应的主题与标题，接着添加资料。</small></div>
        <div className="science-form-row"><label className="science-field">讲给谁听<select value={document.audience} onChange={(event) => patch({ audience: event.target.value as ScienceDocument["audience"] })}><option value="children">儿童 · 生活化比喻</option><option value="teen">中学生 · 原理与观察</option><option value="general">大众 · 准确易懂</option></select></label><label className="science-field">成片比例<select value={document.aspectRatio} onChange={(event) => patch({ aspectRatio: event.target.value as ScienceDocument["aspectRatio"] })}><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></label></div>
        <label className="science-field">叙事结构<select value={document.structure} onChange={(event) => patch({ structure: event.target.value as ScienceDocument["structure"] })}><option value="misconception">提出误区 → 原理解释 → 观察验证 → 追问</option><option value="experiment">提出问题 → 观察 / 实验 → 解释 → 迁移</option><option value="explain">好奇开场 → 分步讲解 → 生活联系 → 追问</option></select></label>
        <div className="science-model-section"><h3>创作模型</h3><label className="science-field">文本模型 · 脚本规划<select aria-label="科普脚本模型" value={textModel} onChange={(event) => patch({ models: { ...current.current.models, text: event.target.value } })}><option value="">原文整理 · 按提供的讲稿分段</option>{textModel && !textModels.some((model) => model.id === textModel) && <option value={textModel} disabled>原模型已移除，请重新选择</option>}{textModels.map((model) => <option key={model.id} value={model.id} disabled={!model.available}>{model.name}{!model.available ? " · 不可用" : ""}</option>)}</select></label><p className="science-hint">文本模型按受众和结构规划分镜；原文整理仅拆分已有资料。<button className="text-button" onClick={() => props.onSettings("text")}>配置文本模型 <ArrowRight size={12}/></button></p>
          <label className="science-field">图片模型 · 可选参考图<select aria-label="科普创作配图模型" value={imageModel} onChange={(event) => patch({ models: { ...current.current.models, image: event.target.value } })}>{!props.models.image.length && <option value="">尚未配置图片模型</option>}{imageModel && !props.models.image.some((model) => modelId(model) === imageModel) && <option value={imageModel} disabled>原模型已移除，请重新选择</option>}{props.models.image.map((model) => <option key={modelId(model)} value={modelId(model)} disabled={typeof model !== "string" && model.available === false}>{typeof model === "string" ? model : model.name || model.id}{typeof model !== "string" && model.available === false ? " · 不可用" : ""}</option>)}</select></label><p className="science-hint">参考图可以从画布生成后用于分镜，成片以动态视频为主体。<button className="text-button" onClick={() => props.onSettings("image")}>配置图片模型 <ArrowRight size={12}/></button></p>
          <label className="science-field">视频模型 · 动态分镜{videoSelector("科普创作视频模型")}</label><p className="science-hint">按镜头生成真实视频片段和模型原声。<button className="text-button" onClick={() => props.onSettings("video")}>配置视频模型 <ArrowRight size={12}/></button></p>
          {!document.topic.trim() ? <p className="science-action-hint">先填写视频主题。</p> : !document.sources.some((source) => source.excerpt.trim()) && !document.scenes.some((scene) => scene.narration.trim()) ? <p className="science-action-hint">在右侧添加资料并粘贴原文后，即可整理脚本与分镜。</p> : null}
          {!textModelAvailable && <p className="science-action-hint" role="status">所选文本模型当前不可用，请更换模型或检查配置。</p>}
        </div>
        <button className="button primary science-next" disabled={!loaded || planning || !textModelAvailable || !document.topic.trim() || (!document.sources.some((source) => source.excerpt.trim()) && !document.scenes.some((scene) => scene.narration.trim()))} onClick={() => void plan()}><MagicWand size={16}/>{planning ? "正在整理分镜…" : "整理脚本与分镜"}</button>
      </section>
      <section className="science-sources"><div className="science-section-heading"><div><h2>资料与证据卡</h2><p>粘贴资料中的关键原文；网址用于追溯和片尾来源，不会自动抓取网页。</p></div><button className="button secondary" disabled={document.sources.length >= 12} onClick={() => patch({ sources: [...document.sources, { id: crypto.randomUUID(), title: "", url: "", excerpt: "" }] })}><Plus size={14}/>添加资料</button></div>
        {!document.sources.length && <div className="science-empty"><BookOpen size={30}/><h3>先给知识一个可靠的起点</h3><p>教材、公开论文、权威科普资料，或你已核对的讲稿。</p><button className="button secondary" onClick={() => patch({ sources: [{ id: crypto.randomUUID(), title: "我的讲稿", url: "", excerpt: "" }] })}><Plus size={14}/>添加第一份资料</button></div>}
        {document.sources.map((source, index) => <article className="science-source" key={source.id}><div><strong>资料 {index + 1}</strong><button className="icon-button" aria-label={`移除资料 ${index + 1}`} onClick={() => patch({ sources: document.sources.filter((item) => item.id !== source.id), scenes: document.scenes.map((scene) => ({ ...scene, sourceIds: scene.sourceIds.filter((id) => id !== source.id), verified: scene.sourceIds.includes(source.id) ? false : scene.verified })) })}><Trash size={14}/></button></div><label className="science-field">来源名称<input aria-label={`资料 ${index + 1} 名称`} maxLength={200} value={source.title} onChange={(event) => patchSource(source.id, { title: event.target.value })} placeholder="教材章节 / 论文标题 / 我的讲稿"/></label><label className="science-field">来源网址（可选）<input aria-label={`资料 ${index + 1} 网址`} value={source.url || ""} maxLength={1000} onChange={(event) => patchSource(source.id, { url: event.target.value })} placeholder="https://…"/></label><label className="science-field">关键原文 / 已核对讲稿<textarea aria-label={`资料 ${index + 1} 原文`} value={source.excerpt} maxLength={3000} onChange={(event) => patchSource(source.id, { excerpt: event.target.value })} placeholder="粘贴需要讲解的原文或讲稿；保留条件、数字和适用范围。"/></label></article>)}
      </section>
    </div>}
    {loaded && step === 2 && <section className="science-storyboard"><div className="science-section-heading"><div><h2>分镜与科学核对</h2><p>每幕编写动作、变化与运镜，关联依据并核对讲解。每幕默认 15 秒，讲解建议不超过 45 字。</p></div><button className="button secondary" disabled={!loaded || document.scenes.length >= 6} onClick={() => patch({ scenes: [...document.scenes, { id: crypto.randomUUID(), role: "explain", narration: "", visualPrompt: "", sourceIds: [], verified: false }] })}><Plus size={14}/>添加分镜</button></div>{planSummary && <p className="science-plan-summary">{planSummary}</p>}
      {!document.scenes.length && <div className="science-empty"><FilmStrip size={28}/><h3>还没有分镜</h3><p>先整理提供的资料，或直接添加你已准备好的分镜。</p><button className="button secondary" onClick={() => setStep(1)}>返回主题与资料</button></div>}
      <div className="science-scene-list">{document.scenes.map((scene, index) => {
        const video = videos.find((asset) => asset.id === scene.videoAssetId);
        return <article key={scene.id} className={cn("science-scene", scene.verified && "verified")}>
          <div className="science-scene-title"><span>镜头 {String(index + 1).padStart(2, "0")}</span><select aria-label={`镜头 ${index + 1} 作用`} value={scene.role} onChange={(event) => patchScene(scene.id, { role: event.target.value as Scene["role"] })}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="icon-button" aria-label={`移除镜头 ${index + 1}`} onClick={() => patch({ scenes: document.scenes.filter((item) => item.id !== scene.id) })}><Trash size={14}/></button></div>
          <div className="science-scene-body"><div className="science-scene-visual">
            {video ? <video src={video.url} controls playsInline preload="metadata" aria-label={`镜头 ${index + 1} 动态预览`}/> : <div><FilmStrip size={27}/><span>动态片段待生成<br/>也可选择已有视频</span></div>}
            <label className="science-field">动态视频<select aria-label={`镜头 ${index + 1} 视频`} value={scene.videoAssetId || ""} onChange={(event) => patchScene(scene.id, { videoAssetId: event.target.value || undefined })}><option value="">制作时由视频模型生成</option>{videos.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
            <label className="science-field">参考图片（可选）<select aria-label={`镜头 ${index + 1} 配图`} value={scene.assetId || ""} onChange={(event) => patchScene(scene.id, { assetId: event.target.value || undefined })}><option value="">不使用参考图</option>{images.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><button className="text-button" onClick={props.onUpload}>上传素材</button>
          </div><div className="science-scene-script"><label className="science-field">讲解台词 · 由视频模型发声<textarea aria-label={`镜头 ${index + 1} 旁白`} maxLength={400} value={scene.narration} onChange={(event) => patchScene(scene.id, { narration: event.target.value })}/><small className={scene.narration.length > narrationLimit ? "science-run-error" : undefined}>{scene.narration.length} / {narrationLimit} 字 · {duration} 秒，给表达留出停顿</small></label>
            <label className="science-field">动态画面 · 动作、变化与运镜<textarea aria-label={`镜头 ${index + 1} 视频描述`} maxLength={2000} value={scene.videoPrompt ?? scene.visualPrompt} onChange={(event) => patchScene(scene.id, { videoPrompt: event.target.value })} placeholder="例如：微距实拍，水滴沿叶面缓缓滚动；镜头跟随水滴推进，保留叶片纹理和自然光影。"/></label>
          </div></div><div className="science-scene-evidence"><strong>本幕依据</strong>{document.sources.map((source) => <label key={source.id}><input type="checkbox" checked={scene.sourceIds.includes(source.id)} onChange={(event) => patchScene(scene.id, { sourceIds: event.target.checked ? [...scene.sourceIds, source.id] : scene.sourceIds.filter((id) => id !== source.id) })}/>{source.title || "未命名资料"}</label>)}{!document.sources.length && <span>先添加一张资料卡。</span>}</div>
          <label className="science-confirm"><input aria-label={`确认镜头 ${index + 1} 科学内容`} type="checkbox" disabled={!scene.narration.trim() || !scene.sourceIds.length} checked={scene.verified} onChange={(event) => patchScene(scene.id, { verified: event.target.checked })}/><span>我已对照所选资料核对这幕讲解、数字与适用条件</span><small>{scene.verified ? "已人工核对" : "待核对"}</small></label>
        </article>;
      })}</div><div className="science-step-footer"><span>{document.scenes.length} / 6 幕 · 讲解 {narrationLength} 字 · 已核对 {checkedScenes} 幕</span><button className="button primary" disabled={!document.scenes.length} onClick={() => setStep(3)}>进入自动制作 <ArrowRight size={15}/></button></div>
    </section>}
    {loaded && step === 3 && <div className="science-production"><section className="science-production-settings"><h2>Muse 动态科普成片</h2><p className="science-hint">视频模型逐幕生成动态画面、讲解与环境声，合成器将片段编排为 MP4 并附上资料来源。可先看单幕，再检查完整成片。</p><div className="science-readiness"><span>{document.scenes.length} 幕分镜</span><span>{checkedScenes} 幕已核对</span><span>{missingVideos} 幕待生成视频</span></div>
      <label className="science-field">动态视频模型{videoSelector("科普视频模型")}</label><button className="text-button" onClick={() => props.onSettings("video")}>配置视频模型 <ArrowRight size={12}/></button>
      <label className="science-field">每幕时长<select aria-label="每幕视频时长" value={duration} onChange={(event) => setVideoDuration(Number(event.target.value))}>{durationOptions.map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select><small>仅显示所选模型支持的时长；每幕讲解不超过 {narrationLimit} 字。</small></label>
      <label className="science-generate-option"><input type="checkbox" checked={generateVideos} onChange={(event) => setGenerateVideos(event.target.checked)}/><span>调用视频模型生成缺失片段<small>将消耗账号额度。相同分镜已成功的生成结果会复用；请求状态不确定时先查询结果。</small></span></label>
      <p className="science-hint">声音来自生成视频的原声音轨。字幕按分镜安排草稿时间，请听看核对台词与字幕；AI 画面是科学示意，发布前需检查其准确性。</p>
      {checkedScenes !== document.scenes.length || !document.scenes.length ? <p className="science-action-hint">请先完成所有分镜的资料关联与人工核对。</p> : longScenes ? <p className="science-action-hint">{longScenes} 幕讲解超过 {narrationLimit} 字，请缩短讲解或增加每幕时长。</p> : missingVideos && !generateVideos ? <p className="science-action-hint">请勾选生成缺失片段，或返回分镜选择已有动态视频。</p> : missingVideos && !videoModelAvailable ? <p className="science-action-hint">请先配置可用的视频模型和生成账号。</p> : null}
      <button className="button primary science-next" disabled={!loaded || !document.scenes.length || checkedScenes !== document.scenes.length || longScenes > 0 || (missingVideos > 0 && (!generateVideos || !videoModelAvailable)) || creating || Boolean(activeRun) || conflict} onClick={() => void createRun()}><MagicWand size={16}/>{creating ? "提交中…" : activeRun ? "正在制作动态视频…" : "生成动态科普视频"}</button><button className="button subtle science-back" onClick={() => setStep(2)}>返回分镜调整</button><p className="science-hint">单片最多 6 幕；生成时长和人物发声效果取决于所选模型。已核对表示创作者确认，不代表系统完成事实认证。</p>
    </section><section className="science-result" aria-label="科普成片与制作记录">{completedRun?.resultUrl ? <><video src={completedRun.resultUrl} controls playsInline preload="metadata" aria-label="科普成片预览"/><div className="science-result-links"><a className="button primary" href={completedRun.resultUrl} download><DownloadSimple size={15}/>下载成片</a>{completedRun.subtitleUrl && <a className="button secondary" href={completedRun.subtitleUrl} download>下载字幕草稿 SRT</a>}</div><p className="science-hint">此版本由动态分镜组成。请检查科学示意、模型发声与字幕，再发布。</p></> : <div className="science-result-empty"><FilmStrip size={42}/><h3>让知识在画面里发生</h3><p>每一幕生成独立动态视频与原声，完成后在这里预览整片。</p></div>}<div className="science-run-list">{runs.map((run) => <article key={run.id}><div><strong>{statusNames[run.status] || run.status}</strong><small>{new Date(run.createdAt).toLocaleString("zh-CN")}</small></div><p>{run.productionMode === "muse_video" ? "动态视频 · 模型原声" : "历史图文版本"}</p>{run.stage && <p>{stageNames[run.stage] || "正在处理制作任务"}</p>}{run.error && <p className="science-run-error">{run.error}</p>}{run.resultUrl && run.id !== completedRun?.id && <a href={run.resultUrl} download>下载此版 MP4</a>}</article>)}</div></section></div>}
  </section>;
});

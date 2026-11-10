import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { ArrowRight, BookOpen, CheckCircle, ClipboardText, CloudCheck, DownloadSimple, FilmStrip, FolderOpen, GearSix, Lock, MagicWand, MapPin, Package, Pause, UserCircle, WarningCircle } from "@phosphor-icons/react";
import { api, ApiError, json, message } from "./api";
import { cn, Modal } from "./components";
import { coreLabels, editableStory, emptyStoryDocument, exportStoryText, storyCanvasPayload, storyKey, storyStages, storyTaskActive, type StoryApplyPayload, type StoryCharacter, type StoryDocument, type StoryScene, type StorySnapshot, type StoryTask } from "./storyWorkflowModel";
import "./canvas-story-workflow.css";

export type CanvasStoryWorkflowProps = {
  open: boolean; onOpenChange: (open: boolean) => void; projectId: string; modelCatalogVersion?: number;
  onSettings?: () => void; onApply: (payload: StoryApplyPayload) => void | Promise<void>;
};
type TextModel = { id: string; name: string; available: boolean };
const finished = (task: StoryTask) => !storyTaskActive(task);
const download = (text: string, name: string, type = "text/plain;charset=utf-8") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function CanvasStoryWorkflow({ open, onOpenChange, projectId, modelCatalogVersion = 0, onSettings, onApply }: CanvasStoryWorkflowProps) {
  const [document, setDocument] = useState<StoryDocument>(emptyStoryDocument);
  const current = useRef(document); current.current = document;
  const revision = useRef(0); const saved = useRef("");
  const [savedKey, setSavedKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [models, setModels] = useState<TextModel[]>([]);
  const [tasks, setTasks] = useState<StoryTask[]>([]);
  const [working, setWorking] = useState(""); const lock = useRef(false);
  const [saving, setSaving] = useState(false); const pendingSave = useRef<Promise<boolean> | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<"input" | "archive" | "segments">("input");
  const [selectedId, setSelectedId] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const sourceFile = useRef<HTMLInputElement>(null);
  const base = `/projects/${encodeURIComponent(projectId)}/story-workflow`;
  const active = tasks.find(storyTaskActive);
  const lastFailure = tasks[0]?.status === "failed" ? tasks[0] : undefined;
  const dirty = storyKey(document) !== savedKey;
  const disabled = !loaded || Boolean(working) || Boolean(active) || conflict;
  const segment = document.segments.find((value) => value.id === selectedId) || document.segments.at(-1);
  const requestSignal = (scope: AbortController, timeout = 20_000) => AbortSignal.any([scope.signal, AbortSignal.timeout(timeout)]);

  const applySnapshot = (value: StorySnapshot) => {
    current.current = value.document; setDocument(value.document); revision.current = value.revision;
    saved.current = storyKey(value.document); setSavedKey(saved.current); setLoaded(true); setConflict(false);
  };
  const load = useCallback(async (scope: AbortController) => {
    setLoaded(false); setError("");
    try {
      const [snapshot, queue] = await Promise.all([api<StorySnapshot>(base, { signal: requestSignal(scope) }), api<{ tasks: StoryTask[] }>(`${base}/tasks`, { signal: requestSignal(scope) })]);
      if (scope.signal.aborted) return;
      applySnapshot(snapshot); setTasks(queue.tasks); setSelectedId(snapshot.document.segments.at(-1)?.id || "");
    } catch (cause) { if (!scope.signal.aborted) setError(message(cause)); }
  }, [base]);
  useEffect(() => {
    if (!open) return;
    const scope = new AbortController(); lifetime.current = scope;
    setDocument(emptyStoryDocument()); current.current = emptyStoryDocument(); revision.current = 0; saved.current = ""; setSavedKey(""); setTasks([]); setWorking(""); setNotice(""); setTab("input"); setSaving(false); setConfirmClose(false); pendingSave.current = null; lock.current = false;
    void load(scope);
    return () => { scope.abort(); if (lifetime.current === scope) lifetime.current = null; };
  }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api<{ models: TextModel[] }>("/models/text", { signal: requestSignal(controller) }).then((result) => { if (!controller.signal.aborted) setModels(result.models); }).catch((cause) => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => controller.abort();
  }, [open, modelCatalogVersion]);

  const save = useCallback(async (): Promise<boolean> => {
    const scope = lifetime.current;
    if (!scope || scope.signal.aborted || !loaded || conflict) return false;
    if (pendingSave.current) { const ok = await pendingSave.current; return ok && lifetime.current === scope && !scope.signal.aborted && (storyKey(current.current) === saved.current || save()); }
    if (storyKey(current.current) === saved.current) return true;
    const input = current.current; setSaving(true);
    const operation: Promise<boolean> = (async () => {
      try {
        const value = await api<StorySnapshot>(base, { method: "PUT", body: json({ baseRevision: revision.current, document: editableStory(input) }), signal: requestSignal(scope) });
        if (scope.signal.aborted) return false;
        revision.current = value.revision; saved.current = storyKey(value.document); setSavedKey(saved.current);
        const next = storyKey(current.current) === storyKey(input) ? value.document : { ...value.document, ...editableStory(current.current) };
        current.current = next; setDocument(next); return true;
      } catch (cause) {
        if (!scope.signal.aborted) { setError(message(cause)); if (cause instanceof ApiError && cause.status === 409) setConflict(true); }
        return false;
      } finally { if (lifetime.current === scope) pendingSave.current = null; if (!scope.signal.aborted) setSaving(false); }
    })();
    pendingSave.current = operation;
    const ok = await operation;
    return ok && lifetime.current === scope && !scope.signal.aborted && (storyKey(current.current) === saved.current || save());
  }, [base, loaded, conflict]);
  useEffect(() => {
    if (!open || !loaded || !dirty || active || conflict) return;
    const timer = setTimeout(() => void save(), 1000); return () => clearTimeout(timer);
  }, [open, loaded, dirty, document, active?.id, conflict, save]);
  useEffect(() => {
    if (!open || !dirty || !loaded) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty, loaded]);
  useEffect(() => {
    if (!open || !active) return;
    const scope = lifetime.current; if (!scope) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const queue = await api<{ tasks: StoryTask[] }>(`${base}/tasks`, { signal: requestSignal(scope) });
        if (scope.signal.aborted || disposed) return;
        const latest = queue.tasks.find((task) => task.id === active.id);
        if (latest && finished(latest)) {
          if (latest.status === "succeeded") {
            const next = await api<StorySnapshot>(base, { signal: requestSignal(scope) });
            if (scope.signal.aborted || disposed) return;
            applySnapshot(next); setSelectedId(next.document.segments.at(-1)?.id || ""); setTab(latest.operation === "extract" ? "archive" : "segments"); setNotice(latest.operation === "extract" ? "档案已提取并锁定，请核对拟定项与人物形象。" : "五个镜头与末镜状态已保存，可核对后应用到画布。");
          } else if (latest.error) setError(latest.error);
          setTasks(queue.tasks);
          return;
        }
        setTasks(queue.tasks);
      } catch (cause) { if (!scope.signal.aborted && !disposed) setError(`读取任务状态失败：${message(cause)}，可以稍后重新打开工作流查看。`); }
      if (!scope.signal.aborted && !disposed) timer = setTimeout(() => void poll(), 2200);
    };
    timer = setTimeout(() => void poll(), 1200);
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [open, active?.id, base]);

  const patch = (value: Partial<StoryDocument>) => { const next = { ...current.current, ...value }; current.current = next; setDocument(next); setError(""); setNotice(""); };
  const run = async (name: string, action: (scope: AbortController) => Promise<void>) => {
    const scope = lifetime.current; if (!scope || scope.signal.aborted || lock.current) return;
    lock.current = true; setWorking(name); setError(""); setNotice("");
    try { await action(scope); } catch (cause) { if (!scope.signal.aborted) setError(message(cause)); }
    finally { if (!scope.signal.aborted) { lock.current = false; setWorking(""); } }
  };
  const start = (operation: StoryTask["operation"]) => void run(operation, async (scope) => {
    if (!(await save())) throw new Error("工作流尚未保存，请处理保存错误后重试。");
    if (scope.signal.aborted) return;
    const task = await api<StoryTask>(`${base}/tasks`, { method: "POST", body: json({ revision: revision.current, operation }), signal: requestSignal(scope) });
    if (!scope.signal.aborted) setTasks((values) => [task, ...values]);
  });
  const cancel = () => active && void run("cancel", async (scope) => {
    const task = await api<StoryTask>(`${base}/tasks/${active.id}/cancel`, { method: "POST", signal: requestSignal(scope) });
    if (!scope.signal.aborted && task.status === "succeeded") {
      const next = await api<StorySnapshot>(base, { signal: requestSignal(scope) });
      if (scope.signal.aborted) return;
      applySnapshot(next); setSelectedId(next.document.segments.at(-1)?.id || ""); setTab(task.operation === "extract" ? "archive" : "segments");
    }
    if (!scope.signal.aborted) { setTasks((values) => values.map((value) => value.id === task.id ? task : value)); setNotice(task.status === "cancelled" ? "任务已取消，现有档案与分镜保留。已经发出的模型请求可能仍被供应商计费。" : "任务已经完成，请查看保存结果。"); }
  });
  const close = (next: boolean) => { if (lock.current) return; if (!next && loaded && dirty) setConfirmClose(true); else onOpenChange(next); };
  const apply = () => segment && void run("apply", async (scope) => { if (!(await save())) throw new Error("请先同步档案修改。"); if (scope.signal.aborted) return; await onApply(storyCanvasPayload(current.current, segment)); if (!scope.signal.aborted) setNotice("分镜与档案已应用到画布，可在画布中明确执行生图／视频任务。"); });
  const importNovel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const scope = lifetime.current; if (!scope || scope.signal.aborted) return;
    try { if (file.size > 1024 * 1024) throw new Error("TXT文件超过1MiB，请按章节分段输入。"); const value = await file.text(); if (scope.signal.aborted) return; if (value.length > 120000) throw new Error("小说全文最多12万字符，请按章节分段输入。"); patch({ novel: value }); } catch (cause) { if (!scope.signal.aborted) setError(message(cause)); }
  };
  const personPatch = (id: string, value: Partial<StoryCharacter>) => patch({ characters: document.characters.map((person) => person.id === id ? { ...person, ...value } : person) });
  const scenePatch = (id: string, value: Partial<StoryScene>) => patch({ scenes: document.scenes.map((scene) => scene.id === id ? { ...scene, ...value } : scene) });
  const outputName = `${document.title.replace(/[<>:"/\\|?*]/g, "_") || "连续剧本"}`;

  return <><Modal open={open} onOpenChange={close} title="连续剧本 Agent" description="从小说与逐段剧本建立同一套人物档案，再生成严格五镜头的15秒真人分镜。" className="canvas-story-dialog">
    <div className="cs-summary"><span><FilmStrip size={16}/>5 个镜头 × 3 秒</span><span>真人写实 · 无字幕 · 音效 · 无音乐</span><span className="cs-save-status"><CloudCheck size={14}/>{saving ? "正在保存…" : dirty && loaded ? "本次修改待同步" : loaded ? "已同步到当前画布草稿" : "正在读取…"}</span></div>
    <nav className="cs-tabs" aria-label="剧本工作流">{([{ id: "input", name: "文字与设定", icon: BookOpen }, { id: "archive", name: `连续性档案 ${document.characters.length + document.scenes.length + document.props.length}`, icon: UserCircle }, { id: "segments", name: `分镜历史 ${document.segments.length}`, icon: FilmStrip }] as const).map(({ id, name, icon: Icon }) => <button key={id} className={cn(tab === id && "active")} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={16}/>{name}</button>)}</nav>
    {error && <div className="cs-feedback error" role="alert"><WarningCircle size={17}/><span>{error}</span>{(!loaded || conflict) && <button className="button secondary" disabled={Boolean(working)} onClick={() => lifetime.current && void load(lifetime.current)}>重新读取</button>}</div>}
    {notice && <div className="cs-feedback success" role="status"><CheckCircle size={17}/><span>{notice}</span></div>}
    {active && <div className="cs-task" role="status"><div><strong>{storyStages[active.stage] || "正在执行工作流"}</strong><p>只调用已选择的模型，校验通过后才保存结果。关闭弹层后仍可在此画布查看任务。</p></div><button className="button secondary" disabled={Boolean(working)} onClick={cancel}><Pause size={15}/>{working === "cancel" ? "取消中…" : "取消任务"}</button></div>}
    {!loaded ? <div className="cs-loading">{error ? "工作流尚未载入，请重新读取。" : "正在载入此画布的剧本与连续性档案…"}</div> : <div className="cs-body">
      {tab === "input" && <div className="cs-input-layout"><fieldset className="cs-input-fields" disabled={disabled}>
        <label className="cs-field">剧集名称<input maxLength={200} value={document.title} onChange={(event) => patch({ title: event.target.value })}/></label>
        <label className="cs-field">文本理解模型<select value={document.model} onChange={(event) => patch({ model: event.target.value })}><option value="">选择已配置的文本模型</option>{models.map((model) => <option key={model.id} value={model.id} disabled={!model.available}>{model.name}{model.available ? "" : " · 暂不可用"}</option>)}</select></label>
        {onSettings && <button className="text-button cs-settings" onClick={onSettings}><GearSix size={14}/>配置文本渠道</button>}
        <label className="cs-field">全剧设定<textarea value={document.world} maxLength={12000} rows={4} placeholder="时代、地域、人物关系、视觉基调，以及必须遵守的全剧设定。" onChange={(event) => patch({ world: event.target.value })}/><small>最多12,000字符。角色形象拟定项会单独列出，供你核对。</small></label>
        <div className="cs-field"><span><label htmlFor="canvas-story-novel">小说全文 / 章节原文</label><button type="button" className="text-button" onClick={() => sourceFile.current?.click()}><FolderOpen size={14}/>导入 TXT</button></span><textarea id="canvas-story-novel" value={document.novel} maxLength={120000} rows={5} placeholder="粘贴全文或一个章节，用于首次提取角色、同人代称、场景和道具。也可先留空，按当前段落提取。" onChange={(event) => patch({ novel: event.target.value })}/><small>{document.novel.length.toLocaleString()} / 120,000字符；原文不会被自动截断，模型须支持所需上下文长度。</small></div>
        <input ref={sourceFile} type="file" accept=".txt,text/plain" hidden onChange={(event) => void importNovel(event)}/>
      </fieldset><section className="cs-paragraph-area"><label className="cs-field">当前剧本段落<textarea className="cs-current-paragraph" disabled={disabled} value={document.paragraph} maxLength={6000} placeholder="输入本次要拍的段落。每次生成严格5个3秒镜头；后续段落会接续上段末镜状态。" onChange={(event) => patch({ paragraph: event.target.value })}/><small>{document.paragraph.length} / 6,000字符 · 每段保留对应原文</small></label>
        {document.lastState && <div className="cs-last-state"><span>上一段末镜状态</span><strong>{document.scenes.find((scene) => scene.id === document.lastState?.sceneId)?.name || "已保存场景"}</strong><p>{document.lastState.visibleAction}</p><small>下一段首镜从这个场景接续。方位、衣着与动作阶段会一并传给模型。</small></div>}
        <div className="cs-run-actions"><button className="button primary" disabled={disabled || !document.model || !document.paragraph.trim()} onClick={() => start("first")}><MagicWand size={17}/>一键档案与首段分镜</button><button className="button secondary" disabled={disabled || !document.model || (!document.novel.trim() && !document.paragraph.trim())} onClick={() => start("extract")}><UserCircle size={16}/>提取 / 更新档案</button><button className="button secondary" disabled={disabled || !document.model || !document.paragraph.trim() || !document.characters.length || !document.scenes.length || document.characters.some((person) => !person.locked)} onClick={() => start("segment")}>生成下一段<ArrowRight size={16}/></button></div><p className="cs-hint">提取和分镜会使用模型额度，失败与取消不会覆盖原档案。分镜目标为15秒；应用到画布后，须按实际视频模型支持的时长执行生成。</p>
      </section></div>}
      {tab === "archive" && <div className="cs-archives">
        {!document.characters.length && !document.scenes.length && !document.props.length && <div className="cs-empty"><UserCircle size={30}/><h3>先从原文建立连续性档案</h3><p>人物核心形象、同人代称、实景环境与道具会贯穿后续分镜。</p><button className="button secondary" onClick={() => setTab("input")}>输入小说或当前段落</button></div>}
        {document.characters.length > 0 && <section><h3><UserCircle size={18}/>角色档案<span>{document.characters.length}</span></h3><div className="cs-profile-grid">{document.characters.map((person) => <details className="cs-profile" key={person.id}><summary><span><strong>{person.name}</strong><small>{person.aliases.length ? person.aliases.join(" / ") : "无其他代称"}</small></span><span className={cn("cs-lock-label", person.locked && "locked")}><Lock size={13}/>{person.locked ? "核心已锁定" : "待锁定"}</span></summary><label className="cs-lock-control"><input type="checkbox" checked={person.locked} disabled={disabled} onChange={(event) => personPatch(person.id, { locked: event.target.checked })}/>锁定姓名、代称、核心形象与音色</label><fieldset disabled={disabled || person.locked}><label className="cs-field">姓名<input value={person.name} maxLength={80} onChange={(event) => personPatch(person.id, { name: event.target.value })}/></label><label className="cs-field">所有同人代称（用逗号分隔）<input value={person.aliases.join("，")} onChange={(event) => personPatch(person.id, { aliases: event.target.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean) })}/></label><div className="cs-core-grid">{Object.entries(coreLabels).map(([key, label]) => <label className="cs-field" key={key}>{label}<input value={person.core[key as keyof typeof coreLabels]} maxLength={140} onChange={(event) => personPatch(person.id, { core: { ...person.core, [key]: event.target.value } })}/></label>)}</div><label className="cs-field">固定音色<input value={person.voice} maxLength={240} onChange={(event) => personPatch(person.id, { voice: event.target.value })}/></label></fieldset><fieldset disabled={disabled}>{Object.entries({ upper: "上身", lower: "下身", shoes: "鞋", accessories: "配饰" }).map(([key, label]) => <label className="cs-field" key={key}>{label}<input value={person.clothing[key as keyof StoryCharacter["clothing"]]} maxLength={180} onChange={(event) => personPatch(person.id, { clothing: { ...person.clothing, [key]: event.target.value } })}/></label>)}<label className="cs-field">性格<textarea value={person.personality} rows={2} maxLength={300} onChange={(event) => personPatch(person.id, { personality: event.target.value })}/></label></fieldset>{person.assumptions.length > 0 && <div className="cs-assumptions"><strong>原文未明确，以下为拍摄拟定项，请核对</strong><ul>{person.assumptions.map((value, index) => <li key={index}>{value}</li>)}</ul></div>}<details className="cs-prompt"><summary>正面全身与三视图提示词</summary><p>{person.imagePrompt}</p><p>{person.threeViewPrompt}</p></details></details>)}</div></section>}
        {document.scenes.length > 0 && <section><h3><MapPin size={18}/>场景档案<span>{document.scenes.length}</span></h3><div className="cs-profile-grid">{document.scenes.map((scene) => <details className="cs-profile" key={scene.id}><summary><strong>{scene.name}</strong><small>{scene.time} · {scene.weather}</small></summary><fieldset disabled={disabled}>{Object.entries({ name: "场景名称", time: "时间", weather: "天气", lighting: "光线", space: "空间结构", elements: "环境元素" }).map(([key, label]) => <label className="cs-field" key={key}>{label}<textarea rows={key === "space" || key === "elements" ? 2 : 1} maxLength={400} value={scene[key as keyof Pick<StoryScene, "name" | "time" | "weather" | "lighting" | "space" | "elements">]} onChange={(event) => scenePatch(scene.id, { [key]: event.target.value })}/></label>)}</fieldset><p className="cs-hint">同场景代称：{scene.aliases.join(" / ") || "无"} · 描述仅含实景环境与元素。</p><details className="cs-prompt"><summary>真人实景提示词</summary><p>{scene.imagePrompt}</p></details></details>)}</div></section>}
        {document.props.length > 0 && <section><h3><Package size={18}/>道具档案<span>{document.props.length}</span></h3><div className="cs-profile-grid">{document.props.map((prop) => <details className="cs-profile" key={prop.id}><summary><strong>{prop.name}</strong><small>{prop.material}</small></summary><fieldset disabled={disabled}>{Object.entries({ name: "名称", material: "材质", size: "尺寸", appearance: "外观" }).map(([key, label]) => <label className="cs-field" key={key}>{label}<textarea rows={2} maxLength={400} value={prop[key as keyof Pick<typeof prop, "name" | "material" | "size" | "appearance">]} onChange={(event) => patch({ props: document.props.map((value) => value.id === prop.id ? { ...value, [key]: event.target.value } : value) })}/></label>)}</fieldset><details className="cs-prompt"><summary>白底正面完整提示词</summary><p>{prop.imagePrompt}</p></details></details>)}</div></section>}
      </div>}
      {tab === "segments" && <div className="cs-history-layout"><aside className="cs-segment-list" aria-label="历次分镜">{document.segments.map((value) => <button className={cn(segment?.id === value.id && "active")} key={value.id} onClick={() => setSelectedId(value.id)}><strong>第 {value.number} 段 <span>15秒</span></strong><small>{value.script.slice(0, 44)}{value.script.length > 44 ? "…" : ""}</small></button>)}</aside><section className="cs-segment-detail">{segment ? <><div className="cs-segment-heading"><h3>第 {segment.number} 段 · 五个连续镜头</h3><div><button className="button secondary" onClick={() => download(exportStoryText(document, segment), `${outputName}-第${segment.number}段分镜.txt`)}><DownloadSimple size={15}/>导出本段</button><button className="button primary" disabled={Boolean(working) || Boolean(active) || conflict} onClick={apply}><FilmStrip size={15}/>{working === "apply" ? "正在应用…" : "应用到画布"}</button></div></div><div className="cs-source-script"><span>本段对应剧本</span><p>{segment.script}</p></div><div className="cs-shot-table"><table><caption>本段0–15秒分镜。每个镜头固定3秒，旁白无。</caption><thead><tr><th>时段</th><th>镜头 / 运镜</th><th>可视化动作 / 角色状态</th><th>环境与动作音</th><th>台词 / 音色</th><th>场景</th></tr></thead><tbody>{segment.shots.map((shot) => <tr key={shot.start}><td>{shot.start}–{shot.end}s</td><td><strong>{shot.shotType}</strong><p>{shot.camera}</p></td><td><p>{shot.visibleAction}</p>{shot.characters.map((actor) => <small key={actor.characterId}>{document.characters.find((person) => person.id === actor.characterId)?.name}：{actor.position}，{actor.posture}，{actor.action}</small>)}</td><td>{shot.sound}<small>旁白：无 · 无音乐</small></td><td>{shot.dialogue.length ? shot.dialogue.map((line, index) => <p key={index}><strong>{document.characters.find((person) => person.id === line.characterId)?.name}</strong>：{line.text}<small>{document.characters.find((person) => person.id === line.characterId)?.voice}</small></p>) : "无台词"}</td><td>{shot.sceneDetail}</td></tr>)}</tbody></table></div><details className="cs-formatted"><summary>查看完整视频分镜文本<button type="button" className="text-button" onClick={(event) => { event.preventDefault(); void navigator.clipboard.writeText(segment.formattedPrompt).then(() => setNotice("完整分镜文本已复制。")).catch(() => setError("无法写入剪贴板，可使用导出本段。")); }}><ClipboardText size={14}/>复制</button></summary><pre>{segment.formattedPrompt}</pre></details><p className="cs-hint">应用只创建可审阅的档案与镜头节点。实际生图、视频生成需要你在画布中明确执行；供应商不支持3秒或15秒时不能据此标注成片已完成。</p></> : <div className="cs-empty"><FilmStrip size={30}/><h3>这里会保存每一段的原文与五镜头</h3><p>先输入文字并提取档案，再生成首段或下一段。</p><button className="button secondary" onClick={() => setTab("input")}>开始规划</button></div>}</section></div>}
    </div>}
    <footer className="cs-footer"><div><span>{document.characters.filter((person) => person.locked).length} 个锁定角色 · {document.scenes.length} 个场景 · {document.props.length} 件道具</span>{lastFailure && !active && <small>上次失败：{lastFailure.error}</small>}</div><div><button className="button secondary" disabled={!document.segments.length} onClick={() => download(exportStoryText(document), `${outputName}-全部分镜.txt`)}><DownloadSimple size={15}/>导出全部</button><button className="button secondary" disabled={!loaded || Boolean(working) || Boolean(active) || !dirty || conflict} onClick={() => void save()}><CloudCheck size={15}/>保存草稿</button></div></footer>
  </Modal><AlertDialog.Root open={confirmClose} onOpenChange={setConfirmClose}><AlertDialog.Portal><AlertDialog.Overlay className="cs-confirm-overlay"/><AlertDialog.Content className="dialog-content cs-confirm"><AlertDialog.Title>放弃未同步的修改？</AlertDialog.Title><AlertDialog.Description>本次文字或档案修改尚未保存。继续关闭会放弃这些修改；已经提交的模型任务会在后台保留。</AlertDialog.Description><div><AlertDialog.Cancel asChild><button className="button secondary">继续编辑</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="button secondary" onClick={() => onOpenChange(false)}>放弃并关闭</button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root></>;
}

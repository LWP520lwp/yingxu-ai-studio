import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  FilmStrip,
  ImageSquare,
  Lightning,
  MagnifyingGlass,
  Stack,
  Trash,
  Plus,
  Star,
  UploadSimple,
  DownloadSimple,
  X,
} from "@phosphor-icons/react";
import { api, ApiError, json, message } from "./api";
import { cn, Modal } from "./components";
import { RequestScope, type ScopedRequest } from "./requestScope";
import { packageSkillDirectory } from "./skillDirectory";
import { canApplySkill, filterMarketSkills, skillPresentation, type MarketCategory, type MarketCollection } from "./skillMarketModel";

export type ExecutableSkill = string;
export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  capability: "image" | "video" | "composition";
  status: "available" | "planned";
  recipeVersion: string;
  installed?: boolean;
  favorite?: boolean;
  installedVersion?: string | null;
  updateAvailable?: boolean;
  tags?: string[];
  inputSchema?: Record<string, unknown>;
  recipe?: Record<string, unknown>;
  category?: string;
  source?: "builtin" | "imported";
  visibility?: "public" | "private";
  sourceId?: string;
  sourceFormat?: string;
  ignoredFiles?: number;
  includedDocuments?: number;
};
const categories = [
  { id: "all", label: "全部用途" },
  { id: "advertising", label: "商业广告" },
  { id: "film", label: "影视与动作" },
  { id: "character", label: "角色设计" },
  { id: "education", label: "教育科普" },
  { id: "illustration", label: "插画绘本" },
  { id: "space", label: "空间概念" },
] as const;
const labels = {
  image: "图像创作",
  video: "视频创作",
  composition: "组合工作流",
};
const icons = { image: ImageSquare, video: FilmStrip, composition: Lightning };
const requestSignal = (request: ScopedRequest) => AbortSignal.any([request.controller.signal, AbortSignal.timeout(20_000)]);

export function SkillMarket({
  open,
  onOpenChange,
  signedIn,
  sessionKey,
  onLogin,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signedIn: boolean;
  sessionKey?: string | null;
  onLogin: () => void;
  onUse: (skill: ExecutableSkill, definition: SkillDefinition) => Promise<void>;
}) {
  const scopeKey = JSON.stringify([open, signedIn, sessionKey ?? null]);
  const currentKey = useRef(scopeKey);
  currentKey.current = scopeKey;
  const scope = useRef(new RequestScope());
  const busyRequest = useRef<ScopedRequest | null>(null);
  const [catalog, setCatalog] = useState<{
    key: string;
    skills: SkillDefinition[];
  } | null>(null);
  const skills = catalog?.key === scopeKey ? catalog.skills : [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MarketCategory>("all");
  const [collection, setCollection] = useState<MarketCollection>("all");
  const [detailState, setDetailState] = useState<{
    key: string;
    skill: SkillDefinition;
  } | null>(null);
  const detail = detailState?.key === scopeKey ? detailState.skill : null;
  const [busy, setBusy] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCapability, setImportCapability] = useState<"image" | "video">("video");
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");
  const [retrySeconds, setRetrySeconds] = useState(0);
  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = setTimeout(() => setRetrySeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [retrySeconds]);
  const active = useCallback(
    (request: ScopedRequest) =>
      scope.current.current(request, currentKey.current),
    [],
  );
  const refresh = useCallback(
    async (request: ScopedRequest) => {
      const next = await api<SkillDefinition[]>("/skills", {
        signal: requestSignal(request),
      });
      if (!active(request)) return;
      setCatalog({ key: request.key, skills: next });
      setDetailState((previous) => {
        if (!previous || previous.key !== request.key) return null;
        const summary = next.find((item) => item.id === previous.skill.id);
        if (!summary) return null;
        return {
          key: request.key,
          skill: {
            ...previous.skill,
            ...summary,
            recipe:
              summary.recipeVersion === previous.skill.recipeVersion
                ? previous.skill.recipe
                : undefined,
          },
        };
      });
    },
    [active],
  );
  useEffect(() => {
    scope.current.invalidate();
    busyRequest.current = null;
    setBusy("");
    setDetailState(null);
    setImportFile(null);
    setImportError("");
    if (fileInput.current) fileInput.current.value = "";
    if (!open) {
      setLoading(false);
      return () => scope.current.invalidate();
    }
    const request = scope.current.begin(scopeKey);
    setLoading(true);
    setError("");
    setNotice("");
    void refresh(request)
      .catch((cause) => {
        if (active(request)) setError(message(cause));
      })
      .finally(() => {
        if (active(request)) setLoading(false);
        scope.current.release(request);
      });
    return () => scope.current.invalidate();
  }, [open, scopeKey, refresh, active]);

  const visible = useMemo(
    () =>
      filterMarketSkills(skills, category, search, collection),
    [skills, category, search, collection],
  );

  function beginBusy(id: string) {
    if (busyRequest.current && active(busyRequest.current)) return null;
    const request = scope.current.begin(currentKey.current);
    busyRequest.current = request;
    setBusy(id);
    return request;
  }
  function finishBusy(request: ScopedRequest) {
    scope.current.release(request);
    if (busyRequest.current === request) {
      busyRequest.current = null;
      if (active(request)) setBusy("");
    }
  }
  async function retry() {
    if (loading) return;
    const request = scope.current.begin(currentKey.current);
    setError("");
    setLoading(true);
    try {
      await refresh(request);
    } catch (cause) {
      if (active(request)) setError(message(cause));
    } finally {
      if (active(request)) setLoading(false);
      scope.current.release(request);
    }
  }
  async function install(skill: SkillDefinition, remove = false) {
    if (!signedIn) {
      onLogin();
      return;
    }
    const request = beginBusy(skill.id);
    if (!request) return;
    setError("");
    setNotice("");
    try {
      await api(`/workspace/skills/${skill.id}`, {
        method: remove ? "DELETE" : "PUT",
        signal: requestSignal(request),
        ...(remove
          ? {}
          : { body: json({ recipeVersion: skill.recipeVersion }) }),
      });
      if (!active(request)) return;
      await refresh(request);
      if (!active(request)) return;
      setNotice(
        remove
          ? "已从我的技能移除，已有画布和生成记录保留。"
          : "已添加到我的技能，可以在当前画布使用。",
      );
    } catch (cause) {
      if (active(request)) setError(message(cause));
    } finally {
      finishBusy(request);
    }
  }
  async function showDetail(skill: SkillDefinition) {
    const request = beginBusy(skill.id);
    if (!request) return;
    setError("");
    try {
      const next = await api<SkillDefinition>(`/skills/${skill.id}`, {
        signal: requestSignal(request),
      });
      if (active(request)) setDetailState({ key: request.key, skill: next });
    } catch (cause) {
      if (active(request)) setError(message(cause));
    } finally {
      finishBusy(request);
    }
  }
  async function toggleFavorite(skill: SkillDefinition) {
    if (!signedIn) { onLogin(); return; }
    const request = beginBusy(skill.id);
    if (!request) return;
    setError("");
    try {
      await api(`/workspace/skill-favorites/${skill.id}`, {
        method: skill.favorite ? "DELETE" : "PUT", signal: requestSignal(request),
      });
      if (!active(request)) return;
      await refresh(request);
    } catch (cause) {
      if (active(request)) setError(message(cause));
    } finally { finishBusy(request); }
  }
  async function use(skill: SkillDefinition) {
    if (!signedIn) {
      onLogin();
      return;
    }
    if (!canApplySkill(skill)) return;
    const request = beginBusy(skill.id);
    if (!request) return;
    setError("");
    try {
      // Re-read the session's installation and current recipe immediately before use.
      const definition = await api<SkillDefinition>(`/skills/${skill.id}`, {
        signal: requestSignal(request),
      });
      if (!active(request)) return;
      if (!definition.installed || definition.status !== "available")
        throw new Error("请先将这个技能添加到当前工作空间。");
      if (
        definition.updateAvailable ||
        definition.installedVersion !== definition.recipeVersion
      )
        throw new Error("技能版本已更新，请确认并更新后再使用。");
      const expectedKind = definition.capability;
      if (
        definition.id !== skill.id ||
        !["image", "video"].includes(expectedKind) ||
        definition.recipe?.schemaVersion !== 1 ||
        definition.recipe?.operation !== "generation-job" ||
        definition.recipe.path !== "/api/jobs" ||
        definition.recipe.method !== "POST" ||
        definition.recipe.kind !== expectedKind
      )
        throw new Error("这个技能配方暂不能在当前工作台执行。");
      await onUse(skill.id, definition);
    } catch (cause) {
      if (active(request)) setError(message(cause));
    } finally {
      finishBusy(request);
    }
  }
  async function importPackage() {
    if (!signedIn) { onLogin(); return; }
    if (!importFile) { setImportError("请先选择技能包或技能文件夹"); return; }
    if (retrySeconds > 0) return;
    if (importFile.size > 2 * 1024 * 1024 || !/\.(zip|json|md)$/i.test(importFile.name)) { setImportError("请上传不超过 2 MiB 的 ZIP、JSON 或 SKILL.md"); return; }
    const request = beginBusy("skill-import");
    if (!request) return;
    setError(""); setImportError(""); setNotice("");
    try {
      const body = new FormData(); body.set("file", importFile); body.set("capability", importCapability);
      const imported = await api<SkillDefinition>("/workspace/skill-imports", { method: "POST", body, signal: requestSignal(request) });
      if (!active(request)) return;
      await refresh(request);
      if (!active(request)) return;
      setCollection("imported"); setCategory("all"); setSearch(""); setDetailState(null);
      setImportFile(null); if (fileInput.current) fileInput.current.value = "";
      setImportOpen(false);
      setNotice(`已导入并安装「${imported.name}」，可在${imported.capability === "video" ? "视频 Skill 选择器或" : ""}画布中使用。${imported.includedDocuments ? `已保留 ${imported.includedDocuments} 份参考文档，可在详情查阅。` : ""}${imported.ignoredFiles ? `包内 ${imported.ignoredFiles} 个附属文件未导入。` : ""}`);
      window.dispatchEvent(new CustomEvent("workbench:skills-changed"));
    } catch (cause) { if (active(request)) {
      setImportError(message(cause));
      if (cause instanceof ApiError && cause.status === 429) setRetrySeconds(Math.min(3600, Math.max(1, Number(cause.details?.retryAfterSeconds) || 60)));
    } }
    finally { finishBusy(request); }
  }
  async function selectDirectory(files: File[]) {
    const request = beginBusy("skill-directory");
    if (!request) return;
    setImportError("");
    try { const packed = await packageSkillDirectory(files); if (active(request)) { setImportFile(packed); setNotice(packed.skippedFiles ? `技能文件夹已准备好，已跳过 ${packed.skippedFiles} 个 PDF、压缩包、脚本等非配方文件。确认导入后保存到我的技能。` : "技能文件夹已准备好，请确认导入。"); } }
    catch (cause) { if (active(request)) setImportError(message(cause)); }
    finally { finishBusy(request); if (directoryInput.current) directoryInput.current.value = ""; }
  }
  function actions(skill: SkillDefinition) {
    if (skill.status === "planned") return <span className="skill-market-status planned">规划中</span>;
    if (!skill.installed) return <button className="button secondary" disabled={!!busy || loading} onClick={() => void install(skill)} aria-label={`安装 ${skill.name}`}><Plus size={15}/>{busy === skill.id ? "处理中…" : "安装"}</button>;
    if (skill.updateAvailable) return <button className="button primary" disabled={!!busy || loading} onClick={() => void install(skill)} aria-label={`更新 ${skill.name}`}>{busy === skill.id ? "处理中…" : "更新技能"}</button>;
    return <button className="button primary" disabled={!!busy || loading || !canApplySkill(skill)} onClick={() => void use(skill)} aria-label={`使用 ${skill.name}`}>使用技能<ArrowRight size={14}/></button>;
  }
  const installedCount = skills.filter((skill) => skill.installed).length;
  const favoriteCount = skills.filter((skill) => skill.favorite).length;
  const importedCount = skills.filter((skill) => skill.source === "imported").length;
  const presentation = detail ? skillPresentation(detail) : null;

  return <Modal open={open} onOpenChange={onOpenChange} title="创作 Skill 库" description="把创作方法带进画布。从一个想法开始，找到适合它的表达。" className="market-dialog market-gallery">
    <div className="market-gallery-top">
      <div className="market-collection-tabs" role="group" aria-label="技能集合">
        {([{ id: "all", label: "创作精选", count: skills.length }, { id: "favorites", label: "我的收藏", count: favoriteCount }, { id: "installed", label: "已安装", count: installedCount }, { id: "imported", label: "我的导入", count: importedCount }] as const).map((tab) => <button key={tab.id} className={cn(collection === tab.id && "active")} aria-pressed={collection === tab.id} onClick={() => { setCollection(tab.id); setDetailState(null); }}>{tab.id === "favorites" ? <Star size={16}/> : tab.id === "installed" ? <CheckCircle size={16}/> : <Stack size={16}/>}<span>{tab.label}</span><small>{tab.count}</small></button>)}
      </div>
      <div className="market-toolbar">
        <label className="market-query"><MagnifyingGlass size={17}/><input aria-label="搜索技能" placeholder="搜索创作方法、场景或用途" value={search} onChange={(event) => { setSearch(event.target.value); setDetailState(null); }}/>{search && <button type="button" className="market-clear-search" aria-label="清空技能搜索" onClick={() => setSearch("")}><X size={15}/></button>}</label>
        <button className="icon-button market-refresh" aria-label="刷新技能目录" disabled={loading || !!busy} onClick={() => void retry()}><ArrowClockwise size={18}/></button>
        <button className="button secondary" aria-expanded={importOpen} aria-controls="skill-package-import" disabled={!!busy} onClick={() => { setImportOpen((value) => !value); setDetailState(null); }}><UploadSimple size={16}/>导入 Skill</button>
      </div>
    </div>
    {importOpen && <section className="market-import-panel" id="skill-package-import" aria-label="导入个人 Skill">
      <div><h3>把你的创作方法，变成一个 Skill</h3><p>支持 ZIP、JSON 与 SKILL.md。导入后仅你可见，并自动加入技能库；选择后会将配方与你的文字、参考图一起用于生成。</p></div>
      <div className="market-import-fields">
        <label className="market-import-file"><span>选择技能包 · 最多 2 MiB</span><input ref={fileInput} type="file" accept=".zip,.json,.md,application/zip,application/json,text/markdown" disabled={!!busy} onChange={(event) => { setImportFile(event.target.files?.[0] || null); setImportError(""); }}/>{importFile && <small>已选择：{importFile.name}</small>}</label>
        <label><span>Markdown 默认用途</span><select aria-label="导入技能默认用途" disabled={!!busy} value={importCapability} onChange={(event) => setImportCapability(event.target.value as "image" | "video")}><option value="video">视频创作</option><option value="image">图像创作</option></select></label>
        <button className="button primary" disabled={!!busy || !importFile || retrySeconds > 0} onClick={() => void importPackage()}><UploadSimple size={16}/>{retrySeconds > 0 ? `${retrySeconds} 秒后重试` : busy === "skill-import" ? "正在校验…" : signedIn ? "导入并安装" : "登录后导入"}</button>
      </div>
      <input ref={directoryInput} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(event) => void selectDirectory(Array.from(event.target.files || []))}/>
      <button className="button secondary" disabled={!!busy} onClick={() => directoryInput.current?.click()}>{busy === "skill-directory" ? "正在打包…" : "选择技能文件夹"}</button>
      {importError && <div className="market-feedback error" role="alert"><span>{importError}</span></div>}
      <details><summary>格式说明与示例下载</summary><p>ZIP 中放一个 skill.json / manifest.json，或一个 SKILL.md。JSON 填写名称、用途、版本和 promptTemplate；正文中的 {"{{text}}"} 会替换为你的创作文字。SKILL.md 可使用 name、description、version 前置信息，正文填写创作方法。修改同一配方时请提高版本号。</p><p>只导入文字配方与生成参数；附属文件不执行、不安装依赖，也不读取包外文件。</p><div className="market-import-examples"><a href="/skill-examples/orbit-explainer.skill.json" download><DownloadSimple size={15}/>下载 JSON 示例</a><a href="/skill-examples/SKILL.md" download><DownloadSimple size={15}/>下载 SKILL.md 示例</a></div></details>
    </section>}
    <nav className="market-categories" aria-label="创作用途分类">{categories.map(({ id, label }) => <button key={id} className={cn(category === id && "active")} aria-pressed={category === id} onClick={() => { setCategory(id); setDetailState(null); }}>{label}</button>)}</nav>
    {error && <div className="market-feedback error" role="alert"><span>{error}</span><button className="button secondary" disabled={loading || !!busy} onClick={() => void retry()}>重试</button></div>}
    {notice && <div className="market-feedback success" role="status"><CheckCircle size={17}/><span>{notice}</span></div>}
    <section className="market-gallery-body" aria-label="技能目录">
      {loading ? <div className="market-loading" aria-label="正在加载技能" aria-busy="true">{[1, 2, 3, 4, 5, 6].map((item) => <div key={item}><i/><span/><span/></div>)}</div> : detail && presentation ? <article className="market-detail">
        <button className="market-back" onClick={() => setDetailState(null)}><ArrowLeft size={15}/>返回技能库</button>
        <div className="market-detail-layout">
          <div className="market-detail-art"><img src={presentation.cover} alt="" decoding="async"/><span>{presentation.coverLabel}</span></div>
          <div className="market-detail-copy">
            <div className="market-detail-heading"><span className="market-skill-icon">{(() => { const Icon = icons[detail.capability]; return <Icon size={25}/>; })()}</span><div><div className="market-detail-kicker"><span>{presentation.label}</span><span>v{detail.recipeVersion}</span>{detail.installed && <span className="market-installed"><CheckCircle size={13}/>已安装</span>}</div><h2>{detail.name}</h2></div></div>
            <p className="market-detail-description">{detail.description}</p>
            <dl className="market-io-detail"><div><dt>你需要提供</dt><dd>{presentation.input}</dd></div><div><dt>你将获得</dt><dd>{presentation.output}</dd></div></dl>
            <section className="market-detail-section"><h3>适合什么创作</h3><p>{presentation.scope}</p></section>
            <section className="market-detail-section"><h3>如何使用</h3><ol className="market-workflow">{presentation.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol></section>
            <p className="market-execution-note">{presentation.note}</p>
            {detail.source === "imported" && detail.recipe?.referenceDocuments && typeof detail.recipe.referenceDocuments === "object" ? <section className="market-detail-section"><h3>参考文档与模板</h3><p>生成使用核心配方。以下文档完整保留供查阅，不自动执行，也不逐份拼入镜头提示词。</p>{Object.entries(detail.recipe.referenceDocuments).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([name, content]) => <details className="market-import-recipe" key={name}><summary>{name}</summary><pre>{content}</pre></details>)}</section> : null}
            {detail.source === "imported" && typeof detail.recipe?.promptTemplate === "string" && <details className="market-import-recipe"><summary>查看你的创作配方</summary><pre>{detail.recipe.promptTemplate}</pre><p>仅当前账号可见 · {detail.sourceId} · v{detail.recipeVersion}</p></details>}
          </div>
        </div>
        <footer className="market-detail-footer"><div className="market-publisher"><span>{detail.source === "imported" ? "我的导入 · 仅自己可见" : "映序内置"}</span><span>{detail.installedVersion ? "已安装 v" + detail.installedVersion : "版本 v" + detail.recipeVersion}</span></div><div className="market-detail-buttons"><button className="button secondary" aria-pressed={detail.favorite === true} disabled={!!busy} onClick={() => void toggleFavorite(detail)}><Star size={15} weight={detail.favorite ? "fill" : "regular"}/>{detail.favorite ? "已收藏" : "收藏"}</button>{detail.installed && <button className="button secondary" disabled={!!busy} onClick={() => void install(detail, true)} aria-label={"移除 " + detail.name}><Trash size={15}/>移除</button>}{actions(detail)}</div></footer>
      </article> : <>
        <div className="market-directory-heading"><div><h3>{collection === "imported" ? "你的方法，你的技能" : collection === "favorites" ? "留给下一次灵感" : collection === "installed" ? "你的创作工具箱" : "从想法，到画面"}</h3><p>{collection === "imported" ? "私人创作配方，可在画布和视频生成中选择使用。" : collection === "favorites" ? "收藏感兴趣的方法，随时回到这里继续。" : collection === "installed" ? "已添加到当前账号，可应用到正在创作的画布。" : "广告、角色、镜头与科普，让每个创作方向都有方法。"}</p></div><span>{visible.length} 项技能</span></div>
        {visible.length > 0 ? <div className="market-skill-grid">{visible.map((skill) => {
          const summary = skillPresentation(skill);
          return <article className={cn("market-skill-card", skill.status === "planned" && "planned")} key={skill.id}>
            <button className="market-card-cover" onClick={() => void showDetail(skill)} disabled={!!busy} aria-label={"查看 " + skill.name + " 详情"}><img src={summary.cover} alt="" loading="lazy" decoding="async"/><span className="market-cover-kind">{labels[skill.capability]}</span><span className="market-cover-caption">{summary.coverLabel}</span></button>
            <div className="market-card-copy"><div className="market-card-title"><button onClick={() => void showDetail(skill)} disabled={!!busy}><h4>{skill.name}</h4></button><button className={cn("market-favorite", skill.favorite && "active")} aria-label={(skill.favorite ? "取消收藏 " : "收藏 ") + skill.name} aria-pressed={skill.favorite === true} disabled={!!busy || loading} onClick={() => void toggleFavorite(skill)}><Star size={19} weight={skill.favorite ? "fill" : "regular"}/></button></div><p>{skill.description}</p><div className="market-card-footer"><span>{skill.source === "imported" ? "我的导入 · 私有" : summary.label}</span>{actions(skill)}</div>{skill.installed && <span className="market-card-installed"><CheckCircle size={12}/>已安装 v{skill.installedVersion}</span>}</div>
          </article>;
        })}</div> : <div className="market-empty"><Stack size={30}/><h3>{collection !== "all" && !signedIn ? "登录后查看你的技能" : collection === "favorites" && !search ? "还没有收藏技能" : collection === "installed" && !search ? "还没有安装技能" : "没有找到相关技能"}</h3><p>{collection !== "all" && !signedIn ? "收藏与安装记录会保存在你的账号中。" : collection === "favorites" && !search ? "点击卡片上的星标，保存想尝试的创作方法。" : "试试其他创作用途，或清除搜索。"}</p><button className="button secondary" onClick={collection !== "all" && !signedIn ? onLogin : () => { setSearch(""); setCategory("all"); setCollection("all"); }}>{collection !== "all" && !signedIn ? "登录工作空间" : "浏览创作精选"}</button></div>}
        <p className="market-directory-footnote">封面展示创作方向。应用 Skill 后检查提示词和模型，再确认生成；规划中的技能暂不开放。</p>
      </>}
    </section>
  </Modal>;
}

import { ArrowDown, ArrowRight, ArrowUpRight, Atom, ClockCounterClockwise, FilmSlate, MagnifyingGlass, PencilSimple, Plus, SquaresFour, WarningCircle, X } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useId, useRef, useState } from "react";
import { ApiError, message } from "./api";
import { cn } from "./components";
import { draftTitleError, type DraftKind, type DraftSummary } from "./draftLibraryModel";
import { StudioSculpture } from "./StudioSculpture";
import "./home.css";

type HomeProps = {
  drafts: DraftSummary[];
  draftKind: DraftKind;
  draftQuery: string;
  draftLoading: boolean;
  draftError: string;
  draftHasMore: boolean;
  currentProjectId?: string;
  signedIn: boolean;
  onDraftKind: (kind: DraftKind) => void;
  onDraftQuery: (query: string) => void;
  onLoadMore: () => void;
  onNewDraft: (kind: DraftKind) => void;
  onDraft: (draft: DraftSummary) => void;
  onRenameDraft: (draft: DraftSummary, title: string) => Promise<DraftSummary>;
  onStart: (destination: DraftKind) => void;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function updatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "已保存" : dateFormatter.format(date);
}

export function Home(props: HomeProps) {
  const { drafts, draftKind, draftQuery, draftLoading, draftError, draftHasMore, currentProjectId, signedIn, onDraftKind, onDraftQuery, onLoadMore, onNewDraft, onDraft, onRenameDraft, onStart } = props;
  const kindLabel = draftKind === "canvas" ? "画布" : "科普视频";
  return <section className="home-page" aria-label="映序主页">
    <div className="home-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-intro">
          <span className="home-studio-label">映序创作空间</span>
          <h1 id="home-title">让想法成形。<br/><span>让知识入镜。</span></h1>
          <p>在无限画布中探索，在科普视频中讲清。<br className="home-desktop-break"/>从第一份资料，到最后一帧作品。</p>
          <div className="home-hero-actions"><a className="home-primary-action" href="#home-drafts-title">查看我的草稿<ArrowDown size={16}/></a></div>
        </div>
        <StudioSculpture/>
      </section>
      <section className="home-workflows" aria-label="选择创作方式">
        <button className="home-workflow home-workflow-canvas" onClick={() => onStart("canvas")}>
          <span className="home-workflow-symbol"><SquaresFour size={22} weight="duotone"/></span>
          <span className="home-workflow-copy"><strong>创作画布</strong><span>连接文字、图像与视频，自由推演每个创意。</span></span>
          <span className="home-workflow-link">新建画布<ArrowUpRight size={17}/></span>
        </button>
        <button className="home-workflow home-workflow-science" onClick={() => onStart("science")}>
          <span className="home-workflow-symbol"><Atom size={23} weight="duotone"/></span>
          <span className="home-workflow-copy"><strong>科普短视频</strong><span>整理证据和分镜，让 Muse 生成动态视频、原声与成片。</span></span>
          <span className="home-workflow-link">开始制作<ArrowUpRight size={17}/></span>
        </button>
      </section>
      <section className="home-drafts" aria-labelledby="home-drafts-title">
        <div className="home-drafts-heading"><div><h2 id="home-drafts-title">接着，把它完成。</h2><p>画布与科普视频分别保存，继续你的上一次灵感。</p></div><button className="home-new-draft" aria-label={`新建${kindLabel}草稿`} onClick={() => onNewDraft(draftKind)}><Plus size={16}/>新建{kindLabel}草稿</button></div>
        <div className="home-library-toolbar">
          <div className="home-draft-kinds" role="group" aria-label="草稿类型">
            <button aria-pressed={draftKind === "canvas"} className={cn(draftKind === "canvas" && "active")} onClick={() => onDraftKind("canvas")}><SquaresFour size={17}/>画布草稿</button>
            <button aria-pressed={draftKind === "science"} className={cn(draftKind === "science" && "active")} onClick={() => onDraftKind("science")}><FilmSlate size={17}/>科普草稿</button>
          </div>
          <label className="home-draft-search"><MagnifyingGlass size={17}/><span className="home-sr-only">搜索{kindLabel}草稿</span><input type="search" aria-label={`搜索${kindLabel}草稿`} value={draftQuery} onChange={(event) => onDraftQuery(event.target.value)} placeholder="搜索草稿名称" maxLength={120}/>{draftQuery && <button aria-label="清空草稿搜索" onClick={() => onDraftQuery("")}><X size={14}/></button>}</label>
        </div>
        <div className="home-library-body" role="region" aria-busy={draftLoading} aria-label={`${kindLabel}草稿列表`}>
          {draftError && <div className="home-draft-error" role="alert"><WarningCircle size={20}/><div><strong>草稿暂时没有载入</strong><p>{draftError}</p></div><button onClick={onLoadMore}>重新载入</button></div>}
          {draftLoading && !drafts.length ? <div className="home-draft-grid" aria-label="正在载入草稿">{[0, 1, 2, 3].map((index) => <div key={index} className="home-draft-skeleton" aria-hidden="true"><div/><span/><small/></div>)}</div> : drafts.length ? <div className="home-draft-grid">{drafts.map((draft) => <article className="home-draft" key={`${draft.kind}:${draft.projectId}`}><button className="home-draft-entry" type="button" onClick={() => onDraft(draft)} aria-label={`继续${draft.kind === "canvas" ? "画布" : "科普"}草稿：${draft.title}`}>
            <DraftArtwork kind={draft.kind}/>
            <span className="home-draft-content"><strong title={draft.title}>{draft.title}</strong><span className="home-draft-meta"><span><ClockCounterClockwise size={13}/><time dateTime={draft.updatedAt}>{updatedAt(draft.updatedAt)}</time></span><span>{draft.itemCount} {draft.kind === "canvas" ? "个节点" : "幕分镜"}</span></span></span>
            {draft.projectId === currentProjectId && <span className="home-draft-current">当前项目</span>}
            <span className="home-draft-open" aria-hidden="true"><ArrowUpRight size={19}/></span>
          </button><div className="home-draft-actions"><span>{draft.kind === "canvas" ? "画布草稿" : "科普草稿"}</span><DraftRenameControl draft={draft} onRename={onRenameDraft}/></div></article>)}</div> : !draftError && <div className="home-draft-empty"><span>{draftKind === "canvas" ? <SquaresFour size={28} weight="thin"/> : <FilmSlate size={28} weight="thin"/>}</span><h3>{!signedIn ? "留住每次创作" : draftQuery ? "没有找到这份草稿" : `第一份${kindLabel}，从这里开始`}</h3><p>{!signedIn ? "登录后，你的画布和科普视频会分别保存在这里。" : draftQuery ? "试试更短的名称，或清空搜索查看全部草稿。" : draftKind === "canvas" ? "把散落的想法放到一起，连接下一幅画面。" : "给一段知识安排画面、声音和讲解节奏。"}</p><button className="home-secondary-action" onClick={() => draftQuery && signedIn ? onDraftQuery("") : onNewDraft(draftKind)}>{draftQuery && signedIn ? "清空搜索" : !signedIn ? "登录并开始" : `新建${kindLabel}草稿`}<ArrowRight size={16}/></button></div>}
        </div>
        {drafts.length > 0 && (draftHasMore || draftLoading) && <div className="home-load-more"><button className="home-secondary-action" disabled={draftLoading} onClick={onLoadMore}>{draftLoading ? "正在载入…" : "载入更多草稿"}{!draftLoading && <ArrowRight size={16}/>}</button></div>}
      </section>
    </div>
  </section>;
}

function DraftRenameControl({ draft, onRename }: { draft: DraftSummary; onRename: HomeProps["onRenameDraft"] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(draft);
  const [title, setTitle] = useState(draft.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const changeOpen = (next: boolean) => {
    if (busy) return;
    if (next) { setSelected(draft); setTitle(draft.title); setError(""); setConflict(false); }
    setOpen(next);
  };
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button className="home-draft-rename" type="button" aria-label={`重命名草稿：${draft.title}`}><PencilSimple size={14}/>重命名</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content home-rename-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
      <div className="dialog-header"><Dialog.Title>重命名{draft.kind === "canvas" ? "画布" : "科普"}草稿</Dialog.Title><Dialog.Close className="icon-button" aria-label="关闭重命名对话框" disabled={busy}><X size={20}/></Dialog.Close></div>
      <Dialog.Description className="dialog-description">取一个便于查找的名称，随时继续这份创作。</Dialog.Description>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (busy || conflict) return;
        const invalid = draftTitleError(title);
        if (invalid) { setError(invalid); return; }
        if (title.trim() === selected.title) { setOpen(false); return; }
        setBusy(true); setError("");
        void onRename(selected, title.trim()).then(() => setOpen(false)).catch((reason: unknown) => {
          const stale = reason instanceof ApiError && reason.status === 409;
          setConflict(stale);
          setError(stale ? "草稿已在其他位置更新。请关闭此窗口，从最新卡片重新打开重命名。" : message(reason));
        }).finally(() => setBusy(false));
      }}>
        <label htmlFor={fieldId}>草稿名称</label>
        <input ref={input} id={fieldId} name="draftTitle" value={title} onChange={(event) => { setTitle(event.target.value); if (!conflict) setError(""); }} maxLength={200} required disabled={busy || conflict} aria-invalid={Boolean(error)} aria-describedby={`${fieldId}-help${error ? ` ${fieldId}-error` : ""}`} onFocus={(event) => event.currentTarget.select()}/>
        <div className="home-rename-help" id={`${fieldId}-help`}><span>最多200字符</span><span>{title.trim().length}/200</span></div>
        {error && <p className="home-rename-error" role="alert" id={`${fieldId}-error`}>{error}</p>}
        <div className="home-rename-actions"><Dialog.Close asChild><button className="home-secondary-action" type="button" disabled={busy}>取消</button></Dialog.Close><button className="home-primary-action" type="submit" disabled={busy || conflict || !title.trim()}>{busy ? "正在保存…" : "保存名称"}</button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}

function DraftArtwork({ kind }: { kind: DraftKind }) {
  return <span className={cn("home-draft-art", `home-draft-art-${kind}`)} aria-hidden="true">{kind === "canvas" ? <><span className="draft-art-node draft-art-node-text"><span/><span/><span/></span><span className="draft-art-connector"/><span className="draft-art-node draft-art-node-media"><SquaresFour size={28} weight="thin"/></span><span className="draft-art-node draft-art-node-note"/></> : <><span className="draft-art-frame"><FilmSlate size={28} weight="thin"/><span/></span><span className="draft-art-timeline"><i/><i/><i/></span><span className="draft-art-captions"><i/><i/></span></>}</span>;
}

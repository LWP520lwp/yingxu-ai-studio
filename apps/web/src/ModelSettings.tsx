import { useEffect, useRef, useState, type FormEvent } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Check, CheckCircle, CloudArrowDown, Eye, ImageSquare, Key, Plus, Power, ShieldCheck, SlidersHorizontal, TextT, Trash, VideoCamera, WarningCircle, X } from "@phosphor-icons/react";
import { api, json, message } from "./api";
import { cn, Modal } from "./components";
import { capabilityNames, configuredCandidates, isCapability, mergeDiscoveredModels, modelNamePattern, selectedChannelModels, type DiscoveredModel, type GenerationChannel, type ModelCandidate, type ModelCapability } from "./modelSettingsModel";
import "./model-settings.css";

export type ModelSettingsProps = {
  open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void | Promise<void>;
  initialCapability?: ModelCapability;
};
type Draft = { id?: string; name: string; baseUrl: string; apiKey: string; enabled: boolean; models: ModelCandidate[] };
type Confirmation = { kind: "close" | "delete" } | { kind: "switch"; selection: GenerationChannel | "new" };
const blank = (): Draft => ({ name: "", baseUrl: "", apiKey: "", enabled: true, models: [] });
const fromChannel = (channel: GenerationChannel): Draft => ({ id: channel.id, name: channel.name, baseUrl: channel.baseUrl, apiKey: "", enabled: channel.enabled, models: configuredCandidates(channel.models) });
const icons = { text: TextT, vision: Eye, image: ImageSquare, video: VideoCamera };

/** The settings lifetime is independent from any project, canvas iframe or editor. */
export function ModelSettings({ open, onOpenChange, onChanged, initialCapability = "text" }: ModelSettingsProps) {
  const [channels, setChannels] = useState<GenerationChannel[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const draftRef = useRef(draft); draftRef.current = draft;
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState("");
  const workLock = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCapability, setManualCapability] = useState<ModelCapability>(initialCapability);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationFocus = useRef<HTMLElement | null>(null);
  const changed = useRef(onChanged); changed.current = onChanged;
  const prior = channels.find((channel) => channel.id === draft.id);
  const selectedCount = draft.models.filter((model) => model.selected).length;
  const serialized = (value: Draft) => json({ name: value.name, baseUrl: value.baseUrl, enabled: value.enabled, models: value.models.filter((model) => model.selected).map(({ name, capability }) => ({ name, capability })) });
  const dirty = Boolean(draft.apiKey || serialized(draft) !== serialized(prior ? fromChannel(prior) : blank()));

  const load = async (scope: AbortController) => {
    setLoading(true); setError("");
    try {
      const result = await api<{ channels: GenerationChannel[] }>("/channels", { signal: AbortSignal.any([scope.signal, AbortSignal.timeout(20_000)]) });
      if (scope.signal.aborted) return;
      setChannels(result.channels);
      setDraft(result.channels[0] ? fromChannel(result.channels[0]) : blank());
    } catch (cause) { if (!scope.signal.aborted) setError(message(cause)); }
    finally { if (!scope.signal.aborted) setLoading(false); }
  };
  useEffect(() => {
    if (!open) { setDraft(blank()); setWorking(""); setConfirmation(null); return; }
    const scope = new AbortController(); lifetime.current = scope;
    setChannels([]); setDraft(blank()); setWorking(""); setQuery(""); setManualName("");
    setManualCapability(initialCapability); setNotice(""); setConfirmation(null);
    void load(scope);
    return () => { scope.abort(); lifetime.current = null; workLock.current = false; };
  }, [open]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value })); setError(""); setNotice("");
  };
  const confirm = (value: Confirmation) => {
    confirmationFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(value);
  };
  const choose = (selection: GenerationChannel | "new", discard = false) => {
    if (workLock.current) return;
    if (dirty && !discard) { confirm({ kind: "switch", selection }); return; }
    setDraft(selection === "new" ? blank() : fromChannel(selection));
    setQuery(""); setError(""); setNotice(""); setManualName(""); setConfirmation(null);
  };
  const announceChange = async (scope: AbortController) => {
    try { await changed.current(); }
    catch { if (!scope.signal.aborted) setNotice("渠道已保存，页面模型目录暂未刷新；关闭配置后可重新进入创作模块。"); }
  };
  const persist = async (scope: AbortController): Promise<GenerationChannel> => {
    const value = draftRef.current;
    const name = value.name.trim();
    if (!name || name.length > 80) throw new Error("填写 1–80 字的渠道名称。");
    let target: URL;
    try { target = new URL(value.baseUrl.trim()); } catch { throw new Error("填写完整的 HTTPS API 基础地址。"); }
    if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.port && target.port !== "443") throw new Error("使用不含账号、查询参数和片段的 HTTPS 443 公网基础地址。");
    const old = channels.find((channel) => channel.id === value.id);
    if (!value.apiKey.trim() && (!old?.hasKey || new URL(old.baseUrl).origin !== target.origin)) throw new Error("新增渠道或切换服务域名时，请填写 API Key。");
    const models = selectedChannelModels(value.models);
    const result = await api<GenerationChannel>("/channels", { method: "PUT", body: json({ id: value.id, name, baseUrl: value.baseUrl.trim(), apiFormat: "openai", enabled: value.enabled, apiKey: value.apiKey.trim() || undefined, models }), signal: AbortSignal.any([scope.signal, AbortSignal.timeout(20_000)]) });
    if (scope.signal.aborted) return result;
    setChannels((current) => current.some((channel) => channel.id === result.id) ? current.map((channel) => channel.id === result.id ? result : channel) : [...current, result]);
    const next = { ...fromChannel(result), models: [...configuredCandidates(result.models), ...value.models.filter((model) => !model.selected)] };
    draftRef.current = next; setDraft(next);
    setNotice(`渠道已保存，${result.models.length} 个模型已配置。`);
    await announceChange(scope);
    return result;
  };
  const run = async (name: string, operation: (scope: AbortController) => Promise<void>) => {
    const scope = lifetime.current;
    if (!scope || scope.signal.aborted || workLock.current) return;
    workLock.current = true; setWorking(name); setError(""); setNotice("");
    try { await operation(scope); }
    catch (cause) { if (!scope.signal.aborted) setError(message(cause)); }
    finally { if (!scope.signal.aborted) { workLock.current = false; setWorking(""); } }
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    void run("save", async (scope) => { await persist(scope); });
  };
  const probe = () => void run("probe", async (scope) => {
    // The discovery endpoint only accepts a saved channel ID. Keys stay server-side after this step.
    const saved = await persist(scope);
    if (scope.signal.aborted) return;
    const result = await api<{ models: DiscoveredModel[] }>(`/channels/${encodeURIComponent(saved.id)}/models`, { method: "POST", signal: AbortSignal.any([scope.signal, AbortSignal.timeout(45_000)]) });
    if (scope.signal.aborted) return;
    setDraft((current) => ({ ...current, models: mergeDiscoveredModels(current.models, result.models) }));
    setNotice(result.models.length ? `读取到 ${result.models.length} 个模型。勾选需要的模型并确认能力，再保存。名称建议不代表能力验证。` : "渠道没有返回模型，可按供应商文档手动添加模型 ID。");
  });
  const remove = () => void run("delete", async (scope) => {
    if (!draftRef.current.id) return;
    const id = draftRef.current.id;
    await api(`/channels/${encodeURIComponent(id)}`, { method: "DELETE", signal: scope.signal });
    if (scope.signal.aborted) return;
    const remaining = channels.filter((channel) => channel.id !== id);
    setChannels(remaining); setDraft(remaining[0] ? fromChannel(remaining[0]) : blank());
    setNotice("渠道已移除，已生成素材保留。"); await announceChange(scope);
  });
  const addManual = () => {
    const name = manualName.trim();
    if (!modelNamePattern.test(name)) { setError("填写有效的模型 ID（1–64 字符，允许字母、数字和 . _ / -）。"); return; }
    if (draft.models.some((model) => model.name === name)) { setError("此模型已在列表中，可直接调整能力和勾选状态。"); return; }
    if (draft.models.length >= 100) { setError("每个渠道最多保留 100 个模型，请先移除不需要的项目。"); return; }
    update("models", [...draft.models, { name, capability: manualCapability, selected: true, source: "manual" }]); setManualName("");
  };
  const changeModel = (name: string, patch: Partial<ModelCandidate>) => update("models", draft.models.map((model) => model.name === name ? { ...model, ...patch } : model));
  const close = (next: boolean) => {
    if (workLock.current) return;
    if (!next && dirty) { confirm({ kind: "close" }); return; }
    onOpenChange(next);
  };
  const confirmAction = () => {
    if (!confirmation) return;
    if (confirmation.kind === "delete") remove();
    else if (confirmation.kind === "switch") choose(confirmation.selection, true);
    else onOpenChange(false);
    setConfirmation(null);
  };
  const visibleModels = draft.models.filter((model) => model.name.toLowerCase().includes(query.trim().toLowerCase()));

  return <><Modal open={open} onOpenChange={close} title="模型与渠道" description="为文本规划、图像生成与视频生成连接自己的模型服务。" className="model-settings">
    <div className="ms-layout" aria-busy={Boolean(working)}>
      <aside className="ms-sidebar" aria-label="API 渠道">
        <div className="ms-sidebar-heading"><span>我的 API 渠道</span><span>{channels.length} / 20</span></div>
        <button className={cn("ms-channel-new", !draft.id && "active")} onClick={() => choose("new")} disabled={Boolean(working) || loading || channels.length >= 20}><Plus size={17}/>添加渠道</button>
        <div className="ms-channel-list">{channels.map((channel) => <button key={channel.id} className={cn("ms-channel", channel.id === draft.id && "active")} disabled={Boolean(working)} onClick={() => choose(channel)}><span className={cn("ms-channel-dot", channel.enabled && "enabled")}/><span><strong>{channel.name}</strong><small>{channel.models.length} 个模型 · {channel.enabled ? "启用" : "停用"}</small></span></button>)}</div>
        {loading && <p className="ms-sidebar-status" role="status">正在读取渠道…</p>}
        <p className="ms-private-note"><ShieldCheck size={16}/>仅当前登录账号可见，独立于画布与科普草稿。</p>
      </aside>
      <form className="ms-editor" onSubmit={submit}>
        {error && <div className="ms-feedback error" role="alert"><WarningCircle size={17}/><span>{error}</span>{!channels.length && loading === false && <button type="button" className="text-button" onClick={() => lifetime.current && void load(lifetime.current)}>重新读取</button>}</div>}
        {notice && <div className="ms-feedback success" role="status"><CheckCircle size={17}/><span>{notice}</span></div>}
        <div className="ms-editor-heading"><div><span className="ms-eyebrow">OPENAI COMPATIBLE</span><h3>{draft.id ? draft.name || "编辑渠道" : "连接一个模型渠道"}</h3><p>使用供应商提供的基础地址与 API Key。</p></div><label className="ms-enabled"><input type="checkbox" checked={draft.enabled} disabled={Boolean(working) || loading} onChange={(event) => update("enabled", event.target.checked)}/><Power size={14}/>启用渠道</label></div>
        <fieldset className="ms-connection" disabled={Boolean(working) || loading}>
          <label className="ms-field"><span>渠道名称</span><input value={draft.name} maxLength={80} autoComplete="off" placeholder="例如：我的模型服务" onChange={(event) => update("name", event.target.value)}/></label>
          <label className="ms-field"><span>API 基础地址</span><input type="url" value={draft.baseUrl} maxLength={512} autoComplete="off" placeholder="https://api.example.com/v1" onChange={(event) => update("baseUrl", event.target.value)}/><small>HTTPS 443 公网地址，可包含 /v1；本机 Muse 从账号池接入。</small></label>
          <label className="ms-field ms-key"><span><Key size={14}/>API Key{prior?.hasKey && <em>已加密保存</em>}</span><input type="password" value={draft.apiKey} maxLength={8192} autoComplete="new-password" placeholder={prior?.hasKey ? "留空保留已保存的 Key" : "填写供应商 API Key"} onChange={(event) => update("apiKey", event.target.value)}/><small>{prior?.hasKey ? "留空沿用当前凭证；更换服务域名时需重新填写。" : "仅保存在服务端，保存后不会回传，也不写入浏览器存储。"}</small></label>
        </fieldset>
        <section className="ms-models" aria-labelledby="ms-model-heading">
          <div className="ms-models-heading"><div><h4 id="ms-model-heading">模型与能力</h4><span>已选择 {selectedCount} 个 · 共 {draft.models.length} 个</span></div><button type="button" className="button secondary" disabled={Boolean(working) || loading} onClick={probe}><CloudArrowDown size={16}/>{working === "probe" ? "正在获取…" : "保存并获取模型"}</button></div>
          <p className="ms-model-guidance">获取模型后，勾选需要使用的项目。未知模型必须先选择能力；列表建议仍需你按供应商文档确认。</p>
          {draft.models.length > 5 && <input className="ms-model-search" aria-label="搜索模型 ID" placeholder="筛选模型 ID…" value={query} onChange={(event) => setQuery(event.target.value)}/>}
          <div className="ms-model-list">{visibleModels.map((model) => {
            const Icon = isCapability(model.capability) ? icons[model.capability] : SlidersHorizontal;
            return <div className={cn("ms-model-row", model.selected && "selected")} key={model.name}>
              <label className="ms-model-check"><input type="checkbox" checked={model.selected} aria-label={`启用模型 ${model.name}`} disabled={Boolean(working) || model.capability === "unknown"} onChange={(event) => changeModel(model.name, { selected: event.target.checked })}/><Icon size={17}/><span><strong>{model.name}</strong><small>{model.capability === "unknown" ? "能力未知，先选择类型" : model.source === "configured" ? "已保存" : model.selected ? "已选择，保存后生效" : model.source === "name-hint" ? "按名称建议 · 请确认" : "尚未选择"}</small></span></label>
              <select aria-label={`${model.name} 模型能力`} value={model.capability} disabled={Boolean(working)} onChange={(event) => { if (isCapability(event.target.value)) changeModel(model.name, { capability: event.target.value, selected: true, source: "manual" }); }}><option value="unknown" disabled>选择模型能力</option>{Object.entries(capabilityNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <button type="button" className="icon-button" disabled={Boolean(working)} aria-label={`移除模型 ${model.name}`} onClick={() => update("models", draft.models.filter((item) => item.name !== model.name))}><X size={16}/></button>
            </div>;
          })}</div>
          {!draft.models.length && <div className="ms-model-empty"><SlidersHorizontal size={25}/><strong>让渠道提供你的模型列表</strong><p>点击“保存并获取模型”，也可以在下方手动填写。</p></div>}
          {draft.models.length > 0 && !visibleModels.length && <p className="ms-model-no-match">没有匹配的模型。</p>}
          <div className="ms-manual"><label><span>手动添加模型</span><input aria-label="手动模型 ID" maxLength={64} value={manualName} placeholder="供应商文档中的模型 ID" disabled={Boolean(working) || loading} onChange={(event) => setManualName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManual(); } }}/></label><select aria-label="手动模型能力" value={manualCapability} disabled={Boolean(working) || loading} onChange={(event) => setManualCapability(event.target.value as ModelCapability)}>{Object.entries(capabilityNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="button secondary" disabled={Boolean(working) || loading || !manualName.trim()} onClick={addManual}><Plus size={16}/>添加</button></div>
          {draft.models.some((model) => model.capability === "vision") || initialCapability === "vision" ? <p className="ms-scope-note"><Eye size={15}/>图像理解模型可保存配置；画布的图像理解调用通路尚未接入。文本规划请配置“文本理解”模型。</p> : <p className="ms-scope-note"><Check size={15}/>文本用于脚本与剪辑规划；图像／视频用于现有生成接口。能力配置不等同于服务可用性验证。</p>}
        </section>
        <div className="ms-footer"><div>{draft.id && <button type="button" className="ms-delete" disabled={Boolean(working)} onClick={() => confirm({ kind: "delete" })}><Trash size={15}/>移除渠道</button>}{!draft.id && <span className="ms-footer-note">保存后可继续添加与调整模型</span>}</div><div><span className="ms-dirty">{dirty ? "有未保存的修改" : draft.id ? "修改已保存" : ""}</span><button type="button" className="button secondary" disabled={Boolean(working)} onClick={() => close(false)}>完成</button><button type="submit" className="button primary" disabled={Boolean(working) || loading}><Check size={16}/>{working === "save" ? "保存中…" : "保存渠道"}</button></div></div>
      </form>
    </div>
  </Modal><AlertDialog.Root open={Boolean(confirmation)} onOpenChange={(next) => { if (!next) setConfirmation(null); }}>
    <AlertDialog.Portal><AlertDialog.Overlay className="ms-confirm-overlay"/><AlertDialog.Content className="dialog-content ms-confirm-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); if (confirmationFocus.current?.isConnected) confirmationFocus.current.focus(); }}>
      <AlertDialog.Title>{confirmation?.kind === "delete" ? "移除此渠道？" : "放弃未保存的修改？"}</AlertDialog.Title>
      <AlertDialog.Description>{confirmation?.kind === "delete" ? "将删除此渠道的服务端凭证和模型配置，已经生成的素材会保留。" : "当前填写的 API Key、渠道信息或模型选择尚未保存。继续操作会放弃这些修改。"}</AlertDialog.Description>
      <div className="ms-confirm-actions"><AlertDialog.Cancel asChild><button className="button secondary">{confirmation?.kind === "delete" ? "保留渠道" : "继续编辑"}</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="button primary ms-confirm-danger" onClick={confirmAction}>{confirmation?.kind === "delete" ? "确认移除" : confirmation?.kind === "switch" ? "放弃并切换" : "放弃并关闭"}</button></AlertDialog.Action></div>
    </AlertDialog.Content></AlertDialog.Portal>
  </AlertDialog.Root></>;
}

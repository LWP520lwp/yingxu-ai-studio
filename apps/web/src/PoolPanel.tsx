import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowRight, Browser, CheckCircle, CloudArrowDown, EyeSlash, MagnifyingGlass, Plus, Power, ShieldCheck, Stack, UsersThree, WarningCircle, X } from "@phosphor-icons/react";
import { ApiError, api, json, message } from "./api";
import { cn, Modal } from "./components";
import { RequestScope, type ScopedRequest } from "./requestScope";
import { filterPoolAccounts, poolAccountStatus, poolCounts, poolFailureMessage, poolQuotaPercent, poolQuotaStatus, poolRecordTime, poolTypeNames, type PoolAccount, type PoolFilter, type PoolQuota, type PoolSource } from "./poolPanelModel";
import "./pool-panel.css";

type PoolSnapshot = {
  accounts: PoolAccount[];
  workerAvailable: boolean;
  interactiveLoginEnabled?: boolean;
  encryptionReady: boolean;
  localManagement: boolean;
  scope: "personal";
  canImportLocal: boolean;
  sharedChannels?: {
    muse: { available: number; busy: number; quota?: PoolQuota };
    message: string;
  };
};
const sources: { id: PoolSource; label: string }[] = [
  { id: "all", label: "全部来源" }, { id: "native_muse", label: "Muse 账号" },
  { id: "native_doubao", label: "豆包账号" }, { id: "muse_service", label: "服务凭据" },
];
const permissionError = (cause: unknown) => poolFailureMessage(
  cause instanceof ApiError ? cause.status : undefined,
  cause instanceof ApiError ? cause.details?.code : undefined,
  message(cause),
);
const requestSignal = (request: ScopedRequest, timeout = 20_000) => AbortSignal.any([request.controller.signal, AbortSignal.timeout(timeout)]);

function PoolQuotaDetails({ quota, title = "账号额度" }: { quota?: PoolQuota; title?: string }) {
  return <div className="pool-quota" aria-label={title}>
    <div className="pool-quota-heading"><strong>{title}</strong><span className={cn("pool-quota-status", quota?.status === "available" && "current")}>{poolQuotaStatus(quota)}</span></div>
    {quota?.accounts?.length ? <div className="pool-quota-accounts">{quota.accounts.map((entry, index) => <div className="pool-quota-account" key={`${entry.label}:${index}`}>
      <div className="pool-quota-account-heading"><span>{entry.label}</span>{entry.plan && <span>{entry.plan}</span>}{entry.stale && <span className="pool-quota-stale">上次记录</span>}</div>
      <dl className="pool-quota-values">
        <div className="pool-quota-weekly"><dt>本周剩余</dt><dd>{poolQuotaPercent(entry.weeklyRemainingPercent)}</dd></div>
        <div><dt>本周已用</dt><dd>{poolQuotaPercent(entry.weeklyUsedPercent)}</dd></div>
        <div className="pool-quota-extra"><dt>额外剩余额度</dt><dd>{entry.extraRemaining || "未提供"}</dd></div>
      </dl>
      {typeof entry.weeklyRemainingPercent === "number" && Number.isFinite(entry.weeklyRemainingPercent) && entry.weeklyRemainingPercent >= 0 && entry.weeklyRemainingPercent <= 100 && <progress max={100} value={entry.weeklyRemainingPercent} aria-label={`${entry.label}本周剩余额度`}/>}
      <div className="pool-quota-times"><span>重置时间：{entry.weeklyReset || "未提供"}</span>{entry.extraUsedPercent !== null && entry.extraUsedPercent !== undefined && <span>额外额度已用：{poolQuotaPercent(entry.extraUsedPercent)}</span>}<span title={entry.checkedAt || undefined}>更新于 {poolRecordTime(entry.checkedAt)}</span></div>
    </div>)}</div> : <p className="pool-quota-message">{quota?.message || "尚未读取到额度，可点击刷新额度查询。"}</p>}
    {Boolean(quota?.accounts?.length) && quota?.message && <p className="pool-quota-message">{quota.message}</p>}
  </div>;
}

export function PoolPanel({ open, onOpenChange, signedIn, sessionKey, onLogin }: {
  open: boolean; onOpenChange: (open: boolean) => void; signedIn: boolean;
  sessionKey?: string | null; onLogin: () => void;
}) {
  const scopeKey = JSON.stringify([open, signedIn, sessionKey ?? null]);
  const currentKey = useRef(scopeKey);
  currentKey.current = scopeKey;
  const scope = useRef(new RequestScope());
  const busyRequest = useRef<ScopedRequest | null>(null);
  const readSequence = useRef(0);
  const [data, setData] = useState<{ key: string; value: PoolSnapshot } | null>(null);
  const snapshot = data?.key === scopeKey ? data.value : null;
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<{ key: string; id: string } | null>(null);
  const working = operation?.key === scopeKey ? operation.id : "";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [newType, setNewType] = useState<"native_muse" | "native_doubao">("native_muse");
  const [source, setSource] = useState<PoolSource>("all");
  const [filter, setFilter] = useState<PoolFilter>("all");
  const [search, setSearch] = useState("");
  const filterSession = useRef(sessionKey ?? null);
  const nameInput = useRef<HTMLInputElement>(null);
  const active = useCallback((request: ScopedRequest) => scope.current.current(request, currentKey.current), []);
  const load = useCallback(async (request: ScopedRequest) => {
    const sequence = ++readSequence.current;
    const next = await api<PoolSnapshot>("/pool/accounts", { signal: requestSignal(request) });
    if (active(request) && sequence === readSequence.current) setData({ key: request.key, value: next });
  }, [active]);

  useEffect(() => {
    scope.current.invalidate();
    busyRequest.current = null;
    setData(null); setOperation(null); setError(""); setNotice(""); setName(""); setAdding(false);
    if (filterSession.current !== (sessionKey ?? null)) {
      filterSession.current = sessionKey ?? null;
      setSource("all"); setFilter("all"); setSearch("");
    }
    if (!open || !signedIn) {
      setLoading(false);
      return () => scope.current.invalidate();
    }
    const request = scope.current.begin(scopeKey);
    setLoading(true);
    void load(request).catch((cause) => {
      if (active(request)) setError(permissionError(cause));
    }).finally(() => {
      if (active(request)) setLoading(false);
      scope.current.release(request);
    });
    return () => scope.current.invalidate();
  }, [open, signedIn, scopeKey, active, load]);

  async function refresh() {
    if (working || loading) return;
    const request = scope.current.begin(currentKey.current);
    setLoading(true); setError("");
    try { await load(request); }
    catch (cause) {
      if (active(request)) { setData(null); setAdding(false); setError(permissionError(cause)); }
    }
    finally {
      if (active(request)) setLoading(false);
      scope.current.release(request);
    }
  }

  async function perform(key: string, action: (signal: AbortSignal) => Promise<unknown>, success: string, timeout = 20_000, returnsSnapshot = false) {
    if (!open || !signedIn || !snapshot || loading || (busyRequest.current && active(busyRequest.current))) return;
    const request = scope.current.begin(currentKey.current);
    busyRequest.current = request;
    setOperation({ key: request.key, id: key }); setError(""); setNotice("");
    try {
      const result = await action(requestSignal(request, timeout));
      if (!active(request)) return;
      if (key === "add") { setName(""); setAdding(false); setSource(newType); setFilter("all"); setSearch(""); }
      setNotice(success);
      if (returnsSnapshot) {
        ++readSequence.current;
        setData({ key: request.key, value: result as PoolSnapshot });
      } else await load(request);
    } catch (cause) {
      if (active(request)) {
        if (cause instanceof ApiError && (cause.status === 401 || cause.details?.code === "POOL_MANAGEMENT_DISABLED")) { setData(null); setAdding(false); }
        setError(permissionError(cause));
      }
    } finally {
      if (busyRequest.current === request) {
        busyRequest.current = null;
        if (active(request)) setOperation(null);
      }
      scope.current.release(request);
    }
  }

  function addAccount() {
    if (!name.trim()) { setError("请先填写账号名称。"); nameInput.current?.focus(); return; }
    void perform("add", (signal) => api("/pool/accounts", {
      method: "POST", body: json({ name: name.trim(), type: newType }), signal,
    }), "账号已添加到你的账号池。点击“登录”，在独立窗口完成本人登录后再检查状态。");
  }

  function connectDoubao() {
    if (locked) return;
    setNewType("native_doubao"); setAdding(true); setError(""); setNotice("");
  }

  const accounts = snapshot?.accounts || [];
  const counts = poolCounts(accounts);
  const showServices = snapshot?.canImportLocal === true || accounts.some((account) => account.type === "muse_service");
  const activeSource = source === "muse_service" && !showServices ? "all" : source;
  const visible = filterPoolAccounts(accounts, activeSource, filter, search);
  const workerAvailable = snapshot?.workerAvailable === true;
  const loginEnabled = snapshot?.interactiveLoginEnabled === true;
  const locked = Boolean(working) || loading || !snapshot;
  const clearFilters = () => { setSource("all"); setFilter("all"); setSearch(""); };

  return <Modal open={open} onOpenChange={onOpenChange} title="我的账号池" description="添加自己的生成账号，管理独立会话与创作通道。" className="pool-dialog pool-workspace">
    {!signedIn ? <div className="pool-signin-empty">
      <Stack size={32}/><h3>登录后连接你的生成账号</h3><p>每个登录用户都可以添加 Muse、豆包账号，账号与会话各自独立。</p>
      <button className="button primary" onClick={onLogin}>登录工作空间</button>
    </div> : <div className="pool-workspace-body">
      <div className="pool-runtime-row">
        <div className="pool-runtime-status"><span className={cn("pool-runtime-dot", workerAvailable && "online")}/><span>{!snapshot && !error ? "正在读取你的账号池" : snapshot ? workerAvailable ? "浏览器执行器在线" : "浏览器执行器离线" : "暂时无法读取账号池"}</span><span className="pool-runtime-local">个人独立会话</span></div>
        <div className="pool-header-actions"><button className="button secondary" onClick={() => void refresh()} disabled={Boolean(working) || loading} aria-label="刷新账号池"><ArrowClockwise size={15}/>{loading ? "读取中…" : "刷新"}</button>{snapshot && <button className="button primary" onClick={() => setAdding(!adding)} disabled={locked} aria-expanded={adding}><Plus size={15}/>添加账号</button>}</div>
      </div>

      {snapshot && <section className="pool-doubao-connect" aria-label="豆包国内账号接入">
        <span className="pool-connect-mark"><Browser size={23}/></span>
        <div><strong>豆包国内账号</strong><p>在独立窗口完成本人登录，再检测登录状态。当前支持会话管理，生成适配待验证。</p></div>
        <button className="button secondary" disabled={locked} onClick={connectDoubao}><Plus size={15}/>接入豆包国内账号</button>
      </section>}

      {error && snapshot && <div className="pool-feedback error" role="alert"><WarningCircle size={17}/><span>{error}</span></div>}
      {notice && <div className="pool-feedback success" role="status"><CheckCircle size={17}/><span>{notice}</span></div>}

      {!snapshot ? loading || !error ? <div className="pool-initial-loading" aria-label="正在读取个人账号池" aria-busy="true"><div className="pool-skeleton-metrics">{[1, 2, 3, 4].map((item) => <span key={item}/>)}</div><div className="pool-skeleton-list">{[1, 2].map((item) => <div key={item}><i/><span/><span/></div>)}</div></div> : <div className="pool-connection-empty" role="alert"><WarningCircle size={30}/><h3>暂时无法打开你的账号池</h3><p>{error}</p><button className="button primary" onClick={() => void refresh()} disabled={loading}><ArrowClockwise size={15}/>重新连接</button></div> : <>
      <div className="pool-metrics" aria-label="账号池统计">
        <div><span>我的账号</span><strong>{counts.total}</strong></div>
        <div className="available"><span>可调度</span><strong>{counts.schedulable}</strong></div>
        <div><span>正在使用</span><strong>{counts.busy}</strong></div>
        <div title="已启用但需要登录、检查状态或验证生成适配的账号"><span>待处理</span><strong>{counts.attention}</strong></div>
      </div>

      {snapshot.sharedChannels && <section className="pool-shared-block" aria-label="内置 Muse 通道与额度"><div className="pool-shared-channels">
        <span className="pool-connect-mark"><UsersThree size={22}/></span>
        <div className="pool-shared-description"><strong>内置 Muse · 共享通道</strong><p>{snapshot.sharedChannels.message || "由当前部署内的用户自愿共享，使用时仍按服务实际额度执行。"}</p></div>
        <dl><div><dt>可调度</dt><dd>{snapshot.sharedChannels.muse.available}</dd></div><div><dt>正在使用</dt><dd>{snapshot.sharedChannels.muse.busy}</dd></div></dl>
      </div><div className="pool-shared-quota-heading"><span>额度由生成服务返回，按账号分别展示</span><button className="button secondary" disabled={locked} aria-label="刷新内置账号额度" onClick={() => void perform("quota", (signal) => api("/pool/quota/refresh", { method: "POST", body: json({}), signal }), "额度查询已完成，结果与更新时间见下方。", 100_000, true)}><ArrowClockwise size={14}/>{working === "quota" ? "查询额度中…" : "刷新额度"}</button></div>
      <PoolQuotaDetails quota={snapshot.sharedChannels.muse.quota} title="共享账号额度"/>
      </section>}

      <ol className="pool-login-guide" aria-label="网站账号接入步骤">
        <li><span>1</span>添加账号</li><ArrowRight size={13} aria-hidden="true"/><li><span>2</span>本人完成网页登录</li><ArrowRight size={13} aria-hidden="true"/><li><span>3</span>检查状态后参与调度</li>
      </ol>

      {adding && <form className="pool-create-form" aria-label="添加网站账号" onSubmit={(event) => { event.preventDefault(); addAccount(); }}>
        <label>账号来源<select aria-label="账号类型" value={newType} onChange={(event) => setNewType(event.target.value as typeof newType)} disabled={locked}><option value="native_muse">Muse 网站账号</option><option value="native_doubao">豆包国内账号</option></select></label>
        <label className="pool-create-name">账号名称<input ref={nameInput} value={name} maxLength={80} placeholder={newType === "native_doubao" ? "例如：我的豆包账号" : "例如：Muse 主账号"} onChange={(event) => setName(event.target.value)} disabled={locked}/></label>
        <button className="button primary" type="submit" disabled={locked || !name.trim()}>{working === "add" ? "添加中…" : "确认添加"}</button>
        <button className="icon-button" type="button" aria-label="收起添加账号" disabled={Boolean(working)} onClick={() => setAdding(false)}><X size={17}/></button>
      </form>}

      {!workerAvailable && <p className="pool-context-note"><WarningCircle size={15}/>当前部署的浏览器执行器离线。可以先添加账号，执行器启动后再完成本人登录。</p>}
      {workerAvailable && !loginEnabled && <p className="pool-context-note"><Browser size={15}/>当前部署尚未开启网页登录。可以先添加账号，在自己的部署启用交互登录后再打开登录窗口。</p>}

      <section className="pool-directory" aria-label="账号列表">
        <div className="pool-source-filter" aria-label="按账号来源筛选">
          {sources.filter((item) => item.id !== "muse_service" || showServices).map((item) => <button key={item.id} className={cn(activeSource === item.id && "active")} aria-pressed={activeSource === item.id} onClick={() => setSource(item.id)}>{item.label}<span>{accounts.filter((account) => item.id === "all" || account.type === item.id).length}</span></button>)}
        </div>
        <div className="pool-search-row">
          <label className="pool-search"><MagnifyingGlass size={16}/><input aria-label="搜索账号" placeholder="搜索账号名称或状态说明" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
          <select aria-label="筛选账号状态" value={filter} onChange={(event) => setFilter(event.target.value as PoolFilter)}><option value="all">全部状态</option><option value="schedulable">可调度</option><option value="busy">正在使用</option><option value="attention">待处理</option><option value="disabled">已停用</option></select>
        </div>
        {visible.length ? <div className="pool-directory-list">
          {visible.map((account) => {
            const service = account.type === "muse_service";
            const doubao = account.type === "native_doubao";
            const status = poolAccountStatus(account, workerAvailable);
            const unavailable = locked || account.busy;
            const key = (action: string) => `${account.id}:${action}`;
            const endpoint = `/pool/accounts/${account.id}`;
            return <article className={cn("pool-record", !account.enabled && "disabled")} key={account.id}>
              <div className="pool-record-icon">{service ? <ShieldCheck size={20}/> : <Browser size={20}/>}</div>
              <div className="pool-record-content">
                <div className="pool-record-title"><strong>{account.name}</strong><span className={cn("pool-status-badge", account.schedulable && "available", account.busy && "busy", account.state === "error" && "error")}>{status}</span></div>
                <div className="pool-record-meta"><span>{poolTypeNames[account.type]}</span><span>{service ? "服务密钥已加密保存" : !account.capabilities.image && !account.capabilities.video ? "生成适配待验证" : [account.capabilities.image && "图像通道", account.capabilities.video && "视频通道"].filter(Boolean).join(" · ")}</span></div>
                <div className="pool-record-times"><span title={account.lastCheckedAt || undefined}>最近检查 {poolRecordTime(account.lastCheckedAt)}</span><span title={account.lastUsedAt || undefined}>最近使用 {poolRecordTime(account.lastUsedAt)}</span></div>
                {account.message && <p className="pool-record-message">{account.message}</p>}
                {service && <PoolQuotaDetails quota={account.quota}/>}
                {service && <label className="pool-sharing-control"><input type="checkbox" aria-label={`共享 ${account.name} 给本部署用户`} checked={account.shared === true} disabled={unavailable} onChange={(event) => {
                  const shared = event.target.checked;
                  void perform(key("shared"), (signal) => api(endpoint, { method: "PATCH", body: json({ shared }), signal }), shared ? "该服务通道已共享给当前部署的其他登录用户。密钥仍保留在服务端。" : "已停止共享，服务通道仅供你自己使用。");
                }}/><span>共享给本部署用户</span><small>{account.shared ? "生成会使用此服务的额度" : "默认私有，仅自己使用"}</small></label>}
              </div>
              <div className="pool-record-actions">
                {service && <button className="button secondary" disabled={locked} aria-label={`刷新 ${account.name} 额度`} onClick={() => void perform(key("quota"), (signal) => api(`${endpoint}/quota`, { method: "POST", body: json({}), signal }), "账号额度查询已完成。", 100_000)}><ArrowClockwise size={14}/>{working === key("quota") ? "查询中…" : "刷新额度"}</button>}
                {!service && <><button className="button secondary" disabled={unavailable || !account.enabled || !workerAvailable || !loginEnabled} title={!loginEnabled ? "当前部署尚未开启交互登录" : "打开该账号的独立登录窗口"} onClick={() => void perform(key("login"), (signal) => api(`${endpoint}/login`, { method: "POST", body: json({}), signal }), "登录窗口已打开。请本人完成登录或验证，再点击“检测登录”。", 100_000)} aria-label={`登录 ${account.name}`}><Browser size={14}/>{working === key("login") ? "打开中…" : doubao ? "登录豆包" : "登录 Muse"}</button>
                  <button className="button secondary" disabled={unavailable || !workerAvailable || !account.enabled} onClick={() => void perform(key("check"), (signal) => api(`${endpoint}/check`, { method: "POST", body: json({}), signal }), "登录状态已更新。可调度数量以服务端检查结果为准。")} aria-label={`检查 ${account.name}`}>{working === key("check") ? "检测中…" : "检测登录"}</button>
                  <button className="icon-button" disabled={unavailable || !workerAvailable || !account.enabled} title="关闭窗口，保留该账号的独立会话" aria-label={`关闭 ${account.name} 会话`} onClick={() => void perform(key("close"), (signal) => api(`${endpoint}/close`, { method: "POST", body: json({}), signal }), "登录窗口已关闭，该账号的独立会话已保留。")}><X size={16}/></button></>}
                <button className={cn("icon-button pool-record-power", account.enabled && "enabled")} disabled={unavailable} title={account.enabled ? "停用账号，保留会话" : "启用账号"} aria-label={`${account.enabled ? "停用" : "启用"} ${account.name}`} onClick={() => void perform(key("enabled"), (signal) => api(endpoint, { method: "PATCH", body: json({ enabled: !account.enabled }), signal }), account.enabled ? "账号已停用，会话及凭据保留。" : "账号已启用，网站账号请检查当前登录状态。")}><Power size={17}/></button>
              </div>
            </article>;
          })}
        </div> : <div className="pool-directory-empty"><Stack size={28}/><strong>{accounts.length ? "没有符合筛选的账号" : "连接你的第一个生成账号"}</strong><p>{accounts.length ? "可以更换来源、状态或搜索词。" : "添加 Muse 或豆包账号，完成本人登录后用于自己的创作。"}</p>{accounts.length ? <button className="button secondary" onClick={clearFilters}>清除筛选</button> : <button className="button primary" disabled={locked} onClick={() => setAdding(true)}><Plus size={14}/>添加账号</button>}</div>}
      </section>

      {snapshot.canImportLocal && <section className="pool-service-import" aria-label="特殊服务凭据">
        <ShieldCheck size={22}/><div><strong>当前部署的 Muse 服务</strong><p>将部署机的服务凭据加密接入你的账号池。密钥只在服务端读取和保存，不会返回浏览器。</p><span>{snapshot.encryptionReady ? "加密存储已就绪" : "请先在当前部署配置凭据加密密钥"}</span></div>
        <button className="button secondary" disabled={locked || !snapshot?.encryptionReady} onClick={() => void perform("import-local", (signal) => api("/pool/accounts/import-local", { method: "POST", body: json({ name: "本地 Muse 服务" }), signal }), "已导入独立加密服务凭据，可在“服务凭据”分类查看。未读取网站账号密码。")}><CloudArrowDown size={15}/>{working === "import-local" ? "导入中…" : "导入服务凭据"}</button>
      </section>}
      <p className="pool-privacy-note"><EyeSlash size={14}/>账号、网页登录会话和生成调度按登录用户隔离。可调度状态不代表服务商额度或生成结果承诺。</p>
      </>}
    </div>}
  </Modal>;
}

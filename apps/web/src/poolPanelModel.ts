export type PoolAccountType = "native_muse" | "native_doubao" | "muse_service";
export type PoolQuotaEntry = {
  label: string;
  status: string;
  plan: string | null;
  weeklyUsedPercent: number | null;
  weeklyRemainingPercent: number | null;
  weeklyReset: string | null;
  extraRemaining: string | null;
  extraUsedPercent: number | null;
  checkedAt: string | null;
  stale: boolean;
};
export type PoolQuota = {
  status: "available" | "stale" | "unavailable" | "unsupported";
  message: string;
  checkedAt: string | null;
  accounts: PoolQuotaEntry[];
};
export type PoolAccount = {
  id: string;
  name: string;
  type: PoolAccountType;
  provider: "muse" | "doubao";
  state: string;
  message?: string;
  enabled: boolean;
  busy: boolean;
  fresh?: boolean;
  schedulable?: boolean;
  shared?: boolean;
  quota?: PoolQuota;
  capabilities: { image: boolean; video: boolean };
  lastCheckedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PoolSource = "all" | PoolAccountType;
export type PoolFilter = "all" | "schedulable" | "busy" | "attention" | "disabled";

export const poolTypeNames: Record<PoolAccountType, string> = {
  native_muse: "Muse 网站账号",
  native_doubao: "豆包网站账号",
  muse_service: "Muse 服务凭据",
};

export function poolFailureMessage(status: number | undefined, code: unknown, fallback: string) {
  if (status === 401) return "登录状态已过期，请重新登录后管理你的账号池。";
  if (code === "POOL_MANAGEMENT_DISABLED") return "当前部署尚未开启账号池管理。启用部署配置后，即可添加和管理自己的账号。";
  if (code === "POOL_OVERVIEW_FORBIDDEN") return "当前部署尚未开放个人账号池，请更新部署配置后重试。";
  if (code === "POOL_IMPORT_FORBIDDEN") return "当前账户不能导入部署机的服务凭据，仍可添加和管理自己的网站账号。";
  return fallback;
}

export function accountNeedsAttention(account: PoolAccount) {
  return account.enabled && !account.busy && account.schedulable !== true;
}

export function poolCounts(accounts: PoolAccount[]) {
  return {
    total: accounts.length,
    schedulable: accounts.filter((account) => account.schedulable === true).length,
    busy: accounts.filter((account) => account.busy).length,
    attention: accounts.filter(accountNeedsAttention).length,
  };
}

export function filterPoolAccounts(accounts: PoolAccount[], source: PoolSource, state: PoolFilter, search: string) {
  const query = search.trim().toLocaleLowerCase();
  return accounts.filter((account) => {
    if (source !== "all" && source !== account.type) return false;
    if (state === "schedulable" && account.schedulable !== true) return false;
    if (state === "busy" && !account.busy) return false;
    if (state === "attention" && !accountNeedsAttention(account)) return false;
    if (state === "disabled" && account.enabled) return false;
    return !query || `${account.name} ${poolTypeNames[account.type]} ${account.message || ""}`.toLocaleLowerCase().includes(query);
  });
}

export function poolAccountStatus(account: PoolAccount, workerAvailable: boolean) {
  if (!account.enabled) return "已停用";
  if (account.busy) return "正在使用";
  if (account.schedulable === true) return "可调度";
  if (account.state === "verification_required") return "需要本人验证";
  if (account.state === "login_required") return "需要登录";
  if (account.state === "error") return "检查失败";
  if (account.type !== "muse_service") {
    if (!workerAvailable) return "执行器离线";
    if (!account.capabilities.image && !account.capabilities.video) return "生成适配待验证";
    if (!account.fresh) return "需要检查状态";
  }
  return account.state === "unsupported" ? "生成适配待验证" : "暂不可调度";
}

export function poolRecordTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚无记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function poolQuotaPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return "未提供";
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)}%`;
}

export function poolQuotaStatus(quota?: PoolQuota) {
  if (!quota) return "尚未读取";
  if (quota.status === "available") return "已同步";
  if (quota.status === "stale") return "缓存待更新";
  if (quota.status === "unsupported") return "暂不支持查询";
  return "暂未获取";
}

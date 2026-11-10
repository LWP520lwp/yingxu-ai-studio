import { describe, expect, it } from "vitest";
import { filterPoolAccounts, poolAccountStatus, poolCounts, poolFailureMessage, poolQuotaPercent, poolQuotaStatus, poolRecordTime, type PoolAccount, type PoolQuota } from "./poolPanelModel";

const account = (patch: Partial<PoolAccount> = {}): PoolAccount => ({
  id: "a", name: "主账号", type: "native_muse", provider: "muse", state: "ready",
  enabled: true, busy: false, fresh: true, schedulable: false,
  capabilities: { image: true, video: false }, createdAt: "", updatedAt: "", ...patch,
});

describe("供应商额度展示", () => {
  it("保留零与用尽的真实值，不把未知额度展示成零或无限额度", () => {
    expect(poolQuotaPercent(0)).toBe("0%");
    expect(poolQuotaPercent(100)).toBe("100%");
    expect(poolQuotaPercent(99.99)).toBe("99.99%");
    for (const value of [null, undefined, NaN, Infinity, -1, 101]) expect(poolQuotaPercent(value)).toBe("未提供");
  });
  it("区分旧缓存、服务未提供和已同步，不把读取失败当成余额为零", () => {
    const quota = (status: PoolQuota["status"]): PoolQuota => ({ status, message: "", checkedAt: null, accounts: [] });
    expect(poolQuotaStatus()).toBe("尚未读取");
    expect(poolQuotaStatus(quota("available"))).toBe("已同步");
    expect(poolQuotaStatus(quota("stale"))).toBe("缓存待更新");
    expect(poolQuotaStatus(quota("unavailable"))).toBe("暂未获取");
    expect(poolQuotaStatus(quota("unsupported"))).toBe("暂不支持查询");
  });
});

describe("账号池调度状态与筛选", () => {
  it("仅使用服务端schedulable计数，不把ready、繁忙或过期会话算成可调度", () => {
    expect(poolCounts([account(), account({ busy: true }), account({ fresh: false }), account({ enabled: false }), account({ schedulable: true })]))
      .toEqual({ total: 5, schedulable: 1, busy: 1, attention: 2 });
    expect(poolCounts([account({ schedulable: undefined })]).schedulable).toBe(0);
  });
  it("服务凭据单独分类，不混入Muse网站账号，并组合来源/状态/搜索", () => {
    const rows = [account({ id: "a", name: "Muse Studio", schedulable: true }), account({ id: "b", type: "muse_service", name: "本地服务", schedulable: true }), account({ id: "c", type: "native_doubao", provider: "doubao", name: "豆包测试", busy: true })];
    expect(filterPoolAccounts(rows, "native_muse", "schedulable", "  STUDIO ").map((row) => row.id)).toEqual(["a"]);
    expect(filterPoolAccounts(rows, "muse_service", "all", "").map((row) => row.id)).toEqual(["b"]);
    expect(filterPoolAccounts(rows, "all", "busy", "").map((row) => row.id)).toEqual(["c"]);
  });
  it("停用账号不进待处理，且空白搜索不会隐藏结果", () => {
    const rows = [account(), account({ id: "b", enabled: false }), account({ id: "c", busy: true })];
    expect(filterPoolAccounts(rows, "all", "attention", " ").map((row) => row.id)).toEqual(["a"]);
    expect(filterPoolAccounts(rows, "all", "disabled", "").map((row) => row.id)).toEqual(["b"]);
  });
  it("状态标签区分忙碌、过期、未适配和服务凭据，不夸大已登录能力", () => {
    expect(poolAccountStatus(account({ busy: true }), true)).toBe("正在使用");
    expect(poolAccountStatus(account({ fresh: false }), true)).toBe("需要检查状态");
    expect(poolAccountStatus(account({ type: "native_doubao", capabilities: { image: false, video: false } }), true)).toBe("生成适配待验证");
    expect(poolAccountStatus(account(), false)).toBe("执行器离线");
    expect(poolAccountStatus(account({ type: "muse_service", schedulable: true }), false)).toBe("可调度");
    expect(poolAccountStatus(account({ enabled: false, busy: true }), true)).toBe("已停用");
  });
  it("未检查时间不伪造为当前时间", () => {
    expect(poolRecordTime(null)).toBe("尚无记录");
    expect(poolRecordTime("bad")).toBe("尚无记录");
  });
  it("登录失效与部署关闭分别给出恢复方式，不再声称普通GitHub用户不能添加账号", () => {
    expect(poolFailureMessage(401, "UNAUTHENTICATED", "请求失败")).toContain("重新登录");
    expect(poolFailureMessage(403, "POOL_MANAGEMENT_DISABLED", "请求失败")).toContain("启用部署配置");
    expect(poolFailureMessage(403, "POOL_OVERVIEW_FORBIDDEN", "旧管理员限制")).not.toContain("普通 GitHub");
  });
  it("部署机凭据导入被拒绝时仍保留个人网站账号管理的提示，其他错误保留真实原因", () => {
    expect(poolFailureMessage(403, "POOL_IMPORT_FORBIDDEN", "拒绝导入")).toContain("仍可添加和管理自己的网站账号");
    expect(poolFailureMessage(503, "WORKER_UNAVAILABLE", "执行器连接中断")).toBe("执行器连接中断");
  });
});

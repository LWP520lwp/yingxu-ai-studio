import { Collapse, Progress, Tag } from "antd";

import {
  formatPoolRecordTime,
  poolQuotaStatus,
  validQuotaPercent,
} from "@/lib/config-usage-model";

export type PoolQuotaAccount = {
  label: string;
  status: string;
  plan?: string | null;
  weeklyUsedPercent?: number | null;
  weeklyRemainingPercent?: number | null;
  weeklyReset?: string | null;
  extraRemaining?: string | null;
  extraUsedPercent?: number | null;
  checkedAt?: string | null;
  stale?: boolean;
};
export type PoolQuota = {
  status: string;
  message?: string;
  checkedAt?: string | null;
  accounts: PoolQuotaAccount[];
};
export type ConfigPoolSnapshot = {
  accounts: { id: string; name: string; type: string; quota?: PoolQuota }[];
  sharedChannels?: {
    muse: { available: number; busy: number; quota?: PoolQuota };
    message?: string;
  };
};

export function ConfigPoolQuota({
  quota,
  title,
}: {
  quota?: PoolQuota;
  title: string;
}) {
  return (
    <section className="ff-config-quota" aria-label={`${title}额度`}>
      <div className="ff-config-quota-heading">
        <strong>{title}</strong>
        <span>服务商额度</span>
      </div>
      {quota?.accounts?.length ? (
        <Collapse
          className="ff-config-quota-collapse"
          size="small"
          ghost
          items={quota.accounts.map((account, index) => {
            const remaining = validQuotaPercent(account.weeklyRemainingPercent);
            const used = validQuotaPercent(account.weeklyUsedPercent);
            const status = poolQuotaStatus(
              Boolean(account.stale),
              account.status,
            );
            const label = account.label?.trim() || `账号 ${index + 1}`;
            return {
              key: `${label}-${index}`,
              label: (
                <div className="ff-config-quota-account-title">
                  <span>
                    {label}
                    <small>
                      周剩余 {remaining === null ? "未提供" : `${remaining}%`}
                    </small>
                    {account.extraRemaining ? (
                      <small>{account.extraRemaining}</small>
                    ) : null}
                  </span>
                  <Tag className="m-0" color={status.color}>
                    {status.label}
                  </Tag>
                </div>
              ),
              children: (
                <div className="ff-config-quota-account">
                  {account.plan ? (
                    <p className="ff-config-quota-unavailable">
                      {account.plan}
                    </p>
                  ) : null}
                  <dl className="ff-config-quota-metrics">
                    <div>
                      <dt>周额度剩余</dt>
                      <dd>{remaining === null ? "未提供" : `${remaining}%`}</dd>
                    </div>
                    <div>
                      <dt>周额度已用</dt>
                      <dd>{used === null ? "未提供" : `${used}%`}</dd>
                    </div>
                    <div>
                      <dt>额外剩余额度</dt>
                      <dd>{account.extraRemaining || "未提供"}</dd>
                    </div>
                  </dl>
                  {remaining !== null ? (
                    <Progress
                      percent={remaining}
                      showInfo={false}
                      size="small"
                      aria-label={`${label}周额度剩余 ${remaining}%`}
                    />
                  ) : null}
                  <div className="ff-config-quota-times">
                    <span>周额度重置：{account.weeklyReset || "未提供"}</span>
                    <span>
                      更新于{" "}
                      {formatPoolRecordTime(
                        account.checkedAt || quota.checkedAt,
                      )}
                    </span>
                  </div>
                </div>
              ),
            };
          })}
        />
      ) : (
        <p className="ff-config-quota-unavailable">
          {quota?.message || "暂未获取额度，点击“同步额度”读取服务商数据。"}
        </p>
      )}
      {quota?.accounts?.length && quota.message ? (
        <p className="ff-config-quota-unavailable">{quota.message}</p>
      ) : null}
    </section>
  );
}

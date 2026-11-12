import { Alert, Button, Progress, Spin } from "antd";
import type { TFunction } from "i18next";
import { Database, HardDrive, Layers3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  formatStorageBytes,
  storageQuotaPercent,
  storageStoreLabelKey,
} from "@/lib/config-usage-model";
import {
  readLocalStorageUsage,
  type LocalStorageUsage,
} from "@/services/local-storage-usage";

export function ConfigLocalStorage({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const alive = useRef(false);

  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setError("");
    try {
      const result = await readLocalStorageUsage();
      if (alive.current && request === revision.current) setUsage(result);
    } catch (cause) {
      if (alive.current && request === revision.current) {
        setError(cause instanceof Error ? cause.message : t("config.localStorage.readFailed"));
      }
    } finally {
      if (alive.current && request === revision.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      revision.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      revision.current += 1;
      setLoading(false);
    } else if (!usage) {
      void load();
    }
  }, [active, load, usage]);

  const quotaUse = storageQuotaPercent(usage?.usage, usage?.quota);

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="storage-overview-title"
        aria-busy={loading}
        className="rounded-lg border border-stone-200 p-4 dark:border-stone-800"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="storage-overview-title" className="flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4" />
              {t("config.localStorage.title")}
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              {t("config.localStorage.description")}
            </p>
          </div>
          <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
            {t("config.localStorage.refresh")}
          </Button>
        </header>

        {error ? (
          <Alert
            className="mt-4"
            type="error"
            showIcon
            message={t("config.localStorage.readFailed")}
            description={error}
          />
        ) : null}

        {!usage && loading ? (
          <div className="grid min-h-44 place-items-center"><Spin /></div>
        ) : null}

        {usage ? (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <UsageFigure
                icon={<Database className="size-4" />}
                label={t("config.localStorage.indexedDbUsage")}
                value={formatStorageBytes(usage.contentBytes)}
                detail={t("config.localStorage.contentEstimate")}
              />
              <UsageFigure
                icon={<HardDrive className="size-4" />}
                label={t("config.localStorage.siteUsage")}
                value={formatStorageBytes(usage.usage)}
                detail={t("config.localStorage.siteUsageHint")}
              />
              <UsageFigure
                icon={<Layers3 className="size-4" />}
                label={t("config.localStorage.quota")}
                value={formatStorageBytes(usage.quota)}
                detail={usage.quota ? t("config.localStorage.quotaHint") : t("config.localStorage.quotaUnavailable")}
              />
            </div>
            {quotaUse !== null ? (
              <div className="mt-4" aria-label={t("config.localStorage.quotaProgress")}>
                <div className="mb-1 flex justify-between text-xs text-stone-500">
                  <span>{t("config.localStorage.quotaProgress")}</span>
                  <span className="tabular-nums">{quotaUse.toFixed(2)}%</span>
                </div>
                <Progress percent={quotaUse} showInfo={false} />
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {usage?.databases.map((database) => (
        <section key={database.name} className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
          <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{t("config.localStorage.mainDatabase")}</h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-stone-500">
                {database.name} <span aria-hidden="true">/</span> v{database.version}
              </p>
            </div>
            <strong className="shrink-0 text-sm tabular-nums">{formatStorageBytes(database.bytes)}</strong>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t("config.localStorage.title")}</th>
                  <th scope="col">{t("config.localStorage.records", { count: 0 })}</th>
                  <th scope="col">{t("config.localStorage.siteUsage")}</th>
                </tr>
              </thead>
              <tbody>
                {database.stores.map((store) => (
                  <tr key={store.name} className="border-b border-stone-100 last:border-0 dark:border-stone-900">
                    <th scope="row" className="max-w-0 px-4 py-3 text-left font-medium">
                      <div className="truncate">{storeLabel(store.name, t)}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] font-normal text-stone-500">{store.name}</div>
                    </th>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs text-stone-500 tabular-nums">
                      {t("config.localStorage.records", { count: store.records })}
                    </td>
                    <td className="w-24 whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      {formatStorageBytes(store.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function UsageFigure({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <dl className="grid min-h-24 grid-cols-[1fr_auto] gap-x-3 rounded-md bg-stone-100/70 p-3 dark:bg-stone-900/70">
      <dt className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</dt>
      <dd className="row-span-2 self-center text-right text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-[11px] text-stone-500">{detail}</dd>
    </dl>
  );
}

function storeLabel(name: string, t: TFunction) {
  const key = storageStoreLabelKey(name);
  return key ? t(`config.localStorage.stores.${key}`) : name;
}

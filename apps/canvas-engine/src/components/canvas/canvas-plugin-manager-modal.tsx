import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Spin,
  Switch,
  Tabs,
} from "antd";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Puzzle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import {
  groupInstalledPlugins,
  isPluginSourceUrl,
  officialVersionLabel,
  pluginErrorMessage,
} from "@/lib/canvas/plugin-manager-model";
import {
  installPluginFromUrl,
  setPluginEnabled,
  uninstallPlugin,
  updatePlugin,
} from "@/lib/canvas/plugin-loader";
import {
  fetchOfficialPlugins,
  hasUpgrade,
  type OfficialPluginEntry,
} from "@/lib/canvas/plugin-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  usePluginStore,
  type InstalledPlugin,
} from "@/stores/canvas/use-plugin-store";

type Props = { open: boolean; onClose: () => void };

export function CanvasPluginManagerModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { message } = App.useApp();
  const plugins = usePluginStore((state) => state.plugins);
  const collections = useMemo(() => groupInstalledPlugins(plugins), [plugins]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installingUrl, setInstallingUrl] = useState(false);
  const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
  const [loadingOfficial, setLoadingOfficial] = useState(false);
  const [officialLoaded, setOfficialLoaded] = useState(false);
  const [officialError, setOfficialError] = useState<string | null>(null);
  const loadRevision = useRef(0);

  const loadOfficial = useCallback(async () => {
    const revision = ++loadRevision.current;
    setLoadingOfficial(true);
    setOfficialError(null);
    try {
      const entries = await fetchOfficialPlugins();
      if (revision !== loadRevision.current) return;
      setOfficial(entries);
      setOfficialLoaded(true);
    } catch (error) {
      if (revision !== loadRevision.current) return;
      setOfficialError(pluginErrorMessage(error));
    } finally {
      if (revision === loadRevision.current) setLoadingOfficial(false);
    }
  }, []);

  useEffect(() => {
    if (open && !officialLoaded && !loadingOfficial && !officialError) {
      void loadOfficial();
    }
  }, [loadOfficial, loadingOfficial, officialError, officialLoaded, open]);

  useEffect(() => {
    if (!open) loadRevision.current += 1;
  }, [open]);

  const runPluginAction = useCallback(
    async (
      record: InstalledPlugin,
      action: () => Promise<unknown> | unknown,
      successText: string,
    ) => {
      setBusyId(record.id);
      try {
        await action();
        message.success(successText);
      } catch (error) {
        message.error(pluginErrorMessage(error));
      } finally {
        setBusyId(null);
      }
    },
    [message],
  );

  const installOfficial = useCallback(
    async (entry: OfficialPluginEntry) => {
      setBusyId(entry.id);
      try {
        const plugin = await installPluginFromUrl(entry.url, {
          official: true,
        });
        message.success(t("canvas.plugins.installed", { name: plugin.name }));
      } catch (error) {
        message.error(
          t("canvas.plugins.installFailed", {
            error: pluginErrorMessage(error),
          }),
        );
      } finally {
        setBusyId(null);
      }
    },
    [message, t],
  );

  const installFromUrl = useCallback(async () => {
    const target = sourceUrl.trim();
    if (!isPluginSourceUrl(target) || installingUrl) return;
    setInstallingUrl(true);
    try {
      const plugin = await installPluginFromUrl(target);
      message.success(
        t("canvas.plugins.installedPlugin", { name: plugin.name }),
      );
      setSourceUrl("");
    } catch (error) {
      message.error(
        t("canvas.plugins.installFailed", { error: pluginErrorMessage(error) }),
      );
    } finally {
      setInstallingUrl(false);
    }
  }, [installingUrl, message, sourceUrl, t]);

  const installedActions = (record: InstalledPlugin, upgradable = false) => (
    <div
      className="flex shrink-0 items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <Switch
        size="small"
        checked={record.enabled}
        loading={busyId === record.id}
        disabled={busyId !== null && busyId !== record.id}
        aria-label={t(
          record.enabled ? "canvas.plugins.disabled" : "canvas.plugins.enabled",
        )}
        onChange={(enabled) =>
          void runPluginAction(
            record,
            () => setPluginEnabled(record, enabled),
            t(enabled ? "canvas.plugins.enabled" : "canvas.plugins.disabled"),
          )
        }
      />
      {!record.local ? (
        <>
          <Button
            type={upgradable ? "primary" : "text"}
            size="small"
            icon={<RefreshCw className="size-4" aria-hidden="true" />}
            loading={busyId === record.id}
            disabled={busyId !== null && busyId !== record.id}
            title={t(
              upgradable
                ? "canvas.plugins.upgradeAvailable"
                : "canvas.plugins.updateFromSource",
            )}
            aria-label={t(
              upgradable
                ? "canvas.plugins.upgradeAvailable"
                : "canvas.plugins.updateFromSource",
            )}
            onClick={() =>
              void runPluginAction(
                record,
                () => updatePlugin(record),
                t("canvas.plugins.updated"),
              )
            }
          />
          <Popconfirm
            title={t("canvas.plugins.uninstallTitle")}
            okText={t("canvas.plugins.uninstall")}
            cancelText={t("canvas.editors.cancel")}
            onConfirm={() =>
              runPluginAction(
                record,
                () => uninstallPlugin(record.id),
                t("canvas.plugins.uninstall"),
              )
            }
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<Trash2 className="size-4" aria-hidden="true" />}
              title={t("canvas.plugins.uninstall")}
              aria-label={t("canvas.plugins.uninstall")}
              disabled={busyId !== null}
            />
          </Popconfirm>
        </>
      ) : null}
    </div>
  );

  const installedRow = (record: InstalledPlugin) => (
    <PluginRow
      key={record.id}
      name={record.name}
      version={record.version}
      description={record.description || record.url}
      theme={theme}
      actions={installedActions(record)}
    />
  );

  const officialTab = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-xs" style={{ color: theme.node.muted }}>
          {t("canvas.plugins.officialDescription")}
        </p>
        <Button
          type="text"
          size="small"
          icon={
            <RefreshCw
              className={`size-4 ${loadingOfficial ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          }
          loading={loadingOfficial}
          disabled={loadingOfficial}
          onClick={() => void loadOfficial()}
        >
          {t("canvas.plugins.refresh")}
        </Button>
      </div>
      {officialError ? (
        <div
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"
          style={{ borderColor: theme.node.stroke, color: theme.node.muted }}
          role="alert"
        >
          <span>
            {t("canvas.plugins.loadFailed", { error: officialError })}
          </span>
          <Button size="small" onClick={() => void loadOfficial()}>
            {t("canvas.plugins.refresh")}
          </Button>
        </div>
      ) : loadingOfficial && official.length === 0 ? (
        <div className="grid min-h-40 place-items-center">
          <Spin description={t("canvas.plugins.loadingOfficial")} />
        </div>
      ) : official.length === 0 ? (
        <Empty description={t("canvas.plugins.noOfficial")} />
      ) : (
        <div
          className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto pr-1"
          role="list"
        >
          {official.map((entry) => {
            const record = collections.byId.get(entry.id);
            const upgradable = Boolean(
              record && hasUpgrade(record.version, entry.version),
            );
            const version = officialVersionLabel(record, entry);
            return (
              <PluginRow
                key={entry.id}
                name={entry.name}
                version={version}
                description={entry.description}
                icon={entry.icon}
                theme={theme}
                actions={
                  record ? (
                    installedActions(record, upgradable)
                  ) : (
                    <Button
                      type="primary"
                      size="small"
                      icon={<Download className="size-4" aria-hidden="true" />}
                      loading={busyId === entry.id}
                      disabled={busyId !== null && busyId !== entry.id}
                      onClick={() => void installOfficial(entry)}
                    >
                      {t("canvas.plugins.install")}
                    </Button>
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );

  const localTab = (
    <PluginList
      items={collections.local}
      emptyText={t("canvas.plugins.noLocal")}
      renderItem={installedRow}
    />
  );

  const thirdPartyTab = (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={sourceUrl}
          aria-label={t("canvas.plugins.urlPlaceholder")}
          placeholder={t("canvas.plugins.urlPlaceholder")}
          allowClear
          onChange={(event) => setSourceUrl(event.target.value)}
          onPressEnter={() => void installFromUrl()}
        />
        <Button
          type="primary"
          icon={<ExternalLink className="size-4" aria-hidden="true" />}
          loading={installingUrl}
          disabled={!isPluginSourceUrl(sourceUrl) || installingUrl}
          onClick={() => void installFromUrl()}
        >
          {t("canvas.plugins.install")}
        </Button>
      </div>
      <PluginList
        items={collections.thirdParty}
        emptyText={t("canvas.plugins.noThirdParty")}
        renderItem={installedRow}
      />
    </div>
  );

  const tabs = [
    {
      key: "official",
      label: t("canvas.plugins.official"),
      children: officialTab,
    },
    ...(collections.local.length > 0
      ? [{ key: "local", label: t("canvas.plugins.local"), children: localTab }]
      : []),
    {
      key: "third",
      label: t("canvas.plugins.thirdParty"),
      children: thirdPartyTab,
    },
  ];

  return (
    <Modal
      title={t("canvas.plugins.title", { defaultValue: "画布节点插件" })}
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width="min(760px, calc(100vw - 24px))"
      destroyOnHidden={false}
    >
      <div className="space-y-3">
        <div
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5"
          style={{
            borderColor: "#f59e0b55",
            background: "#f59e0b14",
            color: theme.node.text,
          }}
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-amber-500"
            aria-hidden="true"
          />
          <span>{t("canvas.plugins.warning")}</span>
        </div>
        <Tabs defaultActiveKey="official" items={tabs} destroyOnHidden />
      </div>
    </Modal>
  );
}

function PluginList({
  items,
  emptyText,
  renderItem,
}: {
  items: InstalledPlugin[];
  emptyText: string;
  renderItem: (record: InstalledPlugin) => ReactNode;
}) {
  if (!items.length) return <Empty description={emptyText} />;
  return (
    <div
      className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto pr-1"
      role="list"
    >
      {items.map(renderItem)}
    </div>
  );
}

function PluginRow({
  name,
  version,
  description,
  icon,
  theme,
  actions,
}: {
  name: string;
  version: string;
  description?: string;
  icon?: string;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  actions: ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-2.5"
      style={{ borderColor: theme.node.stroke, background: theme.node.fill }}
      role="listitem"
    >
      <span
        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded text-sm"
        style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}
      >
        <PluginIcon icon={icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="flex min-w-0 items-center gap-2 text-sm font-medium"
          style={{ color: theme.node.text }}
        >
          <span className="truncate">{name}</span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
            style={{
              background: theme.toolbar.activeBg,
              color: theme.node.muted,
            }}
          >
            v{version}
          </span>
        </div>
        {description ? (
          <p
            className="m-0 mt-0.5 truncate text-xs"
            style={{ color: theme.node.muted }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

function PluginIcon({ icon }: { icon?: string }) {
  if (!icon) return <Puzzle className="size-4" aria-hidden="true" />;
  if (/^(https?:\/\/|data:image\/)/i.test(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className="size-full object-cover"
        loading="lazy"
      />
    );
  }
  return <span aria-hidden="true">{icon}</span>;
}

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
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

type Props = { open: boolean; onClose: () => void };
type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export function CanvasPluginManagerModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { message } = App.useApp();
  const plugins = usePluginStore((state) => state.plugins);
  const groups = useMemo(() => groupInstalledPlugins(plugins), [plugins]);
  const officialCatalog = useOfficialCatalog(open);
  const [sourceUrl, setSourceUrl] = useState("");
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const perform = useCallback(
    async (
      plugin: InstalledPlugin,
      work: () => Promise<unknown> | unknown,
      successMessage: string,
    ) => {
      setBusyPlugin(plugin.id);
      try {
        await work();
        message.success(successMessage);
      } catch (error) {
        message.error(pluginErrorMessage(error));
      } finally {
        setBusyPlugin(null);
      }
    },
    [message],
  );

  const installOfficial = useCallback(
    async (entry: OfficialPluginEntry) => {
      setBusyPlugin(entry.id);
      try {
        const installed = await installPluginFromUrl(entry.url, { official: true });
        message.success(t("canvas.plugins.installed", { name: installed.name }));
      } catch (error) {
        message.error(t("canvas.plugins.installFailed", { error: pluginErrorMessage(error) }));
      } finally {
        setBusyPlugin(null);
      }
    },
    [message, t],
  );

  const importFromUrl = useCallback(async () => {
    const url = sourceUrl.trim();
    if (!isPluginSourceUrl(url) || importBusy) return;
    setImportBusy(true);
    try {
      const installed = await installPluginFromUrl(url);
      message.success(t("canvas.plugins.installedPlugin", { name: installed.name }));
      setSourceUrl("");
    } catch (error) {
      message.error(t("canvas.plugins.installFailed", { error: pluginErrorMessage(error) }));
    } finally {
      setImportBusy(false);
    }
  }, [importBusy, message, sourceUrl, t]);

  const renderInstalledControls = (plugin: InstalledPlugin, canUpgrade = false) => (
    <PluginControls
      plugin={plugin}
      canUpgrade={canUpgrade}
      busyPlugin={busyPlugin}
      onToggle={(enabled) => void perform(
        plugin,
        () => setPluginEnabled(plugin, enabled),
        t(enabled ? "canvas.plugins.enabled" : "canvas.plugins.disabled"),
      )}
      onUpdate={() => void perform(
        plugin,
        () => updatePlugin(plugin),
        t("canvas.plugins.updated"),
      )}
      onRemove={() => perform(
        plugin,
        () => uninstallPlugin(plugin.id),
        t("canvas.plugins.uninstall"),
      )}
      t={t}
    />
  );

  const installedRow = (plugin: InstalledPlugin) => (
    <PluginEntry
      key={plugin.id}
      name={plugin.name}
      version={plugin.version}
      description={plugin.description || plugin.url}
      theme={theme}
      controls={renderInstalledControls(plugin)}
    />
  );

  const officialPanel = (
    <OfficialCatalogPanel
      entries={officialCatalog.entries}
      installedById={groups.byId}
      loading={officialCatalog.loading}
      loaded={officialCatalog.loaded}
      error={officialCatalog.error}
      busyPlugin={busyPlugin}
      theme={theme}
      onRefresh={officialCatalog.refresh}
      onInstall={(entry) => void installOfficial(entry)}
      renderInstalledControls={renderInstalledControls}
      t={t}
    />
  );

  const localPanel = (
    <InstalledPluginList
      plugins={groups.local}
      emptyMessage={t("canvas.plugins.noLocal")}
      render={installedRow}
    />
  );

  const externalPanel = (
    <div className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void importFromUrl();
        }}
      >
        <Input
          value={sourceUrl}
          aria-label={t("canvas.plugins.urlPlaceholder")}
          placeholder={t("canvas.plugins.urlPlaceholder")}
          allowClear
          onChange={(event) => setSourceUrl(event.target.value)}
        />
        <Button
          htmlType="submit"
          type="primary"
          icon={<ExternalLink className="size-4" aria-hidden="true" />}
          loading={importBusy}
          disabled={!isPluginSourceUrl(sourceUrl) || importBusy}
        >
          {t("canvas.plugins.install")}
        </Button>
      </form>
      <InstalledPluginList
        plugins={groups.thirdParty}
        emptyMessage={t("canvas.plugins.noThirdParty")}
        render={installedRow}
      />
    </div>
  );

  const tabs = [
    { key: "official", label: t("canvas.plugins.official"), children: officialPanel },
    ...(groups.local.length
      ? [{ key: "local", label: t("canvas.plugins.local"), children: localPanel }]
      : []),
    { key: "third", label: t("canvas.plugins.thirdParty"), children: externalPanel },
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
      <div className="space-y-4">
        <aside
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5"
          style={{
            borderColor: "#f59e0b55",
            background: "#f59e0b14",
            color: theme.node.text,
          }}
          role="note"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>{t("canvas.plugins.warning")}</span>
        </aside>
        <Tabs defaultActiveKey="official" items={tabs} destroyOnHidden />
      </div>
    </Modal>
  );
}

function useOfficialCatalog(open: boolean) {
  const [entries, setEntries] = useState<OfficialPluginEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestRevision = ++revision.current;
    setLoading(true);
    setError(null);
    try {
      const nextEntries = await fetchOfficialPlugins(undefined, controller.signal);
      if (controller.signal.aborted || requestRevision !== revision.current) return;
      setEntries(nextEntries);
      setLoaded(true);
    } catch (reason) {
      if (controller.signal.aborted || requestRevision !== revision.current) return;
      setError(pluginErrorMessage(reason));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (open && !loaded && !loading && !error) void refresh();
  }, [error, loaded, loading, open, refresh]);

  useEffect(() => {
    if (open) return;
    revision.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLoading(false);
  }, [open]);

  return { entries, loading, loaded, error, refresh };
}

function OfficialCatalogPanel({
  entries,
  installedById,
  loading,
  error,
  busyPlugin,
  theme,
  onRefresh,
  onInstall,
  renderInstalledControls,
  t,
}: {
  entries: OfficialPluginEntry[];
  installedById: Map<string, InstalledPlugin>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  busyPlugin: string | null;
  theme: CanvasTheme;
  onRefresh: () => void;
  onInstall: (entry: OfficialPluginEntry) => void;
  renderInstalledControls: (plugin: InstalledPlugin, canUpgrade?: boolean) => ReactNode;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <section className="space-y-3" aria-label={t("canvas.plugins.official")}>
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-xs" style={{ color: theme.node.muted }}>
          {t("canvas.plugins.officialDescription")}
        </p>
        <Button
          type="text"
          size="small"
          icon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />}
          loading={loading}
          disabled={loading}
          onClick={onRefresh}
        >
          {t("canvas.plugins.refresh")}
        </Button>
      </div>

      {error ? (
        <div
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"
          style={{ borderColor: theme.node.stroke, color: theme.node.muted }}
          role="alert"
        >
          <span>{t("canvas.plugins.loadFailed", { error })}</span>
          <Button size="small" onClick={onRefresh}>{t("canvas.plugins.refresh")}</Button>
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="grid min-h-40 place-items-center">
          <Spin description={t("canvas.plugins.loadingOfficial")} />
        </div>
      ) : entries.length === 0 ? (
        <Empty description={t("canvas.plugins.noOfficial")} />
      ) : (
        <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto pr-1" role="list">
          {entries.map((entry) => {
            const installed = installedById.get(entry.id);
            const canUpgrade = Boolean(installed && hasUpgrade(installed.version, entry.version));
            return (
              <PluginEntry
                key={entry.id}
                name={entry.name}
                version={officialVersionLabel(installed, entry)}
                description={entry.description}
                icon={entry.icon}
                theme={theme}
                controls={installed ? (
                  renderInstalledControls(installed, canUpgrade)
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    icon={<Download className="size-4" aria-hidden="true" />}
                    loading={busyPlugin === entry.id}
                    disabled={busyPlugin !== null && busyPlugin !== entry.id}
                    onClick={() => onInstall(entry)}
                  >
                    {t("canvas.plugins.install")}
                  </Button>
                )}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function InstalledPluginList({
  plugins,
  emptyMessage,
  render,
}: {
  plugins: InstalledPlugin[];
  emptyMessage: string;
  render: (plugin: InstalledPlugin) => ReactNode;
}) {
  if (plugins.length === 0) return <Empty description={emptyMessage} />;
  return (
    <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto pr-1" role="list">
      {plugins.map(render)}
    </div>
  );
}

function PluginControls({
  plugin,
  canUpgrade,
  busyPlugin,
  onToggle,
  onUpdate,
  onRemove,
  t,
}: {
  plugin: InstalledPlugin;
  canUpgrade: boolean;
  busyPlugin: string | null;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
  onRemove: () => Promise<unknown>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const locked = busyPlugin !== null && busyPlugin !== plugin.id;
  return (
    <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <Switch
        size="small"
        checked={plugin.enabled}
        loading={busyPlugin === plugin.id}
        disabled={locked}
        aria-label={t(plugin.enabled ? "canvas.plugins.disabled" : "canvas.plugins.enabled")}
        onChange={onToggle}
      />
      {!plugin.local ? (
        <>
          <Button
            type={canUpgrade ? "primary" : "text"}
            size="small"
            icon={<RefreshCw className="size-4" aria-hidden="true" />}
            loading={busyPlugin === plugin.id}
            disabled={locked}
            title={t(canUpgrade ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
            aria-label={t(canUpgrade ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
            onClick={onUpdate}
          />
          <Popconfirm
            title={t("canvas.plugins.uninstallTitle")}
            okText={t("canvas.plugins.uninstall")}
            cancelText={t("canvas.editors.cancel")}
            onConfirm={onRemove}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<Trash2 className="size-4" aria-hidden="true" />}
              title={t("canvas.plugins.uninstall")}
              aria-label={t("canvas.plugins.uninstall")}
              disabled={busyPlugin !== null}
            />
          </Popconfirm>
        </>
      ) : null}
    </div>
  );
}

function PluginEntry({
  name,
  version,
  description,
  icon,
  theme,
  controls,
}: {
  name: string;
  version: string;
  description?: string;
  icon?: string;
  theme: CanvasTheme;
  controls: ReactNode;
}) {
  return (
    <article
      className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-2.5"
      style={{ borderColor: theme.node.stroke, background: theme.node.fill }}
      role="listitem"
    >
      <span
        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded text-sm"
        style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}
      >
        <PluginMark icon={icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
          <span className="truncate">{name}</span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
            style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}
          >
            v{version}
          </span>
        </div>
        {description ? (
          <p className="m-0 mt-0.5 truncate text-xs" style={{ color: theme.node.muted }} title={description}>
            {description}
          </p>
        ) : null}
      </div>
      {controls}
    </article>
  );
}

function PluginMark({ icon }: { icon?: string }) {
  if (!icon) return <Puzzle className="size-4" aria-hidden="true" />;
  if (/^(https?:\/\/|data:image\/)/i.test(icon)) {
    return <img src={icon} alt="" className="size-full object-cover" loading="lazy" />;
  }
  return <span aria-hidden="true">{icon}</span>;
}

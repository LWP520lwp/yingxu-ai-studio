import {
  App,
  Button,
  Input,
  Modal,
  Progress,
  Radio,
  Select,
  Switch,
} from "antd";
import type { TFunction } from "i18next";
import {
  Check,
  CircleStop,
  Cloud,
  Database,
  Download,
  Network,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { videoResolutionOptions } from "@/components/video-settings-panel";
import { ConfigServerChannels } from "@/components/layout/config-server-channels";
import { ConfigLocalProxy } from "@/components/layout/config-local-proxy";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import type { AppLocale } from "@/i18n";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import {
  syncAppDataToWebdav,
  type AppSyncDomainKey,
  type AppSyncProgressEvent,
} from "@/services/app-sync-engine";
import {
  testWebdavConnection,
  WEBDAV_MANIFEST_FILE_NAME,
} from "@/services/webdav-sync";
import {
  computeMediaSize,
  inferMediaRatio,
  inferMediaScale,
  mediaScaleOptions,
  parseVideoResolution,
} from "@/lib/media-size";
import { getPlatformInit } from "@/platform/rpc";
import { openPlatformAction } from "@/platform/navigation";
import {
  useConfigStore,
  type ConfigTabKey,
  type ModelCapability,
} from "@/stores/use-config-store";
import "./app-config-modal.css";

type DomainProgress = {
  stage: string;
  current?: number;
  total?: number;
  status?: "active" | "success" | "exception";
};

const domainKeys: AppSyncDomainKey[] = [
  "canvas",
  "assets",
  "image-workbench",
  "video-workbench",
];
const configSections: Array<{
  key: ConfigTabKey;
  title: string;
  detail: string;
  icon: typeof Network;
}> = [
  { key: "channels", title: "生成渠道", detail: "模型服务连接", icon: Network },
  { key: "local-proxy", title: "网络连接", detail: "本地代理设置", icon: Wifi },
  {
    key: "preferences",
    title: "创作偏好",
    detail: "模型与交互默认值",
    icon: SlidersHorizontal,
  },
  {
    key: "prompt-sources",
    title: "提示词来源",
    detail: "灵感与提示词订阅",
    icon: Sparkles,
  },
  { key: "webdav", title: "云端同步", detail: "WebDAV 数据备份", icon: Cloud },
  {
    key: "local-storage",
    title: "本地数据",
    detail: "存储空间与用量",
    icon: Database,
  },
];

function emptyProgress(): Record<AppSyncDomainKey, DomainProgress> {
  return Object.fromEntries(
    domainKeys.map((key) => [key, { stage: "等待同步" }]),
  ) as Record<AppSyncDomainKey, DomainProgress>;
}

export function AppConfigPanel({
  showDoneButton = false,
  initialTab = "channels",
}: {
  showDoneButton?: boolean;
  initialTab?: ConfigTabKey;
}) {
  const { message } = App.useApp();
  const { i18n, t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const syncRef = useRef<AbortController | null>(null);
  const testRef = useRef<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [progress, setProgress] = useState(emptyProgress);
  const config = useConfigStore((state) => state.config);
  const webdav = useConfigStore((state) => state.webdav);
  const updateConfig = useConfigStore((state) => state.updateConfig);
  const updateWebdavConfig = useConfigStore(
    (state) => state.updateWebdavConfig,
  );
  const shouldPromptContinue = useConfigStore(
    (state) => state.shouldPromptContinue,
  );
  const setConfigDialogOpen = useConfigStore(
    (state) => state.setConfigDialogOpen,
  );
  const clearPromptContinue = useConfigStore(
    (state) => state.clearPromptContinue,
  );
  const locale = i18n.resolvedLanguage as AppLocale;
  const readyModels = getPlatformInit()?.models;
  const readyModelIds = useMemo(
    () =>
      new Set(
        [...(readyModels?.image || []), ...(readyModels?.video || [])]
          .filter((model) => model.available)
          .map((model) => model.id),
      ),
    [readyModels],
  );
  const pickerConfig = useMemo(
    () => ({
      ...config,
      channels: config.channels.map((channel) => ({
        ...channel,
        models: channel.models.filter((model) => readyModelIds.has(model.name)),
      })),
    }),
    [config, readyModelIds],
  );
  const imageScales = mediaScaleOptions.map((value) => ({
    value,
    label:
      value === "auto" ? t("settingsPanels.common.auto") : value.toUpperCase(),
  }));

  useEffect(() => setActiveTab(initialTab), [initialTab]);
  useEffect(
    () => () => {
      syncRef.current?.abort();
      testRef.current?.abort();
    },
    [],
  );

  const closeSettings = () => {
    syncRef.current?.abort();
    testRef.current?.abort();
    setConfigDialogOpen(false);
  };
  const finishSettings = () => {
    closeSettings();
    message.success(
      t(shouldPromptContinue ? "config.savedContinue" : "config.saved"),
    );
    clearPromptContinue();
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      await importAppConfig(file);
      message.success(t("config.imported"));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("config.importFailed"),
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const testConnection = async () => {
    if (!webdav.url.trim()) {
      message.error(t("config.webdav.missingUrl"));
      return;
    }
    const controller = new AbortController();
    testRef.current = controller;
    setTesting(true);
    try {
      await testWebdavConnection(webdav, controller.signal);
      message.success(t("config.webdav.available"));
    } catch (error) {
      if (!controller.signal.aborted)
        message.error(
          error instanceof Error
            ? error.message
            : t("config.webdav.testFailed"),
        );
    } finally {
      if (testRef.current === controller) testRef.current = null;
      setTesting(false);
    }
  };
  const reportProgress = (event: AppSyncProgressEvent) => {
    setSyncMessage(event.stage);
    if (!event.domain) return;
    setProgress((current) => ({
      ...current,
      [event.domain!]: {
        stage: event.stage,
        current: event.current,
        total: event.total,
        status: event.status,
      },
    }));
  };
  const synchronize = async () => {
    if (!webdav.url.trim()) {
      message.error(t("config.webdav.missingUrl"));
      return;
    }
    const controller = new AbortController();
    syncRef.current = controller;
    setSyncing(true);
    setProgress(emptyProgress());
    setSyncMessage(t("config.webdav.preparing"));
    try {
      const result = await syncAppDataToWebdav(webdav, reportProgress, {
        signal: controller.signal,
      });
      updateWebdavConfig("lastSyncedAt", result.syncedAt);
      message.success(
        t("config.webdav.completed", {
          projects: result.projects,
          assets: result.assets,
          records: result.imageLogs + result.videoLogs,
          files: result.uploadedFiles,
          bytes: formatBytes(result.uploadedBytes),
        }),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setSyncMessage(t("common.cancel"));
      } else {
        const text =
          error instanceof Error ? error.message : t("config.webdav.failed");
        setSyncMessage(text);
        message.error(text);
      }
    } finally {
      if (syncRef.current === controller) syncRef.current = null;
      setSyncing(false);
    }
  };

  return (
    <div className="ff-config-center">
      <div className="ff-config-filebar">
        <div>
          <strong>你的创作环境</strong>
          <p>生成渠道、创作偏好与数据管理</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="small"
            icon={<Upload size={14} />}
            onClick={() => fileRef.current?.click()}
          >
            {t("config.import")}
          </Button>
          <Button
            size="small"
            icon={<Download size={14} />}
            onClick={exportAppConfig}
          >
            {t("config.export")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="ff-config-workspace">
        <nav className="ff-config-workspace__nav" aria-label="创作设置">
          {configSections.map(({ key, title, detail, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={activeTab === key ? "is-active" : ""}
              aria-current={activeTab === key ? "page" : undefined}
              onClick={() => setActiveTab(key)}
            >
              <Icon size={16} />
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </button>
          ))}
        </nav>
        <main className="ff-config-workspace__content" key={activeTab}>
          {activeTab === "channels" ? <ConfigServerChannels /> : null}
          {activeTab === "local-proxy" ? (
            <ConfigSection
              title="网络连接"
              description="生成请求由服务端发送；浏览器中的 WebDAV 与媒体下载可使用本地代理。"
            >
              <ConfigLocalProxy />
            </ConfigSection>
          ) : null}
          {activeTab === "preferences" ? (
            <Preferences
              config={config}
              pickerConfig={pickerConfig}
              imageScales={imageScales}
              updateConfig={updateConfig}
              t={t}
            />
          ) : null}
          {activeTab === "prompt-sources" ? (
            <ConfigSection
              title="提示词来源"
              description="订阅、浏览和更新创作提示词。"
            >
              <div className="mb-4 flex justify-end">
                <Button
                  icon={<Sparkles size={14} />}
                  onClick={() =>
                    void openPlatformAction("skills")
                      .then(() => setConfigDialogOpen(false))
                      .catch((error) =>
                        message.error(
                          error instanceof Error
                            ? error.message
                            : "Skill 市场暂时无法打开，请重试",
                        ),
                      )
                  }
                >
                  打开 Skill 市场
                </Button>
              </div>
              <ConfigPromptSources />
            </ConfigSection>
          ) : null}
          {activeTab === "webdav" ? (
            <WebdavSettings
              webdav={webdav}
              progress={progress}
              status={syncMessage}
              syncing={syncing}
              testing={testing}
              locale={locale}
              update={updateWebdavConfig}
              onTest={() => void testConnection()}
              onSync={() => void synchronize()}
              onCancel={() => syncRef.current?.abort()}
              t={t}
            />
          ) : null}
          {activeTab === "local-storage" ? (
            <ConfigSection
              title="本地数据"
              description="查看此浏览器的缓存与素材用量，服务端项目数据单独保存。"
            >
              <ConfigLocalStorage active />
            </ConfigSection>
          ) : null}
        </main>
      </div>
      {showDoneButton ? (
        <div className="ff-config-footer">
          <span>
            <Check size={13} />
            偏好自动保存 · 导出不含密钥
          </span>
          <Button type="primary" onClick={finishSettings}>
            {t("common.done")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ConfigSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="ff-config-section">
      <div className="ff-config-section-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Preferences({
  config,
  pickerConfig,
  imageScales,
  updateConfig,
  t,
}: {
  config: ReturnType<typeof useConfigStore.getState>["config"];
  pickerConfig: typeof config;
  imageScales: Array<{ value: string; label: string }>;
  updateConfig: ReturnType<typeof useConfigStore.getState>["updateConfig"];
  t: TFunction;
}) {
  const models: Array<{
    capability: ModelCapability;
    key: "imageModel" | "videoModel";
    label: string;
  }> = [
    {
      capability: "image",
      key: "imageModel",
      label: t("config.preferences.defaultImageModel"),
    },
    {
      capability: "video",
      key: "videoModel",
      label: t("config.preferences.defaultVideoModel"),
    },
  ];
  return (
    <ConfigSection
      title="创作偏好"
      description="设置新建节点和生成任务的默认行为。修改会自动保存。"
    >
      <div className="mb-2 text-sm font-semibold">
        {t("config.preferences.defaultModels")}
      </div>
      <div className="ff-config-preference-grid mb-5">
        {models.map((item) => (
          <label key={item.key} className="block text-sm">
            {item.label}
            <div className="mt-2">
              <ModelPicker
                config={pickerConfig}
                value={config[item.key]}
                onChange={(model) => updateConfig(item.key, model)}
                capability={item.capability}
                placeholder="暂无可用模型，请先接入账号或渠道"
                fullWidth
              />
            </div>
          </label>
        ))}
      </div>
      <div className="mb-2 text-sm font-semibold">
        {t("config.preferences.generation")}
      </div>
      <div className="ff-config-preference-grid">
        <label className="text-sm">
          {t("config.preferences.canvasImageCount")}
          <Input
            className="mt-2"
            type="number"
            min={1}
            max={15}
            value={config.canvasImageCount}
            onChange={(event) =>
              updateConfig("canvasImageCount", event.target.value)
            }
            onBlur={(event) =>
              updateConfig(
                "canvasImageCount",
                normalizeImageCount(event.target.value),
              )
            }
          />
        </label>
        <label className="text-sm">
          {t("config.preferences.imageResolution")}
          <Select
            className="mt-2 w-full"
            value={inferMediaScale(config.size)}
            options={imageScales}
            onChange={(scale) =>
              updateConfig(
                "size",
                computeMediaSize(scale, inferMediaRatio(config.size)),
              )
            }
          />
        </label>
        <label className="text-sm">
          {t("config.preferences.videoResolution")}
          <Select
            className="mt-2 w-full"
            value={parseVideoResolution(config.vquality)}
            options={videoResolutionOptions}
            onChange={(value) => updateConfig("vquality", value)}
          />
        </label>
      </div>
      <div className="mt-5">
        <div className="mb-2 text-sm font-medium">
          {t("config.preferences.regenerateBehavior")}
        </div>
        <Radio.Group
          value={config.nodeRegenerateBehavior}
          onChange={(event) =>
            updateConfig("nodeRegenerateBehavior", event.target.value)
          }
          className="flex flex-col gap-2"
        >
          <Radio value="overwrite">
            <span className="font-medium">
              {t("config.preferences.regenerateBehaviorOverwrite")}
            </span>
            <span className="mt-0.5 block text-xs opacity-60">
              {t("config.preferences.regenerateBehaviorOverwriteDescription")}
            </span>
          </Radio>
          <Radio value="new-node">
            <span className="font-medium">
              {t("config.preferences.regenerateBehaviorNewNode")}
            </span>
            <span className="mt-0.5 block text-xs opacity-60">
              {t("config.preferences.regenerateBehaviorNewNodeDescription")}
            </span>
          </Radio>
        </Radio.Group>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 text-sm">
        <span>{t("config.preferences.autoFocusOnSelect")}</span>
        <Switch
          checked={config.autoFocusOnSelect}
          onChange={(value) => updateConfig("autoFocusOnSelect", value)}
        />
      </div>
    </ConfigSection>
  );
}

function WebdavSettings({
  webdav,
  progress,
  status,
  syncing,
  testing,
  locale,
  update,
  onTest,
  onSync,
  onCancel,
  t,
}: {
  webdav: ReturnType<typeof useConfigStore.getState>["webdav"];
  progress: Record<AppSyncDomainKey, DomainProgress>;
  status: string;
  syncing: boolean;
  testing: boolean;
  locale: AppLocale;
  update: ReturnType<typeof useConfigStore.getState>["updateWebdavConfig"];
  onTest: () => void;
  onSync: () => void;
  onCancel: () => void;
  t: TFunction;
}) {
  const ready = Boolean(webdav.url.trim());
  return (
    <ConfigSection
      title="云端同步"
      description="将本地素材和画布数据同步到自己的 WebDAV 空间。"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <strong className="text-sm">{t("config.webdav.title")}</strong>
          <p className="mt-1 text-xs text-stone-500">
            {t("config.webdav.description")}
          </p>
        </div>
        <span className="text-xs text-stone-500">
          {webdav.lastSyncedAt
            ? t("config.webdav.lastSynced", {
                time: formatWebdavTime(webdav.lastSyncedAt, locale),
              })
            : t("config.webdav.neverSynced")}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs">
          {t("config.webdav.url")}
          <Input
            className="mt-1.5"
            value={webdav.url}
            placeholder="https://nas.example.com/webdav"
            onChange={(event) => update("url", event.target.value)}
          />
        </label>
        <label className="text-xs">
          {t("config.webdav.directory")}
          <Input
            className="mt-1.5"
            value={webdav.directory}
            placeholder="yingxu-ai-studio"
            onChange={(event) => update("directory", event.target.value)}
          />
          <small className="mt-1 block text-stone-500">
            {t("config.webdav.directoryDescription", {
              manifest: WEBDAV_MANIFEST_FILE_NAME,
            })}
          </small>
        </label>
        <label className="text-xs">
          {t("config.webdav.username")}
          <Input
            className="mt-1.5"
            autoComplete="username"
            value={webdav.username}
            onChange={(event) => update("username", event.target.value)}
          />
        </label>
        <label className="text-xs">
          {t("config.webdav.password")}
          <Input.Password
            className="mt-1.5"
            autoComplete="current-password"
            value={webdav.password}
            onChange={(event) => update("password", event.target.value)}
          />
          <small className="mt-1 block text-stone-500">
            密码只用于当前会话，配置导出不包含密码。
          </small>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          icon={<Wifi size={15} />}
          disabled={!ready || syncing}
          loading={testing}
          onClick={onTest}
        >
          {t("config.webdav.test")}
        </Button>
        {syncing ? (
          <Button
            title={t("common.cancel")}
            aria-label={t("common.cancel")}
            icon={<CircleStop size={15} />}
            onClick={onCancel}
          />
        ) : (
          <Button
            type="primary"
            icon={<RefreshCw size={15} />}
            disabled={!ready || testing}
            onClick={onSync}
          >
            {t("config.webdav.syncNow")}
          </Button>
        )}
        {syncing ? (
          <span className="text-xs text-stone-500">
            {t("config.webdav.syncing")}
          </span>
        ) : status ? (
          <span className="text-xs text-stone-500">{stageText(status, t)}</span>
        ) : null}
      </div>
      {syncing || status ? (
        <div className="mt-3 grid gap-2">
          {domainKeys.map((key) => (
            <div
              key={key}
              className="border-b border-stone-200 pb-2 last:border-0 dark:border-stone-800"
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span>{t(`config.webdav.domains.${domainKey(key)}`)}</span>
                <span className="truncate text-right text-stone-500">
                  {stageText(progress[key].stage, t)}
                  {progress[key].total
                    ? ` · ${progress[key].current || 0}/${progress[key].total}`
                    : ""}
                </span>
              </div>
              <Progress
                percent={progressPercent(progress[key])}
                size="small"
                status={
                  progress[key].status === "exception"
                    ? "exception"
                    : progress[key].status === "success"
                      ? "success"
                      : progress[key].status === "active"
                        ? "active"
                        : "normal"
                }
                showInfo={false}
              />
            </div>
          ))}
        </div>
      ) : null}
    </ConfigSection>
  );
}

export function AppConfigModal() {
  const open = useConfigStore((state) => state.isConfigOpen);
  const tab = useConfigStore((state) => state.configTab);
  const setOpen = useConfigStore((state) => state.setConfigDialogOpen);
  return (
    <Modal
      title={
        <div className="ff-config-title">
          <div className="ff-config-title-icon">
            <Settings2 size={20} />
          </div>
          <div>
            <div className="text-lg font-semibold">创作设置</div>
            <div className="mt-0.5 text-xs font-normal text-stone-500">
              映序工作空间
            </div>
          </div>
        </div>
      }
      open={open}
      width={1040}
      centered
      destroyOnHidden
      onCancel={() => setOpen(false)}
      className="ff-config-modal"
      styles={{ body: { maxHeight: "76vh", overflowY: "auto" } }}
      footer={null}
    >
      <AppConfigPanel showDoneButton initialTab={tab} />
    </Modal>
  );
}

function normalizeImageCount(value: string) {
  return String(
    Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))),
  );
}

function formatWebdavTime(value: string, locale: AppLocale) {
  return new Date(value).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function domainKey(domain: AppSyncDomainKey) {
  if (domain === "image-workbench") return "imageWorkbench";
  if (domain === "video-workbench") return "videoWorkbench";
  return domain;
}

function stageText(stage: string, t: TFunction) {
  const known: Record<string, string> = {
    等待本地数据加载: "localWaiting",
    同步完成: "syncComplete",
    等待同步: "waiting",
    读取远端清单: "remoteManifest",
    读取本地数据: "localData",
    下载缺失媒体: "downloadMedia",
    写入本地合并结果: "writeMerge",
    上传新增媒体: "uploadMedia",
    媒体已齐全: "mediaReady",
    媒体无需上传: "mediaSkipped",
    检查缺失媒体: "checkMissingMedia",
    下载媒体: "downloadMediaFile",
    检查本地媒体: "checkLocalMedia",
    完成: "complete",
  };
  if (stage.startsWith("上传媒体 "))
    return t("config.webdav.stages.uploadMediaFile", { size: stage.slice(5) });
  if (stage.startsWith("上传清单 "))
    return t("config.webdav.stages.uploadManifest", { size: stage.slice(5) });
  const key = known[stage];
  return key ? t(`config.webdav.stages.${key}`) : stage;
}

function progressPercent(item: DomainProgress) {
  if (item.status === "success" || item.status === "exception") return 100;
  if (item.total)
    return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
  const stages: Record<string, number> = {
    等待同步: 0,
    读取远端清单: 12,
    读取本地数据: 24,
    下载缺失媒体: 36,
    写入本地合并结果: 58,
    上传新增媒体: 66,
    媒体已齐全: 74,
    媒体无需上传: 74,
  };
  return (
    stages[item.stage] ??
    (item.stage.startsWith("上传清单") ? 90 : item.status === "active" ? 30 : 0)
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

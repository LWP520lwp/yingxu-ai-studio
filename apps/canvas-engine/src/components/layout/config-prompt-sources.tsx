import { Alert, App, Button, Empty, Select, Skeleton, Switch, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PromptSourceContentModal } from "./prompt-source-content-modal";
import { PromptSourceEditorDrawer } from "./prompt-source-editor-drawer";
import {
  fetchPromptSourceStatuses,
  refreshAllSources,
  refreshSource,
  type PromptSourceStatus,
} from "@/services/api/prompts";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import {
  PROMPT_SOURCE_INTERVALS,
  usePromptSourceStore,
} from "@/stores/use-prompt-source-store";
import {
  formatPromptSourceTime,
  promptSourceHealth,
  promptSourceIntervalKey,
} from "@/lib/prompt-source-view-model";

const STATUS_QUERY_KEY = ["prompt-source-statuses"];

export function ConfigPromptSources() {
  const { message, modal } = App.useApp();
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const sources = usePromptSourceStore((state) => state.sources);
  const schedule = usePromptSourceStore((state) => state.schedule);
  const addSource = usePromptSourceStore((state) => state.addSource);
  const saveSource = usePromptSourceStore((state) => state.saveSource);
  const removeSource = usePromptSourceStore((state) => state.removeSource);
  const toggleSource = usePromptSourceStore((state) => state.toggleSource);
  const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchPromptSourceStatuses,
  });

  const [editingSource, setEditingSource] = useState<PromptSource | null>(null);
  const [viewingId, setViewingId] = useState("");
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [refreshingAll, setRefreshingAll] = useState(false);
  const viewingSource =
    sources.find((source) => source.id === viewingId) || null;
  const hasSourceRefresh = refreshingIds.size > 0;
  const isRefreshBusy = refreshingAll || hasSourceRefresh;
  const intervalOptions = PROMPT_SOURCE_INTERVALS.map((value) => ({
    value,
    label: t(
      `config.promptSources.intervals.${promptSourceIntervalKey(value)}`,
    ),
  }));

  const invalidatePrompts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
      queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
    ]);
  };

  const handleSave = (source: PromptSource) => {
    saveSource(source);
    void invalidatePrompts();
  };

  const handleDelete = (source: PromptSource) => {
    modal.confirm({
      title: t("config.promptSources.deleteTitle", { name: source.name }),
      content: t("config.promptSources.deleteDescription"),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        removeSource(source.id);
        await invalidatePrompts();
      },
    });
  };

  const handleRefreshOne = async (source: PromptSource) => {
    if (isRefreshBusy) return;
    setRefreshingIds((current) => new Set(current).add(source.id));
    try {
      const result = await refreshSource(source.id);
      await invalidatePrompts();
      message.success(
        t("config.promptSources.refreshed", {
          name: source.name,
          count: result.count,
        }),
      );
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      message.error(
        error instanceof Error
          ? error.message
          : t("config.promptSources.refreshFailedCached"),
      );
    } finally {
      setRefreshingIds((current) => {
        const next = new Set(current);
        next.delete(source.id);
        return next;
      });
    }
  };

  const handleRefreshAll = async () => {
    if (isRefreshBusy) return;
    setRefreshingAll(true);
    try {
      const result = await refreshAllSources();
      updateSchedule("lastFetchedAt", new Date().toISOString());
      await invalidatePrompts();
      if (result.failureCount) {
        message.warning(
          t("config.promptSources.refreshPartial", {
            success: result.successCount,
            failed: result.failureCount,
          }),
        );
      } else {
        message.success(
          t("config.promptSources.refreshAllSuccess", {
            sources: result.successCount,
            total: result.total,
          }),
        );
      }
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("config.promptSources.refreshFailed"),
      );
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {t("config.tabs.promptSources")}
          </h2>
        </div>
        <Button
          type="primary"
          icon={<Plus className="size-4" aria-hidden="true" />}
          onClick={() => setEditingSource(addSource())}
        >
          {t("config.promptSources.add")}
        </Button>
      </div>

      {statusQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message={
            statusQuery.error instanceof Error
              ? statusQuery.error.message
              : t("config.promptSources.refreshFailed")
          }
          action={
            <Button
              type="text"
              size="small"
              loading={statusQuery.isFetching}
              onClick={() => void statusQuery.refetch()}
            >
              {t("generation.retry")}
            </Button>
          }
        />
      ) : null}

      {statusQuery.isLoading ? (
        <div className="space-y-3" aria-busy="true" role="status">
          <Skeleton active title={false} paragraph={{ rows: 2 }} />
          <Skeleton active title={false} paragraph={{ rows: 2 }} />
        </div>
      ) : (
        <section
          aria-label={t("config.tabs.promptSources")}
          className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800"
        >
          {sources.length ? (
            sources.map((source) => (
              <PromptSourceRow
                key={source.id}
                source={source}
                status={statusQuery.data?.[source.id]}
                locale={i18n.resolvedLanguage}
                busy={isRefreshBusy}
                refreshing={refreshingIds.has(source.id)}
                onToggle={(enabled) => {
                  toggleSource(source.id, enabled);
                  void invalidatePrompts();
                }}
                onView={() => setViewingId(source.id)}
                onRefresh={() => void handleRefreshOne(source)}
                onEdit={() => setEditingSource(source)}
                onDelete={() => handleDelete(source)}
              />
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </section>
      )}

      <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
        <div className="mb-3 text-sm font-semibold">
          {t("config.promptSources.schedule")}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-xs text-stone-500">
              {t("config.promptSources.interval")}
            </span>
            <Select
              size="small"
              className="w-36"
              value={schedule.intervalMinutes}
              aria-label={t("config.promptSources.interval")}
              options={intervalOptions}
              onChange={(value) => updateSchedule("intervalMinutes", value)}
            />
          </label>
          <Button
            size="small"
            type="primary"
            icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
            loading={refreshingAll}
            disabled={hasSourceRefresh}
            onClick={() => void handleRefreshAll()}
          >
            {t("config.promptSources.refreshAll")}
          </Button>
          <span className="text-xs text-stone-500" aria-live="polite">
            {schedule.lastFetchedAt
              ? t("config.promptSources.lastFetched", {
                  time: formatPromptSourceTime(
                    schedule.lastFetchedAt,
                    i18n.resolvedLanguage,
                  ),
                })
              : t("config.promptSources.neverScheduled")}
          </span>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          {t("config.promptSources.scheduleDescription")}
        </p>
      </section>

      <PromptSourceEditorDrawer
        open={Boolean(editingSource)}
        source={editingSource}
        onSave={handleSave}
        onClose={() => setEditingSource(null)}
      />
      <PromptSourceContentModal
        source={viewingSource}
        onClose={() => setViewingId("")}
      />
    </div>
  );
}

function PromptSourceRow({
  source,
  status,
  locale,
  busy,
  refreshing,
  onToggle,
  onView,
  onRefresh,
  onEdit,
  onDelete,
}: {
  source: PromptSource;
  status?: PromptSourceStatus;
  locale?: string;
  busy: boolean;
  refreshing: boolean;
  onToggle: (enabled: boolean) => void;
  onView: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const health = promptSourceHealth(status);

  return (
    <article className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <Switch
        size="small"
        checked={source.enabled}
        disabled={busy}
        aria-label={
          t("config.promptSources.editor.enabled") + `: ${source.name}`
        }
        onChange={onToggle}
      />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{source.name}</span>
          {source.builtIn ? (
            <Tag className="m-0 shrink-0 text-[10px]">
              {t("config.promptSources.builtIn")}
            </Tag>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
          <a
            className="inline-flex max-w-full min-w-0 items-center gap-1 hover:text-stone-800 hover:underline dark:hover:text-stone-200"
            href={source.homepage || source.url}
            target="_blank"
            rel="noopener noreferrer"
            title="提示词来源（外部网站）"
            aria-label={`${source.name}（提示词来源，外部网站）`}
          >
            <span className="truncate">{source.homepage || source.url}</span>
            <ArrowUpRight size={12} className="shrink-0" aria-hidden="true" />
          </a>
          <span className="tabular-nums">
            {t("config.promptSources.itemCount", { count: status?.count ?? 0 })}
          </span>
          <PromptSourceStatusTag health={health} error={status?.lastError} />
          <span>
            {status?.lastSuccessAt
              ? t("config.promptSources.lastSuccess", {
                  time: formatPromptSourceTime(status.lastSuccessAt, locale),
                })
              : t("config.promptSources.neverFetched")}
          </span>
        </div>
      </div>

      <div className="col-start-2 flex flex-wrap justify-start gap-2 sm:col-start-auto sm:justify-end">
        <Button
          size="small"
          icon={<Eye className="size-3.5" />}
          onClick={onView}
        >
          {t("config.promptSources.view")}
        </Button>
        <Button
          size="small"
          icon={<RefreshCw className="size-3.5" />}
          loading={refreshing}
          disabled={busy && !refreshing}
          onClick={onRefresh}
        >
          {t("config.promptSources.refresh")}
        </Button>
        {!source.builtIn ? (
          <Button
            size="small"
            icon={<Pencil className="size-3.5" />}
            onClick={onEdit}
          >
            {t("config.promptSources.edit")}
          </Button>
        ) : null}
        {!source.builtIn ? (
          <Button
            size="small"
            danger
            icon={<Trash2 className="size-3.5" />}
            onClick={onDelete}
          >
            {t("common.delete")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function PromptSourceStatusTag({
  health,
  error,
}: {
  health: "failed" | "healthy" | "unsynced";
  error?: string;
}) {
  const { t } = useTranslation();
  if (health === "failed") {
    return (
      <Tag color="error" className="m-0 text-[10px]" title={error}>
        {t("config.promptSources.failed")}
      </Tag>
    );
  }
  if (health === "healthy") {
    return (
      <Tag color="success" className="m-0 text-[10px]">
        {t("config.promptSources.healthy")}
      </Tag>
    );
  }
  return (
    <Tag className="m-0 text-[10px]">{t("config.promptSources.unsynced")}</Tag>
  );
}

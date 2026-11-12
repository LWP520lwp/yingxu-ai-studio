import { App } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  refreshAllSources,
  refreshSource,
} from "@/services/api/prompts";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";

export const PROMPT_SOURCE_STATUS_QUERY_KEY = ["prompt-source-statuses"];

export function usePromptSourceActions() {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [refreshingAll, setRefreshingAll] = useState(false);
  const operationLock = useRef(false);

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
      queryClient.invalidateQueries({
        queryKey: PROMPT_SOURCE_STATUS_QUERY_KEY,
      }),
    ]);
  }, [queryClient]);

  const refreshOne = useCallback(
    async (source: PromptSource, blocked: boolean) => {
      if (blocked || operationLock.current) return;
      operationLock.current = true;
      setRefreshingIds((current) => new Set(current).add(source.id));
      try {
        const result = await refreshSource(source.id);
        await invalidate();
        message.success(
          t("config.promptSources.refreshed", {
            name: source.name,
            count: result.count,
          }),
        );
      } catch (cause) {
        await queryClient.invalidateQueries({
          queryKey: PROMPT_SOURCE_STATUS_QUERY_KEY,
        });
        message.error(
          cause instanceof Error
            ? cause.message
            : t("config.promptSources.refreshFailedCached"),
        );
      } finally {
        operationLock.current = false;
        setRefreshingIds((current) => {
          const remaining = new Set(current);
          remaining.delete(source.id);
          return remaining;
        });
      }
    },
    [invalidate, message, queryClient, t],
  );

  const refreshAll = useCallback(
    async (blocked: boolean) => {
      if (blocked || operationLock.current) return;
      operationLock.current = true;
      setRefreshingAll(true);
      try {
        const result = await refreshAllSources();
        updateSchedule("lastFetchedAt", new Date().toISOString());
        await invalidate();
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
      } catch (cause) {
        message.error(
          cause instanceof Error
            ? cause.message
            : t("config.promptSources.refreshFailed"),
        );
      } finally {
        operationLock.current = false;
        setRefreshingAll(false);
      }
    },
    [invalidate, message, t, updateSchedule],
  );

  return {
    refreshingIds,
    refreshingAll,
    refreshOne,
    refreshAll,
    invalidate,
  };
}

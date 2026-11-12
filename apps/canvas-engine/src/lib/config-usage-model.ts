const STORE_LABEL_KEYS: Readonly<Record<string, string>> = {
  app_state: "appState",
  image_files: "images",
  image_previews: "imagePreviews",
  media_files: "media",
  image_generation_logs: "imageLogs",
  video_generation_logs: "videoLogs",
  agent_chat_messages: "agentMessages",
  prompt_cache: "promptCache",
};

export function storageStoreLabelKey(name: string): string | undefined {
  return STORE_LABEL_KEYS[name];
}

export function storageQuotaPercent(
  usage: number | null | undefined,
  quota: number | null | undefined,
): number | null {
  if (
    typeof usage !== "number" ||
    !Number.isFinite(usage) ||
    usage < 0 ||
    typeof quota !== "number" ||
    !Number.isFinite(quota) ||
    quota <= 0
  ) {
    return null;
  }
  return Math.min(100, (usage / quota) * 100);
}

export function formatStorageBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0)
    return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function validQuotaPercent(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

export function poolQuotaStatus(stale: boolean, status: string) {
  if (stale) return { label: "缓存待刷新", color: "gold" as const };
  if (status === "available")
    return { label: "已同步", color: "green" as const };
  return { label: "暂未同步", color: undefined };
}

export function formatPoolRecordTime(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚未获取";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

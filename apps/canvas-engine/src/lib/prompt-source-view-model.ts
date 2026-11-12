import type { PromptSourceStatus } from "@/services/api/prompts";

export type PromptSourceHealth = "failed" | "healthy" | "unsynced";

export function promptSourceHealth(
  status: PromptSourceStatus | undefined,
): PromptSourceHealth {
  if (status?.lastError) return "failed";
  return status?.lastSuccessAt ? "healthy" : "unsynced";
}

export function promptSourceIntervalKey(minutes: number) {
  switch (minutes) {
    case 30:
      return "minutes30";
    case 60:
      return "hour1";
    case 360:
      return "hours6";
    case 1440:
      return "hours24";
    default:
      return "disabled";
  }
}

export function formatPromptSourceTime(value: string, locale?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";

  return date.toLocaleString(locale || undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

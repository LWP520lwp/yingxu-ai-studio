import { App } from "antd";
import { useTranslation } from "react-i18next";

import { copyTextWithFallback } from "@/lib/clipboard";

export function useCopyText() {
  const { message } = App.useApp();
  const { t } = useTranslation();

  return async (value: string, successText = t("common.copied")) => {
    const copied = await copyTextWithFallback(value, {
      writeText:
        typeof navigator !== "undefined" && navigator.clipboard
          ? (text) => navigator.clipboard.writeText(text)
          : undefined,
      fallback: copyThroughSelection,
    });
    if (copied) message.success(successText);
    else message.error(t("common.copyFailed"));
  };
}

function copyThroughSelection(value: string) {
  if (typeof document === "undefined") return false;
  const active = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const selection = document.getSelection();
  const savedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.tabIndex = -1;
  input.style.position = "fixed";
  input.style.insetInlineStart = "-10000px";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    input.remove();
    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    active?.focus({ preventScroll: true });
  }
  return copied;
}

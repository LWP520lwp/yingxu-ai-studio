import { Button } from "antd";
import { ArrowUp, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

type GenerationControlProps = {
  running: boolean;
  ready: boolean;
  variant: "composer" | "node";
  run: () => void;
  stop: () => void;
};

/** The same state machine controls launch and cancellation on every generation surface. */
export function GenerationControl({ running, ready, variant, run, stop }: GenerationControlProps) {
  const { t } = useTranslation();
  const compact = variant === "composer";
  const key = compact ? "canvas.promptPanel" : "canvas.configNode";
  const label = t(`${key}.${running ? "stop" : "generate"}`);
  const Icon = running ? Square : compact ? ArrowUp : Play;
  return (
    <Button
      type="primary"
      danger={running}
      disabled={!running && !ready}
      className={compact ? "!h-10 !min-w-16 shrink-0 !rounded-full !px-3" : "mt-auto !h-9 !w-full !rounded-lg"}
      aria-label={label}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={running ? stop : run}
      icon={<Icon aria-hidden="true" className={`size-4 ${running ? "fill-current" : ""}`} />}
    >
      {running || !compact ? label : null}
    </Button>
  );
}

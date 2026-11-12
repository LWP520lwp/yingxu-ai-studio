import { Button, Tooltip } from "antd";
import { Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

type ViewportControlsProps = {
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  undo?: { enabled: boolean; run: () => void };
  redo?: { enabled: boolean; run: () => void };
  className?: string;
  hint?: string;
};

export function ImageEditorViewportControls({
  zoom,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  undo,
  redo,
  className = "",
  hint,
}: ViewportControlsProps) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {undo ? (
        <Tooltip title={t("canvas.editors.undoSplitTitle")}>
          <Button
            type="text"
            icon={<Undo2 className="size-4" />}
            disabled={!undo.enabled}
            aria-label={t("canvas.editors.undoSplit")}
            onClick={undo.run}
          />
        </Tooltip>
      ) : null}
      {redo ? (
        <Tooltip title={t("canvas.editors.redoSplitTitle")}>
          <Button
            type="text"
            icon={<Redo2 className="size-4" />}
            disabled={!redo.enabled}
            aria-label={t("canvas.editors.redoSplit")}
            onClick={redo.run}
          />
        </Tooltip>
      ) : null}
      <Tooltip title={t("canvas.editors.zoomOut")}>
        <Button
          type="text"
          icon={<ZoomOut className="size-4" />}
          disabled={!canZoomOut}
          aria-label={t("canvas.editors.zoomOut")}
          onClick={onZoomOut}
        />
      </Tooltip>
      <button
        type="button"
        className="min-w-14 text-center text-xs font-semibold tabular-nums opacity-70"
        onClick={onResetZoom}
        aria-label={t("canvas.editors.reset")}
        title={t("canvas.editors.reset")}
      >
        {Math.round(zoom * 100)}%
      </button>
      <Tooltip title={t("canvas.editors.zoomIn")}>
        <Button
          type="text"
          icon={<ZoomIn className="size-4" />}
          disabled={!canZoomIn}
          aria-label={t("canvas.editors.zoomIn")}
          onClick={onZoomIn}
        />
      </Tooltip>
      {hint ? <span className="ml-2 text-xs opacity-55">{hint}</span> : null}
    </div>
  );
}

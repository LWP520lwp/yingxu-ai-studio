import { useMemo, useState } from "react";
import { Alert, Button, Modal, Tag } from "antd";
import { ScanSearch } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  auditCanvasWorkflow,
  repairCanvasConnections,
  summarizeCanvasWorkflow,
  type CanvasWorkflowIssue,
} from "@/lib/canvas/canvas-workflow-audit";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export function CanvasWorkflowAuditAction({
  nodes,
  connections,
  onFocusNode,
  onRepairConnections,
}: {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  onFocusNode: (nodeId: string) => void;
  onRepairConnections: (connections: CanvasConnection[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const themeName = useThemeStore((state) => state.theme);
  const theme = canvasThemes[themeName];
  const issues = useMemo(
    () => (open ? auditCanvasWorkflow(nodes, connections) : []),
    [connections, nodes, open],
  );
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const repairable = issues.filter((issue) => issue.code !== "cycle").length;
  const summary = useMemo(
    () => (open ? summarizeCanvasWorkflow(nodes, connections) : null),
    [connections, nodes, open],
  );

  return (
    <>
      <Button
        type="text"
        aria-label={t("canvas.workflowAudit.title")}
        title={t("canvas.workflowAudit.title")}
        className="!h-8 !w-8 !min-w-8 !p-0"
        style={{ color: theme.toolbar.item }}
        icon={<ScanSearch className="size-4.5" />}
        onClick={() => setOpen(true)}
      />
      <Modal
        title={t("canvas.workflowAudit.title")}
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          repairable ? (
            <Button
              type="primary"
              onClick={() =>
                onRepairConnections(repairCanvasConnections(nodes, connections))
              }
            >
              {t("canvas.workflowAudit.clean", { count: repairable })}
            </Button>
          ) : null
        }
        width={560}
        destroyOnHidden
      >
        {summary ? (
          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
            <WorkflowMetric
              label={t("canvas.workflowAudit.entries")}
              count={summary.entryNodes.length}
            />
            <WorkflowMetric
              label={t("canvas.workflowAudit.exits")}
              count={summary.exitNodes.length}
            />
            <WorkflowMetric
              label={t("canvas.workflowAudit.isolated")}
              count={summary.isolatedNodes.length}
            />
            <WorkflowMetric
              label={t("canvas.workflowAudit.branches")}
              count={summary.branchNodes.length}
            />
          </div>
        ) : null}
        {issues.length === 0 ? (
          <Alert
            type="success"
            showIcon
            message={t("canvas.workflowAudit.healthy")}
          />
        ) : (
          <div className="grid max-h-[55vh] gap-2 overflow-y-auto">
            <Alert
              type={errors ? "error" : "warning"}
              showIcon
              message={t("canvas.workflowAudit.issueSummary", {
                count: issues.length,
                errors,
              })}
            />
            {issues.map((issue, index) => (
              <WorkflowIssueRow
                key={`${issue.code}:${issue.connectionId}:${index}`}
                issue={issue}
                onFocusNode={onFocusNode}
                onClose={() => setOpen(false)}
              />
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

function WorkflowMetric({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
      <span className="truncate text-neutral-600 dark:text-neutral-300">
        {label}
      </span>
      <Tag className="mr-0 tabular-nums">{count}</Tag>
    </div>
  );
}

function WorkflowIssueRow({
  issue,
  onFocusNode,
  onClose,
}: {
  issue: CanvasWorkflowIssue;
  onFocusNode: (nodeId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labelKey =
    issue.code === "missing-source"
      ? "missingSource"
      : issue.code === "missing-target"
        ? "missingTarget"
        : issue.code === "self-link"
          ? "selfLink"
          : issue.code === "duplicate-link"
            ? "duplicateLink"
            : "cycle";
  const label = t(`canvas.workflowAudit.labels.${labelKey}`);
  const fromTitle = issue.fromTitle || t("canvas.workflowAudit.untitledNode");
  const toTitle = issue.toTitle || t("canvas.workflowAudit.untitledNode");
  const detail =
    issue.code === "missing-source"
      ? issue.toTitle
        ? t("canvas.workflowAudit.details.missingSourceWithTarget", {
            title: issue.toTitle,
          })
        : t("canvas.workflowAudit.details.missingSource")
      : issue.code === "missing-target"
        ? issue.fromTitle
          ? t("canvas.workflowAudit.details.missingTargetWithSource", {
              title: issue.fromTitle,
            })
          : t("canvas.workflowAudit.details.missingTarget")
        : issue.code === "self-link"
          ? t("canvas.workflowAudit.details.selfLink", { title: fromTitle })
          : issue.code === "duplicate-link"
            ? t("canvas.workflowAudit.details.duplicateLink", {
                from: fromTitle,
                to: toTitle,
              })
            : t("canvas.workflowAudit.details.cycle", {
                from: fromTitle,
                to: toTitle,
              });

  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-700">
      <Tag
        color={issue.severity === "error" ? "error" : "warning"}
        className="mt-0.5 mr-0"
      >
        {label}
      </Tag>
      <span className="min-w-0 flex-1 break-words text-sm">{detail}</span>
      {issue.focusNodeId ? (
        <Button
          size="small"
          onClick={() => {
            onClose();
            onFocusNode(issue.focusNodeId!);
          }}
        >
          {t("canvas.workflowAudit.focus")}
        </Button>
      ) : null}
    </div>
  );
}

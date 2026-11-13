import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { Alert, Button, Modal, Space, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const Crop = lazy(() =>
  import("@/components/canvas/canvas-node-crop-dialog").then((module) => ({
    default: module.CanvasNodeCropDialog,
  })),
);
const Split = lazy(() =>
  import("@/components/canvas/canvas-node-split-dialog").then((module) => ({
    default: module.CanvasNodeSplitDialog,
  })),
);
const Upscale = lazy(() =>
  import("@/components/canvas/canvas-node-upscale-dialog").then((module) => ({
    default: module.CanvasNodeUpscaleDialog,
  })),
);
const Angle = lazy(() =>
  import("@/components/canvas/canvas-node-angle-dialog").then((module) => ({
    default: module.CanvasNodeAngleDialog,
  })),
);
const Mask = lazy(() =>
  import("@/components/canvas/canvas-mask-workspace").then((module) => ({
    default: module.CanvasNodeMaskEditDialog,
  })),
);

export type StudioEditOperation =
  "crop" | "split" | "upscale" | "angle" | "mask";
export type StudioEditRequest = {
  node: CanvasNodeData;
  operation: StudioEditOperation;
};
export type StudioDialogsProps = {
  edit: StudioEditRequest | null;
  onClose(): void;
  onConfirm(
    node: CanvasNodeData,
    operation: StudioEditOperation,
    parameters: unknown,
  ): void;
  preview: CanvasNodeData | null;
  onPreviewClose(): void;
};

class EditorBoundary extends Component<
  { children: ReactNode; onClose(): void; message: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Modal
        open
        title={this.props.message}
        onCancel={this.props.onClose}
        footer={null}
      >
        <Alert type="error" showIcon message={this.props.message} />
      </Modal>
    ) : (
      this.props.children
    );
  }
}

function MediaPreview({
  node,
  onClose,
  english,
}: {
  node: CanvasNodeData;
  onClose(): void;
  english: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const source = node.metadata?.content || "";
  const image = node.type === CanvasNodeType.Image;
  const unavailable = english
    ? "This media could not be read. Reopen it or replace the source file."
    : "暂时无法读取此素材。请重新打开或替换源文件。";
  return (
    <Modal
      open
      title={node.title || (english ? "Preview" : "素材预览")}
      onCancel={onClose}
      footer={null}
      width={1080}
      centered
      destroyOnHidden
    >
      {image && (
        <Space style={{ marginBottom: 12 }}>
          <Button
            aria-label={english ? "Zoom out" : "缩小预览"}
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            −
          </Button>
          <Button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
          <Button
            aria-label={english ? "Zoom in" : "放大预览"}
            disabled={zoom >= 3}
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          >
            ＋
          </Button>
        </Space>
      )}
      {failed || !source ? (
        <Alert showIcon type="warning" message={unavailable} />
      ) : (
        <div
          style={{
            maxHeight: "72vh",
            overflow: "auto",
            textAlign: "center",
            background: "var(--background)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          {image ? (
            <img
              src={source}
              alt={node.title}
              onError={() => setFailed(true)}
              style={{
                display: "block",
                margin: "auto",
                maxWidth: `${zoom * 100}%`,
                maxHeight: `${zoom * 64}vh`,
                objectFit: "contain",
              }}
            />
          ) : node.type === CanvasNodeType.Video ? (
            <video
              src={source}
              controls
              playsInline
              preload="metadata"
              onError={() => setFailed(true)}
              style={{ display: "block", width: "100%", maxHeight: "66vh" }}
            />
          ) : node.type === CanvasNodeType.Audio ? (
            <audio
              src={source}
              controls
              preload="metadata"
              onError={() => setFailed(true)}
              style={{ width: "100%" }}
            />
          ) : (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                textAlign: "left",
                margin: 0,
                font: "inherit",
              }}
            >
              {source}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Only the active editor is mounted; large pixel editors never enter the initial canvas bundle. */
export default function StudioDialogs({
  edit,
  onClose,
  onConfirm,
  preview,
  onPreviewClose,
}: StudioDialogsProps) {
  const { i18n } = useTranslation();
  const english = (i18n.resolvedLanguage || i18n.language).startsWith("en");
  let editor: ReactNode = null;
  if (edit?.node.type === CanvasNodeType.Image && edit.node.metadata?.content) {
    const request = edit;
    const props = {
      dataUrl: edit.node.metadata.content,
      open: true,
      onClose,
      onConfirm: (parameters: unknown) => {
        onClose();
        onConfirm(request.node, request.operation, parameters);
      },
    };
    editor =
      edit.operation === "crop" ? (
        <Crop {...props} />
      ) : edit.operation === "split" ? (
        <Split {...props} />
      ) : edit.operation === "upscale" ? (
        <Upscale {...props} />
      ) : edit.operation === "angle" ? (
        <Angle {...props} />
      ) : (
        <Mask {...props} />
      );
  }
  return (
    <>
      {editor && (
        <EditorBoundary
          key={`${edit!.node.id}:${edit!.operation}`}
          onClose={onClose}
          message={
            english
              ? "The image editor could not be loaded. Close this panel and try again."
              : "图像编辑器暂时无法加载，请关闭后重试。"
          }
        >
          <Suspense
            fallback={
              <Modal
                open
                title={english ? "Opening editor" : "正在打开编辑器"}
                onCancel={onClose}
                footer={null}
              >
                <div style={{ padding: 48, textAlign: "center" }}>
                  <Spin />
                </div>
              </Modal>
            }
          >
            {editor}
          </Suspense>
        </EditorBoundary>
      )}
      {preview && (
        <MediaPreview
          key={`${preview.id}:${preview.metadata?.content || ""}`}
          node={preview}
          onClose={onPreviewClose}
          english={english}
        />
      )}
    </>
  );
}

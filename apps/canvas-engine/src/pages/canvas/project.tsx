import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Group, Video } from "lucide-react";
import { saveAs } from "file-saver";
import {
  getPlatformInit,
  platformAbortError,
  platformRequest,
} from "@/platform/rpc";
import { openPlatformAction, type PlatformAction } from "@/platform/navigation";
import {
  canvasSkillPrompt,
  prepareTextVideo,
  selectImageModel,
  selectVideoModel,
  textVideoPrompt,
  videoSkillMetadata,
  type CanvasVideoSkill,
} from "@/platform/skill-video";
import { createStoryWorkflowImport } from "@/platform/story-workflow";
import { useTranslation } from "react-i18next";

import {
  requestEdit,
  requestGeneration,
  requestImageQuestion,
} from "@/services/api/image";
import {
  requestAudioGeneration,
  storeGeneratedAudio,
} from "@/services/api/audio";
import {
  createVideoGenerationTask,
  isVideoTaskFailed,
  storeGeneratedVideo,
  waitForVideoGenerationTask,
} from "@/services/api/video";
import {
  defaultConfig,
  useConfigStore,
  useEffectiveConfig,
} from "@/stores/use-config-store";
import { deleteStoredImages, ensureImagePreview, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { deleteStoredMedia, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { mapConcurrent } from "@/lib/async-pool";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  cropAtlasImageDataUrl as cropDataUrl,
  splitAtlasImageDataUrl as splitDataUrl,
  upscaleAtlasImageDataUrl as upscaleDataUrl,
} from "@/atlas-engine/workflows/image-processing";
import {
  fitAtlasNodeSize as fitNodeSize,
  atlasNodeSizeFromRatio as nodeSizeFromRatio,
} from "@/atlas-engine/model/node-size";
import { applyAtlasNodeCommand as applyCanvasNodeCommand } from "@/atlas-engine/interaction/node-layout";
import { createAtlasGenerationCoordinator, atlasGenerationScopeKey } from "@/atlas-engine/workflows/generation-coordinator";
import { completeAtlasVideoGeneration as completeCanvasVideoGeneration } from "@/atlas-engine/workflows/video-generation";
import { retryAtlasCanvasNode as retryCanvasNode } from "@/atlas-engine/workflows/generation-retry";
import { executeAtlasProvider, executeAtlasImageWriteback } from "@/atlas-engine/workflows/generation-provider";
import {
  applyAtlasImageEditMedia,
  createAtlasImageEditGuard,
  executeAtlasImageEdit,
  planAtlasAngleImageEdit,
  planAtlasMaskImageEdit,
  restoreAtlasImageEditCancellation,
  type AtlasImageEditPlan,
} from "@/atlas-engine/workflows/image-edit-plan";
import {
  planAtlasImageReversePrompt,
  planAtlasTextToImage,
  planAtlasTextToVideo,
} from "@/atlas-engine/interaction/generation-commands";
import { tidyAtlasNodes as tidyCanvasNodes } from "@/atlas-engine/interaction/node-layout";
import {
  captureAtlasFragment as captureCanvasFragment,
  type AtlasCanvasFragment as CanvasFragment,
} from "@/atlas-engine/interaction/node-layout";
import {
  atlasBatchRemovalCollapses,
  atlasNodeCreationOpensPanel,
  planAtlasBatchImageDuplicate,
  planAtlasBatchImageRemoval,
  planAtlasBatchPrimary,
  planAtlasConnectedNode,
  planAtlasConnectionRemoval,
  planAtlasFragmentClone,
  planAtlasFragmentInsertion,
  planAtlasNodeInsertion,
  planAtlasReferenceDisconnect,
} from "@/atlas-engine/interaction/node-commands";
import {
  canvasViewBounds,
  connectedSourcesByTarget,
  countCanvasGroupChildren,
  createCanvasViewIndex,
  indexCanvasNodes,
  relatedCanvasElements,
  selectVisibleConnections,
  selectVisibleNodes,
} from "@/atlas-engine/surface/spatial-index";
import {
  captureAtlasVideoFrame as captureVideoFrame,
  type AtlasVideoFramePosition as VideoFramePosition,
} from "@/atlas-engine/workflows/video-frame";
import { App, Button, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { AtlasBoardScene } from "@/atlas-engine/surface/AtlasBoardScene";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import type { CanvasImageMaskEditPayload } from "@/components/canvas/canvas-mask-workspace";
import type { CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import type { CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import {
  buildNodeGenerationContext,
  buildNodeGenerationInputs,
  hydrateNodeGenerationContext,
  type NodeGenerationInput,
} from "@/components/canvas/canvas-node-generation";
import {
  CanvasNodeHoverToolbar,
  CanvasNodeInfoModal,
} from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasSelectionToolbar } from "@/components/canvas/canvas-selection-toolbar";
import { AtlasCanvasViewport as CanvasViewport } from "@/atlas-engine/surface/AtlasCanvasViewport";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { resolveAtlasShortcut as resolveCanvasShortcutIntent } from "@/atlas-engine/workflows/async-flow";
import { resolveAtlasGenerationRequest } from "@/atlas-engine/workflows/generation-request";
import {
  applyAtlasGenerationFailure,
  applyAtlasGenerationEvent,
  beginAtlasGenerationSource,
  cancelAtlasGenerationNodes,
  finalizeAtlasImageBatch,
  finalizeAtlasTextBatch,
  patchAtlasGenerationMetadata,
  restoreAtlasCancelledImageSource,
} from "@/atlas-engine/workflows/generation-state";
import {
  idleBoardInteraction,
  type BoardInteractionState,
} from "@/atlas-engine/interaction/canvas-board-adapter";
import { useAtlasNodeSelection } from "@/atlas-engine/host/use-atlas-node-selection";
import { useAtlasBoardGestures } from "@/pages/canvas/hooks/use-atlas-board-gestures";
import { useAtlasNodeDialogs } from "@/pages/canvas/hooks/use-atlas-node-dialogs";
import {
  canvasCenterInWorld,
  centeredCanvasViewport,
  clientPointToCanvas,
  zoomCanvasToScale,
} from "@/atlas-engine/host/viewport-controller";
import {
  applyAtlasMediaReplacement as applyMediaReplacement,
  createAtlasCropImageResult as createCropImageResult,
  createAtlasSplitImageResults as createSplitImageResults,
  createAtlasUpscaleImageResult as createUpscaleImageResult,
  planAtlasMediaImport as planMediaImport,
} from "@/atlas-engine/workflows/media-operations";
import {
  atlasMediaCommitCommands,
  atlasMediaOutputPosition,
  buildAtlasAssetDraft,
  buildAtlasCapturedFrameNode,
  createAtlasAssistantImageNode,
  createAtlasAssistantTextNode,
  createAtlasAssetNode,
  createAtlasClipboardTextNode,
  createAtlasMediaTransactions,
  importAtlasMediaBatch,
  readAtlasClipboard,
  type AtlasTransferContext,
} from "@/atlas-engine/workflows/media-transaction";
import {
  resumeAtlasVideoTask as resumeCanvasVideoTask,
  applyAtlasVideoResumeFailure,
  planAtlasVideoResume,
} from "@/atlas-engine/workflows/video-task";
import {
  CanvasNodePromptPanel,
  type CanvasNodeGenerationMode,
} from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-library-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { AtlasAgentPanel } from "@/atlas-engine/agent/AtlasAgentPanel";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAtlasDocumentState } from "@/atlas-engine/host/use-atlas-document-state";
import { planAtlasNodeDeletion } from "@/atlas-engine/interaction/node-actions";
import {
} from "@/atlas-engine/workflows/generation-output";
import {
  applyAtlasNodeOutputPlan,
  atlasNodeOutputConnection,
  atlasNodeOutputId,
  planAtlasNodeOutput,
} from "@/atlas-engine/workflows/node-output";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { useCanvasHistory } from "@/pages/canvas/hooks/use-canvas-history";
import { useCanvasDocument } from "@/pages/canvas/hooks/use-canvas-document";
import {
  createCanvasResourceIndex,
  type CanvasResourceReference,
} from "@/atlas-engine/model/resource-references";
import {
  atlasAudioMetadata as audioMetadata,
  createAtlasNode as createCanvasNode,
  atlasImageMetadata as imageMetadata,
  atlasVideoMetadata as videoMetadata,
} from "@/atlas-engine/model/node-factory";
import {
  applyAtlasGroupSelection as applyGroupSelection,
  applyAtlasUngroupSelection as applyUngroupSelection,
  canCanvasGroupSelection as canGroupSelectedNodes,
  canCanvasUngroupSelection as canUngroupSelectedNodes,
  canvasGroupMembers as collectGroupMemberNodes,
  canvasGroupFrame as getGroupWrapRect,
  canvasNodeBounds as nodeBounds,
  focusCanvasViewportForNode as focusViewportForNode,
} from "@/atlas-engine/interaction/canvas-group-adapter";
import {
  CONNECTION_HANDLE_HIT_RADIUS,
  CONNECTION_NODE_HIT_PADDING,
  findConnectionDropTarget as resolveConnectionDropTarget,
  normalizeProductConnection,
  type ConnectionDropTarget,
} from "@/atlas-engine/interaction/connections";
import {
  atlasAudioExtension as audioExtension,
  buildAtlasAngleLabel as buildAngleLabel,
  buildAtlasAnglePrompt as buildAnglePrompt,
  buildAtlasGenerationConfig as buildGenerationConfig,
  findAtlasRetrySourceNode as findRetrySourceNode,
  atlasGenerationReferenceUrls as generationReferenceUrls,
  atlasGenerationCount as getGenerationCount,
  atlasInputSummary as getInputSummary,
  hasAtlasResumableVideoTask as hasResumableVideoTask,
  atlasImageExtension as imageExtension,
  isAtlasAudioFile as isAudioFile,
  isAtlasGenerationCanceled as isGenerationCanceled,
  resolveAtlasMetadataReferences as resolveMetadataReferences,
  atlasSourceNodeReferenceImages as sourceNodeReferenceImages,
} from "@/atlas-engine/workflows/generation-runtime";
import {
  getAtlasNodeDefinition as getNodeDefinition,
  useAtlasNodeRegistryVersion as useNodeRegistryVersion,
} from "@/atlas-engine/model/node-registry";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import {
  ATLAS_COMPOSITION_NODE_TYPE as COMPOSITION_NODE_TYPE,
  atlasCompositionVideos as compositionVideos,
  createAtlasComposition as createComposition,
} from "@/atlas-engine/workflows/video-composition";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import {
  ConnectionCreateMenu,
  NodeCreateMenu,
  type PendingConnectionCreate,
} from "@/components/canvas/canvas-create-menus";
import {
  CanvasNodeType,
  type CanvasAssistantImage,
  type CanvasAssistantSession,
  type CanvasConnection,
  type CanvasNodeData,
  type CanvasNodeImage,
  type CanvasNodeTypeId,
  type ConnectionHandle,
  type ContextMenuState,
  type Position,
  type SelectionBox,
  type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

// Register built-in nodes in the shared registry once when the module loads.
registerBuiltinNodes();

const CanvasNodeAngleDialog = lazy(() =>
  import("@/components/canvas/canvas-node-angle-dialog").then(
    ({ CanvasNodeAngleDialog }) => ({ default: CanvasNodeAngleDialog }),
  ),
);
const CanvasNodeCropDialog = lazy(() =>
  import("@/components/canvas/canvas-node-crop-dialog").then(
    ({ CanvasNodeCropDialog }) => ({ default: CanvasNodeCropDialog }),
  ),
);
const CanvasNodeMaskEditDialog = lazy(() =>
  import("@/components/canvas/canvas-mask-workspace").then(
    ({ CanvasNodeMaskEditDialog }) => ({ default: CanvasNodeMaskEditDialog }),
  ),
);
const CanvasNodeSplitDialog = lazy(() =>
  import("@/components/canvas/canvas-node-split-dialog").then(
    ({ CanvasNodeSplitDialog }) => ({ default: CanvasNodeSplitDialog }),
  ),
);
const CanvasNodeUpscaleDialog = lazy(() =>
  import("@/components/canvas/canvas-node-upscale-dialog").then(
    ({ CanvasNodeUpscaleDialog }) => ({ default: CanvasNodeUpscaleDialog }),
  ),
);
const CanvasPluginManagerModal = lazy(() =>
  import("@/components/canvas/canvas-plugin-manager-modal").then(
    ({ CanvasPluginManagerModal }) => ({ default: CanvasPluginManagerModal }),
  ),
);
const AssetPickerModal = lazy(() =>
  import("@/components/canvas/asset-picker-modal").then(
    ({ AssetPickerModal }) => ({ default: AssetPickerModal }),
  ),
);

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
// Stable empty reference array prevents `... || []` from invalidating CanvasNode's React.memo on every render.
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

function applyGeneratedVideo(
  item: CanvasNodeData,
  video: UploadedFile,
  extra: CanvasNodeData["metadata"] = {},
): CanvasNodeData {
  const videoSize = fitNodeSize(
    video.width || item.width,
    video.height || item.height,
    VIDEO_NODE_MAX_WIDTH,
    VIDEO_NODE_MAX_HEIGHT,
  );
  return {
    ...item,
    width: videoSize.width,
    height: videoSize.height,
    position: {
      x: item.position.x + item.width / 2 - videoSize.width / 2,
      y: item.position.y + item.height / 2 - videoSize.height / 2,
    },
    metadata: { ...item.metadata, ...videoMetadata(video), ...extra },
  };
}

export default function CanvasPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <CanvasRefreshShell />;

  return <InfiniteCanvasPage />;
}

function CanvasDialogLoading({ label }: { label: string }) {
  return (
    <div
      className="fixed inset-0 z-[1190] grid place-items-center bg-black/20"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-md border bg-background px-4 py-3 text-sm shadow-xl">
        {label}
      </div>
    </div>
  );
}

function measureFocusFrame(container: HTMLDivElement | null, nodeId: string) {
  if (!container) return {};
  const nodeRect = container
    .querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
    ?.getBoundingClientRect();
  const panelRect = container
    .querySelector<HTMLElement>(`[data-node-id="${nodeId}"] [data-node-panel]`)
    ?.getBoundingClientRect();
  const toolbarRect = document
    .querySelector<HTMLElement>(`[data-node-toolbar="${nodeId}"]`)
    ?.getBoundingClientRect();
  const dockRect = document
    .querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")
    ?.getBoundingClientRect();
  const below = nodeRect && panelRect ? panelRect.bottom - nodeRect.bottom : 0;
  const above = nodeRect && toolbarRect ? nodeRect.top - toolbarRect.top : 0;
  return {
    above,
    below,
    bottomInset:
      dockRect && below > 0
        ? Math.max(0, container.getBoundingClientRect().bottom - dockRect.top)
        : 0,
  };
}

function InfiniteCanvasPage() {
  const { message, modal } = App.useApp();
  const openHostPanel = useCallback(
    (action: PlatformAction) => {
      void openPlatformAction(action).catch((error) =>
        message.error(
          error instanceof Error ? error.message : "页面暂时无法打开，请重试",
        ),
      );
    },
    [message],
  );
  const { t } = useTranslation();
  // Subscribe to the registry version so plugin registration changes rerender the canvas.
  const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = params.id || "";
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const projectLoaded = loadedProjectId === projectId;
  const localAgentConnected = useAgentStore((state) => state.connected);
  const localAgentActivity = useAgentStore((state) => state.activity);
  const localAgentEnabled = useAgentStore((state) => state.enabled);
  const fragmentBootstrap = useAgentStore((state) => state.fragmentBootstrap);
  const agentPanelOpen = useAgentStore((state) => state.panelOpen);
  const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
  const openAgentPanel = useAgentStore((state) => state.openPanel);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<{
    nodeId?: string;
    position?: Position;
  } | null>(null);
  const clipboardRef = useRef<CanvasFragment | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const boardInteractionRef = useRef<BoardInteractionState>(
    idleBoardInteraction(),
  );
  const gestureSequenceRef = useRef(0);
  const nodeDraggingRef = useRef(false);

  const config = useConfigStore((state) => state.config);
  const effectiveConfig = useEffectiveConfig();
  const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
  const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
  const addAsset = useAssetStore((state) => state.addAsset);
  const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
  const hydrated = useCanvasStore((state) => state.hydrated);
  const createProject = useCanvasStore((state) => state.createProject);
  const openProject = useCanvasStore((state) => state.openProject);
  const updateProject = useCanvasStore((state) => state.updateProject);
  const renameProject = useCanvasStore((state) => state.renameProject);
  const currentProject = useCanvasStore((state) =>
    state.projects.find((project) => project.id === projectId),
  );
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const {
    nodes,
    connections,
    viewport,
    selectedNodeIds,
    selectedConnectionId,
    dispatchAtlasCommands,
    setNodes,
    setConnections,
    setViewport,
    setSelectedNodeIds,
    setSelectedConnectionId,
  } = useAtlasDocumentState();
  const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>(
    [],
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [restoreRetrySequence, setRestoreRetrySequence] = useState(0);
  const [canvasTool, setCanvasTool] = useState<"select" | "pan">("pan");
  const [size, setSize] = useState({ width: 1200, height: 720 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [connectingParams, setConnectingParams] =
    useState<ConnectionHandle | null>(null);
  const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<
    string | null
  >(null);
  const [pendingConnectionCreate, setPendingConnectionCreate] =
    useState<PendingConnectionCreate | null>(null);
  const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(
    null,
  );
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
  const [backgroundMode, setBackgroundMode] =
    useState<CanvasBackgroundMode>("lines");
  const [showImageInfo, setShowImageInfo] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
  const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
  const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
  const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const {
    cropNodeId, setCropNodeId,
    maskEditNodeId, setMaskEditNodeId,
    splitNodeId, setSplitNodeId,
    upscaleNodeId, setUpscaleNodeId,
    superResolveNodeId, setSuperResolveNodeId,
    angleNodeId, setAngleNodeId,
  } = useAtlasNodeDialogs(projectId);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const [hoverPreviewNodeId, setHoverPreviewNodeId] = useState<string | null>(
    null,
  );
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [expandedBatchNodeIds, setExpandedBatchNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [isNodeResizing, setIsNodeResizing] = useState(false);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(
    null,
  );
  const [referencePickerNodeId, setReferencePickerNodeId] = useState<
    string | null
  >(null);

  const canvasHistory = useCanvasHistory({
    project: currentProject || null,
    projectLoaded,
    nodes,
    connections,
    chatSessions,
    activeChatId,
    backgroundMode,
    showImageInfo,
    setNodes,
    setConnections,
    setChatSessions,
    setActiveChatId,
    setBackgroundMode,
    setShowImageInfo,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
  });
  const historyRef = canvasHistory.stacksRef;
  const lastHistoryRef = canvasHistory.currentRef;
  const historyPausedRef = canvasHistory.pausedRef;
  const historyState = canvasHistory.state;
  const undoCanvas = canvasHistory.undo;
  const redoCanvas = canvasHistory.redo;

  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const viewportRef = useRef(viewport);
  const focusAnimRef = useRef<number | null>(null);
  const generateNodeRef = useRef<
    | ((
        nodeId: string,
        mode: CanvasNodeGenerationMode,
        prompt: string,
      ) => Promise<void>)
    | null
  >(null);
  const connectingParamsRef = useRef(connectingParams);
  const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
  const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
  const activeProjectIdRef = useRef(projectId);
  const [generationRequests] = useState(() => createAtlasGenerationCoordinator(
    () => ({ projectId: activeProjectIdRef.current, scopeId: getPlatformInit()?.scopeId }),
    isGenerationCanceled,
  ));
  const videoPollIdsRef = useRef(new Set<string>());

  const handleDocumentRestoreError = useCallback(
    (error: unknown) => {
      message.error(
        error instanceof Error ? error.message : "画布恢复失败，请刷新后重试",
      );
    },
    [message],
  );
  const documentRecovery = useCanvasDocument({
    projectId,
    projectLoaded,
    setLoadedProjectId,
    retrySequence: restoreRetrySequence,
    setRetrySequence: setRestoreRetrySequence,
    hydrated,
    openProject,
    navigate,
    updateProject,
    history: canvasHistory,
    viewportRef,
    nodes,
    connections,
    chatSessions,
    activeChatId,
    backgroundMode,
    showImageInfo,
    viewport,
    setNodes,
    setConnections,
    setChatSessions,
    setActiveChatId,
    setBackgroundMode,
    setShowImageInfo,
    setViewport,
    onRestoreError: handleDocumentRestoreError,
  });

  useLayoutEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    const polling = videoPollIdsRef.current;
    return () => {
      generationRequests.cancelAll();
      polling.clear();
    };
  }, [generationRequests, projectId]);

  useEffect(() => {
    if (!projectLoaded) return;
    const init = getPlatformInit();
    const receive = (event: MessageEvent) => {
      if (
        event.source !== parent ||
        event.origin !== location.origin ||
        event.data?.type !== "frameflow:command" ||
        event.data.scopeId !== getPlatformInit()?.scopeId ||
        getPlatformInit()?.project.id !== projectId
      )
        return;
      const payload = event.data.payload || {};
      if (event.data.command === "openConfig") {
        useConfigStore.getState().openConfigDialog(false, "channels");
        return;
      }
      if (event.data.command === "rename") {
        const title =
          typeof payload.title === "string"
            ? payload.title.trim().slice(0, 200)
            : "";
        if (
          title &&
          useCanvasStore.getState().openProject(projectId)?.title !== title
        )
          renameProject(projectId, title);
        return;
      }
      if (
        event.data.command !== "insert" &&
        event.data.command !== "skill" &&
        event.data.command !== "storyWorkflow"
      )
        return;
      const view = viewportRef.current;
      const container = containerRef.current;
      const position = {
        x: ((container?.clientWidth || 800) / 2 - view.x) / view.k,
        y: ((container?.clientHeight || 600) / 2 - view.y) / view.k,
      };
      if (event.data.command === "storyWorkflow") {
        const respond = (
          ok: boolean,
          result?: {
            applied: boolean;
            duplicate?: boolean;
            warnings?: string[];
          },
          reason?: string,
        ) =>
          parent.postMessage(
            {
              type: "frameflow:command-response",
              scopeId: event.data.scopeId,
              id: event.data.id,
              command: "storyWorkflow",
              ok,
              result,
              error: reason ? { message: reason } : undefined,
            },
            location.origin,
          );
        try {
          if (
            typeof event.data.id !== "string" ||
            !event.data.id ||
            event.data.id.length > 128
          )
            throw new Error("连续分镜命令缺少有效请求标识");
          const current = getPlatformInit();
          if (!current || current.project.id !== projectId)
            throw platformAbortError();
          const imported = createStoryWorkflowImport(
            payload,
            nodesRef.current,
            current.models,
            position,
          );
          if (!imported.duplicate) {
            const nextNodes = [...nodesRef.current, ...imported.nodes];
            const nextConnections = [
              ...connectionsRef.current,
              ...imported.connections,
            ];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
          }
          const selected = new Set(imported.selectedIds);
          selectedNodeIdsRef.current = selected;
          setSelectedNodeIds(selected);
          setSelectedConnectionId(null);
          setDialogNodeId(null);
          const focus = nodesRef.current.find(
            (node) =>
              selected.has(node.id) &&
              node.metadata?.storyWorkflow?.role === "storyboard",
          );
          if (focus && container) {
            const nextView = focusViewportForNode(focus, {
              width: container.clientWidth,
              height: container.clientHeight,
            });
            viewportRef.current = nextView;
            setViewport(nextView);
          }
          if (imported.duplicate)
            message.info("这段分镜已应用到画布，已选中现有节点");
          else if (imported.warnings.length)
            message.warning(imported.warnings.join(" "));
          else
            message.success(
              "剧本、完整15秒分镜与素材生图配置已加入画布，确认参数后再生成",
            );
          respond(true, {
            applied: true,
            duplicate: imported.duplicate,
            warnings: imported.warnings,
          });
        } catch (cause) {
          const reason =
            cause instanceof Error
              ? cause.message
              : "连续分镜应用失败，现有画布已保留";
          message.error(reason);
          respond(false, { applied: false }, reason);
        }
        return;
      }
      const isSkill = event.data.command === "skill";
      const source =
        isSkill && payload.requiresReference
          ? nodesRef.current.find(
              (item) =>
                selectedNodeIdsRef.current.has(item.id) &&
                item.type === CanvasNodeType.Image,
            )
          : undefined;
      const prompt = source
        ? textVideoPrompt(source.id, canvasSkillPrompt(payload))
        : canvasSkillPrompt(payload);
      const videoModel =
        isSkill && payload.kind === "video"
          ? selectVideoModel(
              getPlatformInit()?.models.video || [],
              payload.defaults?.model,
              undefined,
              payload.requiresReference,
            )
          : undefined;
      const imageModel =
        isSkill && payload.kind === "image"
          ? selectImageModel(
              getPlatformInit()?.models.image || [],
              payload.defaults?.model,
              useConfigStore.getState().config.imageModel,
              payload.requiresReference,
            )
          : undefined;
      if (isSkill && payload.kind === "video" && !videoModel) {
        message.warning("暂无可用的视频通道，请先在我的账号池接入账号");
        return;
      }
      if (isSkill && payload.kind === "image" && !imageModel) {
        message.warning("暂无可用的图像通道，请先在创作设置或账号池接入");
        return;
      }
      const node = createCanvasNode(
        isSkill
          ? CanvasNodeType.Config
          : payload.kind === "video"
            ? CanvasNodeType.Video
            : CanvasNodeType.Image,
        position,
        {
          content:
            typeof payload.url === "string" &&
            /^\/api\/assets\/[a-zA-Z0-9-]+\/content$/.test(payload.url)
              ? payload.url
              : "",
          prompt,
          composerContent: prompt,
          status: payload.url ? "success" : "idle",
          generationMode: payload.kind === "video" ? "video" : "image",
          model: imageModel
            ? `platform::${imageModel.id}`
            : payload.defaults?.model,
          skillId: payload.defaults?.skillId,
          skillVersion: payload.defaults?.skillVersion,
          ...(Number.isInteger(payload.defaults?.width) &&
          Number.isInteger(payload.defaults?.height)
            ? { size: `${payload.defaults.width}x${payload.defaults.height}` }
            : {}),
          ...(Number.isInteger(payload.defaults?.duration)
            ? { seconds: String(payload.defaults.duration) }
            : {}),
          ...(videoModel
            ? videoSkillMetadata(
                { ...payload, defaults: payload.defaults || {} },
                videoModel,
                source?.id,
              )
            : {}),
        },
      );
      if (typeof payload.title === "string") node.title = payload.title;
      if (source) {
        node.position = {
          x: source.position.x + source.width + 100,
          y: source.position.y,
        };
        const nextConnections = [
          ...connectionsRef.current,
          { id: crypto.randomUUID(), fromNodeId: source.id, toNodeId: node.id },
        ];
        connectionsRef.current = nextConnections;
        setConnections(nextConnections);
      }
      const nextNodes = [...nodesRef.current, node];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setSelectedNodeIds(new Set([node.id]));
      if (isSkill) {
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        if (payload.requiresReference && !source)
          message.info("请连接参考图片，在参数面板确认后再生成");
      }
    };
    window.addEventListener("message", receive);
    parent.postMessage(
      { type: "frameflow:mounted", scopeId: init?.scopeId },
      location.origin,
    );
    return () => window.removeEventListener("message", receive);
  }, [message, projectId, projectLoaded, renameProject]);

  const cleanupCanvasFiles = useCallback(
    (extra?: unknown) => {
      cleanupAssetImages({
        extra,
        history: historyRef.current,
        lastHistory: lastHistoryRef.current,
      });
    },
    [cleanupAssetImages],
  );

  const startGenerationRequest = useCallback(
    (
      targetNodeId: string,
      originNodeId: string,
      runningId = originNodeId,
      controller = new AbortController(),
    ) => {
      return generationRequests.begin(
        targetNodeId,
        originNodeId,
        runningId,
        controller,
      );
    },
    [generationRequests],
  );

  const finishGenerationRequest = useCallback(
    (targetNodeId: string, controller: AbortController) => {
      return generationRequests.finish(targetNodeId, controller);
    },
    [generationRequests],
  );

  const setNodesForGeneration = useCallback(
    (
      nodeId: string,
      controller: AbortController,
      update: (nodes: CanvasNodeData[]) => CanvasNodeData[],
    ) => setNodes(generationRequests.guard(nodeId, controller, update)),
    [generationRequests],
  );

  const completeVideoNodeTask = useCallback(
    async (
      nodeId: string,
      config: Parameters<typeof buildGenerationConfig>[0],
      prompt: string,
      images: NonNullable<Parameters<typeof createVideoGenerationTask>[2]>,
      signal: AbortSignal,
      controller: AbortController,
      extra: CanvasNodeData["metadata"] = {},
      videos: ReferenceVideo[] = [],
      audios: ReferenceAudio[] = [],
    ) =>
      completeCanvasVideoGeneration({
        ports: {
          createTask: createVideoGenerationTask,
          waitForTask: waitForVideoGenerationTask,
          storeVideo: storeGeneratedVideo,
          getProjectId: () => getPlatformInit()?.project.id,
          writeNode: setNodesForGeneration,
          applyVideo: applyGeneratedVideo,
        },
        nodeId,
        config,
        prompt,
        images,
        signal,
        controller,
        metadata: extra,
        videos,
        audios,
      }),
    [setNodesForGeneration],
  );

  const pollVideoNodeTask = useCallback(
    async (candidate: CanvasNodeData, silent = false) => {
      const node = nodesRef.current.find((item) => item.id === candidate.id);
      const config = buildGenerationConfig(effectiveConfig, node, "video");
      const pollKey = atlasGenerationScopeKey({ projectId: activeProjectIdRef.current, scopeId: getPlatformInit()?.scopeId }, candidate.id);
      const plan = planAtlasVideoResume(node, config.model, isAiConfigReady(config, config.model),
        generationRequests.has(candidate.id) || videoPollIdsRef.current.has(pollKey));
      if (plan.kind === "skip") return;
      if (plan.kind === "configure") {
        if (silent)
          setNodes((current) => patchAtlasGenerationMetadata(current, candidate.id, { status: "error", errorDetails: t("workbench.configFirst") }));
        else openConfigDialog(true);
        return;
      }
      videoPollIdsRef.current.add(pollKey);
      try {
        await generationRequests.run({
          nodeId: candidate.id,
          start: ({ controller }) => {
            setRunningNodeId(candidate.id);
            setNodesForGeneration(candidate.id, controller, (current) =>
              patchAtlasGenerationMetadata(current, candidate.id, { status: "loading", errorDetails: undefined }),
            );
          },
          prepare: async () => plan,
          execute: async (resume, lease) => {
            const ownsTask = (nodeId: string, controller: AbortController) =>
              generationRequests.canWrite(nodeId, controller) &&
              nodesRef.current.find((item) => item.id === nodeId)?.metadata?.videoTaskId === resume.task.id;
            await resumeCanvasVideoTask({
              node: resume.node,
              task: resume.task,
              config,
              controller: lease.controller,
              ports: {
                waitForTask: waitForVideoGenerationTask,
                storeVideo: storeGeneratedVideo,
                ownsNode: ownsTask,
                updateNode: (nodeId, controller, update) => setNodesForGeneration(nodeId, controller,
                  (current) => current.find((item) => item.id === nodeId)?.metadata?.videoTaskId === resume.task.id ? update(current) : current),
                createCompletedNode: applyGeneratedVideo,
              },
            });
          },
          failed: (error, { controller }) => {
            const details = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
            message.error(details);
            setNodesForGeneration(candidate.id, controller, (current) =>
              applyAtlasVideoResumeFailure(current, candidate.id, plan.task.id, details, isVideoTaskFailed(error)),
            );
          },
          settled: (_lease, latest) => {
            if (latest) setRunningNodeId((current) => current === candidate.id ? null : current);
          },
        });
      } finally {
        videoPollIdsRef.current.delete(pollKey);
      }
    },
    [effectiveConfig, generationRequests, isAiConfigReady, message, openConfigDialog, setNodesForGeneration, t],
  );

  const stopGenerationByRunningId = useCallback(
    (runningId: string) => {
      const affectedNodeIds = generationRequests.cancelRunning(runningId);
      setRunningNodeId((current) => (current === runningId ? null : current));
      if (!affectedNodeIds.size) return;
      setNodes((current) => cancelAtlasGenerationNodes(current, affectedNodeIds, t("common.requestCanceled")));
    },
    [generationRequests, t],
  );

  const confirmStopGeneration = useCallback(
    (nodeId: string) => {
      modal.confirm({
        title: t("canvas.projectPage.stopTitle"),
        content: t("canvas.projectPage.stopDescription"),
        okText: t("canvas.projectPage.stop"),
        cancelText: t("canvas.projectPage.continue"),
        okButtonProps: { danger: true },
        onOk: () => stopGenerationByRunningId(nodeId),
      });
    },
    [modal, stopGenerationByRunningId, t],
  );

  useEffect(() => {
    if (!projectLoaded) return;
    nodesRef.current
      .filter(hasResumableVideoTask)
      .forEach((node) => void pollVideoNodeTask(node, true));
    // Resume once after the current canvas is restored, not on later config identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLoaded]);

  useEffect(() => {
    if (
      !projectLoaded ||
      !["new", "recent", "choose"].includes(searchParams.get("mode") || "")
    )
      return;
    if (
      !searchParams.has("agentUrl") &&
      !localAgentEnabled &&
      !fragmentBootstrap
    )
      openAgentPanel();
  }, [
    fragmentBootstrap,
    localAgentEnabled,
    openAgentPanel,
    projectLoaded,
    searchParams,
  ]);

  useEffect(() => {
    if (!dialogNodeId) setNodeImageSettingsOpen(false);
  }, [dialogNodeId]);

  useLayoutEffect(() => {
    nodesRef.current = nodes;
    connectionsRef.current = connections;
    selectedNodeIdsRef.current = selectedNodeIds;
    viewportRef.current = viewport;
    connectingParamsRef.current = connectingParams;
    connectionTargetNodeIdRef.current = connectionTargetNodeId;
    pendingConnectionCreateRef.current = pendingConnectionCreate;
  }, [
    nodes,
    connections,
    selectedNodeIds,
    viewport,
    connectingParams,
    connectionTargetNodeId,
    pendingConnectionCreate,
  ]);

  useEffect(() => {
    if (!projectLoaded) return;
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [projectLoaded]);

  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return clientPointToCanvas(
      { x: clientX, y: clientY },
      { left: rect?.left ?? 0, top: rect?.top ?? 0 },
      viewportRef.current,
    );
  }, []);

  const getCanvasCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return canvasCenterInWorld(
      { left: rect?.left ?? 0, top: rect?.top ?? 0 },
      { width: rect?.width || size.width, height: rect?.height || size.height },
      viewportRef.current,
    );
  }, [size.height, size.width]);

  const setConnecting = useCallback((next: ConnectionHandle | null) => {
    connectingParamsRef.current = next;
    setConnectingParams(next);
    if (!next) {
      connectionTargetNodeIdRef.current = null;
      setConnectionTargetNodeId(null);
    }
  }, []);

  const keepNodeToolbar = useCallback(
    (nodeId: string) => {
      if (
        nodeDraggingRef.current ||
        nodeImageSettingsOpen ||
        !selectedNodeIdsRef.current.has(nodeId)
      )
        return;
      setToolbarNodeId(nodeId);
    },
    [nodeImageSettingsOpen],
  );

  const hideNodeToolbar = useCallback(() => {}, []);

  const connectNodes = useCallback(
    (current: ConnectionHandle, targetNodeId: string) => {
      if (current.nodeId === targetNodeId) return;

      const connection = normalizeProductConnection(
        current.nodeId,
        targetNodeId,
        nodesRef.current,
        current.handleType,
      );
      if (!connection) {
        message.warning(t("canvas.projectPage.configConnection"));
        return;
      }
      const { fromNodeId, toNodeId } = connection;
      const exists = connectionsRef.current.some(
        (conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId,
      );
      if (!exists) {
        setConnections((prev) => [
          ...prev,
          { id: `conn-${Date.now()}`, fromNodeId, toNodeId },
        ]);
      }
      setContextMenu(null);
    },
    [message, t],
  );

  const createConnectedNode = useCallback(
    (
      type:
        | CanvasNodeType.Image
        | CanvasNodeType.Text
        | CanvasNodeType.Config
        | CanvasNodeType.Video
        | CanvasNodeType.Audio,
      pending: PendingConnectionCreate,
    ) => {
      const metadata =
        type === CanvasNodeType.Config
          ? {
              model: effectiveConfig.imageModel,
              size: effectiveConfig.size,
              count: getGenerationCount(
                effectiveConfig.canvasImageCount || effectiveConfig.count,
              ),
            }
          : undefined;
      const plan = planAtlasConnectedNode(
        type,
        pending.position,
        pending.connection,
        metadata,
        nodesRef.current,
      );
      if (!plan) {
        message.warning(t("canvas.projectPage.configConnection"));
        return;
      }
      dispatchAtlasCommands(plan.commands);
      if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio)
        setDialogNodeId(plan.nodes[0].id);
      setPendingConnectionCreate(null);
      setConnecting(null);
    },
    [
      effectiveConfig.canvasImageCount,
      effectiveConfig.count,
      effectiveConfig.imageModel,
      effectiveConfig.model,
      effectiveConfig.size,
      dispatchAtlasCommands,
      message,
      setConnecting,
      t,
    ],
  );

  const cancelPendingConnectionCreate = useCallback(() => {
    setPendingConnectionCreate(null);
    setConnecting(null);
  }, [setConnecting]);

  const getConnectionDropTarget = useCallback(
    (
      clientX: number,
      clientY: number,
      current: ConnectionHandle,
    ): ConnectionDropTarget => {
      const world = screenToCanvas(clientX, clientY);
      return resolveConnectionDropTarget(
        world,
        viewportRef.current.k,
        current,
        nodesRef.current,
        CONNECTION_NODE_HIT_PADDING,
        CONNECTION_HANDLE_HIT_RADIUS,
      );
    },
    [screenToCanvas],
  );

  const nodeById = useMemo(() => indexCanvasNodes(nodes), [nodes]);
  const viewIndex = useMemo(
    () => createCanvasViewIndex(nodes, connections, nodeById),
    [connections, nodeById, nodes],
  );
  const viewBounds = useMemo(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width || size.width;
    const height = rect?.height || size.height;
    return canvasViewBounds(viewport, { width, height });
    // `nodes` keeps the container rect re-read on node changes, matching the previous behaviour when the container resizes without a size update.
  }, [nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

  const visibleNodes = useMemo(
    // Keep the open panel mounted so focus can measure it before moving an offscreen node into view.
    () => selectVisibleNodes(nodes, viewBounds, dialogNodeId, viewIndex),
    [dialogNodeId, nodes, viewBounds, viewIndex],
  );

  const visibleConnections = useMemo(
    () =>
      selectVisibleConnections(connections, nodeById, viewBounds, viewIndex),
    [connections, nodeById, viewBounds, viewIndex],
  );
  // The toolbar follows a single selected node selected by click, creation, marquee, or keyboard.
  // It stays hidden for multi-selection and while isNodeDragging is true.
  const singleSelectedNodeId =
    selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
  const toolbarNode =
    (toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null) ||
    (singleSelectedNodeId ? nodeById.get(singleSelectedNodeId) || null : null);
  const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
  const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
  const maskEditNode = maskEditNodeId
    ? nodeById.get(maskEditNodeId) || null
    : null;
  const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
  const upscaleNode = upscaleNodeId
    ? nodeById.get(upscaleNodeId) || null
    : null;
  const superResolveNode = superResolveNodeId
    ? nodeById.get(superResolveNodeId) || null
    : null;
  const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
  const contextMenuNode =
    contextMenu?.type === "node"
      ? nodeById.get(contextMenu.nodeId) || null
      : null;
  const previewNode = previewNodeId
    ? nodeById.get(previewNodeId) || null
    : null;
  const previewContent = previewImageId
    ? previewNode?.metadata?.images?.find(
        (image) => image.id === previewImageId,
      )?.content
    : previewNode?.metadata?.content;
  const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
  const selectedNodes = useMemo(
    () => nodes.filter((node) => selectedNodeIds.has(node.id)),
    [nodes, selectedNodeIds],
  );
  const canMergeVideos = compositionVideos(selectedNodes).length >= 2;
  const canGroupSelection = canGroupSelectedNodes(selectedNodeIds, nodes);
  const canUngroupSelection = canUngroupSelectedNodes(selectedNodeIds, nodes);
  const activeNodeId = hasMultipleSelectedNodes
    ? null
    : hoveredNodeId ||
      (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
  const groupChildCountById = useMemo(
    () => countCanvasGroupChildren(nodes),
    [nodes],
  );
  const relatedHighlight = useMemo(
    () => relatedCanvasElements(activeNodeId, nodes, connections, nodeById),
    [activeNodeId, connections, nodeById, nodes],
  );
  const resourceIndex = useMemo(
    () => createCanvasResourceIndex(nodes, connections),
    [connections, nodes],
  );

  const configInputsById = useMemo(() => {
    const map = new Map<string, NodeGenerationInput[]>();
    nodes.forEach((node) => {
      if (node.type !== CanvasNodeType.Config) return;
      map.set(
        node.id,
        buildNodeGenerationInputs(node.id, nodes, connections, resourceIndex),
      );
    });
    return map;
  }, [nodes, resourceIndex]);
  const mentionReferencesByNodeId = useMemo(() => {
    const map = new Map<string, CanvasResourceReference[]>();
    nodes.forEach((node) => {
      map.set(node.id, resourceIndex.buildNodeMentionReferences(node.id));
    });
    return map;
  }, [nodes, resourceIndex]);
  const connectedNodesByNodeId = useMemo(
    () => connectedSourcesByTarget(connections, nodeById),
    [connections, nodeById],
  );
  const referenceConnectedNodeIds = useMemo(
    () =>
      new Set(
        [
          referencePickerNodeId,
          ...(referencePickerNodeId
            ? connectedNodesByNodeId
                .get(referencePickerNodeId)
                ?.flatMap((node) =>
                  node.type === CanvasNodeType.Group
                    ? [
                        node.id,
                        ...resourceIndex
                          .getGroupResourceNodes(node.id)
                          .map((child) => child.id),
                      ]
                    : [node.id],
                ) || []
            : []),
        ].filter((id): id is string => Boolean(id)),
      ),
    [connectedNodesByNodeId, nodes, referencePickerNodeId, resourceIndex],
  );
  const { applyAgentOps } = useAgentBridge({
    projectId,
    title: currentProject?.title,
    nodes,
    connections,
    selectedNodeIds,
    viewport,
    nodesRef,
    connectionsRef,
    selectedNodeIdsRef,
    viewportRef,
    generateNodeRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setViewport,
    setContextMenu,
  });

  const { pluginHost, renderPluginPanel, buildNodeToolbarItems } =
    usePluginHost({
      effectiveConfig,
      isAiConfigReady,
      openConfigDialog,
      theme,
      nodesRef,
      connectionsRef,
      viewportRef,
      setNodes,
      setDialogNodeId,
      applyAgentOps,
    });
  const createNode = useCallback(
    (type: CanvasNodeTypeId, position?: Position) => {
      const targetPosition = position || getCanvasCenter();
      const configMetadata =
        type === CanvasNodeType.Config
          ? {
              model: effectiveConfig.imageModel,
              size: effectiveConfig.size,
              count: getGenerationCount(
                effectiveConfig.canvasImageCount || effectiveConfig.count,
              ),
            }
          : undefined;
      const newNode = createCanvasNode(type, targetPosition, configMetadata);

      dispatchAtlasCommands(planAtlasNodeInsertion([newNode]));
      if (atlasNodeCreationOpensPanel(type, getNodeDefinition(type)))
        setDialogNodeId(newNode.id);
    },
    [
      effectiveConfig.canvasImageCount,
      effectiveConfig.count,
      effectiveConfig.imageModel,
      effectiveConfig.model,
      effectiveConfig.size,
      getCanvasCenter,
      dispatchAtlasCommands,
    ],
  );

  const deleteNodes = useCallback(
    (ids: Set<string>) => {
      if (!ids.size) return;
      const allIds = new Set(ids);
      const cancelledIds = generationRequests.cancelNodes(allIds);
      setRunningNodeId((current) =>
        current && cancelledIds.has(current) ? null : current,
      );
      dispatchAtlasCommands(planAtlasNodeDeletion(allIds));
      setHoveredNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setToolbarNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setDialogNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setInfoNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setCropNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setMaskEditNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setAngleNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setPreviewNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setRunningNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setReferencePickerNodeId((current) =>
        current && allIds.has(current) ? null : current,
      );
      setExpandedBatchNodeIds(
        (current) =>
          new Set([...current].filter((nodeId) => !allIds.has(nodeId))),
      );
      setContextMenu((current) =>
        current?.type === "node" && allIds.has(current.nodeId) ? null : current,
      );
      cleanupCanvasFiles({
        projectId,
        nodes: nodesRef.current.filter((node) => !allIds.has(node.id)),
        chatSessions,
      });
    },
    [chatSessions, cleanupCanvasFiles, generationRequests, projectId],
  );

  const mergeVideoSelection = useCallback(() => {
    const selected = compositionVideos(
      nodesRef.current.filter((node) =>
        selectedNodeIdsRef.current.has(node.id),
      ),
    );
    if (selected.length < 2) return;
    const bounds = nodeBounds(selected);
    const created = createCanvasNode(
      COMPOSITION_NODE_TYPE,
      { x: bounds.right + 340, y: (bounds.top + bounds.bottom) / 2 },
      { composition: createComposition(selected), status: NODE_STATUS_SUCCESS },
    );
    setNodes((previous) => [...previous, created]);
    setConnections((previous) => [
      ...previous,
      ...selected.map((node) => ({
        id: nanoid(),
        fromNodeId: node.id,
        toNodeId: created.id,
      })),
    ]);
    setSelectedNodeIds(new Set([created.id]));
    setSelectedConnectionId(null);
    setToolbarNodeId(created.id);
    setDialogNodeId(null);
    setContextMenu(null);
  }, []);

  const groupSelection = useCallback(() => {
    const selectedIds = selectedNodeIdsRef.current;
    const members = collectGroupMemberNodes(selectedIds, nodesRef.current);
    if (members.length < 2) return;
    const rect = getGroupWrapRect(members);
    const created = createCanvasNode(CanvasNodeType.Group, {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    });
    const result = applyGroupSelection(
      selectedIds,
      nodesRef.current,
      connectionsRef.current,
      {
        ...created,
        position: { x: rect.x, y: rect.y },
        width: rect.width,
        height: rect.height,
      },
    );
    if (!result) return;
    setNodes(result.nodes);
    setConnections(result.connections);
    setSelectedNodeIds(new Set(result.selectedIds));
    setSelectedConnectionId(null);
    setToolbarNodeId(result.selectedIds[0] || null);
    setDialogNodeId(null);
    setContextMenu(null);
  }, []);

  const ungroupSelection = useCallback((ids?: Set<string>) => {
    const result = applyUngroupSelection(
      ids || selectedNodeIdsRef.current,
      nodesRef.current,
      connectionsRef.current,
    );
    if (!result) return;
    setNodes(result.nodes);
    setConnections(result.connections);
    setSelectedNodeIds(new Set(result.selectedIds));
    setSelectedConnectionId(null);
    setToolbarNodeId(
      result.selectedIds.length === 1 ? result.selectedIds[0] : null,
    );
    setDialogNodeId(null);
    setContextMenu(null);
  }, []);

  const deleteConnection = useCallback((connectionId: string) => {
    dispatchAtlasCommands(planAtlasConnectionRemoval(connectionId));
    setContextMenu((current) =>
      current?.type === "connection" && current.connectionId === connectionId
        ? null
        : current,
    );
  }, [dispatchAtlasCommands]);

  const disconnectNodeReference = useCallback(
    (fromNodeId: string, toNodeId: string) => {
      dispatchAtlasCommands(planAtlasReferenceDisconnect(
        connectionsRef.current,
        fromNodeId,
        toNodeId,
      ));
    },
    [dispatchAtlasCommands],
  );

  const startNodeReferenceSelection = useCallback((nodeId: string) => {
    setReferencePickerNodeId(nodeId);
    setSelectedNodeIds(new Set([nodeId]));
    setSelectedConnectionId(null);
    setDialogNodeId(null);
  }, []);

  const exitNodeReferenceSelection = useCallback(() => {
    if (!referencePickerNodeId) return;
    setSelectedNodeIds(new Set([referencePickerNodeId]));
    setDialogNodeId(referencePickerNodeId);
    setReferencePickerNodeId(null);
  }, [referencePickerNodeId]);

  const selectNodeReference = useCallback(
    (fromNodeId: string) => {
      if (!referencePickerNodeId || referenceConnectedNodeIds.has(fromNodeId))
        return;
      const source = nodesRef.current.find((node) => node.id === fromNodeId);
      if (!source || !resourceIndex.isReferenceNode(source)) return;
      setConnections((prev) => [
        ...prev,
        { id: nanoid(), fromNodeId, toNodeId: referencePickerNodeId },
      ]);
    },
    [referenceConnectedNodeIds, referencePickerNodeId, resourceIndex],
  );

  useEffect(() => {
    if (!referencePickerNodeId) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exitNodeReferenceSelection();
    };
    window.addEventListener("keydown", exit, true);
    return () => window.removeEventListener("keydown", exit, true);
  }, [exitNodeReferenceSelection, referencePickerNodeId]);

  const deselectCanvas = useCallback(() => {
    cancelPendingConnectionCreate();
    setSelectedNodeIds(new Set());
    setSelectedConnectionId(null);
    setContextMenu(null);
    setSelectionBox(null);
    setHoveredNodeId(null);
    setToolbarNodeId(null);
    setDialogNodeId(null);
  }, [cancelPendingConnectionCreate]);

  const clearCanvas = useCallback(() => {
    generationRequests.cancelAll();
    setNodes([]);
    setConnections([]);
    setInfoNodeId(null);
    setCropNodeId(null);
    setMaskEditNodeId(null);
    setAngleNodeId(null);
    setPreviewNodeId(null);
    setRunningNodeId(null);
    deselectCanvas();
    setClearConfirmOpen(false);
    cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
  }, [cleanupCanvasFiles, deselectCanvas, generationRequests, projectId]);

  const duplicateNode = useCallback((nodeId: string) => {
    const plan = planAtlasFragmentClone(
      nodesRef.current,
      connectionsRef.current,
      new Set([nodeId]),
      { offset: { x: 36, y: 36 }, preserveExternalGroups: true },
    );
    if (!plan) return;
    dispatchAtlasCommands(plan.commands);
    const primary = plan.nodes.find((node) => node.type !== CanvasNodeType.Group);
    setDialogNodeId(
      plan.nodes[0]?.type === CanvasNodeType.Group ? null : primary?.id || null,
    );
  }, [dispatchAtlasCommands]);

  const copySelectedNodes = useCallback(() => {
    const fragment = captureCanvasFragment(
      nodesRef.current,
      connectionsRef.current,
      selectedNodeIdsRef.current,
    );
    clipboardRef.current = fragment || clipboardRef.current;
  }, []);

  const pasteCopiedNodes = useCallback(() => {
    const fragment = clipboardRef.current;
    if (!fragment) return false;
    const plan = planAtlasFragmentInsertion(fragment, nodesRef.current, getCanvasCenter());
    if (!plan) return false;
    dispatchAtlasCommands(plan.commands);
    setContextMenu(null);
    setDialogNodeId(
      plan.nodes[0]?.type === CanvasNodeType.Group
        ? null
        : plan.nodes[0]?.id || null,
    );
    return true;
  }, [dispatchAtlasCommands, getCanvasCenter]);

  const resetViewport = useCallback(() => {
    setViewport(centeredCanvasViewport(size));
    setContextMenu(null);
  }, [size.height, size.width]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node) return;
      setHoverPreviewNodeId(null);
      const target = focusViewportForNode(
        node,
        size,
        measureFocusFrame(containerRef.current, nodeId),
      );
      setSelectedNodeIds(new Set([nodeId]));
      setSelectedConnectionId(null);
      setContextMenu(null);

      if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
      const start = { ...viewportRef.current };
      const duration = 450;
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      let startTime: number | null = null;
      const step = (now: number) => {
        if (startTime === null) startTime = now;
        const progress = Math.min((now - startTime) / duration, 1);
        const t = easeOutCubic(progress);
        setViewport({
          x: start.x + (target.x - start.x) * t,
          y: start.y + (target.y - start.y) * t,
          k: start.k + (target.k - start.k) * t,
        });
        focusAnimRef.current =
          progress < 1 ? requestAnimationFrame(step) : null;
      };
      focusAnimRef.current = requestAnimationFrame(step);
    },
    [size.height, size.width],
  );

  const focusNodeRef = useRef(focusNode);
  useEffect(() => {
    focusNodeRef.current = focusNode;
  }, [focusNode]);

  const focusSelectedNode = useCallback(() => {
    const nodeId = selectedNodeIdsRef.current.values().next().value;
    if (nodeId) focusNode(nodeId);
  }, [focusNode]);

  const tidyLayout = useCallback(() => {
    const next = tidyCanvasNodes(
      nodesRef.current,
      connectionsRef.current,
      selectedNodeIdsRef.current,
    );
    if (next === nodesRef.current) return;
    nodesRef.current = next;
    // Use the normal node state path so the existing canvas history records
    // this as an undoable edit and document synchronization persists it.
    setNodes(next);
    setContextMenu(null);
  }, []);

  useEffect(
    () => () =>
      void (focusAnimRef.current && cancelAnimationFrame(focusAnimRef.current)),
    [],
  );

  const setZoomScale = useCallback(
    (scale: number) => {
      setViewport((prev) => zoomCanvasToScale(prev, size, scale));
      setContextMenu(null);
    },
    [size.height, size.width],
  );

  const createAndOpenProject = useCallback(() => {
    const id = createProject(
      t("canvas.defaultTitle", {
        count: useCanvasStore.getState().projects.length + 1,
      }),
    );
    navigate(`/canvas/${id}`);
  }, [createProject, navigate, t]);

  const exportCurrentProject = useCallback(async () => {
    const project = useCanvasStore
      .getState()
      .projects.find((item) => item.id === projectId);
    if (!project) return message.error(t("canvas.projectPage.notFound"));
    const hide = message.loading(t("canvas.projectPage.exporting"), 0);
    try {
      const { exportAtlasProjects } =
        await import("@/atlas-engine/workflows/project-export");
      await exportAtlasProjects([project], project.title || t("canvas.title"));
      message.success(t("canvas.projectPage.exported"));
    } catch (error) {
      console.error(error);
      message.error(t("canvas.sidePanel.exportFailed"));
    } finally {
      hide();
    }
  }, [message, projectId, t]);

  const {
    beginMarqueeSelection,
    handleNodeMouseDown,
    handleNodeSelectCapture,
    selectNodeByEvent,
    selectionGestureRef,
  } = useAtlasNodeSelection({
    nodesRef,
    selectedNodeIdsRef,
    boardInteractionRef,
    gestureSequenceRef,
    historyPausedRef,
    nodeDraggingRef,
    setSelectedNodeIds,
    setToolbarNodeId,
    setSelectedConnectionId,
    setSelectionBox,
    setContextMenu,
    setHoveredNodeId,
    setIsNodeDragging,
  });

  const handleCanvasMouseDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setContextMenu(null);
      setNodeCreatePosition(null);
      setHoveredNodeId(null);
      setToolbarNodeId(null);
      setDialogNodeId(null);
      if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
      if (event.button !== 0) return;
      beginMarqueeSelection(
        screenToCanvas(event.clientX, event.clientY),
        event.shiftKey,
        event.pointerId,
      );
    },
    [beginMarqueeSelection, cancelPendingConnectionCreate, screenToCanvas],
  );

  useAtlasBoardGestures({
    nodesRef,
    selectedNodeIdsRef,
    viewportRef,
    boardRef: boardInteractionRef,
    historyPausedRef,
    nodeDraggingRef,
    selectionGestureRef,
    previewFrameRef,
    connectingRef: connectingParamsRef,
    connectionTargetRef: connectionTargetNodeIdRef,
    pendingConnectionRef: pendingConnectionCreateRef,
    screenToCanvas,
    getConnectionDropTarget,
    connectNodes,
    focusNode: (nodeId) => focusNodeRef.current(nodeId),
    autoFocusOnSelect: () => useConfigStore.getState().config.autoFocusOnSelect,
    setNodes,
    setSelectedNodeIds,
    setSelectionBox,
    setIsNodeDragging,
    setDropTargetGroupId,
    setDialogNodeId,
    setConnecting,
    setMouseWorld,
    setConnectionTargetNodeId,
    setPendingConnectionCreate,
  });

  const discardImportedMedia = useCallback(async (media: { storageKey?: string }) => {
    if (!media.storageKey) return;
    if (media.storageKey.startsWith("image:")) await deleteStoredImages([media.storageKey]);
    else await deleteStoredMedia([media.storageKey]);
  }, []);
  const [mediaTransfers] = useState(() => createAtlasMediaTransactions(discardImportedMedia));
  useEffect(() => () => mediaTransfers.cancelAll(), [mediaTransfers, projectId]);

  const commitMediaNodes = useCallback(
    (incoming: readonly CanvasNodeData[], edges: readonly CanvasConnection[] = []) => {
      if (!incoming.length) return;
      dispatchAtlasCommands(atlasMediaCommitCommands(incoming, edges));
      const updates = new Map(incoming.map((node) => [node.id, node]));
      const retained = nodesRef.current.map((node) => updates.get(node.id) || node);
      const existing = new Set(retained.map((node) => node.id));
      nodesRef.current = [...retained, ...incoming.filter((node) => !existing.has(node.id))];
      if (edges.length) connectionsRef.current = [...connectionsRef.current, ...edges];
      selectedNodeIdsRef.current = new Set(incoming.map((node) => node.id));
    },
    [dispatchAtlasCommands],
  );

  const runMediaTransfer = useCallback(
    async <T,>(prepare: (context: AtlasTransferContext) => Promise<T>, commit: (value: T) => void, channel?: string, fallback = "媒体处理失败，请重试") => {
      const scopeId = getPlatformInit()?.scopeId;
      const outcome = await mediaTransfers.run({
        channel,
        isCurrent: () => activeProjectIdRef.current === projectId && getPlatformInit()?.scopeId === scopeId,
        prepare,
        commit,
      });
      if (outcome.status === "failed") message.error(outcome.error.message || fallback);
      return outcome;
    },
    [mediaTransfers, message, projectId],
  );

  const importFilesToCanvas = useCallback(
    async (files: readonly File[], target: { nodeId?: string; position?: Position } | null) => {
      const plan = planMediaImport(files, target, getCanvasCenter(), isAudioFile);
      const entries = [...(plan.replacement ? [plan.replacement] : []), ...plan.additions];
      if (!entries.length) return;
      await runMediaTransfer(async (context) => {
        const results = await importAtlasMediaBatch(entries, { uploadImage, uploadMediaFile }, { signal: context.signal, rollback: discardImportedMedia });
        results.forEach(({ media }) => context.retain(media));
        return results;
      }, (results) => {
        const additions = results.slice(plan.replacement ? 1 : 0).map((result) => result.node);
        const incoming: CanvasNodeData[] = [];
        if (plan.replacement) {
          const nodeId = plan.replacement.nodeId;
          const current = nodesRef.current.find((node) => node.id === nodeId);
          if (!current) throw new DOMException("替换目标已删除", "AbortError");
          incoming.push(applyMediaReplacement([current], nodeId, {
            fileName: plan.replacement.file.name, kind: plan.replacement.kind, media: results[0]!.media,
          }, { width: VIDEO_NODE_MAX_WIDTH, height: VIDEO_NODE_MAX_HEIGHT })[0]!);
        }
        incoming.push(...additions);
        commitMediaNodes(incoming);
        const lastVisual = additions.findLast((node) => node.type !== CanvasNodeType.Audio);
        if (lastVisual) setDialogNodeId(lastVisual.id);
      }, plan.replacement ? `replace:${plan.replacement.nodeId}` : undefined);
    },
    [commitMediaNodes, discardImportedMedia, getCanvasCenter, runMediaTransfer],
  );

  const pasteSystemClipboard = useCallback(async () => {
    if (!navigator.clipboard) return;
    const outcome = await runMediaTransfer(async (context) => {
      const payload = await readAtlasClipboard({ read: () => navigator.clipboard.read(), readText: () => navigator.clipboard.readText() }, context.signal);
      if (!payload) return null;
      const center = getCanvasCenter();
      if (payload.kind === "text") return { kind: payload.kind, node: createAtlasClipboardTextNode(payload.text, center, t("canvas.projectPage.clipboardText")) };
      const file = new File([payload.blob], "clipboard-image.png", { type: payload.mimeType });
      const results = await importAtlasMediaBatch([{ file, kind: "image", position: center }], { uploadImage, uploadMediaFile }, { signal: context.signal, rollback: discardImportedMedia });
      results.forEach(({ media }) => context.retain(media));
      return { kind: payload.kind, node: results[0]!.node };
    }, (result) => {
      if (!result?.node) return;
      commitMediaNodes([result.node]);
      setContextMenu(null);
      setDialogNodeId(result.node.id);
    }, "clipboard");
    if (outcome.status === "committed" && outcome.value?.node) message.success(t(outcome.value.kind === "image" ? "canvas.projectPage.clipboardImageAdded" : "canvas.projectPage.clipboardTextAdded"));
  }, [commitMediaNodes, discardImportedMedia, getCanvasCenter, message, runMediaTransfer, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editableTarget =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        Boolean(
          target?.closest(
            "[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]",
          ),
        );
      const selection = selectedNodeIdsRef.current;
      const groupingShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "g";
      const intent = resolveCanvasShortcutIntent({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        editableTarget,
        selectedText: Boolean(window.getSelection()?.toString()),
        canGroup:
          groupingShortcut &&
          canGroupSelectedNodes(selection, nodesRef.current),
        canUngroup:
          groupingShortcut &&
          canUngroupSelectedNodes(selection, nodesRef.current),
        selectedNodeCount: selection.size,
        selectedConnection: Boolean(selectedConnectionId),
      });

      switch (intent) {
        case "undo":
        case "redo":
          event.preventDefault();
          if (intent === "undo") undoCanvas();
          else redoCanvas();
          return;
        case "select-all":
          event.preventDefault();
          setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
          setSelectedConnectionId(null);
          setContextMenu(null);
          setSelectionBox(null);
          return;
        case "group":
          event.preventDefault();
          groupSelection();
          return;
        case "ungroup":
          event.preventDefault();
          ungroupSelection();
          return;
        case "copy-nodes":
          event.preventDefault();
          copySelectedNodes();
          return;
        case "paste-nodes":
          event.preventDefault();
          if (!pasteCopiedNodes()) void pasteSystemClipboard();
          return;
        case "delete-nodes":
          deleteNodes(new Set(selection));
          return;
        case "delete-connection":
          if (selectedConnectionId) deleteConnection(selectedConnectionId);
          return;
        case "cancel":
          setSelectedNodeIds(new Set());
          setSelectedConnectionId(null);
          setContextMenu(null);
          setNodeCreatePosition(null);
          setSelectionBox(null);
          setConnecting(null);
          setHoveredNodeId(null);
          setToolbarNodeId(null);
          setDialogNodeId(null);
          setInfoNodeId(null);
          setCropNodeId(null);
          setMaskEditNodeId(null);
          setPendingConnectionCreate(null);
          return;
        case "none":
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    copySelectedNodes,
    deleteConnection,
    deleteNodes,
    groupSelection,
    pasteCopiedNodes,
    pasteSystemClipboard,
    redoCanvas,
    selectedConnectionId,
    setConnecting,
    undoCanvas,
    ungroupSelection,
  ]);

  const handleConnectStart = useCallback(
    (
      event: ReactMouseEvent,
      nodeId: string,
      handleType: "source" | "target",
    ) => {
      event.stopPropagation();
      setMouseWorld(screenToCanvas(event.clientX, event.clientY));
      setConnecting({ nodeId, handleType });
      connectionTargetNodeIdRef.current = null;
      setConnectionTargetNodeId(null);
      setSelectedConnectionId(null);
    },
    [screenToCanvas, setConnecting],
  );

  const handleNodeResize = useCallback(
    (nodeId: string, width: number, height: number, position?: Position) => {
      setNodes((nodes) =>
        applyCanvasNodeCommand(nodes, {
          kind: "resize",
          nodeId,
          width,
          height,
          position,
        }),
      );
    },
    [],
  );

  const handleNodeResizeStart = useCallback(() => {
    setIsNodeResizing(true);
  }, []);
  const handleNodeResizeEnd = useCallback(() => setIsNodeResizing(false), []);

  const toggleNodeFreeResize = useCallback((nodeId: string) => {
    setNodes((nodes) =>
      applyCanvasNodeCommand(nodes, { kind: "toggle-free-resize", nodeId }),
    );
  }, []);

  const handleNodeContentChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((nodes) =>
        applyCanvasNodeCommand(nodes, { kind: "content", nodeId, value }),
      );
    },
    [],
  );

  const handleNodeTitleChange = useCallback((nodeId: string, value: string) => {
    setNodes((nodes) =>
      applyCanvasNodeCommand(nodes, { kind: "title", nodeId, value }),
    );
  }, []);

  const toggleBatchExpanded = useCallback((nodeId: string) => {
    setExpandedBatchNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const setBatchPrimary = useCallback((nodeId: string, variantId: string) => {
    setNodes((nodes) => planAtlasBatchPrimary(nodes, nodeId, variantId));
  }, []);

  const duplicateBatchImage = useCallback(
    (node: CanvasNodeData, imageId: string) => {
      const source = nodesRef.current.find((item) => item.id === node.id) || node;
      const copy = planAtlasBatchImageDuplicate(source, imageId);
      if (!copy) return;
      dispatchAtlasCommands(planAtlasNodeInsertion([copy]));
      setDialogNodeId(copy.id);
    },
    [dispatchAtlasCommands],
  );

  const handleNodePromptChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((nodes) =>
        applyCanvasNodeCommand(nodes, { kind: "prompt", nodeId, value }),
      );
    },
    [],
  );

  const handleConfigNodeChange = useCallback(
    (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
      setNodes((nodes) =>
        applyCanvasNodeCommand(nodes, { kind: "config", nodeId, patch }),
      );
    },
    [],
  );

  const downloadNodeImage = useCallback((node: CanvasNodeData) => {
    if (
      (node.type !== CanvasNodeType.Image &&
        node.type !== CanvasNodeType.Video &&
        node.type !== CanvasNodeType.Audio) ||
      !node.metadata?.content
    )
      return;
    saveAs(
      node.metadata.content,
      `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`,
    );
  }, []);

  const downloadBatchImage = useCallback(
    (node: CanvasNodeData, imageId: string) => {
      const image = node.metadata?.images?.find((item) => item.id === imageId);
      if (!image?.content) return;
      saveAs(
        image.content,
        `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`,
      );
    },
    [],
  );

  const captureVideoNodeFrame = useCallback(
    async (nodeId: string, position: VideoFramePosition) => {
      setContextMenu(null);
      const source = nodesRef.current.find((node) => node.id === nodeId);
      const player = containerRef.current?.querySelector<HTMLVideoElement>(`video[data-canvas-video="${nodeId}"]`);
      if (source?.type !== CanvasNodeType.Video || !source.metadata?.content || (position === "current" && !player)) {
        message.error(t("canvas.videoFrames.failed"));
        return;
      }
      const sourceUrl = source.metadata.content;
      const outcome = await runMediaTransfer(async (context) => {
        const frame = await captureVideoFrame(sourceUrl, position, player?.currentTime || 0);
        context.assertCurrent();
        const image = await uploadImage(frame, { signal: context.signal });
        context.retain(image);
        return image;
      }, (image) => {
        const current = nodesRef.current.find((node) => node.id === nodeId);
        if (!current || current.metadata?.content !== sourceUrl) throw new DOMException("视频来源已改变", "AbortError");
        const child = buildAtlasCapturedFrameNode(current, image, { x: 0, y: 0 }, t(`canvas.videoFrames.${position}Title`, { name: current.title || t("assets.kinds.video") }));
        child.position = atlasMediaOutputPosition(current, nodesRef.current, child);
        commitMediaNodes([child], [{ id: nanoid(), fromNodeId: current.id, toNodeId: child.id }]);
        setDialogNodeId(child.id);
      }, `frame:${nodeId}`, t("canvas.videoFrames.failed"));
      if (outcome.status === "committed") message.success(t("canvas.videoFrames.captured"));
    },
    [commitMediaNodes, message, runMediaTransfer, t],
  );

  const saveNodeAsset = useCallback(
    async (node: CanvasNodeData) => {
      const outcome = await runMediaTransfer(async () => {
        const asset = buildAtlasAssetDraft(node, {
          canvasText: t("canvas.projectPage.canvasText"), canvasImage: t("canvas.projectPage.canvasImage"), canvasVideo: t("canvas.projectPage.canvasVideo"),
        });
        if (!asset) {
          const key = node.type === CanvasNodeType.Text ? "canvas.projectPage.noTextToSave" : node.type === CanvasNodeType.Video ? "canvas.projectPage.noVideoToSave" : "canvas.projectPage.noImageToSave";
          throw new Error(t(key));
        }
        return asset;
      }, (asset) => { addAsset(asset); });
      if (outcome.status === "committed") message.success(t("common.addedToAssets"));
    },
    [addAsset, message, runMediaTransfer, t],
  );

  const createImageReversePromptNodes = useCallback(
    (node: CanvasNodeData) => {
      const plan = planAtlasImageReversePrompt({
        source: nodesRef.current.find((item) => item.id === node.id),
        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
        instruction: t("canvas.projectPage.reversePreset"),
        instructionTitle: t("canvas.projectPage.reverseTitle"),
        configurationTitle: t("canvas.projectPage.reverseConfigTitle"),
        compose: (imageId, textId) => t("canvas.reverseComposer", { imageId, textId }),
      });
      if (!plan) {
        message.warning(t("canvas.projectPage.emptyReverse"));
        return;
      }
      dispatchAtlasCommands(plan.commands);
      setDialogNodeId(plan.panelId);
      setContextMenu(null);
    },
    [dispatchAtlasCommands, effectiveConfig.model, effectiveConfig.textModel, message, t],
  );

  const cropImageNode = useCallback(
    async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
      const source = nodesRef.current.find((item) => item.id === node.id);
      if (!source?.metadata?.content) return;
      const sourceUrl = source.metadata.content;
      setCropNodeId((current) => current === node.id ? null : current);
      await runMediaTransfer(async (context) => {
        const data = await cropDataUrl(sourceUrl, crop);
        context.assertCurrent();
        const image = await uploadImage(data, { signal: context.signal });
        context.retain(image);
        return image;
      }, (image) => {
        const current = nodesRef.current.find((item) => item.id === source.id);
        if (!current || current.metadata?.content !== sourceUrl) throw new DOMException("图片来源已改变", "AbortError");
        const child = createCropImageResult(current, nanoid(), image);
        commitMediaNodes([child], [{ id: nanoid(), fromNodeId: current.id, toNodeId: child.id }]);
        setDialogNodeId(child.id);
      }, `crop:${node.id}`);
    },
    [commitMediaNodes, runMediaTransfer, setCropNodeId],
  );

  const splitImageNode = useCallback(
    async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
      const source = nodesRef.current.find((item) => item.id === node.id);
      if (!source?.metadata?.content) return;
      const sourceUrl = source.metadata.content;
      setSplitNodeId((current) => current === node.id ? null : current);
      let insertedCount = 0;
      const outcome = await runMediaTransfer(async (context) => {
        const pieces = await splitDataUrl(sourceUrl, params);
        context.assertCurrent();
        return mapConcurrent(pieces, 3, async (piece) => {
          const image = await uploadImage(piece.dataUrl, { signal: context.signal });
          context.retain(image);
          return { id: nanoid(), title: t("canvas.projectPage.splitTitle", { name: source.title || t("assets.kinds.image"), row: piece.row + 1, column: piece.column + 1 }), row: piece.row, column: piece.column, image };
        });
      }, (results) => {
        const current = nodesRef.current.find((item) => item.id === source.id);
        if (!current || current.metadata?.content !== sourceUrl) throw new DOMException("图片来源已改变", "AbortError");
        const children = createSplitImageResults(current, results, params);
        commitMediaNodes(children, children.map((child) => ({ id: nanoid(), fromNodeId: current.id, toNodeId: child.id })));
        insertedCount = children.length;
        setDialogNodeId(null);
      }, `split:${node.id}`);
      if (outcome.status === "committed") message.success(t("canvas.projectPage.splitSuccess", { count: insertedCount }));
    },
    [commitMediaNodes, message, runMediaTransfer, setSplitNodeId, t],
  );

  const runImageEdit = useCallback(
    async (
      source: CanvasNodeData,
      prepare: (outputId: string, signal: AbortSignal) => Promise<AtlasImageEditPlan>,
      generate: boolean,
      failureText: string,
      notifyFailure = false,
    ) => {
      const outputId = nanoid();
      const scopeId = getPlatformInit()?.scopeId;
      const controller = startGenerationRequest(outputId, source.id, outputId);
      const isCurrent = () =>
        activeProjectIdRef.current === projectId &&
        getPlatformInit()?.scopeId === scopeId &&
        generationRequests.canWrite(outputId, controller);
      const assertCurrent = createAtlasImageEditGuard(
        source,
        controller.signal,
        () => nodesRef.current.find((node) => node.id === source.id),
        isCurrent,
      );
      try {
        assertCurrent();
        if (generate) setRunningNodeId(outputId);
        const plan = await prepare(outputId, controller.signal);
        assertCurrent();
        dispatchAtlasCommands(plan.commands);
        setDialogNodeId(outputId);
        if (!plan.generate) return;
        const image = await executeAtlasImageEdit({
          plan,
          signal: controller.signal,
          assertCurrent,
          edit: requestEdit,
          store: uploadImage,
        });
        setNodesForGeneration(outputId, controller, (current) =>
          applyAtlasImageEditMedia(current, plan, image),
        );
      } catch (error) {
        if (!isCurrent()) return;
        if (isGenerationCanceled(error)) {
          setNodesForGeneration(outputId, controller, (current) =>
            restoreAtlasImageEditCancellation(current, outputId),
          );
          return;
        }
        const details = error instanceof Error ? error.message : failureText;
        if (notifyFailure) message.error(details);
        setNodesForGeneration(outputId, controller, (current) =>
          applyAtlasGenerationFailure(current, {
            sourceId: source.id,
            pendingOutputIds: [outputId],
            markSource: false,
            details,
            clearFailedVideoTask: false,
          }),
        );
      } finally {
        finishGenerationRequest(outputId, controller);
        if (
          activeProjectIdRef.current === projectId &&
          generationRequests.isLastWriter(outputId, controller)
        )
          setRunningNodeId((current) => current === outputId ? null : current);
      }
    },
    [dispatchAtlasCommands, finishGenerationRequest, generationRequests, message, projectId, setNodesForGeneration, startGenerationRequest],
  );

  const maskEditImageNode = useCallback(
    async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
      const source = nodesRef.current.find((item) => item.id === node.id);
      if (source?.type !== CanvasNodeType.Image || !source.metadata?.content) return;
      const config = { ...buildGenerationConfig(effectiveConfig, source, "image"), count: "1", size: source.metadata.size || "auto" };
      if (payload.generate && !isAiConfigReady(config, config.model)) {
        openConfigDialog(true);
        return;
      }
      const prompt = t("canvas.projectPage.maskPrompt", { source: imageReferenceLabel(0), mask: imageReferenceLabel(1), prompt: payload.prompt.trim() });
      setMaskEditNodeId(null);
      await runImageEdit(source, async (outputId, signal) => planAtlasMaskImageEdit({
        source,
        outputId,
        mask: await uploadImage(payload.maskDataUrl, { signal }),
        config,
        prompt,
        title: payload.prompt.trim().slice(0, 32) || t("canvas.projectPage.maskResult"),
        maskTitle: t("canvas.projectPage.maskNodeTitle"),
        generate: payload.generate,
      }), payload.generate, t("canvas.projectPage.maskFailed"), true);
    },
    [effectiveConfig, isAiConfigReady, openConfigDialog, runImageEdit, t],
  );

  const upscaleImageNode = useCallback(
    async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
      const source = nodesRef.current.find((item) => item.id === node.id);
      if (!source?.metadata?.content) return;
      const sourceUrl = source.metadata.content;
      setUpscaleNodeId((current) => current === node.id ? null : current);
      await runMediaTransfer(async (context) => {
        const data = await upscaleDataUrl(sourceUrl, params);
        context.assertCurrent();
        const image = await uploadImage(data, { signal: context.signal });
        context.retain(image);
        return image;
      }, (image) => {
        const current = nodesRef.current.find((item) => item.id === source.id);
        if (!current || current.metadata?.content !== sourceUrl) throw new DOMException("图片来源已改变", "AbortError");
        const child = createUpscaleImageResult(current, nanoid(), image);
        commitMediaNodes([child], [{ id: nanoid(), fromNodeId: current.id, toNodeId: child.id }]);
        setDialogNodeId(child.id);
      }, `upscale:${node.id}`);
    },
    [commitMediaNodes, runMediaTransfer, setUpscaleNodeId],
  );

  const generateAngleNode = useCallback(
    async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
      const source = nodesRef.current.find((item) => item.id === node.id);
      if (source?.type !== CanvasNodeType.Image || !source.metadata?.content) return;
      const config = { ...buildGenerationConfig(effectiveConfig, source, "image"), count: "1" };
      if (!isAiConfigReady(config, config.model)) {
        openConfigDialog(true);
        return;
      }
      setAngleNodeId(null);
      await runImageEdit(source, async (outputId) => planAtlasAngleImageEdit({
        source,
        outputId,
        config,
        title: buildAngleLabel(params),
        prompt: buildAnglePrompt(params),
      }), true, t("canvas.projectPage.generationFailed"));
    },
    [effectiveConfig, isAiConfigReady, openConfigDialog, runImageEdit, t],
  );

  const handleFontSizeChange = useCallback((nodeId: string, value: number) => {
    setNodes((nodes) =>
      applyCanvasNodeCommand(nodes, { kind: "font-size", nodeId, value }),
    );
  }, []);

  const handleUploadRequest = useCallback(
    (nodeId?: string, position?: Position) => {
      uploadTargetRef.current = { nodeId, position };
      imageInputRef.current?.click();
    },
    [],
  );

  const handleImageInputChange = useCallback(
    async (event: ReactChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const files = Array.from(input.files || []);
      const target = uploadTargetRef.current;
      uploadTargetRef.current = null;
      input.value = "";
      await importFilesToCanvas(files, target);
    },
    [importFilesToCanvas],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      void importFilesToCanvas(files, { position: screenToCanvas(event.clientX, event.clientY) });
    },
    [importFilesToCanvas, screenToCanvas],
  );

  const startTitleEditing = useCallback(() => {
    setTitleDraft(
      currentProject?.title || t("canvas.projectPage.untitledCanvas"),
    );
    setTitleEditing(true);
  }, [currentProject?.title, t]);

  const finishTitleEditing = useCallback(() => {
    const nextTitle = titleDraft.trim().slice(0, 200);
    if (
      nextTitle &&
      useCanvasStore.getState().openProject(projectId)?.title !== nextTitle
    ) {
      renameProject(projectId, nextTitle);
      void platformRequest("platform.action", {
        action: "renameProject",
        title: nextTitle,
      }).catch((error) =>
        message.error(
          error instanceof Error
            ? error.message
            : "项目名称同步失败，请重新修改名称",
        ),
      );
    }
    setTitleEditing(false);
  }, [message, projectId, renameProject, titleDraft]);

  const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest("[data-node-id]")) return;
    event.preventDefault();
    setContextMenu(null);
  }, []);

  const handleGenerateNode = useCallback(
    async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
      const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
      if (!sourceNode) return;
      const generationConfig = buildGenerationConfig(
        effectiveConfig,
        sourceNode,
        mode,
      );
      if (!isAiConfigReady(generationConfig, generationConfig.model)) {
        openConfigDialog(true);
        return;
      }

      const request = resolveAtlasGenerationRequest({
        nodeId,
        mode,
        prompt,
        sourceNode,
        nodes: nodesRef.current,
        connections: connectionsRef.current,
        config: generationConfig,
        overwriteExisting:
          effectiveConfig.nodeRegenerateBehavior === "overwrite",
        resourceIndex,
        builtinPanel: sourceNode
          ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel
          : undefined,
        formatTextEdit: (source, instruction) =>
          t("canvas.projectPage.editTextPrompt", {
            source,
            prompt: instruction,
          }),
      });

      if (request.kind === "plugin-image-writeback") {
        const { scene, panel } = request;
        if (!scene) return;
        await generationRequests.run({
          nodeId,
          start: ({ controller }) => {
            setRunningNodeId(nodeId);
            setNodesForGeneration(nodeId, controller, (current) =>
              patchAtlasGenerationMetadata(current, nodeId, { prompt: scene, status: "loading", errorDetails: undefined }),
            );
          },
          prepare: (signal) => hydrateNodeGenerationContext(
            buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, (panel.promptPrefix || "") + scene, { resourceIndex }),
            { signal },
          ),
          execute: async (context, lease) => {
            const uploaded = await executeAtlasImageWriteback({
              config: generationConfig,
              context,
              signal: lease.controller.signal,
              ports: { generate: requestGeneration, edit: requestEdit, upload: uploadImage, isCancelled: isGenerationCanceled },
            });
            lease.assertCurrent();
            setNodesForGeneration(nodeId, lease.controller, (current) =>
              patchAtlasGenerationMetadata(current, nodeId, { ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: "success", errorDetails: undefined }),
            );
            setDialogNodeId((current) => current === nodeId ? null : current);
          },
          failed: (error, { controller }) => {
            const details = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
            message.error(details);
            setNodesForGeneration(nodeId, controller, (current) =>
              patchAtlasGenerationMetadata(current, nodeId, { status: "error", errorDetails: details }),
            );
          },
          settled: (_lease, latest) => {
            if (latest) setRunningNodeId((current) => current === nodeId ? null : current);
          },
        });
        return;
      }

      if (request.kind !== "node-generation") return;
      const generationInput = request.context;
      const frameIssue = request.frameIssue;
      if (frameIssue) {
        message.error(frameIssue);
        return;
      }
      const overwriteExisting = request.overwriteExisting;
      const markSourceStatus = request.markSourceStatus;
      let pendingChildIds: string[] = [];
      await generationRequests.run({
        nodeId,
        start: () => setRunningNodeId(nodeId),
        prepare: (signal) =>
          hydrateNodeGenerationContext(generationInput, { signal }),
        skip: (generationContext) =>
          !generationContext.prompt.trim() &&
          (mode === "text" || mode === "audio"),
        execute: async (generationContext, lease) => {
          const runController = lease.controller;
          const effectivePrompt = generationContext.prompt.trim();
          if (markSourceStatus)
            setNodesForGeneration(nodeId, runController, (current) =>
              beginAtlasGenerationSource(current, nodeId, prompt),
            );

          const outputPlan = planAtlasNodeOutput({
            mode,
            sourceId: nodeId,
            sourceNode,
            prompt: effectivePrompt,
            sourcePrompt: prompt,
            config: generationConfig,
            overwriteExisting,
            imageCount: getGenerationCount(generationConfig.count),
            textCount: getGenerationCount(
              String(sourceNode?.metadata?.textCount || 1),
            ),
            references: generationContext.referenceImages,
            referenceUrls: generationReferenceUrls(generationContext),
            createId: nanoid,
          });
          const outputId = atlasNodeOutputId(outputPlan);
          pendingChildIds = [outputId];
          setNodesForGeneration(nodeId, runController, (prev) => applyAtlasNodeOutputPlan(prev, outputPlan));
          const outputConnection = atlasNodeOutputConnection(outputPlan);
          if (outputConnection)
            setConnections(generationRequests.guard(nodeId, runController, (prev: CanvasConnection[]) => [...prev, outputConnection]));

          if (outputPlan.mode === "image" || outputPlan.mode === "text") {
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setDialogNodeId(nodeId);
          }

          const controller = lease.track(outputId);
          const result = await executeAtlasProvider({
              plan: outputPlan,
              config: generationConfig,
              context: generationContext,
              signal: controller.signal,
              ports: {
                image: {
                  generate: requestGeneration,
                  edit: requestEdit,
                  upload: uploadImage,
                  isCancelled: isGenerationCanceled,
                },
                text: {
                  request: requestImageQuestion,
                  isCancelled: isGenerationCanceled,
                },
                audio: {
                  generate: requestAudioGeneration,
                  store: storeGeneratedAudio,
                },
                video: ({ outputId: targetId, config, prompt, context, signal }) =>
                  completeVideoNodeTask(
                    targetId,
                    config,
                    prompt,
                    context.referenceImages,
                    signal,
                    controller,
                    {
                      size: config.size,
                      seconds: config.videoSeconds,
                      vquality: config.vquality,
                      generateAudio: config.videoGenerateAudio,
                      watermark: config.videoWatermark,
                      videoMode: config.videoMode,
                      references: generationReferenceUrls(context),
                    },
                    context.referenceVideos,
                    context.referenceAudios,
                  ),
              },
              emit: (event) => {
                if (!lease.owns(outputId)) return;
                setNodesForGeneration(outputId, controller, (current) =>
                  applyAtlasGenerationEvent(current, outputId, event),
                );
                if (
                  event.type === "image-stored" &&
                  outputPlan.mode === "image" &&
                  outputPlan.output.isConfigurationSource
                )
                  setNodesForGeneration(nodeId, controller, (current) =>
                    patchAtlasGenerationMetadata(current, nodeId, { status: "success", errorDetails: undefined }),
                  );
              },
              errorText: (error) =>
                error instanceof Error
                  ? error.message
                  : t("canvas.projectPage.generationFailed"),
            });
          if (!lease.owns(outputId)) {
            if (outputPlan.mode === "image")
              setNodes((current) =>
                generationRequests.isLastWriter(nodeId, controller)
                  ? restoreAtlasCancelledImageSource(
                      current,
                      nodeId,
                      outputPlan.output.isConfigurationSource,
                    )
                  : current,
              );
            return;
          }
          if (result.kind === "media") return;
          if (result.kind === "images") {
            if (result.summary.hasFailure)
              message.error(
                result.summary.hasSuccess
                  ? t("canvas.projectPage.partialFailed")
                  : result.firstError || t("canvas.projectPage.generationFailed"),
              );
            setNodesForGeneration(outputId, controller, (current) =>
              finalizeAtlasImageBatch(current, {
                sourceId: nodeId,
                outputId,
                configurationSource:
                  outputPlan.mode === "image" && outputPlan.output.isConfigurationSource,
                hasSuccess: result.summary.hasSuccess,
                failureDetails: t("canvas.projectPage.generationFailed"),
                allFailedDetails: t("canvas.projectPage.allFailed"),
              }),
            );
            return;
          }
          if (result.completed.length <= 1)
            setExpandedBatchNodeIds(
              (current) => new Set([...current].filter((id) => id !== outputId)),
            );
          if (result.failed.length)
            message.error(
              result.completed.length
                ? t("canvas.projectPage.partialTextFailed")
                : result.failed[0]?.errorDetails || t("canvas.projectPage.generationFailed"),
            );
          setNodesForGeneration(outputId, controller, (current) =>
            finalizeAtlasTextBatch(current, {
              sourceId: nodeId,
              outputId,
              configurationSource:
                outputPlan.mode === "text" && outputPlan.output.configurationSource,
              completed: result.completed,
              failureDetails: t("canvas.projectPage.generationFailed"),
            }),
          );
        },
        failed: (error, { controller }) => {
          const errorDetails =
            error instanceof Error
              ? error.message
              : t("canvas.projectPage.generationFailed");
          message.error(errorDetails);
          setNodesForGeneration(nodeId, controller, (prev) =>
            applyAtlasGenerationFailure(prev, {
              sourceId: nodeId,
              pendingOutputIds: pendingChildIds,
              markSource: markSourceStatus,
              details: errorDetails,
              clearFailedVideoTask: isVideoTaskFailed(error),
            }),
          );
        },
        settled: (_lease, latest) => {
          if (latest)
            setRunningNodeId((current) =>
              current === nodeId ? null : current,
            );
        },
      });
    },
    [
      completeVideoNodeTask,
      effectiveConfig,
      generationRequests,
      isAiConfigReady,
      message,
      openConfigDialog,
      resourceIndex,
      setNodesForGeneration,
      t,
    ],
  );
  useEffect(() => {
    generateNodeRef.current = handleGenerateNode;
  }, [handleGenerateNode]);

  const handleRetryNode = useCallback(
    (node: CanvasNodeData, imageId?: string) =>
      retryCanvasNode(node, imageId, {
        effectiveConfig,
        nodesRef,
        connectionsRef,
        generationRequests,
        isAiConfigReady,
        openConfigDialog,
        pollVideoNodeTask,
        startGenerationRequest,
        finishGenerationRequest,
        setNodesForGeneration,
        setNodes,
        setRunningNodeId,
        completeVideoNodeTask,
        providers: {
          requestQuestion: requestImageQuestion,
          requestAudio: requestAudioGeneration,
          storeAudio: storeGeneratedAudio,
          requestEdit,
          requestGeneration,
          uploadImage,
        },
        notifyError: (text) => message.error(text),
        notifyWarning: (text) => message.warning(text),
        translate: (key) => t(key),
      }),
    [
      completeVideoNodeTask,
      effectiveConfig,
      finishGenerationRequest,
      generationRequests,
      isAiConfigReady,
      message,
      openConfigDialog,
      pollVideoNodeTask,
      setNodesForGeneration,
      startGenerationRequest,
      t,
    ],
  );
  const deleteBatchImage = useCallback((nodeId: string, variantId: string) => {
    if (atlasBatchRemovalCollapses(nodesRef.current.find((node) => node.id === nodeId)))
      setExpandedBatchNodeIds(
        (current) => new Set([...current].filter((id) => id !== nodeId)),
      );
    setNodes((current) => planAtlasBatchImageRemoval(current, nodeId, variantId).nodes);
  }, []);

  const retryBatchImage = useCallback(
    (node: CanvasNodeData, imageId: string) =>
      void handleRetryNode(node, imageId),
    [handleRetryNode],
  );

  const generateImageFromTextNode = useCallback(
    (node: CanvasNodeData) => {
      const plan = planAtlasTextToImage(
        nodesRef.current.find((item) => item.id === node.id),
        effectiveConfig,
      );
      if (!plan) {
        message.warning(t("canvas.projectPage.emptyTextImage"));
        return;
      }
      dispatchAtlasCommands(plan.commands);
      setDialogNodeId(plan.panelId);
    },
    [dispatchAtlasCommands, effectiveConfig, message, t],
  );

  const prepareVideoFromTextNode = useCallback(
    async (
      node: CanvasNodeData,
      selected: CanvasVideoSkill | null,
      signal: AbortSignal,
    ) => {
      const prepared = await prepareTextVideo({
        sourceNodeId: node.id,
        projectId,
        selected,
        preferredModel: effectiveConfig.videoModel,
        signal,
        getSourceNode: () =>
          nodesRef.current.find((item) => item.id === node.id),
        isCurrentProject: () => activeProjectIdRef.current === projectId,
      });
      const current = getPlatformInit();
      const sourceNode = nodesRef.current.find((item) => item.id === node.id);
      if (
        signal.aborted ||
        current?.scopeId !== prepared.scopeId ||
        current.project.id !== projectId ||
        activeProjectIdRef.current !== projectId ||
        sourceNode?.type !== CanvasNodeType.Text
      )
        throw platformAbortError();
      const plan = planAtlasTextToVideo(sourceNode, prepared.metadata, selected ? `${selected.name} · 视频参数` : "视频参数");
      if (!plan) throw platformAbortError();
      dispatchAtlasCommands(plan.commands);
      setToolbarNodeId(plan.panelId);
      setDialogNodeId(plan.panelId);
      // Measure the rendered composer before fitting the new node and its panel.
      requestAnimationFrame(() => {
        if (
          activeProjectIdRef.current !== projectId ||
          getPlatformInit()?.scopeId !== prepared.scopeId ||
          !selectedNodeIdsRef.current.has(plan.panelId)
        )
          return;
        focusNodeRef.current(plan.panelId);
      });
      if (prepared.requiresReference)
        message.info("已准备视频参数，请连接参考图片，确认后再生成");
    },
    [dispatchAtlasCommands, effectiveConfig.videoModel, message, projectId],
  );

  const insertAssistantImage = useCallback(
    async (image: CanvasAssistantImage) => {
      const center = getCanvasCenter();
      const outcome = await runMediaTransfer((context) => createAtlasAssistantImageNode(
        image, center, { uploadImage, ensureImagePreview, readImageMeta, resolveImageUrl }, context.signal, context.retain,
      ), (node) => {
        commitMediaNodes([node]);
        setDialogNodeId(node.id);
      });
      return outcome.status === "committed";
    },
    [commitMediaNodes, getCanvasCenter, runMediaTransfer],
  );

  const insertAssistantText = useCallback(
    async (text: string, title?: string) => {
      const center = getCanvasCenter();
      const outcome = await runMediaTransfer(async () => createAtlasAssistantTextNode(text, center, title), (node) => {
        if (node) commitMediaNodes([node]);
      });
      return outcome.status === "committed" && Boolean(outcome.value);
    },
    [commitMediaNodes, getCanvasCenter, runMediaTransfer],
  );

  const handleAssetInsert = useCallback(
    async (payload: InsertAssetPayload) => {
      let inserted = false;
      if (payload.kind === "image") {
        inserted = await insertAssistantImage({ id: `asset-${nanoid(8)}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
      } else if (payload.kind === "text") {
        inserted = await insertAssistantText(payload.content, payload.title);
      } else {
        const center = getCanvasCenter();
        const outcome = await runMediaTransfer(async () => createAtlasAssetNode(payload, center), (node) => {
          if (node) commitMediaNodes([node]);
        });
        inserted = outcome.status === "committed" && Boolean(outcome.value);
      }
      if (inserted) setAssetPickerOpen(false);
    },
    [commitMediaNodes, getCanvasCenter, insertAssistantImage, insertAssistantText, runMediaTransfer],
  );

  const handleNodeHoverStart = useCallback((nodeId: string) => {
    if (nodeDraggingRef.current) return;
    setHoveredNodeId(nodeId);
  }, []);
  const handleNodeHoverEnd = useCallback((nodeId: string) => {
    setHoveredNodeId((current) => (current === nodeId ? null : current));
  }, []);
  const handleNodeViewImage = useCallback(
    (node: CanvasNodeData, imageId?: string) => {
      setPreviewNodeId(node.id);
      setPreviewImageId(imageId || null);
    },
    [],
  );
  const handleNodeRetry = useCallback(
    (node: CanvasNodeData) => {
      if (
        node.type === CanvasNodeType.Text &&
        (node.metadata?.textCount || 1) > 1
      ) {
        void generateNodeRef.current?.(
          node.id,
          "text",
          node.metadata?.prompt || "",
        );
        return;
      }
      void handleRetryNode(node);
    },
    [handleRetryNode],
  );
  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, nodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedNodeIds((current) =>
        current.has(nodeId) ? current : new Set([nodeId]),
      );
      setSelectedConnectionId(null);
      setContextMenu({
        type: "node",
        x: event.clientX,
        y: event.clientY,
        nodeId,
      });
    },
    [],
  );

  const renderNodePanel = useCallback(
    (panelNode: CanvasNodeData) =>
      getNodeDefinition(panelNode.type)?.Panel ? (
        renderPluginPanel(panelNode)
      ) : panelNode.type === CanvasNodeType.Config ? (
        <CanvasConfigComposer
          nodeId={panelNode.id}
          nodes={nodes}
          value={
            panelNode.metadata?.composerContent ??
            panelNode.metadata?.prompt ??
            ""
          }
          inputs={configInputsById.get(panelNode.id) || []}
          connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
          onChange={(composerContent) =>
            handleConfigNodeChange(panelNode.id, { composerContent })
          }
          onClose={() => setDialogNodeId(null)}
          onDisconnectReference={disconnectNodeReference}
          onStartReferenceSelection={startNodeReferenceSelection}
          onSwapVideoFrames={() =>
            handleConfigNodeChange(panelNode.id, {
              videoFramesReversed: !panelNode.metadata?.videoFramesReversed,
            })
          }
        />
      ) : (
        <CanvasNodePromptPanel
          node={panelNode}
          nodes={nodes}
          isRunning={runningNodeId === panelNode.id}
          mentionReferences={
            mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES
          }
          connectedNodes={connectedNodesByNodeId.get(panelNode.id) || []}
          onPromptChange={handleNodePromptChange}
          onConfigChange={handleConfigNodeChange}
          onGenerate={handleGenerateNode}
          onStop={confirmStopGeneration}
          onDisconnectReference={disconnectNodeReference}
          onStartReferenceSelection={startNodeReferenceSelection}
          modeOverride={
            getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode
          }
          onImageSettingsOpenChange={(open) => {
            setNodeImageSettingsOpen(open);
            if (open) setToolbarNodeId(null);
          }}
        />
      ),
    [
      configInputsById,
      confirmStopGeneration,
      connectedNodesByNodeId,
      disconnectNodeReference,
      handleConfigNodeChange,
      handleGenerateNode,
      handleNodePromptChange,
      mentionReferencesByNodeId,
      nodes,
      renderPluginPanel,
      runningNodeId,
      startNodeReferenceSelection,
    ],
  );

  const renderNodeContentPanel = useCallback(
    (contentNode: CanvasNodeData) => (
      <CanvasConfigNodePanel
        node={contentNode}
        isRunning={runningNodeId === contentNode.id}
        inputSummary={getInputSummary(
          configInputsById.get(contentNode.id) || [],
        )}
        onConfigChange={handleConfigNodeChange}
        onComposerToggle={() =>
          setDialogNodeId((current) =>
            current === contentNode.id ? null : contentNode.id,
          )
        }
        onStop={confirmStopGeneration}
        onGenerate={(nodeId) => {
          const target = nodesRef.current.find((item) => item.id === nodeId);
          void handleGenerateNode(
            nodeId,
            target?.metadata?.generationMode || "image",
            target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "",
          );
        }}
      />
    ),
    [
      configInputsById,
      confirmStopGeneration,
      handleConfigNodeChange,
      handleGenerateNode,
      runningNodeId,
    ],
  );

  const hoverPreviewNode = hoverPreviewNodeId
    ? nodeById.get(hoverPreviewNodeId) || null
    : null;
  const hoverPreviewMedia =
    hoverPreviewNode &&
    (hoverPreviewNode.type === CanvasNodeType.Image ||
      hoverPreviewNode.type === CanvasNodeType.Video) &&
    hoverPreviewNode.metadata?.content
      ? {
          video: hoverPreviewNode.type === CanvasNodeType.Video,
          src: hoverPreviewNode.metadata.content,
          width:
            hoverPreviewNode.metadata.naturalWidth || hoverPreviewNode.width,
          height:
            hoverPreviewNode.metadata.naturalHeight || hoverPreviewNode.height,
        }
      : null;
  const showHoverPreview = Boolean(hoverPreviewMedia);
  const retainedPreviewRef = useRef<{
    video: boolean;
    src: string;
    title: string;
    width: number;
    height: number;
  } | null>(null);
  // Written during render on purpose: the overlay stays mounted while it fades out, so the last preview has to be
  // retained after the hovered node clears. Sizing reuses the measured container size instead of reading layout here.
  if (hoverPreviewMedia) {
    const previewSize = fitNodeSize(
      hoverPreviewMedia.width,
      hoverPreviewMedia.height,
      size.width * 0.9,
      size.height * 0.9,
    );
    retainedPreviewRef.current = {
      video: hoverPreviewMedia.video,
      src: hoverPreviewMedia.src,
      title: hoverPreviewNode?.title || "",
      width: previewSize.width,
      height: previewSize.height,
    };
  }
  const retainedPreview = retainedPreviewRef.current;

  if (!projectLoaded)
    return (
      <CanvasRefreshShell
        error={documentRecovery.restoreError || undefined}
        onRetry={documentRecovery.retry}
        retryLabel={t("canvas.node.retry")}
      />
    );

  return (
    <main
      className="canvas-atlas-shell flex h-full min-h-0 overflow-hidden"
      style={{ background: theme.canvas.background, color: theme.node.text }}
      data-workbench-ui="atlas"
    >
      <CanvasSidePanel
        nodes={nodes}
        selectedNodeIds={selectedNodeIds}
        onFocusNode={focusNode}
        onPreviewNode={setPreviewNodeId}
        onHoverNode={setHoverPreviewNodeId}
        onInsertAsset={handleAssetInsert}
      />
      <section className="canvas-atlas-stage relative min-w-0 flex-1 overflow-hidden">
        <CanvasTopBar
          title={
            currentProject?.title || t("canvas.projectPage.untitledCanvas")
          }
          titleDraft={titleDraft}
          isTitleEditing={titleEditing}
          onTitleDraftChange={setTitleDraft}
          onStartTitleEditing={startTitleEditing}
          onFinishTitleEditing={finishTitleEditing}
          onCancelTitleEditing={() => setTitleEditing(false)}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onHome={() => openHostPanel("home")}
          onProjects={() => openHostPanel("projects")}
          onCreateProject={() => openHostPanel("newProject")}
          onExportProject={exportCurrentProject}
          onImportImage={() => handleUploadRequest()}
          onOpenPlugins={() => setPluginManagerOpen(true)}
          onUndo={undoCanvas}
          onRedo={redoCanvas}
          agentOpen={agentPanelOpen}
          onToggleAgent={toggleAgentPanel}
        />

        <CanvasViewport
          containerRef={containerRef}
          viewport={viewport}
          tool={canvasTool}
          backgroundMode={backgroundMode}
          onViewportChange={(next) => {
            setViewport(next);
            setContextMenu(null);
          }}
          onCanvasMouseDown={(event) => {
            if (!referencePickerNodeId) handleCanvasMouseDown(event);
          }}
          onCanvasDeselect={referencePickerNodeId ? undefined : deselectCanvas}
          onCanvasDoubleClick={(event) => {
            if (referencePickerNodeId) return;
            setContextMenu(null);
            setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
          }}
          onContextMenu={preventCanvasContextMenu}
          onDrop={handleDrop}
        >
          <AtlasBoardScene
            nodes={visibleNodes}
            edges={visibleConnections}
            selection={{
              nodes: selectedNodeIds,
              focused: activeNodeId,
              relatedNodes: relatedHighlight.nodeIds,
              relatedEdges: relatedHighlight.connectionIds,
              edge: selectedConnectionId,
            }}
            presentation={{
              scale: viewport.k,
              panelWidth: Math.min(600, Math.max(240, size.width - 24)),
              panelNode: dialogNodeId,
              resizing: isNodeResizing,
              selecting: Boolean(selectionBox),
              imageInfo: showImageInfo,
              dropGroup: dropTargetGroupId,
              expanded: expandedBatchNodeIds,
              childCounts: groupChildCountById,
              mentions: mentionReferencesByNodeId,
            }}
            references={{
              owner: referencePickerNodeId,
              connected: referenceConnectedNodeIds,
              accepts: (node) => resourceIndex.isReferenceNode(node),
            }}
            gesture={connectingParams ? {
              handle: connectingParams,
              node: nodeById.get(connectingParams.nodeId),
              target: connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined,
              cursor: mouseWorld,
            } : null}
            marquee={selectionBox}
            onSelectEdge={(id, point) => {
              setSelectedConnectionId(id);
              setSelectedNodeIds(new Set());
              setContextMenu(point ? { type: "connection", connectionId: id, ...point } : null);
            }}
            events={{
              pluginHost,
              registryVersion: nodeRegistryVersion,
              renderPanel: renderNodePanel,
              renderNodeContent: renderNodeContentPanel,
              onMouseDown: handleNodeMouseDown,
              onSelectCapture: handleNodeSelectCapture,
              onHoverStart: handleNodeHoverStart,
              onHoverEnd: handleNodeHoverEnd,
              onConnectStart: handleConnectStart,
              onResizeStart: handleNodeResizeStart,
              onResize: handleNodeResize,
              onResizeEnd: handleNodeResizeEnd,
              onContentChange: handleNodeContentChange,
              onTitleChange: handleNodeTitleChange,
              onToggleBatch: toggleBatchExpanded,
              onSetBatchPrimary: setBatchPrimary,
              onDuplicateBatchImage: duplicateBatchImage,
              onDownloadBatchImage: downloadBatchImage,
              onRetryBatchImage: retryBatchImage,
              onDeleteBatchImage: deleteBatchImage,
              onRetry: handleNodeRetry,
              onViewImage: handleNodeViewImage,
              onSelectReference: selectNodeReference,
              onContextMenu: handleNodeContextMenu,
            }}
          />
          {pendingConnectionCreate ? (
            <ConnectionCreateMenu
              pending={pendingConnectionCreate}
              scale={viewport.k}
              onCreate={(type) =>
                createConnectedNode(type, pendingConnectionCreate)
              }
              onClose={cancelPendingConnectionCreate}
            />
          ) : null}
          {nodeCreatePosition ? (
            <NodeCreateMenu
              position={nodeCreatePosition}
              scale={viewport.k}
              onCreate={(type) => {
                createNode(type, nodeCreatePosition);
                setNodeCreatePosition(null);
              }}
              onClose={() => setNodeCreatePosition(null)}
            />
          ) : null}
        </CanvasViewport>

        {referencePickerNodeId ? (
          <button
            type="button"
            className="absolute left-1/2 top-4 z-[90] -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur"
            style={{
              background: theme.toolbar.panel,
              borderColor: theme.toolbar.border,
            }}
            onClick={exitNodeReferenceSelection}
          >
            {t("canvas.references.selectingHint")}
          </button>
        ) : null}

        <div
          className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center transition-opacity duration-200 ease-out"
          style={{
            background: `color-mix(in srgb, ${theme.canvas.background} 76%, transparent)`,
            opacity: showHoverPreview ? 1 : 0,
          }}
        >
          <div
            className="flex flex-col overflow-hidden rounded-2xl border transition-transform duration-200 ease-out"
            style={{
              background: theme.toolbar.panel,
              borderColor: theme.toolbar.border,
              boxShadow: "0 24px 60px rgba(0,0,0,.32)",
              transform: showHoverPreview ? "scale(1)" : "scale(0.95)",
            }}
          >
            {retainedPreview ? (
              <>
                <div
                  className="max-w-full truncate px-3.5 py-2 text-sm font-medium"
                  style={{ color: theme.node.text }}
                >
                  {retainedPreview.title ||
                    t(
                      retainedPreview.video
                        ? "assets.kinds.video"
                        : "assets.kinds.image",
                    )}
                </div>
                <div
                  className="overflow-hidden"
                  style={{
                    width: retainedPreview.width,
                    height: retainedPreview.height,
                  }}
                >
                  {retainedPreview.video ? (
                    <video
                      src={retainedPreview.src}
                      muted
                      playsInline
                      preload="metadata"
                      className="size-full object-contain"
                    />
                  ) : (
                    <img
                      src={retainedPreview.src}
                      alt={retainedPreview.title}
                      className="size-full object-contain"
                    />
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <CanvasNodeHoverToolbar
          node={
            isNodeDragging ||
            isNodeResizing ||
            nodeImageSettingsOpen ||
            Boolean(referencePickerNodeId) ||
            expandedBatchNodeIds.has(toolbarNode?.id || "")
              ? null
              : toolbarNode
          }
          viewport={viewport}
          canvasWidth={size.width}
          projectId={projectId}
          extraTools={
            toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined
          }
          onKeep={keepNodeToolbar}
          onLeave={hideNodeToolbar}
          onInfo={(node) => setInfoNodeId(node.id)}
          onDecreaseFont={(node) =>
            handleFontSizeChange(
              node.id,
              Math.max(10, (node.metadata?.fontSize || 14) - 2),
            )
          }
          onIncreaseFont={(node) =>
            handleFontSizeChange(
              node.id,
              Math.min(32, (node.metadata?.fontSize || 14) + 2),
            )
          }
          onToggleDialog={(node) =>
            setDialogNodeId((current) => (current === node.id ? null : node.id))
          }
          onGenerateImage={generateImageFromTextNode}
          onPrepareVideo={prepareVideoFromTextNode}
          onUpload={(node) => handleUploadRequest(node.id)}
          onDownload={downloadNodeImage}
          onSaveAsset={(node) => void saveNodeAsset(node)}
          onMaskEdit={(node) => setMaskEditNodeId(node.id)}
          onCrop={(node) => setCropNodeId(node.id)}
          onSplit={(node) => setSplitNodeId(node.id)}
          onUpscale={(node) => setUpscaleNodeId(node.id)}
          onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
          onAngle={(node) => setAngleNodeId(node.id)}
          onViewImage={handleNodeViewImage}
          onReversePrompt={createImageReversePromptNodes}
          onRetry={(node) => void handleRetryNode(node)}
          onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
          onDelete={(node) => deleteNodes(new Set([node.id]))}
          onUngroup={(node) => ungroupSelection(new Set([node.id]))}
        />

        {hasMultipleSelectedNodes && !selectionBox ? (
          <CanvasSelectionToolbar
            nodes={selectedNodes}
            canMerge={canMergeVideos}
            onMerge={mergeVideoSelection}
            viewport={viewport}
            canvasSize={size}
            showToolbar={!isNodeDragging && !isNodeResizing}
            canGroup={canGroupSelection}
            canUngroup={canUngroupSelection}
            onGroup={groupSelection}
            onUngroup={ungroupSelection}
          />
        ) : null}

        <CanvasToolbar
          selectedCount={selectedNodeIds.size}
          canvasTool={canvasTool}
          onFocusSelected={focusSelectedNode}
          onTidyLayout={tidyLayout}
          nodes={nodes}
          connections={connections}
          onFocusNode={focusNode}
          onRepairConnections={setConnections}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          backgroundMode={backgroundMode}
          showImageInfo={showImageInfo}
          onAddImage={() => createNode(CanvasNodeType.Image)}
          onAddVideo={() => createNode(CanvasNodeType.Video)}
          onAddAudio={() => createNode(CanvasNodeType.Audio)}
          onAddText={() => createNode(CanvasNodeType.Text)}
          onAddConfig={() => createNode(CanvasNodeType.Config)}
          onAddGroup={() => createNode(CanvasNodeType.Group)}
          onAddExtensionNode={(type) => createNode(type)}
          onUndo={undoCanvas}
          onRedo={redoCanvas}
          onUpload={() => handleUploadRequest()}
          onDelete={() => deleteNodes(new Set(selectedNodeIds))}
          onClear={() => setClearConfirmOpen(true)}
          onCanvasToolChange={setCanvasTool}
          onBackgroundModeChange={setBackgroundMode}
          onShowImageInfoChange={setShowImageInfo}
        />

        {isMiniMapOpen ? (
          <Minimap
            nodes={nodes}
            connections={connections}
            viewport={viewport}
            viewportSize={size}
            onViewportChange={setViewport}
          />
        ) : null}

        <CanvasZoomControls
          scale={viewport.k}
          onScaleChange={setZoomScale}
          onReset={resetViewport}
          isMiniMapOpen={isMiniMapOpen}
          onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}
        />

        {contextMenu ? (
          <CanvasNodeContextMenu
            menu={contextMenu}
            canCaptureVideoFrame={
              contextMenuNode?.type === CanvasNodeType.Video &&
              Boolean(contextMenuNode.metadata?.content)
            }
            canGroup={contextMenu.type === "node" && canGroupSelection}
            canUngroup={contextMenu.type === "node" && canUngroupSelection}
            onClose={() => setContextMenu(null)}
            onCaptureVideoFrame={(position) => {
              if (contextMenu.type !== "node") return;
              void captureVideoNodeFrame(contextMenu.nodeId, position);
            }}
            onDuplicate={() => {
              if (contextMenu.type !== "node") return;
              duplicateNode(contextMenu.nodeId);
              setContextMenu(null);
            }}
            onGroup={groupSelection}
            onUngroup={ungroupSelection}
            onDelete={() => {
              if (contextMenu.type === "node") {
                deleteNodes(new Set([contextMenu.nodeId]));
              } else {
                deleteConnection(contextMenu.connectionId);
              }
              setContextMenu(null);
            }}
          />
        ) : null}

        <input
          ref={imageInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
          className="hidden"
          onChange={handleImageInputChange}
        />

        <CanvasNodeInfoModal
          node={infoNode}
          open={Boolean(infoNode)}
          onClose={() => setInfoNodeId(null)}
        />
        {pluginManagerOpen ? (
          <Suspense
            fallback={<CanvasDialogLoading label={t("canvas.loading")} />}
          >
            <CanvasPluginManagerModal
              open
              onClose={() => setPluginManagerOpen(false)}
            />
          </Suspense>
        ) : null}

        {cropNode?.metadata?.content ? (
          <Suspense
            fallback={<CanvasDialogLoading label={t("canvas.loading")} />}
          >
            <CanvasNodeCropDialog
              dataUrl={cropNode.metadata.content}
              open
              onClose={() => setCropNodeId(null)}
              onConfirm={(crop) => void cropImageNode(cropNode, crop)}
            />
          </Suspense>
        ) : null}

        {maskEditNode?.metadata?.content ? (
          <Suspense
            fallback={<CanvasDialogLoading label={t("canvas.loading")} />}
          >
            <CanvasNodeMaskEditDialog
              dataUrl={maskEditNode.metadata.content}
              open
              onClose={() => setMaskEditNodeId(null)}
              onConfirm={(payload) =>
                void maskEditImageNode(maskEditNode, payload)
              }
            />
          </Suspense>
        ) : null}

        {splitNode?.metadata?.content ? (
          <Suspense
            fallback={<CanvasDialogLoading label={t("canvas.loading")} />}
          >
            <CanvasNodeSplitDialog
              dataUrl={splitNode.metadata.content}
              open
              onClose={() => setSplitNodeId(null)}
              onConfirm={(params) => void splitImageNode(splitNode, params)}
            />
          </Suspense>
        ) : null}

        {upscaleNode?.metadata?.content ? (
          <Suspense
            fallback={<CanvasDialogLoading label={t("canvas.loading")} />}
          >
            <CanvasNodeUpscaleDialog
              dataUrl={upscaleNode.metadata.content}
              open
              onClose={() => setUpscaleNodeId(null)}
              onConfirm={(params) => void upscaleImageNode(upscaleNode, params)}
            />
          </Suspense>
        ) : null}

        <Modal
          title={t("canvas.projectPage.superResolve")}
          open={Boolean(superResolveNode?.metadata?.content)}
          centered
          footer={null}
          onCancel={() => setSuperResolveNodeId(null)}
        >
          <div className="py-8 text-center text-base font-medium">
            {t("canvas.projectPage.notImplemented")}
          </div>
        </Modal>

        {angleNode?.metadata?.content ? (
          <Suspense
            fallback={<CanvasDialogLoading label={t("canvas.loading")} />}
          >
            <CanvasNodeAngleDialog
              dataUrl={angleNode.metadata.content}
              open
              onClose={() => setAngleNodeId(null)}
              onConfirm={(params) => void generateAngleNode(angleNode, params)}
            />
          </Suspense>
        ) : null}

        <Modal
          title={t("canvas.projectPage.imageDetails")}
          open={Boolean(previewContent)}
          centered
          onCancel={() => setPreviewNodeId(null)}
          footer={null}
          width="auto"
          styles={{
            body: {
              padding: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              maxHeight: "80vh",
            },
          }}
        >
          {previewContent ? (
            <img
              src={previewContent}
              alt={previewNode?.title || t("assets.kinds.image")}
              style={{
                maxWidth: "100%",
                maxHeight: "80vh",
                objectFit: "contain",
              }}
            />
          ) : null}
        </Modal>

        <Modal
          title={t("canvas.projectPage.clearTitle")}
          open={clearConfirmOpen}
          centered
          onCancel={() => setClearConfirmOpen(false)}
          footer={
            <>
              <Button onClick={() => setClearConfirmOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button danger type="primary" onClick={clearCanvas}>
                {t("canvas.projectPage.clear")}
              </Button>
            </>
          }
        >
          <p className="text-sm opacity-60">
            {t("canvas.projectPage.clearDescription")}
          </p>
        </Modal>

        {assetPickerOpen ? (
          <Suspense
            fallback={<CanvasDialogLoading label={t("canvas.loading")} />}
          >
            <AssetPickerModal
              open
              onInsert={handleAssetInsert}
              onClose={() => setAssetPickerOpen(false)}
            />
          </Suspense>
        ) : null}
      </section>
      <AtlasAgentPanel />
    </main>
  );
}

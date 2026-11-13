import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  AudioLines,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Crop,
  Download,
  Expand,
  Eye,
  Film,
  Frame,
  Image,
  Layers3,
  Link2,
  RefreshCw,
  Scissors,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Type,
  Ungroup,
  Unplug,
  Upload,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getPlatformInit,
  onPlatformInit,
  platformRequest,
  type PlatformModels,
} from "@/platform/rpc";
import type {
  CanvasVideoSkill,
  PreparedCanvasSkill,
} from "@/platform/skill-video";
import { useEffectiveConfig } from "@/stores/use-config-store";
import type {
  CanvasConnection,
  CanvasGenerationMode,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/types/canvas";
import { useStudioCopy, type StudioCopyKey } from "./copy";

export type StudioInspectorProps = {
  node: CanvasNodeData | null;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  onPatch: (id: string, patch: Partial<CanvasNodeData>) => void;
  onMetadata: (id: string, patch: CanvasNodeMetadata) => void;
  onGenerate: (id: string, mode: CanvasGenerationMode, prompt: string) => void;
  onStop: (id: string) => void;
  onAction: (action: string, node: CanvasNodeData) => void;
  busy: boolean;
  selectedCount: number;
};

function Field({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("studio-field", className)}>
      <span>{title}</span>
      {children}
    </label>
  );
}

function currentMode(node: CanvasNodeData): CanvasGenerationMode {
  if (node.metadata?.generationMode) return node.metadata.generationMode;
  return node.type === "video"
    ? "video"
    : node.type === "audio"
      ? "audio"
      : node.type === "text"
        ? "text"
        : "image";
}

const modeOptions: { id: CanvasGenerationMode; icon: LucideIcon }[] = [
  { id: "image", icon: Image },
  { id: "video", icon: Video },
  { id: "text", icon: Type },
  { id: "audio", icon: AudioLines },
];
const imageActions: {
  action: string;
  label: StudioCopyKey;
  icon: LucideIcon;
}[] = [
  { action: "crop", label: "crop", icon: Crop },
  { action: "mask", label: "mask", icon: WandSparkles },
  { action: "split", label: "split", icon: Scissors },
  { action: "upscale", label: "upscale", icon: Expand },
  { action: "angle", label: "angle", icon: Camera },
  { action: "reverse", label: "reverse", icon: Sparkles },
];
const videoActions: {
  action: string;
  label: StudioCopyKey;
  icon: LucideIcon;
}[] = [
  { action: "capture-start", label: "captureStart", icon: Film },
  { action: "capture-end", label: "captureEnd", icon: Frame },
];

export function StudioInspector(props: StudioInspectorProps) {
  const c = useStudioCopy();
  const fieldId = useId();
  const defaults = useEffectiveConfig();
  const [tab, setTab] = useState<"compose" | "properties">("compose");
  const [catalog, setCatalog] = useState<PlatformModels>(
    () => getPlatformInit()?.models ?? { image: [], video: [] },
  );
  const [skills, setSkills] = useState<CanvasVideoSkill[]>([]);
  const [skillId, setSkillId] = useState("");
  const [skillRevision, setSkillRevision] = useState(0);
  const [skillLoading, setSkillLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [skillMessage, setSkillMessage] = useState("");
  const [skillError, setSkillError] = useState("");
  const preparation = useRef<AbortController | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const node = props.node;
  const mode = node ? currentMode(node) : "image";

  useEffect(() => onPlatformInit((init) => setCatalog(init.models)), []);
  useEffect(() => {
    preparation.current?.abort();
    setPreparing(false);
    setSkillId(node?.metadata?.videoSkillId || "");
    setSkillError("");
    setSkillMessage("");
    return () => preparation.current?.abort();
  }, [node?.id]);
  useEffect(() => {
    if (mode !== "video" || !node) return;
    const controller = new AbortController();
    setSkillLoading(true);
    setSkillError("");
    platformRequest<{ skills: CanvasVideoSkill[] } | CanvasVideoSkill[]>(
      "skills.list",
      {},
      { signal: controller.signal, timeoutMs: 20_000 },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        const list = Array.isArray(value) ? value : value.skills;
        setSkills(
          Array.isArray(list)
            ? list.filter(
                (skill) =>
                  typeof skill.id === "string" &&
                  typeof skill.version === "string",
              )
            : [],
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSkillError(
            error instanceof Error ? error.message : c.skillInvalid,
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSkillLoading(false);
      });
    return () => controller.abort();
  }, [mode, node?.id, skillRevision, c.skillInvalid]);

  const models = useMemo(() => {
    if (mode === "image" || mode === "video")
      return catalog[mode].map((model) => ({
        value: `platform::${model.id}`,
        name: model.name || model.id,
        available: model.available,
      }));
    const available = defaults.channels.flatMap((channel) =>
      channel.models
        .filter((model) => model.capability === mode)
        .map((model) => ({
          value: `${channel.id}::${model.name}`,
          name: `${channel.name} · ${model.name}`,
          available: true,
        })),
    );
    const preferred =
      mode === "text" ? defaults.textModel : defaults.audioModel;
    if (preferred && !available.some((option) => option.value === preferred))
      available.unshift({ value: preferred, name: preferred, available: true });
    return available;
  }, [
    catalog,
    defaults.audioModel,
    defaults.channels,
    defaults.textModel,
    mode,
  ]);

  if (!node)
    return (
      <div className="studio-inspector studio-inspector-empty">
        <div className="studio-inspector-heading">
          <span>{c.inspector}</span>
          <Settings2 size={15} strokeWidth={1.7} />
        </div>
        <div className="studio-empty-orbit" aria-hidden="true">
          <div>
            <Layers3 size={30} strokeWidth={1.2} />
          </div>
        </div>
        <h2>{props.selectedCount > 1 ? c.multiSelection : c.noSelection}</h2>
        <p>
          {props.selectedCount > 1 ? c.multiSelectionHint : c.noSelectionHint}
        </p>
        <div className="studio-inspector-guide">
          <Link2 size={15} strokeWidth={1.7} />
          <span>{c.noConnections}</span>
        </div>
      </div>
    );

  const metadata = node.metadata || {};
  const status = props.busy ? "loading" : metadata.status || "idle";
  const statusText = c[status];
  const prompt =
    metadata.composerContent ??
    metadata.prompt ??
    (node.type === "text" ? metadata.content || "" : "");
  const incoming = props.connections.filter(
    (edge) => edge.toNodeId === node.id,
  );
  const selectedModel =
    metadata.model || models.find((model) => model.available)?.value || "";
  const hasMedia =
    Boolean(metadata.content) &&
    ["image", "video", "audio"].includes(node.type);
  const patchMetadata = (patch: CanvasNodeMetadata) =>
    props.onMetadata(node.id, patch);
  const nodeAction = (action: string) => props.onAction(action, node);
  const skill = skills.find((item) => item.id === skillId);
  const updatePrompt = (value: string) =>
    patchMetadata({ prompt: value, composerContent: value });

  const prepareSkill = async () => {
    if (!skill || preparing) return;
    preparation.current?.abort();
    const controller = new AbortController();
    preparation.current = controller;
    const initial = getPlatformInit();
    const owner = node.id;
    setPreparing(true);
    setSkillError("");
    setSkillMessage("");
    try {
      const recipe = await platformRequest<PreparedCanvasSkill>(
        "skills.prepare",
        {
          id: skill.id,
          version: skill.version,
          install: true,
          sourceNodeId: owner,
          text: `@[node:${owner}]`,
        },
        { signal: controller.signal, timeoutMs: 20_000 },
      );
      if (
        controller.signal.aborted ||
        latest.current.node?.id !== owner ||
        getPlatformInit()?.scopeId !== initial?.scopeId
      )
        return;
      if (
        recipe.kind !== "video" ||
        recipe.defaults?.skillId !== skill.id ||
        recipe.defaults.skillVersion !== skill.version
      )
        throw new Error(c.skillInvalid);
      const settings: CanvasNodeMetadata = {
        generationMode: "video",
        videoSkillId: skill.id,
        videoSkillVersion: skill.version,
        videoSkillInputMode: "instruction",
        skillId: undefined,
        skillVersion: undefined,
        videoMode: recipe.requiresReference
          ? "reference"
          : metadata.videoMode || "auto",
      };
      const { width, height, duration, model } = recipe.defaults;
      if (width && height && Number.isFinite(width) && Number.isFinite(height))
        settings.size = `${width}x${height}`;
      if (duration && Number.isFinite(duration))
        settings.seconds = String(duration);
      if (
        model &&
        catalog.video.some(
          (entry) =>
            entry.id === model.replace(/^platform::/, "") && entry.available,
        )
      )
        settings.model = model.startsWith("platform::")
          ? model
          : `platform::${model}`;
      latest.current.onMetadata(owner, settings);
      setSkills((current) =>
        current.map((entry) =>
          entry.id === skill.id ? { ...entry, installed: true } : entry,
        ),
      );
      setSkillMessage(c.skillApplied);
    } catch (error) {
      if (!controller.signal.aborted && latest.current.node?.id === owner)
        setSkillError(error instanceof Error ? error.message : c.skillInvalid);
    } finally {
      if (preparation.current === controller) {
        preparation.current = null;
        setPreparing(false);
      }
    }
  };

  const actionButton = (
    action: string,
    label: string,
    Icon: LucideIcon,
    disabled = false,
  ) => (
    <button
      key={action}
      type="button"
      className="studio-action-tile"
      onClick={() => nodeAction(action)}
      disabled={disabled || props.busy}
    >
      <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="studio-inspector" data-studio-inspector-node={node.id}>
      <div className="studio-inspector-heading">
        <span>{c.inspector}</span>
        <span className={cn("studio-node-status", `is-${status}`)}>
          <i />
          {statusText}
        </span>
      </div>
      <div className="studio-inspector-node-header">
        <span className="studio-node-kind">
          {node.type === "text" ? (
            <Type size={17} />
          ) : node.type === "video" ? (
            <Video size={17} />
          ) : node.type === "image" ? (
            <Image size={17} />
          ) : (
            <Layers3 size={17} />
          )}
        </span>
        <div>
          <strong title={node.title}>{node.title || c.untitled}</strong>
          <span className="studio-node-dimensions">
            {Math.round(node.width)} × {Math.round(node.height)}
          </span>
        </div>
        <button
          type="button"
          className="studio-icon-button"
          aria-label={c.duplicate}
          title={c.duplicate}
          onClick={() => nodeAction("duplicate")}
        >
          <Copy size={16} strokeWidth={1.7} />
        </button>
      </div>
      <div
        className="studio-inspector-tabs"
        role="group"
        aria-label={c.inspectNode}
      >
        <button
          type="button"
          aria-pressed={tab === "compose"}
          onClick={() => setTab("compose")}
        >
          {c.compose}
        </button>
        <button
          type="button"
          aria-pressed={tab === "properties"}
          onClick={() => setTab("properties")}
        >
          {c.properties}
        </button>
      </div>
      <div className="studio-inspector-scroll">
        {tab === "compose" ? (
          <>
            {node.type === "text" && (
              <Field title={c.content}>
                <textarea
                  rows={5}
                  value={metadata.content || ""}
                  onChange={(event) =>
                    patchMetadata({ content: event.target.value })
                  }
                  placeholder={c.contentPlaceholder}
                />
              </Field>
            )}
            {hasMedia && (
              <div className="studio-source-preview">
                {node.type === "image" ? (
                  <button
                    type="button"
                    aria-label={c.preview}
                    onClick={() => nodeAction("preview")}
                  >
                    <img
                      src={metadata.content}
                      alt={node.title}
                      loading="lazy"
                    />
                    <span>
                      <Eye size={14} />
                      {c.preview}
                    </span>
                  </button>
                ) : node.type === "video" ? (
                  <video src={metadata.content} controls preload="metadata" />
                ) : (
                  <audio src={metadata.content} controls preload="metadata" />
                )}
              </div>
            )}
            {["image", "video", "audio"].includes(node.type) && (
              <section className="studio-inspector-section">
                <button
                  type="button"
                  className="studio-secondary-button studio-wide"
                  onClick={() => nodeAction("upload")}
                >
                  <Upload size={15} />
                  {c.upload}
                </button>
              </section>
            )}
            {node.type !== "group" && (
              <>
                <section className="studio-inspector-section">
                  <h3>{c.output}</h3>
                  <div
                    className="studio-output-switch"
                    role="group"
                    aria-label={c.output}
                  >
                    {modeOptions.map(({ id, icon: Icon }) => (
                      <button
                        type="button"
                        key={id}
                        aria-pressed={mode === id}
                        onClick={() =>
                          patchMetadata({
                            generationMode: id,
                            model: undefined,
                          })
                        }
                      >
                        <Icon size={16} strokeWidth={1.7} />
                        <span>{c[id]}</span>
                      </button>
                    ))}
                  </div>
                  <Field title={c.prompt}>
                    <textarea
                      rows={6}
                      value={prompt}
                      onChange={(event) => updatePrompt(event.target.value)}
                      placeholder={c.promptPlaceholder}
                    />
                  </Field>
                  <div className="studio-field-title-row">
                    <label htmlFor={`${fieldId}-model`}>{c.model}</label>
                    <button
                      type="button"
                      className="studio-text-button"
                      onClick={() => nodeAction("settings")}
                    >
                      {c.configureModel}
                      <ArrowUpRight size={11} />
                    </button>
                  </div>
                  <select
                    id={`${fieldId}-model`}
                    className="studio-select"
                    value={selectedModel}
                    onChange={(event) =>
                      patchMetadata({ model: event.target.value })
                    }
                  >
                    {!selectedModel && <option value="">{c.modelNone}</option>}
                    {selectedModel &&
                      !models.some(
                        (entry) => entry.value === selectedModel,
                      ) && (
                        <option value={selectedModel}>{selectedModel}</option>
                      )}
                    {models.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={!option.available}
                      >
                        {option.name}
                      </option>
                    ))}
                  </select>
                  {(mode === "image" || mode === "video") && (
                    <div className="studio-field-pair">
                      <Field title={c.size}>
                        <select
                          value={metadata.size || "auto"}
                          onChange={(event) =>
                            patchMetadata({ size: event.target.value })
                          }
                        >
                          {[
                            ...new Set([
                              "auto",
                              "1:1",
                              "16:9",
                              "9:16",
                              "4:3",
                              "3:4",
                              ...(metadata.size ? [metadata.size] : []),
                            ]),
                          ].map((value) => (
                            <option key={value} value={value}>
                              {value === "auto" ? c.automatic : value}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {mode === "image" ? (
                        <Field title={c.count}>
                          <input
                            type="number"
                            min={1}
                            max={4}
                            value={metadata.count || 1}
                            onChange={(event) => {
                              const value = event.target.valueAsNumber;
                              if (Number.isFinite(value))
                                patchMetadata({
                                  count: Math.min(
                                    4,
                                    Math.max(1, Math.round(value)),
                                  ),
                                });
                            }}
                          />
                        </Field>
                      ) : (
                        <Field title={c.duration}>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={metadata.seconds || "8"}
                            onChange={(event) => {
                              const value = event.target.valueAsNumber;
                              if (Number.isFinite(value))
                                patchMetadata({
                                  seconds: String(
                                    Math.min(60, Math.max(1, value)),
                                  ),
                                });
                            }}
                          />
                        </Field>
                      )}
                    </div>
                  )}
                  {mode === "video" && (
                    <>
                      <Field title={c.videoMode}>
                        <select
                          value={metadata.videoMode || "auto"}
                          onChange={(event) =>
                            patchMetadata({ videoMode: event.target.value })
                          }
                        >
                          <option value="auto">{c.modeAuto}</option>
                          <option value="reference">{c.modeReference}</option>
                          <option value="frames">{c.modeFrames}</option>
                        </select>
                      </Field>
                      {metadata.videoMode === "frames" && (
                        <div className="studio-frame-note">
                          <p>{c.framesHint}</p>
                          <button
                            type="button"
                            className="studio-secondary-button"
                            onClick={() =>
                              patchMetadata({
                                videoFramesReversed:
                                  !metadata.videoFramesReversed,
                              })
                            }
                            aria-pressed={Boolean(metadata.videoFramesReversed)}
                          >
                            <ArrowDownUp size={14} />
                            {c.swapFrames}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </section>
                {mode === "video" && (
                  <section className="studio-inspector-section">
                    <div className="studio-section-heading">
                      <h3>{c.skill}</h3>
                      <button
                        type="button"
                        className="studio-icon-button"
                        disabled={skillLoading || preparing}
                        onClick={() => setSkillRevision((value) => value + 1)}
                        aria-label={c.skillRefresh}
                        title={c.skillRefresh}
                      >
                        <RefreshCw
                          size={14}
                          strokeWidth={1.7}
                          className={
                            skillLoading ? "studio-is-loading" : undefined
                          }
                        />
                      </button>
                    </div>
                    <select
                      className="studio-select"
                      value={skillId}
                      disabled={skillLoading || preparing}
                      aria-label={c.skill}
                      onChange={(event) => {
                        setSkillId(event.target.value);
                        setSkillMessage("");
                        setSkillError("");
                        if (!event.target.value)
                          patchMetadata({
                            videoSkillId: undefined,
                            videoSkillVersion: undefined,
                            videoSkillInputMode: undefined,
                            skillId: undefined,
                            skillVersion: undefined,
                          });
                      }}
                    >
                      <option value="">
                        {skillLoading ? c.skillPreparing : c.skillNone}
                      </option>
                      {skillId &&
                        !skills.some((entry) => entry.id === skillId) && (
                          <option value={skillId}>{skillId}</option>
                        )}
                      {skills.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <p className="studio-field-hint">
                      {!skillLoading && skills.length === 0
                        ? c.skillEmpty
                        : c.skillHint}
                    </p>
                    {skill && (
                      <button
                        className="studio-secondary-button studio-wide"
                        type="button"
                        disabled={preparing || props.busy}
                        onClick={() => void prepareSkill()}
                      >
                        <Sparkles size={15} />
                        {preparing ? c.skillPreparing : c.skillApply}
                      </button>
                    )}
                    {skillError && (
                      <p className="studio-inline-error" role="alert">
                        {skillError}
                      </p>
                    )}
                    {skillMessage && (
                      <p className="studio-inline-success" role="status">
                        <Check size={13} />
                        {skillMessage}
                      </p>
                    )}
                  </section>
                )}
                <section className="studio-inspector-section">
                  <div className="studio-section-heading">
                    <h3>{c.connections}</h3>
                    <span className="studio-section-count">
                      {incoming.length}
                    </span>
                  </div>
                  {incoming.length === 0 ? (
                    <p className="studio-field-hint">{c.noConnections}</p>
                  ) : (
                    <ol className="studio-reference-list">
                      {incoming.map((edge, index) => {
                        const source = props.nodes.find(
                          (entry) => entry.id === edge.fromNodeId,
                        );
                        return (
                          <li key={edge.id}>
                            <span className="studio-reference-order">
                              {index + 1}
                            </span>
                            {source?.type === "image" &&
                            source.metadata?.content ? (
                              <img src={source.metadata.content} alt="" />
                            ) : (
                              <Link2 size={15} />
                            )}
                            <span title={source?.title}>
                              {source?.title || c.sourceMissing}
                            </span>
                            <button
                              type="button"
                              className="studio-icon-button"
                              aria-label={`${c.disconnect}: ${source?.title || edge.id}`}
                              onClick={() =>
                                nodeAction(`disconnect:${edge.id}`)
                              }
                            >
                              <Unplug size={14} />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              </>
            )}
            {(hasMedia || node.type === "text" || node.type === "group") && (
              <section className="studio-inspector-section">
                <h3>{node.type === "group" ? c.layout : c.mediaTools}</h3>
                <div className="studio-action-grid">
                  {hasMedia && actionButton("download", c.download, Download)}
                  {hasMedia && actionButton("saveAsset", c.saveAsset, Layers3)}
                  {node.type === "image" &&
                    hasMedia &&
                    imageActions.map(({ action, label, icon }) =>
                      actionButton(action, c[label], icon),
                    )}
                  {node.type === "video" &&
                    hasMedia &&
                    videoActions.map(({ action, label, icon }) =>
                      actionButton(action, c[label], icon),
                    )}
                  {node.type === "text" &&
                    actionButton(
                      "prepare-video",
                      c.prepareVideo,
                      Video,
                      !metadata.content?.trim(),
                    )}
                  {node.type === "group" &&
                    actionButton("ungroup", c.ungroup, Ungroup)}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            <section className="studio-inspector-section studio-first-section">
              <Field title={c.nodeName}>
                <input
                  value={node.title}
                  maxLength={120}
                  onChange={(event) =>
                    props.onPatch(node.id, { title: event.target.value })
                  }
                />
              </Field>
              <p className="studio-field-hint">{c.detailsHint}</p>
              <h3>{c.layout}</h3>
              <div className="studio-field-pair">
                <Field title="X">
                  <input
                    type="number"
                    value={Math.round(node.position.x)}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value))
                        props.onPatch(node.id, {
                          position: { ...node.position, x: value },
                        });
                    }}
                  />
                </Field>
                <Field title="Y">
                  <input
                    type="number"
                    value={Math.round(node.position.y)}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value))
                        props.onPatch(node.id, {
                          position: { ...node.position, y: value },
                        });
                    }}
                  />
                </Field>
                <Field title={c.width}>
                  <input
                    type="number"
                    min={40}
                    max={4096}
                    value={Math.round(node.width)}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value))
                        props.onPatch(node.id, {
                          width: Math.max(40, Math.min(4096, value)),
                        });
                    }}
                  />
                </Field>
                <Field title={c.height}>
                  <input
                    type="number"
                    min={40}
                    max={4096}
                    value={Math.round(node.height)}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value))
                        props.onPatch(node.id, {
                          height: Math.max(40, Math.min(4096, value)),
                        });
                    }}
                  />
                </Field>
              </div>
              {node.type === "text" && (
                <Field title={c.fontSize}>
                  <input
                    type="range"
                    min={10}
                    max={48}
                    step={1}
                    value={metadata.fontSize || 14}
                    onChange={(event) =>
                      patchMetadata({ fontSize: Number(event.target.value) })
                    }
                  />
                </Field>
              )}
              {node.type === "image" && (
                <label className="studio-checkbox-field">
                  <input
                    type="checkbox"
                    checked={Boolean(metadata.freeResize)}
                    onChange={(event) =>
                      patchMetadata({ freeResize: event.target.checked })
                    }
                  />
                  <span>{c.freeResize}</span>
                </label>
              )}
            </section>
            <section className="studio-inspector-section">
              <button
                type="button"
                className="studio-delete-button"
                onClick={() => nodeAction("delete")}
              >
                <Trash2 size={15} />
                {c.danger}
              </button>
            </section>
          </>
        )}
        {metadata.errorDetails && (
          <p
            className="studio-inline-error studio-generation-error"
            role="alert"
          >
            {metadata.errorDetails}
          </p>
        )}
      </div>
      {node.type !== "group" && tab === "compose" && (
        <div className="studio-generate-footer">
          {props.busy ? (
            <button
              type="button"
              className="studio-stop-button"
              onClick={() => props.onStop(node.id)}
            >
              <Square size={13} fill="currentColor" />
              {c.stop}
            </button>
          ) : mode === "text" ? (
            <button
              type="button"
              className="studio-generate-button"
              onClick={() => nodeAction("codex")}
            >
              <Sparkles size={17} />
              <span>{c.codex}</span>
              <ArrowUpRight size={16} />
            </button>
          ) : mode === "audio" ? (
            <button
              type="button"
              className="studio-secondary-button studio-wide"
              onClick={() => nodeAction("upload")}
            >
              <Upload size={16} />
              {c.upload}
            </button>
          ) : (
            <button
              type="button"
              className="studio-generate-button"
              onClick={() => props.onGenerate(node.id, mode, prompt.trim())}
              disabled={
                !prompt.trim() ||
                preparing ||
                !models.some((entry) => entry.available)
              }
            >
              <Sparkles size={17} strokeWidth={1.7} />
              <span>{c.generate}</span>
              <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { useId } from "react";
import { DropdownMenu, Popover } from "radix-ui";
import {
  ArrowDownUp,
  ArrowUp,
  AudioLines,
  ChevronDown,
  Code2,
  FolderOpen,
  Image,
  Link2,
  Plus,
  Settings2,
  Square,
  Type,
  Upload,
  Video,
  WandSparkles,
} from "lucide-react";
import type {
  CanvasGenerationMode,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/types/canvas";
import { useStudioCopy } from "./copy";
import "./studio-prompt-composer.css";

export type StudioPromptComposerProps = {
  node: CanvasNodeData;
  mode: CanvasGenerationMode;
  prompt: string;
  models: { value: string; name: string; available: boolean }[];
  selectedModel: string;
  references: { edgeId: string; node?: CanvasNodeData }[];
  skillName?: string;
  busy: boolean;
  preparing: boolean;
  generationDisabled: boolean;
  error?: string;
  onPrompt: (value: string) => void;
  onMetadata: (patch: CanvasNodeMetadata) => void;
  onAction: (action: string) => void;
  onGenerate: () => void;
  onStop: () => void;
};

/** Screen-space composer; generation and account state remain owned by the inspector. */
export function StudioPromptComposer(props: StudioPromptComposerProps) {
  const c = useStudioCopy();
  const fieldId = useId();
  const metadata = props.node.metadata || {};
  const frameMode = props.mode === "video" && metadata.videoMode === "frames";
  const imageReferences = props.references.filter(
    (item) => item.node?.type === "image" && item.node.metadata?.content,
  );
  const frameImages = metadata.videoFramesReversed
    ? [...imageReferences].reverse()
    : imageReferences;
  const sizes = [
    ...new Set([
      "auto",
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      ...(metadata.size ? [metadata.size] : []),
    ]),
  ];
  const busy = props.busy || props.preparing;
  const numericSetting = (key: "count" | "seconds", value: number) => {
    if (!Number.isFinite(value)) return;
    props.onMetadata(
      key === "count"
        ? { count: Math.max(1, Math.min(4, Math.round(value))) }
        : { seconds: String(Math.max(2, Math.min(20, Math.round(value)))) },
    );
  };
  const modeIcon =
    props.mode === "video" ? <Video size={15} /> : <Image size={15} />;
  return (
    <div className="studio-prompt-composer" aria-label={c.prompt}>
      <div className="studio-prompt-references">
        <span className="studio-prompt-reference-label">
          <Link2 size={13} />
          {c.referenceContent}
        </span>
        <div className="studio-prompt-reference-items">
          {props.references.slice(0, 5).map(({ edgeId, node }) => {
            const frameIndex = frameMode
              ? frameImages.findIndex((item) => item.edgeId === edgeId)
              : -1;
            const frameLabel =
              frameIndex === 0
                ? c.firstFrame
                : frameIndex === 1
                  ? c.lastFrame
                  : "";
            const label = frameLabel || node?.title || c.sourceMissing;
            return (
              <button
                key={edgeId}
                type="button"
                className="studio-prompt-reference"
                aria-label={`${c.connections}: ${label}`}
                title={label}
                onClick={() => props.onAction("node-references")}
              >
                {node?.type === "image" && node.metadata?.content ? (
                  <img
                    src={node.metadata.content}
                    alt={node.title || c.image}
                    loading="lazy"
                  />
                ) : node?.type === "video" ? (
                  <Video size={16} />
                ) : node?.type === "audio" ? (
                  <AudioLines size={16} />
                ) : (
                  <Type size={16} />
                )}
                {frameLabel && <span>{frameLabel}</span>}
              </button>
            );
          })}
          {props.references.length > 5 && (
            <button
              type="button"
              className="studio-prompt-reference studio-prompt-overflow"
              onClick={() => props.onAction("node-references")}
              aria-label={`${c.connections}: ${props.references.length}`}
            >
              +{props.references.length - 5}
            </button>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="studio-prompt-add-reference"
                aria-label={c.attachReference}
                title={c.attachReference}
              >
                <Plus size={17} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="studio-command-menu"
                align="start"
                sideOffset={6}
                collisionPadding={12}
              >
                <DropdownMenu.Item
                  className="studio-menu-item"
                  onSelect={() => props.onAction("assets-reference")}
                >
                  <FolderOpen size={15} />
                  {c.chooseReferences}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="studio-menu-item"
                  onSelect={() => props.onAction("upload-reference")}
                >
                  <Upload size={15} />
                  {c.upload}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="studio-menu-item"
                  onSelect={() => props.onAction("node-references")}
                >
                  <Link2 size={15} />
                  {c.connections}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <label className="studio-prompt-input" htmlFor={`${fieldId}-prompt`}>
        <textarea
          id={`${fieldId}-prompt`}
          aria-label={c.prompt}
          value={props.prompt}
          onChange={(event) => props.onPrompt(event.target.value)}
          placeholder={c.promptPlaceholder}
          disabled={busy}
        />
      </label>
      {props.error && (
        <p className="studio-prompt-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="studio-prompt-controls">
        <div className="studio-prompt-options">
          {(props.mode === "video" || props.mode === "image") && (
            <button
              type="button"
              className="studio-prompt-skill"
              onClick={() => props.onAction("node-skills")}
              title={props.mode === "video" ? c.skill : c.skillSwitchVideo}
              aria-label={props.mode === "video" ? c.skill : c.skillSwitchVideo}
              disabled={busy}
            >
              <WandSparkles size={15} />
              <span>{props.skillName || c.skill}</span>
            </button>
          )}
          {(props.mode === "image" || props.mode === "video") && (
            <label className="studio-prompt-model" title={c.model}>
              {modeIcon}
              <select
                aria-label={c.model}
                value={props.selectedModel}
                disabled={busy}
                onChange={(event) =>
                  props.onMetadata({ model: event.target.value })
                }
              >
                {!props.selectedModel && (
                  <option value="">{c.modelNone}</option>
                )}
                {props.selectedModel &&
                  !props.models.some(
                    (item) => item.value === props.selectedModel,
                  ) && (
                    <option value={props.selectedModel}>
                      {props.selectedModel}
                    </option>
                  )}
                {props.models.map((item) => (
                  <option
                    key={item.value}
                    value={item.value}
                    disabled={!item.available}
                  >
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
          )}
          {(props.mode === "image" || props.mode === "video") && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="studio-prompt-settings"
                  aria-label={c.generationParameters}
                  title={c.generationParameters}
                  disabled={busy}
                >
                  <Settings2 size={15} />
                  <span>
                    {metadata.size && metadata.size !== "auto"
                      ? metadata.size
                      : c.automatic}
                  </span>
                  <span className="studio-prompt-setting-unit">
                    {props.mode === "video"
                      ? `${metadata.seconds || "8"}s`
                      : `×${metadata.count || 1}`}
                  </span>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="studio-command-menu studio-prompt-parameters"
                  side="top"
                  align="end"
                  sideOffset={10}
                  collisionPadding={12}
                  aria-label={c.generationParameters}
                >
                  <div className="studio-prompt-parameter-heading">
                    <Settings2 size={14} />
                    {c.generationParameters}
                  </div>
                  <label>
                    {c.size}
                    <select
                      value={metadata.size || "auto"}
                      onChange={(event) =>
                        props.onMetadata({ size: event.target.value })
                      }
                    >
                      {sizes.map((value) => (
                        <option key={value} value={value}>
                          {value === "auto" ? c.automatic : value}
                        </option>
                      ))}
                    </select>
                  </label>
                  {props.mode === "image" ? (
                    <label>
                      {c.count}
                      <input
                        type="number"
                        min={1}
                        max={4}
                        step={1}
                        value={metadata.count || 1}
                        onChange={(event) =>
                          numericSetting("count", event.target.valueAsNumber)
                        }
                      />
                    </label>
                  ) : (
                    <>
                      <label>
                        {c.duration}
                        <input
                          type="number"
                          min={2}
                          max={20}
                          value={metadata.seconds || "8"}
                          onChange={(event) =>
                            numericSetting(
                              "seconds",
                              event.target.valueAsNumber,
                            )
                          }
                        />
                      </label>
                      <label>
                        {c.videoMode}
                        <select
                          value={metadata.videoMode || "auto"}
                          onChange={(event) =>
                            props.onMetadata({ videoMode: event.target.value })
                          }
                        >
                          <option value="auto">{c.modeAuto}</option>
                          <option value="reference">{c.modeReference}</option>
                          <option value="frames">{c.modeFrames}</option>
                        </select>
                      </label>
                      {frameMode && (
                        <>
                          <p>{c.framesHint}</p>
                          <button
                            type="button"
                            className="studio-prompt-swap"
                            aria-pressed={Boolean(metadata.videoFramesReversed)}
                            onClick={() =>
                              props.onMetadata({
                                videoFramesReversed:
                                  !metadata.videoFramesReversed,
                              })
                            }
                          >
                            <ArrowDownUp size={14} />
                            {c.swapFrames}
                          </button>
                        </>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className="studio-prompt-configure"
                    onClick={() => props.onAction("settings")}
                  >
                    {c.configureModel}
                    <ArrowUp size={12} />
                  </button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>
        {props.busy ? (
          <button
            type="button"
            className="studio-prompt-submit is-stop"
            onClick={props.onStop}
            aria-label={c.stop}
            title={c.stop}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : props.mode === "text" ? (
          <button
            type="button"
            className="studio-prompt-submit"
            onClick={() => props.onAction("codex")}
            aria-label={c.codex}
            title={c.codex}
          >
            <Code2 size={18} />
          </button>
        ) : props.mode === "audio" ? (
          <button
            type="button"
            className="studio-prompt-submit"
            onClick={() => props.onAction("upload")}
            aria-label={c.upload}
            title={c.upload}
          >
            <Upload size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="studio-prompt-submit"
            onClick={props.onGenerate}
            disabled={props.generationDisabled || busy}
            aria-label={props.preparing ? c.skillPreparing : c.generate}
            title={props.preparing ? c.skillPreparing : c.generate}
          >
            <ArrowUp size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

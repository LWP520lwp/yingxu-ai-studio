import { useEffect, useRef, useState } from "react";
import { VideoSkillSelect } from "../../../../web/src/VideoSkillSelect";
import type { VideoSkillOption } from "../../../../web/src/videoGenerationSkill";
import { getPlatformInit, onPlatformInit, platformRequest } from "@/platform/rpc";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { openPlatformAction } from "@/platform/navigation";
import type { SkillDefinition } from "../../../../web/src/SkillMarket";
import { changeVideoSkillSelection, recoverLegacyVideoSkill, videoSkillInstruction, videoSkillInstructionPatch, videoSkillSelection } from "@/platform/video-skill-state";

export function CanvasVideoSkillSelect({ metadata, disabled, onChange }: {
  metadata?: CanvasNodeMetadata;
  disabled?: boolean;
  onChange: (patch: Partial<CanvasNodeMetadata>) => void;
}) {
  const [skills, setSkills] = useState<VideoSkillOption[]>([]);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);
  const selected = videoSkillSelection(metadata);
  const selection = useRef(selected.id); selection.current = selected.id;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const metadataRef = useRef(metadata); metadataRef.current = metadata;
  const migrationKey = JSON.stringify([selected.id, selected.version, selected.legacy, videoSkillInstruction(metadata)]);
  const currentMigrationKey = useRef(migrationKey); currentMigrationKey.current = migrationKey;
  const [migration, setMigration] = useState<{ key: string; reason: string; definition?: SkillDefinition } | null>(null);
  const [migrationReload, setMigrationReload] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const refreshSkills = useRef<() => void>(() => undefined);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    let request = 0;
    const refresh = () => {
      const current = getPlatformInit(); const revision = ++request;
      if (!current) return;
      void platformRequest<{ skills: VideoSkillOption[] }>("skills.list", {}, { signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted && revision === request && getPlatformInit()?.scopeId === current.scopeId) { setSkills(result.skills); setError(""); }
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Skill 列表读取失败"); });
    };
    refreshSkills.current = refresh;
    const unsubscribe = onPlatformInit(refresh);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); unsubscribe(); window.removeEventListener("focus", refresh); refreshSkills.current = () => undefined; if (lifetime.current === controller) lifetime.current = null; };
  }, []);
  useEffect(() => {
    if (!selected.legacy || !metadata) { setMigration(null); return; }
    const controller = new AbortController();
    const snapshot = metadata;
    let revision = 0;
    const inspect = () => {
      const current = getPlatformInit(); const request = ++revision;
      if (!current) return;
      setMigration({ key: migrationKey, reason: "正在确认此节点原有的 Skill 配方…" });
      void platformRequest<SkillDefinition>("skills.detail", { id: selected.id }, { signal: controller.signal, timeoutMs: 20_000 }).then((definition) => {
        if (controller.signal.aborted || revision !== request || currentMigrationKey.current !== migrationKey || getPlatformInit()?.scopeId !== current.scopeId) return;
        const recovered = recoverLegacyVideoSkill(snapshot, definition);
        if (recovered.ready) {
          onChangeRef.current(videoSkillInstructionPatch(definition, recovered.instruction));
          setMigration(null);
        } else setMigration({ key: migrationKey, reason: recovered.reason, definition });
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted && revision === request && currentMigrationKey.current === migrationKey && getPlatformInit()?.scopeId === current.scopeId) setMigration({ key: migrationKey, reason: cause instanceof Error ? cause.message : "原有 Skill 读取失败，请刷新技能后重试" });
      });
    };
    const unsubscribe = onPlatformInit(inspect);
    return () => { controller.abort(); unsubscribe(); };
  }, [migrationKey, selected.id, selected.legacy, migrationReload]);
  const install = async (skill: VideoSkillOption) => {
    const controller = lifetime.current, scope = getPlatformInit()?.scopeId;
    if (!controller || controller.signal.aborted || installing) return;
    setInstalling(true); setError("");
    try {
      const result = await platformRequest<VideoSkillOption>("skills.install", { id: skill.id, version: skill.version }, { signal: controller.signal });
      if (controller.signal.aborted || getPlatformInit()?.scopeId !== scope) return;
      setSkills((items) => items.map((item) => item.id === result.id ? result : item));
      if (selection.current === skill.id) {
        if (videoSkillSelection(metadataRef.current).legacy) setMigrationReload((value) => value + 1);
        else onChangeRef.current({ videoSkillId: result.id, videoSkillVersion: result.version });
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Skill 安装失败"); }
    finally { if (!controller.signal.aborted) setInstalling(false); }
  };
  return <div className="canvas-video-skill-control mb-2 min-w-0 cursor-default" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <VideoSkillSelect skills={skills} value={selected.id} disabled={disabled} installing={installing} onInstall={(skill) => void install(skill)} onManage={() => { void openPlatformAction("skills").catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "技能库打开失败")); }} onRefresh={() => { refreshSkills.current(); setMigrationReload((value) => value + 1); }} onChange={(id) => {
      const skill = skills.find((item) => item.id === id);
      try { onChange(changeVideoSkillSelection(metadata, id, skill?.version)); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "请先确认旧配置的镜头文字"); }
    }}/>
    {selected.id && !selected.legacy && <p className="mt-1 text-xs opacity-70" role="status">已选择此 Skill，提交时会与你的镜头文字组合一次；改选或停用会保留原始文字。</p>}
    {selected.legacy && <div className="mt-2 space-y-2 rounded-md border border-current/20 p-2 text-xs">
      <p role="status">{migration?.key === migrationKey ? migration.reason : "此节点已关联 Skill，正在确认原有配方。"}</p>
      {migration?.key === migrationKey && migration.definition && <>
        <p className="opacity-70">确认后会把编辑框全部文字作为镜头内容，再应用当前配方一次。请先检查文字中是否含旧配方；需要保留旧方法时可另建配置。</p>
        <button type="button" disabled={disabled || installing} className="rounded border border-current/30 px-2 py-1" onClick={() => {
          const current = metadataRef.current;
          if (!current || currentMigrationKey.current !== migrationKey || !migration.definition) return;
          onChangeRef.current(videoSkillInstructionPatch(migration.definition, videoSkillInstruction(current))); setError(""); setMigration(null);
        }}>将现有文字作为镜头内容</button>
      </>}
    </div>}
    {error && <p className="mt-1 text-xs text-red-500" role="alert">{error}</p>}
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { VideoSkillSelect } from "../../../../web/src/VideoSkillSelect";
import type { VideoSkillOption } from "../../../../web/src/videoGenerationSkill";
import type { SkillDefinition } from "../../../../web/src/SkillMarket";

import {
  changeVideoSkillSelection,
  recoverLegacyVideoSkill,
  videoSkillInstruction,
  videoSkillInstructionPatch,
  videoSkillSelection,
} from "@/platform/video-skill-state";
import {
  getPlatformInit,
  onPlatformInit,
  platformRequest,
} from "@/platform/rpc";
import { openPlatformAction } from "@/platform/navigation";
import {
  isCurrentSkillRequest,
  skillRequestErrorMessage,
} from "@/platform/scoped-skill-request";
import type { CanvasNodeMetadata } from "@/types/canvas";

type Props = {
  metadata?: CanvasNodeMetadata;
  disabled?: boolean;
  onChange: (patch: Partial<CanvasNodeMetadata>) => void;
};

type MigrationState = {
  key: string;
  status: "loading" | "review" | "error";
  reason: string;
  definition?: SkillDefinition;
};

const EMPTY_SKILL_MESSAGE = "技能列表为空，请检查工作台连接或刷新技能。";

export function CanvasVideoSkillSelect({
  metadata,
  disabled,
  onChange,
}: Props) {
  const selected = videoSkillSelection(metadata);
  const migrationKey = JSON.stringify([
    selected.id,
    selected.version,
    selected.legacy,
    videoSkillInstruction(metadata),
  ]);

  const [skills, setSkills] = useState<VideoSkillOption[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [migration, setMigration] = useState<MigrationState | null>(null);
  const [migrationReload, setMigrationReload] = useState(0);

  const listRevision = useRef(0);
  const migrationRevision = useRef(0);
  const installRevision = useRef(0);
  const installLock = useRef(false);
  const scopeId = useRef<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const refreshSkills = useRef<() => void>(() => undefined);
  const selectedId = useRef(selected.id);
  const metadataValue = useRef(metadata);
  const onChangeValue = useRef(onChange);
  const currentMigrationKey = useRef(migrationKey);

  selectedId.current = selected.id;
  metadataValue.current = metadata;
  onChangeValue.current = onChange;
  currentMigrationKey.current = migrationKey;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;

    const loadSkills = () => {
      const init = getPlatformInit();
      if (!init || controller.signal.aborted) return;

      if (scopeId.current !== init.scopeId) {
        scopeId.current = init.scopeId;
        setSkills([]);
        setError("");
      }

      const revision = ++listRevision.current;
      const ticket = {
        scopeId: init.scopeId,
        revision,
        signal: controller.signal,
      };
      setLoadingSkills(true);
      setError("");

      void platformRequest<{ skills: VideoSkillOption[] }>(
        "skills.list",
        {},
        { signal: controller.signal },
      )
        .then((result) => {
          if (
            !isCurrentSkillRequest(ticket, {
              scopeId: getPlatformInit()?.scopeId ?? null,
              revision: listRevision.current,
            })
          ) {
            return;
          }
          setSkills(Array.isArray(result.skills) ? result.skills : []);
        })
        .catch((cause: unknown) => {
          if (
            isCurrentSkillRequest(ticket, {
              scopeId: getPlatformInit()?.scopeId ?? null,
              revision: listRevision.current,
            })
          ) {
            setError(
              skillRequestErrorMessage(cause, "视频 Skill 列表读取失败"),
            );
          }
        })
        .finally(() => {
          if (
            isCurrentSkillRequest(ticket, {
              scopeId: getPlatformInit()?.scopeId ?? null,
              revision: listRevision.current,
            })
          ) {
            setLoadingSkills(false);
          }
        });
    };

    refreshSkills.current = loadSkills;
    const unsubscribe = onPlatformInit(loadSkills);
    window.addEventListener("focus", loadSkills);

    return () => {
      listRevision.current += 1;
      controller.abort();
      unsubscribe();
      window.removeEventListener("focus", loadSkills);
      refreshSkills.current = () => undefined;
      if (lifetime.current === controller) lifetime.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selected.legacy || !metadata) {
      migrationRevision.current += 1;
      setMigration(null);
      return;
    }

    const controller = new AbortController();
    const snapshot = metadata;

    const inspectLegacySkill = () => {
      const init = getPlatformInit();
      if (!init || controller.signal.aborted) return;

      const revision = ++migrationRevision.current;
      const ticket = {
        scopeId: init.scopeId,
        revision,
        key: migrationKey,
        signal: controller.signal,
      };
      setMigration({
        key: migrationKey,
        status: "loading",
        reason: "正在确认此节点原有的 Skill 配方…",
      });

      void platformRequest<SkillDefinition>(
        "skills.detail",
        { id: selected.id },
        { signal: controller.signal, timeoutMs: 20_000 },
      )
        .then((definition) => {
          const current = isCurrentSkillRequest(ticket, {
            scopeId: getPlatformInit()?.scopeId ?? null,
            revision: migrationRevision.current,
            key: currentMigrationKey.current,
          });
          if (!current) return;

          const recovered = recoverLegacyVideoSkill(snapshot, definition);
          if (recovered.ready) {
            onChangeValue.current(
              videoSkillInstructionPatch(definition, recovered.instruction),
            );
            setMigration(null);
            return;
          }

          setMigration({
            key: migrationKey,
            status: "review",
            reason: recovered.reason,
            definition,
          });
        })
        .catch((cause: unknown) => {
          if (
            !isCurrentSkillRequest(ticket, {
              scopeId: getPlatformInit()?.scopeId ?? null,
              revision: migrationRevision.current,
              key: currentMigrationKey.current,
            })
          ) {
            return;
          }

          setMigration({
            key: migrationKey,
            status: "error",
            reason: skillRequestErrorMessage(
              cause,
              "原有 Skill 读取失败，请刷新技能后重试",
            ),
          });
        });
    };

    const unsubscribe = onPlatformInit(inspectLegacySkill);
    return () => {
      migrationRevision.current += 1;
      controller.abort();
      unsubscribe();
    };
  }, [migrationKey, selected.id, selected.legacy, migrationReload, metadata]);

  const installSkill = async (skill: VideoSkillOption) => {
    const controller = lifetime.current;
    const init = getPlatformInit();
    if (
      !controller ||
      controller.signal.aborted ||
      !init ||
      installLock.current
    ) {
      return;
    }

    installLock.current = true;
    const revision = ++installRevision.current;
    const ticket = {
      scopeId: init.scopeId,
      revision,
      signal: controller.signal,
    };
    setInstalling(true);
    setError("");

    try {
      const result = await platformRequest<VideoSkillOption>(
        "skills.install",
        { id: skill.id, version: skill.version },
        { signal: controller.signal },
      );
      if (
        !isCurrentSkillRequest(ticket, {
          scopeId: getPlatformInit()?.scopeId ?? null,
          revision: installRevision.current,
        })
      ) {
        return;
      }

      setSkills((current) =>
        current.map((item) => (item.id === result.id ? result : item)),
      );
      if (selectedId.current !== skill.id) return;

      if (videoSkillSelection(metadataValue.current).legacy) {
        setMigrationReload((value) => value + 1);
      } else {
        onChangeValue.current({
          videoSkillId: result.id,
          videoSkillVersion: result.version,
        });
      }
    } catch (cause) {
      if (
        isCurrentSkillRequest(ticket, {
          scopeId: getPlatformInit()?.scopeId ?? null,
          revision: installRevision.current,
        })
      ) {
        setError(skillRequestErrorMessage(cause, "视频 Skill 安装失败"));
      }
    } finally {
      if (!controller.signal.aborted && installRevision.current === revision) {
        installLock.current = false;
        setInstalling(false);
      }
    }
  };

  const manageSkills = async () => {
    const requestScope = getPlatformInit()?.scopeId;
    try {
      await openPlatformAction("skills");
      if (getPlatformInit()?.scopeId === requestScope) setError("");
    } catch (cause) {
      if (getPlatformInit()?.scopeId === requestScope) {
        setError(skillRequestErrorMessage(cause, "技能库打开失败"));
      }
    }
  };

  const selectSkill = (id: string) => {
    const skill = skills.find((item) => item.id === id);
    try {
      onChangeValue.current(
        changeVideoSkillSelection(metadataValue.current, id, skill?.version),
      );
      setError("");
    } catch (cause) {
      setError(
        skillRequestErrorMessage(
          cause,
          "请先确认旧配置的镜头文字，再改选 Skill",
        ),
      );
    }
  };

  const confirmLegacyInstruction = () => {
    const current = metadataValue.current;
    const definition = migration?.definition;
    if (
      !current ||
      !definition ||
      currentMigrationKey.current !== migrationKey ||
      migration.key !== migrationKey
    ) {
      return;
    }

    onChangeValue.current(
      videoSkillInstructionPatch(definition, videoSkillInstruction(current)),
    );
    setError("");
    setMigration(null);
  };

  const refresh = () => {
    refreshSkills.current();
    setMigrationReload((value) => value + 1);
  };

  const migrationState = migration?.key === migrationKey ? migration : null;

  return (
    <div
      className="canvas-video-skill-control mb-2 min-w-0 cursor-default"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <VideoSkillSelect
        skills={skills}
        value={selected.id}
        disabled={disabled}
        installing={installing}
        onInstall={(skill) => void installSkill(skill)}
        onManage={() => void manageSkills()}
        onRefresh={refresh}
        onChange={selectSkill}
      />

      {loadingSkills ? (
        <p className="mt-1 text-xs opacity-65" role="status" aria-live="polite">
          正在读取视频 Skill…
        </p>
      ) : null}
      {!loadingSkills && !error && skills.length === 0 ? (
        <p className="mt-1 text-xs opacity-65" role="status">
          {EMPTY_SKILL_MESSAGE}
        </p>
      ) : null}
      {selected.id && !selected.legacy ? (
        <p className="mt-1 text-xs opacity-70" role="status">
          已选择此
          Skill，提交时会与你的镜头文字组合一次；改选或停用会保留原始文字。
        </p>
      ) : null}

      {selected.legacy ? (
        <div className="mt-2 space-y-2 rounded-md border border-current/20 p-2 text-xs">
          <p role="status" aria-live="polite">
            {migrationState?.reason ?? "此节点已关联 Skill，正在确认原有配方。"}
          </p>
          {migrationState?.status === "review" && migrationState.definition ? (
            <>
              <p className="opacity-70">
                确认后会把编辑框全部文字作为镜头内容，再应用当前配方一次。请先检查文字中是否含旧配方；需要保留旧方法时可另建配置。
              </p>
              <button
                type="button"
                disabled={disabled || installing}
                className="min-h-8 rounded border border-current/30 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                onClick={confirmLegacyInstruction}
              >
                将现有文字作为镜头内容
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-1 text-xs text-red-500" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

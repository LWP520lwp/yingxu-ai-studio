import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import {
  normalizeStudioDocument,
  type StudioDocument,
} from "@/atlas-engine/studio/studio-document";
import StudioWorkspace from "@/atlas-engine/studio/StudioWorkspace";

/** Restore a draft once per route; a failed load must never overwrite its saved content. */
export default function CanvasProjectPage() {
  const { id = "" } = useParams();
  const hydrated = useCanvasStore((state) => state.hydrated);
  const [loaded, setLoaded] = useState<{
    id: string;
    document: StudioDocument;
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    setLoaded(null);
    setError("");
    const project = useCanvasStore.getState().openProject(id);
    if (!project) {
      setError("找不到这个画布草稿，请返回草稿库重新打开。");
      return;
    }
    const nodes = structuredClone(project.nodes);
    let cursor = 0;
    const worker = async () => {
      while (active && cursor < nodes.length) {
        const node = nodes[cursor++];
        const meta = node.metadata;
        if (!meta) continue;
        if (node.type === "image") {
          meta.content = await resolveImageUrl(
            meta.storageKey,
            meta.content || "",
          );
          if (meta.images)
            for (const image of meta.images)
              image.content = await resolveImageUrl(
                image.storageKey,
                image.content || "",
              );
        } else if (node.type === "video" || node.type === "audio") {
          meta.content = await resolveMediaUrl(
            meta.storageKey,
            meta.content || "",
          );
        }
        if (meta.status === "loading" && !meta.videoTaskId)
          meta.status = meta.content ? "success" : "idle";
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, nodes.length) }, worker))
      .then(() => {
        if (active)
          setLoaded({
            id,
            document: normalizeStudioDocument({
              nodes,
              connections: project.connections,
              viewport: project.viewport,
              backgroundMode:
                project.backgroundMode === "blank"
                  ? "none"
                  : project.backgroundMode,
              showImageInfo: project.showImageInfo,
            }),
          });
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "草稿素材恢复失败，请重试。",
          );
      });
    return () => {
      active = false;
    };
  }, [id, hydrated, attempt]);
  if (error)
    return (
      <div role="alert" style={{ padding: 32 }}>
        <p>{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>
          重新加载草稿
        </button>
      </div>
    );
  if (!loaded || loaded.id !== id)
    return (
      <div role="status" style={{ padding: 32 }}>
        正在打开创作空间…
      </div>
    );
  return <StudioWorkspace key={id} projectId={id} initial={loaded.document} />;
}

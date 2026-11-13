export type AtlasVideoFramePosition = "first" | "last" | "current";

export const ATLAS_VIDEO_FRAME_EVENT_TIMEOUT_MS = 15_000;
const DEFAULT_FRAME_DURATION_SECONDS = 1 / 30;
const MAX_FRAME_DURATION_SECONDS = 0.1;

type MediaEventName = "loadedmetadata" | "loadeddata" | "seeked";
type MediaEventTarget = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

/** Resolve a seek target without asking the browser to seek past the final decodable frame. */
export function resolveAtlasVideoFrameTime(
  duration: number,
  position: AtlasVideoFramePosition,
  currentTime: number,
  seekableEnd?: number,
) {
  if (position === "first") return 0;

  const end =
    Number.isFinite(seekableEnd) && seekableEnd! > 0
      ? seekableEnd!
      : Number.isFinite(duration) && duration > 0
        ? duration
        : undefined;

  if (position === "last" && end === undefined) {
    throw new Error("无法读取视频时长，不能提取尾帧");
  }
  if (!Number.isFinite(currentTime)) {
    throw new Error("当前视频时间无效，无法提取画面");
  }

  if (end === undefined) return Math.max(0, currentTime);
  const frameDuration = Math.min(
    DEFAULT_FRAME_DURATION_SECONDS,
    MAX_FRAME_DURATION_SECONDS,
    end / 2,
  );
  const lastDecodableTime = Math.max(0, end - frameDuration);
  return position === "last"
    ? lastDecodableTime
    : Math.min(Math.max(0, currentTime), lastDecodableTime);
}

/** Wait for one media event and always release listeners and its timer. */
export function waitForAtlasVideoEvent(
  target: MediaEventTarget,
  eventName: MediaEventName,
  timeoutMs = ATLAS_VIDEO_FRAME_EVENT_TIMEOUT_MS,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("视频读取已取消"));
      return;
    }

    let settled = false;
    const timer = setTimeout(
      () => finish(new Error("等待视频读取超时，请检查视频文件是否可用")),
      timeoutMs,
    );

    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(eventName, onReady);
      target.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () =>
      finish(new Error("读取视频失败，请检查视频地址、格式和跨域权限"));
    const onAbort = () => finish(new Error("视频读取已取消"));

    target.addEventListener(eventName, onReady, { once: true });
    target.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function captureAtlasVideoFrame(
  source: string,
  position: AtlasVideoFramePosition,
  currentTime: number,
) {
  if (typeof document === "undefined") {
    throw new Error("视频抽帧只能在浏览器中执行");
  }
  if (!source.trim()) throw new Error("视频地址不能为空");

  const video = document.createElement("video");
  const controller = new AbortController();
  let canvas: HTMLCanvasElement | null = null;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    const metadataReady = waitForAtlasVideoEvent(
      video,
      "loadedmetadata",
      ATLAS_VIDEO_FRAME_EVENT_TIMEOUT_MS,
      controller.signal,
    );
    video.src = source;
    video.load();
    await metadataReady;

    const targetTime = resolveAtlasVideoFrameTime(
      video.duration,
      position,
      currentTime,
      readSeekableEnd(video),
    );
    if (Math.abs(video.currentTime - targetTime) > 0.001) {
      const seekReady = waitForAtlasVideoEvent(
        video,
        "seeked",
        ATLAS_VIDEO_FRAME_EVENT_TIMEOUT_MS,
        controller.signal,
      );
      video.currentTime = targetTime;
      await seekReady;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      const frameReady = waitForAtlasVideoEvent(
        video,
        "loadeddata",
        ATLAS_VIDEO_FRAME_EVENT_TIMEOUT_MS,
        controller.signal,
      );
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
        await frameReady;
    }

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("视频没有可读取的画面");
    }

    canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建视频画布");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("视频抽帧失败，请检查视频是否损坏或受跨域限制");
  } finally {
    controller.abort();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    releaseVideo(video);
  }
}

function readSeekableEnd(video: HTMLVideoElement) {
  try {
    const ranges = video.seekable;
    if (ranges.length === 0) return undefined;
    const end = ranges.end(ranges.length - 1);
    return Number.isFinite(end) && end > 0 ? end : undefined;
  } catch {
    return undefined;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("浏览器未能导出视频帧，请重试")),
        "image/png",
      );
    } catch {
      reject(new Error("无法导出视频帧，视频可能受跨域限制"));
    }
  });
}

function releaseVideo(video: HTMLVideoElement) {
  try {
    video.pause();
    video.removeAttribute("src");
    video.srcObject = null;
    video.load();
  } catch {
    // Cleanup must not replace the original decode or export error.
  }
}

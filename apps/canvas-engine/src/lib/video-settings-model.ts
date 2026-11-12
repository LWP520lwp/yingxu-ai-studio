import {
  clampVideoSeconds,
  computeVideoSize,
  inferVideoRatio,
  parseAspectRatio,
  parseVideoResolution,
  readVideoDimensions,
  VIDEO_SECONDS_MAX,
  VIDEO_SECONDS_MIN,
  videoRatioOptions,
} from "@/lib/media-size";

export type VideoMode = "auto" | "frames" | "reference";
export type VideoOutputChoice = "auto" | "true" | "false";
export type VideoDimensions = { width: number; height: number };

export const VIDEO_RESOLUTIONS = ["480", "720", "1080"] as const;
export const VIDEO_DIMENSION_MAX = 4096;
export const VIDEO_SECONDS_RANGE = {
  min: VIDEO_SECONDS_MIN,
  max: VIDEO_SECONDS_MAX,
} as const;

const validRatios = new Set<string>(videoRatioOptions.map(({ value }) => value));

export function normalizeVideoMode(value?: string): VideoMode {
  return value === "auto" || value === "reference" ? value : "frames";
}

export function normalizeVideoOutputChoice(value?: string): VideoOutputChoice {
  return value === "true" || value === "false" ? value : "auto";
}

export function normalizeVideoResolution(value?: string, ratio = "16:9"): string {
  const parsed = Number(parseVideoResolution(value));
  const dimensions = parseAspectRatio(ratio) || { width: 16, height: 9 };
  const aspect = Math.max(
    dimensions.width / dimensions.height,
    dimensions.height / dimensions.width,
  );
  const ratioLimit = Math.floor(VIDEO_DIMENSION_MAX / aspect / 2) * 2;
  const upperBound = Math.max(240, ratioLimit);
  return String(Math.min(upperBound, Math.max(240, Math.floor(parsed / 2) * 2)));
}

export function normalizeVideoSize(value: string | undefined, resolution = "720") {
  const size = String(value || "auto").trim();
  if (size === "auto") return "auto";

  const dimensions = /^(\d+)\s*x\s*(\d+)$/i.exec(size);
  if (dimensions) {
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    if (
      width > 0 &&
      height > 0 &&
      width <= VIDEO_DIMENSION_MAX &&
      height <= VIDEO_DIMENSION_MAX
    )
      return `${width}x${height}`;
    return "auto";
  }

  const ratio = validRatios.has(size) ? size : inferVideoRatio(size);
  return ratio === "auto"
    ? "auto"
    : computeVideoSize(normalizeVideoResolution(resolution, ratio), ratio);
}

export function videoRatioForSize(value: string | undefined) {
  const size = String(value || "auto").trim();
  if (size === "auto") return "auto";
  return inferVideoRatio(size);
}

export function videoDimensions(
  value: string | undefined,
  resolution: string,
  ratio: string,
): VideoDimensions {
  const safeRatio = validRatios.has(ratio) ? ratio : "16:9";
  const safeResolution = normalizeVideoResolution(resolution, safeRatio);
  const safeSize = normalizeVideoSize(value, safeResolution);
  return readVideoDimensions(safeSize, safeResolution, safeRatio);
}

export function sizeFromDimensions(
  axis: "width" | "height",
  input: number | null,
  current: VideoDimensions,
) {
  const next = Math.min(
    VIDEO_DIMENSION_MAX,
    Math.max(2, Math.floor(input || current[axis] || 720)),
  );
  const width = axis === "width" ? next : current.width;
  const height = axis === "height" ? next : current.height;
  return `${width}x${height}`;
}

export function normalizedVideoSeconds(value?: string) {
  return Number(clampVideoSeconds(value || "6"));
}

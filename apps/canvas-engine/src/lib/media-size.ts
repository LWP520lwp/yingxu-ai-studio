export const mediaScaleOptions = ["1k", "2k", "4k", "auto"] as const;

export const mediaRatioOptions = [
  { value: "1:1", width: 1, height: 1 },
  { value: "2:3", width: 2, height: 3 },
  { value: "3:2", width: 3, height: 2 },
  { value: "4:3", width: 4, height: 3 },
  { value: "3:4", width: 3, height: 4 },
  { value: "16:9", width: 16, height: 9 },
  { value: "9:16", width: 9, height: 16 },
  { value: "21:9", width: 21, height: 9 },
  { value: "9:21", width: 9, height: 21 },
  { value: "auto", width: 0, height: 0 },
] as const;

export const imageSizePresets: Record<string, Record<string, string>> = {
  "1k": {
    "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024",
    "4:3": "1024x768", "3:4": "768x1024", "16:9": "1536x864",
    "9:16": "864x1536", "21:9": "2016x864", "9:21": "864x2016",
  },
  "2k": {
    "1:1": "2048x2048", "2:3": "1360x2048", "3:2": "2048x1360",
    "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152",
    "9:16": "1152x2048", "21:9": "2688x1152", "9:21": "1152x2688",
  },
  "4k": {
    "1:1": "2880x2880", "2:3": "2336x3520", "3:2": "3520x2336",
    "4:3": "3312x2480", "3:4": "2480x3312", "16:9": "3840x2160",
    "9:16": "2160x3840", "21:9": "3840x1648", "9:21": "1648x3840",
  },
};

export type PixelSize = { width: number; height: number };
export type MediaRatio = PixelSize;

export const videoRatioOptions = [
  { value: "1:1", width: 1, height: 1 },
  { value: "3:4", width: 3, height: 4 },
  { value: "4:3", width: 4, height: 3 },
  { value: "16:9", width: 16, height: 9 },
  { value: "9:16", width: 9, height: 16 },
  { value: "21:9", width: 21, height: 9 },
  { value: "auto", width: 0, height: 0 },
] as const;

export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 30;

const scaleAliases: Readonly<Record<string, (typeof mediaScaleOptions)[number]>> = {
  "1k": "1k", "1024": "1k", "2k": "2k", "2048": "2k",
  "4k": "4k", "3840": "4k", auto: "auto",
};

export function parsePixelSize(value: string): PixelSize | null {
  const parts = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(value || "");
  if (!parts) return null;
  return positivePair(Number(parts[1]), Number(parts[2]));
}

export function parseAspectRatio(value: string): MediaRatio | null {
  const parts = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(value || "");
  if (!parts) return null;
  return positivePair(Number(parts[1]), Number(parts[2]));
}

export function normalizeMediaScale(value: string | undefined) {
  const key = String(value ?? "").trim().toLowerCase();
  return scaleAliases[key] ?? "1k";
}

export function inferMediaScale(size: string, storedScale?: string) {
  if (storedScale) return normalizeMediaScale(storedScale);
  if (!size || size === "auto" || parseAspectRatio(size)) return "auto";
  const pixels = parsePixelSize(size);
  if (!pixels) return "auto";

  for (const scale of ["1k", "2k", "4k"] as const) {
    if (Object.values(imageSizePresets[scale]).includes(`${pixels.width}x${pixels.height}`)) return scale;
  }
  const longEdge = Math.max(pixels.width, pixels.height);
  return longEdge >= 3072 ? "4k" : longEdge >= 1536 ? "2k" : "1k";
}

export function inferMediaRatio(size: string, fallback = "1:1") {
  if (!size || size === "auto") return "auto";
  if (mediaRatioOptions.some((option) => option.value === size)) return size;
  const dimensions = parsePixelSize(size) ?? parseAspectRatio(size);
  return dimensions
    ? nearestRatio(mediaRatioOptions, dimensions.width / dimensions.height, fallback)
    : fallback;
}

export function computeMediaSize(scale: string, ratio: string) {
  if (ratio === "auto" || !ratio) return "auto";
  const selectedScale = normalizeMediaScale(scale);
  return selectedScale === "auto" ? ratio : imageSizePresets[selectedScale]?.[ratio] ?? "auto";
}

export function readMediaDimensions(size: string, scale: string, ratio: string) {
  const explicit = parsePixelSize(size);
  if (explicit) return explicit;
  const fallback = computeMediaSize(scale === "auto" ? "1k" : scale, ratio === "auto" ? "1:1" : ratio);
  return parsePixelSize(fallback) ?? { width: 0, height: 0 };
}

export function clampVideoSeconds(value: string) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed) && parsed !== 0 ? Math.floor(parsed) : 6;
  return String(Math.min(VIDEO_SECONDS_MAX, Math.max(VIDEO_SECONDS_MIN, seconds)));
}

export function parseVideoResolution(value: string | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "low") return "480";
  if (raw === "auto" || raw === "high" || raw === "medium") return "720";
  const pixels = raw.replace(/p$/i, "");
  return /^\d+$/.test(pixels) && Number(pixels) > 0 ? String(Number(pixels)) : "720";
}

export function inferVideoRatio(size: string) {
  if (!size || size === "auto") return "auto";
  if (videoRatioOptions.some((option) => option.value === size)) return size;
  const dimensions = parsePixelSize(size) ?? parseAspectRatio(size);
  return dimensions ? nearestRatio(videoRatioOptions, dimensions.width / dimensions.height, "16:9") : "16:9";
}

export function computeVideoSize(resolution: string, ratio: string) {
  if (!ratio || ratio === "auto") return "auto";
  const aspect = parseAspectRatio(ratio);
  if (!aspect) return "auto";
  const edge = Math.max(1, Math.floor(Number(parseVideoResolution(resolution)) || 720));
  const landscape = aspect.width >= aspect.height;
  const width = landscape ? even(edge * aspect.width / aspect.height) : edge;
  const height = landscape ? edge : even(edge * aspect.height / aspect.width);
  return `${width}x${height}`;
}

export function readVideoDimensions(size: string, resolution: string, ratio: string) {
  const explicit = parsePixelSize(size);
  if (explicit) return explicit;
  const fallback = computeVideoSize(resolution, ratio === "auto" ? "16:9" : ratio);
  return parsePixelSize(fallback) ?? { width: 0, height: 0 };
}

function positivePair(width: number, height: number): PixelSize | null {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function nearestRatio<Option extends { value: string; width: number; height: number }>(
  options: readonly Option[],
  target: number,
  fallback: string,
) {
  let choice = fallback;
  let smallestGap = Number.POSITIVE_INFINITY;
  for (const option of options) {
    if (!option.height) continue;
    const gap = Math.abs(option.width / option.height - target);
    if (gap < smallestGap) {
      choice = option.value;
      smallestGap = gap;
    }
  }
  return choice;
}

function even(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

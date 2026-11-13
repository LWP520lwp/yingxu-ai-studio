export type PixelSize = { width: number; height: number };
export type MediaRatio = PixelSize;

const imageRatios = [
  "1:1",
  "2:3",
  "3:2",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "21:9",
  "9:21",
  "auto",
] as const;
const videoRatios = [
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "9:16",
  "21:9",
  "auto",
] as const;
type RatioChoice<Value extends string = string> = PixelSize & { value: Value };
type FixedScale = "1k" | "2k" | "4k";

function choices<const Value extends string>(
  values: readonly Value[],
): readonly RatioChoice<Value>[] {
  return values.map((value) => ({
    value,
    ...(parseAspectRatio(value) ?? { width: 0, height: 0 }),
  }));
}

export const mediaScaleOptions = ["1k", "2k", "4k", "auto"] as const;
export const mediaRatioOptions = choices(imageRatios);
export const videoRatioOptions = choices(videoRatios);
export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 30;

// Provider-compatible output dimensions are facts, not UI geometry. Keep one
// landscape entry per shape and derive its portrait partner by transposition.
const landscapePresets: Record<
  FixedScale,
  readonly [string, number, number][]
> = {
  "1k": [
    ["1:1", 1024, 1024],
    ["3:2", 1536, 1024],
    ["4:3", 1024, 768],
    ["16:9", 1536, 864],
    ["21:9", 2016, 864],
  ],
  "2k": [
    ["1:1", 2048, 2048],
    ["3:2", 2048, 1360],
    ["4:3", 2048, 1536],
    ["16:9", 2048, 1152],
    ["21:9", 2688, 1152],
  ],
  "4k": [
    ["1:1", 2880, 2880],
    ["3:2", 3520, 2336],
    ["4:3", 3312, 2480],
    ["16:9", 3840, 2160],
    ["21:9", 3840, 1648],
  ],
};

const presetScale = new Map<string, FixedScale>();
export const imageSizePresets: Record<string, Record<string, string>> = {};
for (const scale of ["1k", "2k", "4k"] as const) {
  const outputs: Record<string, string> = {};
  for (const [ratio, width, height] of landscapePresets[scale]) {
    const [horizontal, vertical] = ratio.split(":");
    const landscape = `${width}x${height}`;
    const portrait = `${height}x${width}`;
    outputs[ratio] = landscape;
    outputs[`${vertical}:${horizontal}`] = portrait;
    presetScale.set(landscape, scale);
    presetScale.set(portrait, scale);
  }
  imageSizePresets[scale] = outputs;
}

/** Pixel dimensions reject values outside exact integer representation. */
export function parsePixelSize(value: string): PixelSize | null {
  const parts = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(value || "");
  if (!parts) return null;
  const width = Number(parts[1]);
  const height = Number(parts[2]);
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    ? positivePair(width, height)
    : null;
}

export function parseAspectRatio(value: string): MediaRatio | null {
  const parts = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(
    value || "",
  );
  return parts ? positivePair(Number(parts[1]), Number(parts[2])) : null;
}

export function normalizeMediaScale(
  value: string | undefined,
): (typeof mediaScaleOptions)[number] {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if (key === "auto") return "auto";
  if (key === "2k" || key === "2048") return "2k";
  if (key === "4k" || key === "3840") return "4k";
  return "1k";
}

export function inferMediaScale(size: string, storedScale?: string) {
  if (storedScale) return normalizeMediaScale(storedScale);
  const pixels = parsePixelSize(size);
  if (!pixels) return "auto";
  const exact = presetScale.get(`${pixels.width}x${pixels.height}`);
  if (exact) return exact;
  const longEdge = Math.max(pixels.width, pixels.height);
  return longEdge >= 3072 ? "4k" : longEdge >= 1536 ? "2k" : "1k";
}

export function inferMediaRatio(size: string, fallback = "1:1") {
  return inferRatio(size, mediaRatioOptions, fallback);
}

export function computeMediaSize(scale: string, ratio: string) {
  if (!ratio || ratio === "auto") return "auto";
  const selected = normalizeMediaScale(scale);
  return selected === "auto"
    ? ratio
    : (imageSizePresets[selected]?.[ratio] ?? "auto");
}

export function readMediaDimensions(
  size: string,
  scale: string,
  ratio: string,
) {
  return (
    parsePixelSize(size) ??
    parsePixelSize(
      computeMediaSize(
        scale === "auto" ? "1k" : scale,
        ratio === "auto" ? "1:1" : ratio,
      ),
    ) ?? { width: 0, height: 0 }
  );
}

export function clampVideoSeconds(value: string) {
  const input = Number(value);
  const seconds = Number.isFinite(input) && input !== 0 ? Math.floor(input) : 6;
  return String(
    Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, seconds)),
  );
}

export function parseVideoResolution(value: string | undefined) {
  const input = String(value ?? "")
    .trim()
    .toLowerCase();
  if (input === "low") return "480";
  const digits = input.replace(/p$/, "");
  const number = Number(digits);
  return /^\d+$/.test(digits) && Number.isSafeInteger(number) && number > 0
    ? String(number)
    : "720";
}

export function inferVideoRatio(size: string) {
  return inferRatio(size, videoRatioOptions, "16:9");
}

export function computeVideoSize(resolution: string, ratio: string) {
  const aspect = parseAspectRatio(ratio);
  if (!aspect) return "auto";
  const shortEdge = nearestEven(Number(parseVideoResolution(resolution)));
  const factor = shortEdge / Math.min(aspect.width, aspect.height);
  const width = nearestEven(aspect.width * factor);
  const height = nearestEven(aspect.height * factor);
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    ? `${width}x${height}`
    : "auto";
}

export function readVideoDimensions(
  size: string,
  resolution: string,
  ratio: string,
) {
  return (
    parsePixelSize(size) ??
    parsePixelSize(
      computeVideoSize(resolution, ratio === "auto" ? "16:9" : ratio),
    ) ?? { width: 0, height: 0 }
  );
}

function positivePair(width: number, height: number): PixelSize | null {
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

function inferRatio(
  value: string,
  options: readonly RatioChoice[],
  fallback: string,
) {
  const input = String(value ?? "").trim();
  if (!input || input === "auto") return "auto";
  if (options.some((option) => option.value === input)) return input;
  const dimensions = parsePixelSize(input) ?? parseAspectRatio(input);
  if (!dimensions) return fallback;
  const target = dimensions.width / dimensions.height;
  let closest = fallback;
  let distance = Infinity;
  for (const option of options) {
    if (option.height === 0) continue;
    const delta = Math.abs(option.width / option.height - target);
    if (delta >= distance) continue;
    distance = delta;
    closest = option.value;
  }
  return closest;
}

function nearestEven(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

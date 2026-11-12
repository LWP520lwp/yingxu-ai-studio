const voices = [
  ["alloy", "Alloy"], ["ash", "Ash"], ["ballad", "Ballad"],
  ["coral", "Coral"], ["echo", "Echo"], ["fable", "Fable"],
  ["nova", "Nova"], ["onyx", "Onyx"], ["sage", "Sage"],
  ["shimmer", "Shimmer"], ["verse", "Verse"], ["marin", "Marin"],
  ["cedar", "Cedar"],
] as const;

const formats = [
  ["mp3", "MP3", "audio/mpeg"], ["wav", "WAV", "audio/wav"],
  ["opus", "Opus", "audio/opus"], ["aac", "AAC", "audio/aac"],
  ["flac", "FLAC", "audio/flac"], ["pcm", "PCM", "audio/pcm"],
] as const;

export const audioVoiceOptions = voices.map(([value, label]) => ({ value, label }));
export const audioFormatOptions = formats.map(([value, label]) => ({ value, label }));
export const audioSpeedPresets = ["0.75", "1", "1.25", "1.5"] as const;
export const MIN_AUDIO_SPEED = 0.25;
export const MAX_AUDIO_SPEED = 4;

export type AudioVoice = (typeof voices)[number][0];
export type AudioFormat = (typeof formats)[number][0];

const voiceLabels = new Map<string, string>(voices);
const formatInfo = new Map<string, { label: string; mime: string }>(
  formats.map(([value, label, mime]) => [value, { label, mime }]),
);

export function normalizeAudioVoiceValue(value: string): AudioVoice {
  return voiceLabels.has(value) ? value as AudioVoice : "alloy";
}

export function normalizeAudioFormatValue(value: string): AudioFormat {
  return formatInfo.has(value) ? value as AudioFormat : "mp3";
}

export function normalizeAudioSpeedValue(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "1";
  const speed = Math.min(MAX_AUDIO_SPEED, Math.max(MIN_AUDIO_SPEED, parsed));
  return String(Number(speed.toFixed(2)));
}

export function audioVoiceLabel(value: string) {
  return voiceLabels.get(normalizeAudioVoiceValue(value)) ?? "Alloy";
}

export function audioFormatLabel(value: string) {
  return formatInfo.get(normalizeAudioFormatValue(value))?.label ?? "MP3";
}

export function audioSpeedLabel(value: string) {
  return `${normalizeAudioSpeedValue(value)}x`;
}

export function audioMimeType(format: string) {
  return formatInfo.get(normalizeAudioFormatValue(format))?.mime ?? "audio/mpeg";
}

export const audioVoiceOptions = [
  { value: "alloy", label: "Alloy" },
  { value: "ash", label: "Ash" },
  { value: "ballad", label: "Ballad" },
  { value: "coral", label: "Coral" },
  { value: "echo", label: "Echo" },
  { value: "fable", label: "Fable" },
  { value: "nova", label: "Nova" },
  { value: "onyx", label: "Onyx" },
  { value: "sage", label: "Sage" },
  { value: "shimmer", label: "Shimmer" },
  { value: "verse", label: "Verse" },
  { value: "marin", label: "Marin" },
  { value: "cedar", label: "Cedar" },
] as const;

export const audioFormatOptions = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "opus", label: "Opus" },
  { value: "aac", label: "AAC" },
  { value: "flac", label: "FLAC" },
  { value: "pcm", label: "PCM" },
] as const;

export const audioSpeedPresets = ["0.75", "1", "1.25", "1.5"] as const;
export const MIN_AUDIO_SPEED = 0.25;
export const MAX_AUDIO_SPEED = 4;

export type AudioVoice = (typeof audioVoiceOptions)[number]["value"];
export type AudioFormat = (typeof audioFormatOptions)[number]["value"];

const voiceByValue = new Map(
  audioVoiceOptions.map((option) => [option.value, option]),
);
const formatByValue = new Map(
  audioFormatOptions.map((option) => [option.value, option]),
);

export function normalizeAudioVoiceValue(value: string): AudioVoice {
  return voiceByValue.has(value as AudioVoice)
    ? (value as AudioVoice)
    : "alloy";
}

export function normalizeAudioFormatValue(value: string): AudioFormat {
  return formatByValue.has(value as AudioFormat)
    ? (value as AudioFormat)
    : "mp3";
}

export function normalizeAudioSpeedValue(value: string): string {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return "1";
  const bounded = Math.min(MAX_AUDIO_SPEED, Math.max(MIN_AUDIO_SPEED, speed));
  return String(Number(bounded.toFixed(2)));
}

export function audioVoiceLabel(value: string): string {
  return voiceByValue.get(normalizeAudioVoiceValue(value))?.label ?? "Alloy";
}

export function audioFormatLabel(value: string): string {
  return formatByValue.get(normalizeAudioFormatValue(value))?.label ?? "MP3";
}

export function audioSpeedLabel(value: string): string {
  return `${normalizeAudioSpeedValue(value)}x`;
}

export function audioMimeType(format: string): string {
  switch (normalizeAudioFormatValue(format)) {
    case "wav":
      return "audio/wav";
    case "opus":
      return "audio/opus";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "pcm":
      return "audio/pcm";
    case "mp3":
      return "audio/mpeg";
  }
}

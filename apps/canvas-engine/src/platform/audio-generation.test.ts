import { describe, expect, it } from "vitest";

import {
  audioFormatLabel,
  audioFormatOptions,
  audioMimeType,
  audioSpeedLabel,
  audioSpeedPresets,
  audioVoiceLabel,
  audioVoiceOptions,
  normalizeAudioFormatValue,
  normalizeAudioSpeedValue,
  normalizeAudioVoiceValue,
} from "@/lib/audio-generation";

describe("audio generation configuration", () => {
  it("preserves the supported voice and format choices", () => {
    expect(audioVoiceOptions.map(({ value }) => value)).toEqual([
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
      "marin",
      "cedar",
    ]);
    expect(audioFormatOptions.map(({ value }) => value)).toEqual([
      "mp3",
      "wav",
      "opus",
      "aac",
      "flac",
      "pcm",
    ]);
    expect(audioSpeedPresets).toEqual(["0.75", "1", "1.25", "1.5"]);
  });

  it("normalizes invalid values and clamps speed to provider bounds", () => {
    expect(normalizeAudioVoiceValue("marin")).toBe("marin");
    expect(normalizeAudioVoiceValue("unknown")).toBe("alloy");
    expect(normalizeAudioFormatValue("flac")).toBe("flac");
    expect(normalizeAudioFormatValue("unknown")).toBe("mp3");
    expect(normalizeAudioSpeedValue("0.1")).toBe("0.25");
    expect(normalizeAudioSpeedValue("5.321")).toBe("4");
    expect(normalizeAudioSpeedValue("1.236")).toBe("1.24");
    expect(normalizeAudioSpeedValue("invalid")).toBe("1");
  });

  it("returns stable labels and MIME types for every supported format", () => {
    expect(audioVoiceLabel("cedar")).toBe("Cedar");
    expect(audioFormatLabel("wav")).toBe("WAV");
    expect(audioSpeedLabel("1.5")).toBe("1.5x");
    expect(audioMimeType("mp3")).toBe("audio/mpeg");
    expect(audioMimeType("wav")).toBe("audio/wav");
    expect(audioMimeType("opus")).toBe("audio/opus");
    expect(audioMimeType("aac")).toBe("audio/aac");
    expect(audioMimeType("flac")).toBe("audio/flac");
    expect(audioMimeType("pcm")).toBe("audio/pcm");
    expect(audioMimeType("invalid")).toBe("audio/mpeg");
  });
});

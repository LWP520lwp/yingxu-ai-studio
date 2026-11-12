import i18n from "@/i18n";
import type { ModelCapability } from "@/stores/use-config-store";

export type PluginTemplate = { label: string; script: string };

const makeTemplate = (
  provider: "openai" | "gemini",
  script: string,
): PluginTemplate => ({
  label: i18n.t(`modelPlugin.templates.${provider}`),
  script,
});

const imageTemplates: PluginTemplate[] = [
  makeTemplate(
    "openai",
    String.raw`const headers = { Authorization: "Bearer " + apiKey };
const resultUrl = baseUrl + "/v1/images/" + (images.length ? "edits" : "generations");
let body;
if (images.length) {
  body = new FormData();
  for (const [key, value] of Object.entries({ model, prompt, n: params.count || 1, size: params.size || "auto", quality: params.quality || "high", background: params.background || "auto", response_format: "b64_json" })) body.set(key, String(value));
  for (const image of images) body.append(images.length > 1 ? "image[]" : "image", await (await fetch(image)).blob(), "reference.png");
} else {
  headers["Content-Type"] = "application/json";
  body = { model, prompt, n: params.count || 1, size: params.size || "auto", quality: params.quality || "high", background: params.background || "auto", response_format: "b64_json" };
}
const response = await request({ method: "post", url: resultUrl, headers, data: body });
return (response.data || []).map((item) => item.b64_json ? "data:image/png;base64," + item.b64_json : item.url).filter(Boolean);`,
  ),
  makeTemplate(
    "gemini",
    String.raw`const parts = [{ text: prompt }];
for (const source of images) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(source);
  if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
}
const dimensions = /^(\d+)x(\d+)$/.exec(String(params.size || ""));
const divisor = (a, b) => b ? divisor(b, a % b) : a;
const ratio = dimensions ? (() => { const d = divisor(Number(dimensions[1]), Number(dimensions[2])); return Number(dimensions[1]) / d + ":" + Number(dimensions[2]) / d; })() : (params.size && params.size !== "auto" ? params.size : "1:1");
const response = await request({
  method: "post",
  url: baseUrl + "/v1beta/models/" + model + ":generateContent",
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: ratio, imageSize: params.resolution && params.resolution !== "auto" ? String(params.resolution).toUpperCase() : undefined } } },
});
const output = [];
for (const candidate of response.candidates || []) for (const part of candidate.content?.parts || []) {
  const image = part.inlineData || part.inline_data;
  if (image?.data) output.push("data:" + (image.mimeType || image.mime_type || "image/png") + ";base64," + image.data);
}
return output;`,
  ),
];

const videoTemplates: PluginTemplate[] = [
  makeTemplate(
    "openai",
    String.raw`const form = new FormData();
for (const [key, value] of Object.entries({ model, prompt, seconds: params.seconds || 8, size: params.size || "1280x720", resolution_name: params.resolution || "720p", generate_audio: params.generateAudio !== false, watermark: params.watermark === true, mode: params.mode || "reference" })) form.set(key, String(value));
const addImage = async (key, source, name) => form.append(key, await (await fetch(source)).blob(), name);
if (params.mode === "frames" && images.length <= 2) {
  if (images[0]) await addImage("first_frame", images[0], "start.png");
  if (images[1]) await addImage("last_frame", images[1], "end.png");
} else for (const image of images) await addImage("image[]", image, "reference.png");
for (const file of videos) form.append("video[]", file);
for (const file of audios) form.append("audio[]", file);
const headers = { Authorization: "Bearer " + apiKey };
const task = await request({ method: "post", url: baseUrl + "/v1/videos", headers, data: form });
return await poll(
  async () => {
    const state = await request({ method: "get", url: baseUrl + "/v1/videos/" + task.id, headers });
    if (["failed", "cancelled"].includes(state.status)) throw new Error(state.error?.message || "Video generation failed");
    if (state.video_url || state.url) return { url: state.video_url || state.url };
    if (state.status === "completed") return request({ method: "get", url: baseUrl + "/v1/videos/" + task.id + "/content", headers, responseType: "blob" });
    return null;
  },
  (value) => value,
  { intervalMs: 2500, timeoutMs: 300000 },
);`,
  ),
  makeTemplate(
    "gemini",
    String.raw`const decodeMedia = async (source) => {
  let dataUrl = source;
  if (source instanceof Blob) dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(source); });
  const match = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl));
  if (!match) throw new Error("Reference media could not be read");
  return { mimeType: match[1], bytesBase64Encoded: match[2] };
};
const ratioBySize = { "1280x720": "16:9", "1920x1080": "16:9", "720x1280": "9:16", "1080x1920": "9:16" };
const ratio = params.ratio || ratioBySize[params.size] || (params.size && params.size !== "auto" ? params.size : "16:9");
const instance = { prompt };
if (params.mode === "frames") {
  if (images[0]) instance.image = await decodeMedia(images[0]);
  if (images[1]) instance.lastFrame = await decodeMedia(images[1]);
} else if (images.length) {
  instance.referenceImages = await Promise.all(images.map(async (image) => ({ image: await decodeMedia(image), referenceType: "asset" })));
}
if (videos[0]) instance.video = await decodeMedia(videos[0]);
if (audios[0]) instance.audio = await decodeMedia(audios[0]);
const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
const operation = await request({
  method: "post",
  url: baseUrl + "/v1beta/models/" + model + ":predictLongRunning",
  headers,
  data: { instances: [instance], parameters: { aspectRatio: ratio, durationSeconds: Number(params.seconds) || 8, resolution: params.resolution || "720p", generateAudio: params.generateAudio !== false, addWatermark: params.watermark === true } },
});
return poll(
  () => request({ method: "get", url: baseUrl + "/v1beta/" + operation.name, headers }),
  (state) => {
    if (state.error) throw new Error(state.error.message || "Video generation failed");
    if (!state.done) return null;
    const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error("The model returned no video URI");
    return { url: uri.includes("key=") ? uri : uri + (uri.includes("?") ? "&" : "?") + "key=" + apiKey };
  },
  { intervalMs: 5000, timeoutMs: 300000 },
);`,
  ),
];

const audioTemplates: PluginTemplate[] = [
  makeTemplate(
    "openai",
    String.raw`return request({
  method: "post",
  url: baseUrl + "/v1/audio/speech",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
  responseType: "blob",
  data: { model, input: prompt, voice: params.voice, response_format: params.format || "mp3", speed: Number(params.speed) || 1, instructions: params.instructions || undefined },
});`,
  ),
  makeTemplate(
    "gemini",
    String.raw`const response = await request({
  method: "post",
  url: baseUrl + "/v1beta/models/" + model + ":generateContent",
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice || "Kore" } } } } },
});
for (const part of response.candidates?.[0]?.content?.parts || []) {
  const audio = part.inlineData || part.inline_data;
  if (audio?.data) return { data: audio.data };
}
throw new Error("The model returned no audio data");`,
  ),
];

const textTemplates: PluginTemplate[] = [
  makeTemplate(
    "openai",
    String.raw`const response = await request({
  method: "post",
  url: baseUrl + "/v1/responses",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
  data: { model, input: messages, ...(reasoningEffort && reasoningEffort !== "auto" ? { reasoning: { effort: reasoningEffort } } : {}) },
});
const text = response.output_text || (response.output || []).flatMap((item) => item.content || []).map((part) => part.text || "").join("");
onDelta(text);
return text;`,
  ),
  makeTemplate(
    "gemini",
    String.raw`const contents = messages.filter((item) => item.role !== "system").map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] }));
const response = await request({
  method: "post",
  url: baseUrl + "/v1beta/models/" + model + ":generateContent",
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents, ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}) },
});
const text = (response.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
onDelta(text);
return text;`,
  ),
];

export function getPluginTemplates(): Record<
  ModelCapability,
  PluginTemplate[]
> {
  return {
    image: imageTemplates,
    video: videoTemplates,
    audio: audioTemplates,
    text: textTemplates,
  };
}

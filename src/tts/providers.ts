import type { AudioResult, CaptionCue, ElevenLabsAlignment, ElevenLabsHistoryItem, ElevenLabsLanguage, ElevenLabsVoiceSelection, Env, SpeakInput, SpeakStyle, VoiceEvent } from "../types";
import { stripAudioTags } from "./styles";
import { createCaptionCues, normalizeElevenLabsAlignment } from "./captions";

export const ELEVENLABS_V3_STYLE_TAGS: Record<string, string> = {
  soft: "[whispers]",
  whisper: "[whispers]",
  teasing: "[mischievously]",
  excited: "[excited]",
  tired: "[sighs]",
  laughing: "[laughs]",
  curious: "[curious]",
};

export function getDashScopeModel(env: Env): string {
  return env.TTS_MODEL || "cosyvoice-v3.5-plus";
}

export function getElevenLabsModel(env: Env): string {
  return env.ELEVENLABS_MODEL_ID || "eleven_v3";
}

export function getElevenLabsOutputFormat(env: Env): string {
  return env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
}

export function getElevenLabsLanguageCode(env: Env): string | undefined {
  return env.ELEVENLABS_LANGUAGE_CODE?.trim() || undefined;
}

export function detectElevenLabsLanguage(text: string): ElevenLabsLanguage {
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return "zh";
}

export function resolveElevenLabsVoice(env: Env, input: SpeakInput): ElevenLabsVoiceSelection {
  const language = detectElevenLabsLanguage(input.text);
  const voiceId = language === "zh"
    ? env.ELEVENLABS_VOICE_ID_ZH || env.ELEVENLABS_VOICE_ID
    : env.ELEVENLABS_VOICE_ID_EN || env.ELEVENLABS_VOICE_ID;
  const languageCode = language === "zh"
    ? env.ELEVENLABS_LANGUAGE_CODE_ZH || (env.ELEVENLABS_VOICE_ID_ZH ? "zh" : getElevenLabsLanguageCode(env))
    : env.ELEVENLABS_LANGUAGE_CODE_EN || (env.ELEVENLABS_VOICE_ID_EN ? "en" : getElevenLabsLanguageCode(env));

  return { voiceId, language, languageCode };
}

export function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

export function getElevenLabsVoiceSettings(env: Env): Record<string, number | boolean> {
  const settings: Record<string, number | boolean> = {};
  const stability = parseOptionalNumber(env.ELEVENLABS_STABILITY);
  const similarityBoost = parseOptionalNumber(env.ELEVENLABS_SIMILARITY_BOOST);
  const style = parseOptionalNumber(env.ELEVENLABS_STYLE);
  const useSpeakerBoost = parseOptionalBoolean(env.ELEVENLABS_USE_SPEAKER_BOOST);
  const speed = parseOptionalNumber(env.ELEVENLABS_SPEED);

  if (stability !== undefined) settings.stability = stability;
  if (similarityBoost !== undefined) settings.similarity_boost = similarityBoost;
  if (style !== undefined) settings.style = style;
  if (useSpeakerBoost !== undefined) settings.use_speaker_boost = useSpeakerBoost;
  if (speed !== undefined) settings.speed = speed;

  return settings;
}

export function buildDashScopeText(input: SpeakInput): string {
  return stripAudioTags(input.text);
}

export function buildElevenLabsText(env: Env, input: SpeakInput): string {
  const modelId = getElevenLabsModel(env);

  if (modelId !== "eleven_v3") {
    return stripAudioTags(input.text);
  }

  if (input.raw_tags === true) {
    return input.text;
  }

  const text = stripAudioTags(input.text);
  const tag = input.style ? ELEVENLABS_V3_STYLE_TAGS[input.style.trim().toLowerCase()] : undefined;

  return tag ? `${tag} ${text}` : text;
}

export function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 8192;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return btoa(binary);
}

export async function generateDashScopeAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  try {
    const apiKey = env.DASHSCOPE_API_KEY;
    const voiceId = env.VOICE_ID;

    if (!apiKey) {
      return { success: false, error: "DASHSCOPE_API_KEY is not configured" };
    }
    if (!voiceId) {
      return { success: false, error: "VOICE_ID is not configured" };
    }

    const model = getDashScopeModel(env);
    const finalText = buildDashScopeText(input);

    const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: {
          text: finalText,
          voice: voiceId,
          format: "mp3",
          sample_rate: 24000,
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as Record<string, unknown>;

    // Try output.audio.url first
    const output = data.output as Record<string, unknown> | undefined;
    const audio = output?.audio as Record<string, unknown> | undefined;

    if (audio?.url && typeof audio.url === "string") {
      const audioResp = await fetch(audio.url);
      if (!audioResp.ok) {
        return { success: false, error: `Failed to fetch audio: ${audioResp.status}` };
      }
      const arrayBuffer = await audioResp.arrayBuffer();
      return { success: true, audio_base64: arrayBufferToBase64(arrayBuffer) };
    }

    // Fallback: output.audio.data may already be base64
    if (audio?.data && typeof audio.data === "string") {
      return { success: true, audio_base64: audio.data };
    }

    return { success: false, error: "No audio data in response" };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.name : "Request failed" };
  }
}

export async function generateElevenLabsAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  try {
    const apiKey = env.ELEVENLABS_API_KEY;
    const voiceSelection = resolveElevenLabsVoice(env, input);

    if (!apiKey) {
      return { success: false, error: "ELEVENLABS_API_KEY is not configured" };
    }
    if (!voiceSelection.voiceId) {
      return { success: false, error: "ELEVENLABS_VOICE_ID is not configured" };
    }

    const modelId = getElevenLabsModel(env);
    const outputFormat = getElevenLabsOutputFormat(env);
    if (!outputFormat.startsWith("mp3_")) {
      return { success: false, error: "ElevenLabs output format must be MP3 for the player" };
    }
    const finalText = buildElevenLabsText(env, input);
    const voiceSettings = getElevenLabsVoiceSettings(env);
    const requestUrl = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceSelection.voiceId)}/with-timestamps`);
    requestUrl.searchParams.set("output_format", outputFormat);
    const requestBody: Record<string, unknown> = {
      text: finalText,
      model_id: modelId,
      voice_settings: voiceSettings,
    };

    if (voiceSelection.languageCode) {
      requestBody.language_code = voiceSelection.languageCode;
    }

    const response = await fetch(requestUrl.toString(), {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as {
      audio_base64?: string;
      alignment?: ElevenLabsAlignment;
      normalized_alignment?: ElevenLabsAlignment;
    };

    if (!data.audio_base64) {
      return { success: false, error: "No audio data in response" };
    }

    return {
      success: true,
      audio_base64: data.audio_base64,
      alignment: data.alignment,
      normalized_alignment: data.normalized_alignment,
      final_text: finalText,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.name : "Request failed" };
  }
}

export function resolveCartesiaVoice(env: Env, input: SpeakInput): string | undefined {
  return detectElevenLabsLanguage(input.text) === "zh"
    ? env.CARTESIA_VOICE_ID_ZH || env.CARTESIA_VOICE_ID
    : env.CARTESIA_VOICE_ID_EN || env.CARTESIA_VOICE_ID;
}

export async function generateCartesiaAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  if (!env.CARTESIA_API_KEY || !resolveCartesiaVoice(env, input)) {
    return { success: false, error: "Cartesia key or voice is not configured" };
  }
  const language = detectElevenLabsLanguage(input.text);
  const style = input.style as SpeakStyle;
  const emotions: Partial<Record<SpeakStyle, string>> = {
    soft: "calm", teasing: "flirtatious", tired: "tired", excited: "excited",
  };
  const emotion = language === "en" ? emotions[style] : undefined;
  const transcript = stripAudioTags(input.text);
  const requestBody: Record<string, unknown> = {
    model_id: env.CARTESIA_MODEL_ID || "sonic-3.6",
    transcript: style === "laughing" && language === "en" ? `[laughter] ${transcript}` : transcript,
    voice: resolveCartesiaVoice(env, input),
    language,
    output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
  };
  if (emotion) requestBody.generation_config = { emotion };

  try {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CARTESIA_API_KEY}`,
        "Cartesia-Version": env.CARTESIA_VERSION || "2026-08-14",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const audio = await response.arrayBuffer();
    if (!audio.byteLength) return { success: false, error: "Empty audio response" };
    return { success: true, audio_base64: arrayBufferToBase64(audio), final_text: transcript };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.name : "Request failed" };
  }
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function getAzureVoice(env: Env, language: ElevenLabsLanguage): string {
  return language === "zh" ? env.AZURE_VOICE_ZH || "zh-CN-XiaoxiaoNeural"
    : env.AZURE_VOICE_EN || "en-US-JennyNeural";
}

export function buildAzureSsml(env: Env, input: SpeakInput): string {
  const language = detectElevenLabsLanguage(input.text);
  const voice = getAzureVoice(env, language);
  const locale = language === "zh" ? "zh-CN" : "en-US";
  // Only claim styles for the documented default voices. Custom voices speak neutrally.
  const defaultVoice = language === "zh" ? "zh-CN-XiaoxiaoNeural" : "en-US-JennyNeural";
  const styleMap: Partial<Record<SpeakStyle, string>> = language === "zh"
    ? { soft: "gentle", whisper: "whispering", excited: "excited" }
    : { whisper: "whispering", excited: "excited" };
  const azureStyle = voice === defaultVoice ? styleMap[input.style as SpeakStyle] : undefined;
  const spokenText = escapeXml(stripAudioTags(input.text));
  const content = azureStyle
    ? `<mstts:express-as style="${azureStyle}">${spokenText}</mstts:express-as>` : spokenText;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}"><voice name="${escapeXml(voice)}">${content}</voice></speak>`;
}

export async function generateAzureAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  const region = env.AZURE_SPEECH_REGION?.trim().toLowerCase();
  if (!env.AZURE_SPEECH_KEY || !region) {
    return { success: false, error: "Azure Speech key or region is not configured" };
  }
  if (!/^[a-z0-9-]+$/.test(region)) {
    return { success: false, error: "Invalid Azure Speech region" };
  }
  try {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "voice-mcp",
      },
      body: buildAzureSsml(env, input),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const audio = await response.arrayBuffer();
    if (!audio.byteLength) return { success: false, error: "Empty audio response" };
    return { success: true, audio_base64: arrayBufferToBase64(audio), final_text: stripAudioTags(input.text) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.name : "Request failed" };
  }
}

export function isValidHistoryItemId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,96}$/.test(value);
}

export function getTextFromHistoryDialogue(dialogue: ElevenLabsHistoryItem["dialogue"]): string | undefined {
  if (!Array.isArray(dialogue)) return undefined;

  const text = dialogue
    .map((entry) => typeof entry.text === "string" ? entry.text.trim() : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text || undefined;
}

export function getTextFromAlignment(alignment?: ElevenLabsAlignment): string | undefined {
  const text = alignment?.characters?.join("").trim();
  return text || undefined;
}

export function getHistoryText(metadata: ElevenLabsHistoryItem, alignment: ElevenLabsAlignment | undefined, historyItemId: string): string {
  return metadata.text?.trim()
    || getTextFromHistoryDialogue(metadata.dialogue)
    || getTextFromAlignment(alignment)
    || `ElevenLabs history ${historyItemId}`;
}

export function hasUsableCaptionCues(text: string, cues: CaptionCue[]): boolean {
  if (!cues.length) return false;

  const visibleLength = stripAudioTags(text).length;
  const lastEnd = Math.max(...cues.map((cue) => cue.end));
  const hasSubstantialCue = cues.some((cue) => cue.end - cue.start > 0.35);

  if (visibleLength > 60 && lastEnd < 3) return false;
  return hasSubstantialCue || visibleLength <= 20;
}

export async function createForcedAlignment(env: Env, text: string, audioBuffer: ArrayBuffer): Promise<ElevenLabsAlignment | undefined> {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey || !text.trim()) return undefined;

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "history.mp3");
  formData.append("text", text);

  const response = await fetch("https://api.elevenlabs.io/v1/forced-alignment", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    console.error("ElevenLabs forced alignment failed", response.status, await response.text());
    return undefined;
  }

  const data = await response.json() as {
    characters?: Array<{ text?: string; start?: number; end?: number }>;
  };

  if (!Array.isArray(data.characters) || !data.characters.length) return undefined;

  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  for (const character of data.characters) {
    const value = character.text || "";
    const start = Number(character.start);
    const end = Number(character.end);

    if (!value || !Number.isFinite(start) || !Number.isFinite(end)) continue;

    characters.push(value);
    starts.push(start);
    ends.push(end);
  }

  if (!characters.length || characters.length !== starts.length || starts.length !== ends.length) return undefined;

  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

export async function fetchElevenLabsHistoryEvent(env: Env, historyItemId: string): Promise<{ success: boolean; event?: VoiceEvent; error?: string }> {
  try {
    const apiKey = env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return { success: false, error: "ELEVENLABS_API_KEY is not configured" };
    }
    if (!isValidHistoryItemId(historyItemId)) {
      return { success: false, error: "Invalid ElevenLabs history item ID" };
    }

    const historyUrl = `https://api.elevenlabs.io/v1/history/${encodeURIComponent(historyItemId)}`;
    const metadataResponse = await fetch(historyUrl, {
      headers: {
        "xi-api-key": apiKey,
        "Accept": "application/json",
      },
    });

    if (!metadataResponse.ok) {
      const errorText = await metadataResponse.text();
      return { success: false, error: `ElevenLabs history error ${metadataResponse.status}: ${errorText}` };
    }

    const metadata = await metadataResponse.json() as ElevenLabsHistoryItem;
    const audioResponse = await fetch(`${historyUrl}/audio`, {
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!audioResponse.ok) {
      const errorText = await audioResponse.text();
      return { success: false, error: `ElevenLabs history audio error ${audioResponse.status}: ${errorText}` };
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBase64 = arrayBufferToBase64(audioBuffer);
    const alignment = normalizeElevenLabsAlignment(metadata.alignments);
    const text = getHistoryText(metadata, alignment, historyItemId);
    let captionCues = createCaptionCues(text, alignment);

    if (!hasUsableCaptionCues(text, captionCues)) {
      const forcedText = stripAudioTags(text) || text;
      const forcedAlignment = await createForcedAlignment(env, forcedText, audioBuffer);
      captionCues = forcedAlignment ? createCaptionCues(forcedText, forcedAlignment) : [];
    }

    const createdAt = typeof metadata.date_unix === "number" && Number.isFinite(metadata.date_unix)
      ? new Date(metadata.date_unix * 1000).toISOString()
      : new Date().toISOString();

    return {
      success: true,
      event: {
        id: crypto.randomUUID(),
        text,
        audio_base64: audioBase64,
        created_at: createdAt,
        provider: "elevenlabs",
        model_id: metadata.model_id || getElevenLabsModel(env),
        history_item_id: metadata.history_item_id || historyItemId,
        caption_cues: captionCues.length ? captionCues : undefined,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

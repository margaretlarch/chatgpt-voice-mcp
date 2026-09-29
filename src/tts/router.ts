import type { AudioResult, Env, SpeakInput, TtsProvider, TtsProviderAdapter } from "../types";
import { PROVIDER_IDS, getBasePriority, getProviderPriority } from "../config";
import { audioPostprocessors } from "../postprocessors";
import { getDashScopeModel, getElevenLabsModel, generateDashScopeAudio, generateElevenLabsAudio, generateCartesiaAudio, generateAzureAudio } from "./providers";

export const ttsProviders: Record<TtsProvider, TtsProviderAdapter> = {
  elevenlabs: {
    id: "elevenlabs", model: getElevenLabsModel,
    configured: (env) => Boolean(env.ELEVENLABS_API_KEY && (env.ELEVENLABS_VOICE_ID || env.ELEVENLABS_VOICE_ID_ZH || env.ELEVENLABS_VOICE_ID_EN)),
    generate: generateElevenLabsAudio,
  },
  cartesia: {
    id: "cartesia", model: (env) => env.CARTESIA_MODEL_ID || "sonic-3.6",
    configured: (env) => Boolean(env.CARTESIA_API_KEY && (env.CARTESIA_VOICE_ID || env.CARTESIA_VOICE_ID_ZH || env.CARTESIA_VOICE_ID_EN)),
    generate: generateCartesiaAudio,
  },
  azure: {
    id: "azure", model: () => "Azure Speech",
    configured: (env) => Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION),
    generate: generateAzureAudio,
  },
  dashscope: {
    id: "dashscope", model: getDashScopeModel,
    configured: (env) => Boolean(env.DASHSCOPE_API_KEY && env.VOICE_ID),
    generate: generateDashScopeAudio,
  },
};

export async function generateAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  const priority = getProviderPriority(env, input);
  const attempts: NonNullable<AudioResult["attempts"]> = [];
  for (const providerId of priority) {
    const provider = ttsProviders[providerId];
    if (!provider.configured(env)) {
      attempts.push({ provider: providerId, reason: "not configured" });
      continue;
    }
    const result = await provider.generate(env, input);
    if (result.success && result.audio_base64) {
      let processed: AudioResult = { ...result, provider: providerId, model_id: provider.model(env), attempts };
      for (const postprocess of audioPostprocessors) processed = await postprocess(processed, input);
      return processed;
    }
    attempts.push({ provider: providerId, reason: result.error || "unknown error" });
  }
  return { success: false, error: priority.length ? "All configured TTS providers failed" : "No valid TTS provider in priority list", attempts };
}

export function getTtsStatus(env: Env): Record<string, unknown> {
  const priority = getBasePriority(env);
  const first = priority[0];
  return {
    provider: first || "none",
    model_id: first ? ttsProviders[first].model(env) : "",
    priority,
    configured: priority.some((id) => ttsProviders[id].configured(env)),
    providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, { configured: ttsProviders[id].configured(env), model_id: ttsProviders[id].model(env) }])),
    audio_tags_enabled: priority.includes("elevenlabs") && getElevenLabsModel(env) === "eleven_v3",
  };
}

import type { Env, SpeakInput, SpeakScene, TtsProvider } from "./types";
import { detectElevenLabsLanguage } from "./tts/providers";

export function getIdentity(env: Env): { botName: string; userName: string; testLine: string } {
  const botName = env.BOT_NAME?.trim() || "Voice";
  const userName = env.USER_NAME?.trim() || "";
  return { botName, userName, testLine: userName ? `${userName}，我在。` : "我在。" };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export const PROVIDER_IDS: TtsProvider[] = ["elevenlabs", "cartesia", "azure", "dashscope"];
export function parseProviderPriority(value: string | undefined): TtsProvider[] {
  const providers = (value || "").split(",").map((part) => part.trim().toLowerCase());
  return [...new Set(providers.filter((part): part is TtsProvider => PROVIDER_IDS.includes(part as TtsProvider)))];
}

export function getBasePriority(env: Env): TtsProvider[] {
  if (env.TTS_PROVIDER_PRIORITY?.trim()) return parseProviderPriority(env.TTS_PROVIDER_PRIORITY);
  if (env.TTS_PROVIDER?.trim()) return parseProviderPriority(env.TTS_PROVIDER);
  return ["dashscope"]; // Keep old deployments working until priority is configured.
}

export function getScene(input: SpeakInput): SpeakScene {
  if (input.scene) return input.scene;
  if (input.style === "soft" || input.style === "whisper") return "asmr";
  return detectElevenLabsLanguage(input.text) === "en" ? "conversation" : "general";
}

export function getProviderPriority(env: Env, input: SpeakInput): TtsProvider[] {
  const scene = getScene(input);
  const override = scene === "asmr" ? env.TTS_PRIORITY_ASMR
    : scene === "conversation" ? env.TTS_PRIORITY_CONVERSATION : env.TTS_PRIORITY_GENERAL;
  return override?.trim() ? parseProviderPriority(override) : getBasePriority(env);
}

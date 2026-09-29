import type { SpeakInput, SpeakStyle } from "../types";

export const SPEAK_STYLES: SpeakStyle[] = ["normal", "soft", "whisper", "teasing", "tired", "laughing", "excited"];
export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[A-Za-z][A-Za-z _-]*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?，。！？])/g, "$1")
    .trim();
}

export function hasAudioTags(text: string): boolean {
  return stripAudioTags(text) !== text.trim();
}

export function normalizeSpeakInput(input: SpeakInput): SpeakInput {
  return {
    ...input,
    style: SPEAK_STYLES.includes(input.style?.trim().toLowerCase() as SpeakStyle)
      ? input.style?.trim().toLowerCase() : "normal",
    raw_tags: input.raw_tags ?? hasAudioTags(input.text),
  };
}

export function parseRawTags(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value.trim().toLowerCase() === "true";
}

export function getSpeakInputError(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return "Missing text parameter";
  if (trimmed.length > 5000) return "Text is too long (maximum 5000 characters)";

  if (/\{text\}/i.test(trimmed)) {
    return "Text placeholder was not replaced";
  }

  const visibleText = stripAudioTags(trimmed);
  if (!/[A-Za-z0-9\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(visibleText)) {
    return "No speakable text";
  }

  return undefined;
}

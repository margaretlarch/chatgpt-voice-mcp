import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AudioResult, Env, SpeakInput, VoiceEvent } from "../types";
import { getBasePriority, getIdentity } from "../config";
import { createCaptionCues } from "../tts/captions";
import { generateAudio, ttsProviders } from "../tts/router";
import { SPEAK_STYLES, normalizeSpeakInput, getSpeakInputError } from "../tts/styles";
import { EXT_APPS_MIME, VOICE_RESOURCE_URI, getPlayerHTML } from "../ui/player";

const LATEST_VOICE_CACHE_PATH = "/__voice-mcp/latest-voice-event";

export function getLatestVoiceCacheRequest(origin: string): Request {
  return new Request(new URL(LATEST_VOICE_CACHE_PATH, origin).toString(), { method: "GET" });
}

export function createVoiceEvent(env: Env, input: SpeakInput, result: AudioResult): VoiceEvent {
  const provider = result.provider || getBasePriority(env)[0] || "dashscope";
  const finalText = result.final_text || input.text;
  const alignment = result.alignment || result.normalized_alignment;
  const captionCues = createCaptionCues(finalText, alignment);

  return {
    id: crypto.randomUUID(),
    text: input.text,
    audio_base64: result.audio_base64 || "",
    created_at: new Date().toISOString(),
    provider,
    model_id: result.model_id || ttsProviders[provider].model(env),
    caption_cues: captionCues.length ? captionCues : undefined,
    style: input.style,
    raw_tags: input.raw_tags,
  };
}

export async function storeLatestVoiceEvent(origin: string, event: VoiceEvent): Promise<void> {
  await caches.default.put(
    getLatestVoiceCacheRequest(origin),
    Response.json(event, {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    }),
  );
}

export async function readLatestVoiceEvent(origin: string): Promise<VoiceEvent | null> {
  const response = await caches.default.match(getLatestVoiceCacheRequest(origin));
  if (!response) return null;
  return await response.json<VoiceEvent>();
}

// =============================================================================
// MCP Server Factory
// =============================================================================

export function createVoiceServer(env: Env, origin: string): McpServer {
  const { botName } = getIdentity(env);
  const PLAYER_HTML = getPlayerHTML(botName);

  const server = new McpServer({
    name: "voice-mcp",
    version: "1.0.0",
  });

  const uiCapabilities = {
    extensions: {
      "io.modelcontextprotocol/ui": {},
    },
  } as unknown as Parameters<typeof server.server.registerCapabilities>[0];
  server.server.registerCapabilities(uiCapabilities);

  server.resource(
    VOICE_RESOURCE_URI,
    VOICE_RESOURCE_URI,
    { mimeType: EXT_APPS_MIME, description: "Voice Player" },
    async () => ({
      contents: [
        {
          uri: VOICE_RESOURCE_URI,
          mimeType: EXT_APPS_MIME,
          text: PLAYER_HTML,
        },
      ],
    }),
  );

  server.registerTool(
    "speak",
    {
      title: `${botName}'s Voice`,
      description: `Synthesize speech with a configured TTS provider and show an inline audio player. Text is sent to the selected provider.`,
      inputSchema: z.object({
        text: z.string().describe("Text to speak"),
        style: z.enum(SPEAK_STYLES).optional().describe("Speaking style: normal, soft, whisper, teasing, tired, laughing, or excited"),
        scene: z.enum(["asmr", "conversation", "general"]).optional().describe("Optional routing preference; overrides automatic scene selection"),
        raw_tags: z.boolean().optional().describe("Allow raw ElevenLabs v3 audio tags when supported"),
      }),
      _meta: {
        ui: { resourceUri: VOICE_RESOURCE_URI },
        "ui/resourceUri": VOICE_RESOURCE_URI,
        "openai/outputTemplate": VOICE_RESOURCE_URI,
      },
    },
    async ({ text, style, scene, raw_tags }) => {
      const input = normalizeSpeakInput({ text, style, scene, raw_tags });
      const inputError = getSpeakInputError(input.text);
      if (inputError) {
        return {
          content: [
            { type: "text" as const, text: `Voice generation skipped: ${inputError}` },
          ],
          structuredContent: {
            error: inputError,
          },
        };
      }

      const result = await generateAudio(env, input);

      if (result.success && result.audio_base64) {
        try {
          await storeLatestVoiceEvent(origin, createVoiceEvent(env, input, result));
        } catch (error) {
          console.error("Failed to store latest voice event", error);
        }

        return {
          content: [
            { type: "text" as const, text: `🎙️ ${botName} says: "${text}"` },
          ],
          structuredContent: {
            text: text,
            provider: result.provider,
            model_id: result.model_id,
          },
          _meta: { audio_base64: result.audio_base64 },
        };
      }

      return {
        content: [
          { type: "text" as const, text: `Voice generation failed: ${result.error}. ${result.attempts?.map((attempt) => `${attempt.provider}: ${attempt.reason}`).join("; ") || ""}` },
        ],
        structuredContent: {
          error: result.error || 'Unknown error',
          attempts: result.attempts,
        },
      };
    },
  );

  return server;
}

// =============================================================================
// Worker Handler
// =============================================================================

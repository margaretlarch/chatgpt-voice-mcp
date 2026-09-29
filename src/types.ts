export interface Env {
  TTS_PROVIDER?: string;
  TTS_PROVIDER_PRIORITY?: string;
  TTS_PRIORITY_ASMR?: string;
  TTS_PRIORITY_CONVERSATION?: string;
  TTS_PRIORITY_GENERAL?: string;
  DASHSCOPE_API_KEY?: string;
  VOICE_ID?: string;
  TTS_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_VOICE_ID_ZH?: string;
  ELEVENLABS_VOICE_ID_EN?: string;
  ELEVENLABS_MODEL_ID?: string;
  ELEVENLABS_OUTPUT_FORMAT?: string;
  ELEVENLABS_LANGUAGE_CODE?: string;
  ELEVENLABS_LANGUAGE_CODE_ZH?: string;
  ELEVENLABS_LANGUAGE_CODE_EN?: string;
  ELEVENLABS_STABILITY?: string;
  ELEVENLABS_SIMILARITY_BOOST?: string;
  ELEVENLABS_STYLE?: string;
  ELEVENLABS_USE_SPEAKER_BOOST?: string;
  ELEVENLABS_SPEED?: string;
  CARTESIA_API_KEY?: string;
  CARTESIA_VOICE_ID?: string;
  CARTESIA_VOICE_ID_ZH?: string;
  CARTESIA_VOICE_ID_EN?: string;
  CARTESIA_MODEL_ID?: string;
  CARTESIA_VERSION?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  AZURE_VOICE_ZH?: string;
  AZURE_VOICE_EN?: string;
  BOT_NAME?: string;
  USER_NAME?: string;
  AUTH_MODE?: string;
  AUTH_BASE_URL?: string;
  AUTH_ALLOWED_GITHUB_ID?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  OAUTH_KV?: KVNamespace;
}

export type TtsProvider = "dashscope" | "elevenlabs" | "cartesia" | "azure";
export type SpeakStyle = "normal" | "soft" | "whisper" | "teasing" | "tired" | "laughing" | "excited";
export type SpeakScene = "asmr" | "conversation" | "general";
export type ElevenLabsLanguage = "zh" | "en";

export interface SpeakInput {
  text: string;
  style?: string;
  raw_tags?: boolean;
  scene?: SpeakScene;
}

export interface AudioResult {
  success: boolean;
  audio_base64?: string;
  alignment?: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
  final_text?: string;
  error?: string;
  provider?: TtsProvider;
  model_id?: string;
  attempts?: Array<{ provider: TtsProvider; reason: string }>;
}

export interface TtsProviderAdapter {
  id: TtsProvider;
  configured(env: Env): boolean;
  model(env: Env): string;
  generate(env: Env, input: SpeakInput): Promise<AudioResult>;
}

export type AudioPostprocessor = (result: AudioResult, input: SpeakInput) => Promise<AudioResult>;

export interface ElevenLabsAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

export interface CaptionCue {
  text: string;
  start: number;
  end: number;
}

export interface VoiceEvent {
  id: string;
  text: string;
  audio_base64: string;
  created_at: string;
  provider: TtsProvider;
  model_id: string;
  history_item_id?: string;
  caption_cues?: CaptionCue[];
  style?: string;
  raw_tags?: boolean;
}

export interface ElevenLabsVoiceSelection {
  voiceId?: string;
  language: ElevenLabsLanguage;
  languageCode?: string;
}

export interface ElevenLabsHistoryItem {
  history_item_id?: string;
  date_unix?: number;
  voice_id?: string | null;
  model_id?: string | null;
  voice_name?: string | null;
  text?: string | null;
  alignments?: unknown;
  dialogue?: Array<Record<string, unknown>> | null;
}

// =============================================================================
// Constants
// =============================================================================

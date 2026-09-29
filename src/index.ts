import { createMcpHandler } from "agents/mcp";
import type { Env, SpeakScene } from "./types";
import { getAuthConfig, getAuthMode, createOAuthWorker } from "./auth";
import { getIdentity } from "./config";
import { generateAudio } from "./tts/router";
import { parseRawTags, getSpeakInputError, normalizeSpeakInput } from "./tts/styles";
import { fetchElevenLabsHistoryEvent } from "./tts/providers";
import { createVoiceServer, createVoiceEvent, storeLatestVoiceEvent, readLatestVoiceEvent } from "./mcp/server";
import { getVisualizerPanelHTML } from "./ui/panel";

const privatePaths = new Set(["/mcp", "/mcp/", "/sse", "/panel", "/events/latest", "/history", "/speak"]);
const developmentCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function publicResponse(request: Request): Response {
  const path = new URL(request.url).pathname;
  if (path === "/status") {
    return Response.json({ status: "ok", service: "voice-mcp" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (path === "/") {
    return new Response("voice-mcp is running. Connect the /mcp endpoint in ChatGPT.", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response("Not Found", { status: 404 });
}

async function privateResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const headers = getAuthMode(env) === "none" ? developmentCors : {};
  if (path === "/mcp" || path === "/mcp/" || path === "/sse") {
    const handler = createMcpHandler(createVoiceServer(env, url.origin), {
      route: null as unknown as string,
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    return handler(request, env, ctx);
  }
  if (path === "/panel" && request.method === "GET") {
    const identity = getIdentity(env);
    return new Response(getVisualizerPanelHTML(identity.botName, identity.testLine), {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (path === "/events/latest" && request.method === "GET") {
    const event = await readLatestVoiceEvent(url.origin);
    return Response.json({ event: event?.id === url.searchParams.get("since") ? null : event }, {
      headers: { ...headers, "Cache-Control": "no-store" },
    });
  }
  if (path === "/history" && request.method === "GET") {
    const id = url.searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "Missing id parameter" }, { status: 400, headers });
    const result = await fetchElevenLabsHistoryEvent(env, id);
    if (!result.success || !result.event) {
      return Response.json({ error: result.error || "History item unavailable" }, { status: 500, headers });
    }
    try { await storeLatestVoiceEvent(url.origin, result.event); } catch { /* cache is optional */ }
    return Response.json({ event: result.event }, { headers: { ...headers, "Cache-Control": "no-store" } });
  }
  if (path === "/speak" && (request.method === "POST" || (request.method === "GET" && getAuthMode(env) === "none"))) {
    let text = "";
    let style: string | undefined;
    let scene: SpeakScene | undefined;
    let rawTags: boolean | undefined;
    if (request.method === "GET") {
      text = url.searchParams.get("text") || "";
      style = url.searchParams.get("style") || undefined;
      scene = url.searchParams.get("scene") as SpeakScene | undefined;
      rawTags = parseRawTags(url.searchParams.get("raw_tags"));
    } else {
      let payload: Record<string, unknown>;
      try {
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
        payload = body as Record<string, unknown>;
      } catch {
        return Response.json({ error: "JSON object required" }, { status: 400, headers });
      }
      text = typeof payload.text === "string" ? payload.text : "";
      style = typeof payload.style === "string" ? payload.style : undefined;
      scene = typeof payload.scene === "string" ? payload.scene as SpeakScene : undefined;
      rawTags = typeof payload.raw_tags === "boolean" ? payload.raw_tags : undefined;
    }
    const inputError = getSpeakInputError(text);
    if (inputError) return Response.json({ error: inputError }, { status: 400, headers });
    const input = normalizeSpeakInput({
      text, style,
      scene: scene === "asmr" || scene === "conversation" || scene === "general" ? scene : undefined,
      raw_tags: rawTags,
    });
    const result = await generateAudio(env, input);
    if (!result.success || !result.audio_base64) {
      return Response.json({ error: result.error }, { status: 500, headers });
    }
    try { await storeLatestVoiceEvent(url.origin, createVoiceEvent(env, input, result)); } catch { /* cache is optional */ }
    const binary = atob(result.audio_base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new Response(bytes, {
      headers: { ...headers, "Content-Type": "audio/mpeg", "Content-Disposition": 'inline; filename="voice.mp3"', "Cache-Control": "no-store" },
    });
  }
  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const mode = getAuthMode(env);
    if (mode === "none") {
      if (request.method === "OPTIONS") return new Response(null, { headers: developmentCors });
      return privatePaths.has(new URL(request.url).pathname) ? privateResponse(request, env, ctx) : publicResponse(request);
    }
    if (mode !== "oauth") return new Response("Invalid AUTH_MODE", { status: 503 });
    const config = getAuthConfig(env);
    if (!config) {
      if (new URL(request.url).pathname === "/status") return publicResponse(request);
      return new Response("OAuth is not configured", { status: 503 });
    }
    if (new URL(request.url).origin !== config.baseUrl) return new Response("Invalid host", { status: 400 });
    return createOAuthWorker(config, privateResponse, async request => publicResponse(request)).fetch(request, env, ctx);
  },
};

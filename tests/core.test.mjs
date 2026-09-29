import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadTypeScript(path) {
  const result = await build({
    entryPoints: [path], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: [{
      name: "worker-entrypoint-stub",
      setup(builder) {
        builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "worker-entrypoint", namespace: "test" }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export class WorkerEntrypoint {}", loader: "js" }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

const config = await loadTypeScript("src/config.ts");
const router = await loadTypeScript("src/tts/router.ts");
const auth = await loadTypeScript("src/auth.ts");

test("identity defaults and scene priority remain configurable", () => {
  assert.deepEqual(config.getIdentity({}), { botName: "Voice", userName: "", testLine: "我在。" });
  assert.equal(config.getIdentity({ BOT_NAME: "陆澈", USER_NAME: "小橘" }).testLine, "小橘，我在。");
  const env = { TTS_PROVIDER_PRIORITY: "azure", TTS_PRIORITY_ASMR: "elevenlabs,azure", TTS_PRIORITY_CONVERSATION: "cartesia,azure" };
  assert.deepEqual(config.getProviderPriority(env, { text: "Hello", style: "whisper" }), ["elevenlabs", "azure"]);
  assert.deepEqual(config.getProviderPriority(env, { text: "Hello" }), ["cartesia", "azure"]);
  assert.deepEqual(config.getProviderPriority(env, { text: "你好", scene: "general" }), ["azure"]);
});

test("provider error moves to the next configured provider", async () => {
  const first = router.ttsProviders.elevenlabs.generate;
  const second = router.ttsProviders.azure.generate;
  try {
    router.ttsProviders.elevenlabs.generate = async () => ({ success: false, error: "HTTP 429" });
    router.ttsProviders.azure.generate = async () => ({ success: true, audio_base64: "AA==" });
    const env = {
      TTS_PROVIDER_PRIORITY: "elevenlabs,azure",
      ELEVENLABS_API_KEY: "dummy", ELEVENLABS_VOICE_ID: "dummy",
      AZURE_SPEECH_KEY: "dummy", AZURE_SPEECH_REGION: "test",
    };
    const result = await router.generateAudio(env, { text: "Hello" });
    assert.equal(result.provider, "azure");
    assert.deepEqual(result.attempts, [{ provider: "elevenlabs", reason: "HTTP 429" }]);
  } finally {
    router.ttsProviders.elevenlabs.generate = first;
    router.ttsProviders.azure.generate = second;
  }
});

test("OAuth mode fails closed and protected endpoints challenge without bearer", async () => {
  assert.equal(auth.getAuthMode({}), "oauth");
  assert.equal(auth.getAuthConfig({}), null);
  const env = {
    AUTH_BASE_URL: "https://voice.example",
    AUTH_ALLOWED_GITHUB_ID: "123",
    GITHUB_OAUTH_CLIENT_ID: "dummy",
    GITHUB_OAUTH_CLIENT_SECRET: "dummy",
    OAUTH_KV: {},
  };
  const settings = auth.getAuthConfig(env);
  assert.ok(settings);
  const worker = auth.createOAuthWorker(settings, async () => new Response("private"), async () => new Response("public"));
  for (const path of ["/mcp", "/mcp/", "/speak", "/panel", "/events/latest", "/history"]) {
    const response = await worker.fetch(new Request(`https://voice.example${path}`), env, {});
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("WWW-Authenticate") || "", /Bearer.*resource_metadata/);
  }
  const status = await worker.fetch(new Request("https://voice.example/status"), env, {});
  assert.equal(status.status, 200);
  const metadata = await worker.fetch(new Request("https://voice.example/.well-known/oauth-protected-resource"), env, {});
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).resource, "https://voice.example");
});

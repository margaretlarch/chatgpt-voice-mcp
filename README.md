# chatgpt-voice-mcp

基于 [Yinglianchun/voice-mcp](https://github.com/Yinglianchun/voice-mcp)（源自 [garan0613/voice-mcp](https://github.com/garan0613/voice-mcp)）继续开发。保留 `speak(text, style?, raw_tags?, scene?)`、MCP Apps 内嵌播放器、ElevenLabs history、Cloudflare Workers 路线。原项目的 MIT 授权见 [LICENSE](LICENSE)。

## 能做什么

- ElevenLabs、Cartesia、Azure Speech、原有 DashScope。按配置优先级路由；失败时尝试下一家。
- `scene=asmr|conversation|general`，`style=normal|soft|whisper|teasing|tired|laughing|excited`。provider 不支持的风格降级为普通说话。
- TTS → `audioPostprocessors`（目前为空）→ MCP Apps MP3 播放器。没有本地 GPU 或常驻服务。
- `BOT_NAME` 控制工具和播放器称呼；`USER_NAME` 用于示例台词。两者都从环境变量读取。未设置时分别为 `Voice` 和空；示例台词会变成“我在。”。

## 第一次部署清单

在 **Windows PowerShell** 中操作；命令都在含 `package.json` 的仓库文件夹里**逐条运行**。现在无需执行，等注册好账号和 Key 后再做。

1. **注册 Cloudflare**，确认 Workers 可用，并在 Cloudflare 控制台记下你的 `workers.dev` 子域。先运行 `npm ci`、`npx tsc --noEmit`、`npx wrangler deploy --dry-run`；无类型报错且 dry run 构建成功即可。
2. **注册至少一家 TTS**（[ElevenLabs](https://elevenlabs.io/)、[Cartesia](https://cartesia.ai/) 或 [Azure Speech](https://azure.microsoft.com/products/ai-services/ai-speech)），取得对应 API key / voice ID / region。供应商额度与计费规则以各自控制台为准。
3. **设置身份变量**：示例是 `BOT_NAME=陆澈`、`USER_NAME=小橘`；在 Cloudflare Worker 的变量设置中填入自己要用的值，不要写进源码。再按下面的表设置 TTS 优先级。
4. **设置 API secrets**：运行 `npx wrangler login` 登录；在 Worker 的设置中用 Secrets 保存 TTS key，不要提交 `.dev.vars` 或把 key 写在命令行参数里。如果 Cloudflare 要求先有 Worker，先执行一次 `npx wrangler deploy` 建立空配置 Worker；默认 OAuth 配置不全时私人端点会拒绝请求。
5. **配置 OAuth**：在 GitHub 创建一个 [OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)，回调地址填 `https://你的-worker.你的子域.workers.dev/callback`。在 Worker 中设置 `AUTH_MODE=oauth`、`AUTH_BASE_URL=https://你的-worker.你的子域.workers.dev`、`AUTH_ALLOWED_GITHUB_ID=你的数字 GitHub ID`、`GITHUB_OAUTH_CLIENT_ID`，并把 `GITHUB_OAUTH_CLIENT_SECRET` 存为 Secret。GitHub 数字 ID 可打开 `https://api.github.com/users/你的GitHub用户名` 查看 `id` 字段。GitHub OAuth App 不用申请额外数据 scopes；这里只查询登录者的 GitHub 数字 ID。`OAUTH_KV` 由 Wrangler 配置绑定，用于 OAuth client、授权和 token 状态。Worker 地址与 OAuth App 回调地址必须完全一致。**不需要把 TTS key 或 OAuth secret 交给 ChatGPT。**
6. **部署**：运行 `npx wrangler deploy`。Wrangler 会根据 `wrangler.jsonc` 为 `OAUTH_KV` 创建或绑定 KV namespace；部署后先访问 `/status`（只显示 `ok`），再确认不带 Bearer token 访问 `/mcp`、`/speak`、`/history`、`/events/latest` 会收到 `401`。首次部署前可在 Cloudflare 控制台核对 Worker 名称与 KV 资源。
7. **接入 ChatGPT**：在支持自定义 MCP App 的 ChatGPT **网页端**打开 Settings / Workspace settings → Apps → Create，填 `https://你的-worker.你的子域.workers.dev/mcp`。按 OAuth 登录提示登录 GitHub 并同意授权，Scan Tools 后确认看到 `speak`。
8. **试一句**：让 ChatGPT 调用 `speak` 读“小橘，我在。”。成功时工具返回内嵌播放器，手动点击播放。如果登录、Scan Tools 或播放器失败，保留错误文字与发生在哪一步，隐藏所有 key/token 后再排查。

Cloudflare 的 [Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider) 负责 MCP OAuth 2.1、PKCE、Client ID Metadata Documents / 动态客户端注册、token 校验；GitHub OAuth App 只负责确认登录者是你设置的数字 ID。ChatGPT 会在 MCP 请求中使用 `Authorization: Bearer`；自定义 API key header 和把 key 塞进 URL 都不是这里的认证方案。Cloudflare Access 可以作为上游身份系统集成，但仅在 Worker 前加 Access 登录页不能替代 MCP OAuth 发现与 Bearer token 流程。依据：[OpenAI MCP 认证](https://developers.openai.com/plugins/build/auth)、[Cloudflare MCP 认证](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)、[GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)。Cloudflare Workers 与 KV 有[免费额度](https://developers.cloudflare.com/workers/platform/pricing/)，超过免费额度和 TTS 厂商费用需在部署前自行核对；本仓库未创建付费资源。

## 配置

`.env.example` 是变量名和示例值清单。Cloudflare 的普通变量可在 Worker 设置中添加；密钥使用 Secrets。本地短期试验可复制为未跟踪的 `.dev.vars`，把 `AUTH_MODE` 临时改为 `none` 后运行 `npm run dev`。`none` 会公开 `/mcp` 等私人端点，**不要带着它长期部署**。默认 `AUTH_MODE=oauth`，OAuth 变量不全时私人端点拒绝请求。

| 变量 | 作用 / 示例 |
| --- | --- |
| `BOT_NAME`、`USER_NAME` | 播放器身份、测试台词；例如 `陆澈`、`小橘` |
| `TTS_PROVIDER_PRIORITY` | 默认顺序：`elevenlabs,cartesia,azure` |
| `TTS_PRIORITY_ASMR` | 例如 `elevenlabs,cartesia,azure` |
| `TTS_PRIORITY_CONVERSATION` | 例如 `cartesia,elevenlabs,azure` |
| `TTS_PRIORITY_GENERAL` | 例如 `elevenlabs,cartesia,azure` |
| `AUTH_MODE` | `oauth`（长期部署）或 `none`（本地试验） |
| `AUTH_BASE_URL` | Worker 的 HTTPS origin，无路径和尾部 `/` |
| `AUTH_ALLOWED_GITHUB_ID` | 唯一允许授权的 GitHub 数字账号 ID |
| `GITHUB_OAUTH_CLIENT_ID`、`GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App 凭据；Secret 只放 Cloudflare Secrets |

ElevenLabs 用 `ELEVENLABS_API_KEY`、`ELEVENLABS_VOICE_ID`；Cartesia 用 `CARTESIA_API_KEY`、`CARTESIA_VOICE_ID`；Azure 用 `AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`，可选 `AZURE_VOICE_ZH/EN`。语种 voice 和模型变量见 `.env.example`。旧 `TTS_PROVIDER=dashscope`、`DASHSCOPE_API_KEY`、`VOICE_ID` 仍可用。播放器需要 MP3。具体 API 行为见 [Cartesia Bytes](https://docs.cartesia.ai/api-reference/tts/bytes)、[Azure REST TTS](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)。

## 端点与限制

- `/mcp`：MCP；`/speak`：直出 MP3；`/panel`：原有可视化页面；`/history`：ElevenLabs 历史记录；`/events/latest`：最近一次语音。这些在 OAuth 模式下都要求有效 Bearer token 和 `voice:speak` scope。
- `/status`：公开、最小健康检查，只返回服务状态，不暴露 provider、voice ID 或 key。
- OAuth 模式的直出接口只接受 `POST /speak`，JSON 如 `{ "text": "Hello", "style": "soft" }`；本地 `none` 模式仍兼容 `GET /speak`。
- **独立浏览器 `/panel`** 在 OAuth 模式下无法靠地址栏直接打开并交互：地址栏不会附带 ChatGPT 的 Bearer token。页面及其私人数据接口已受保护。ChatGPT 内嵌的 MCP Apps 播放器仍直接读取本次工具结果中的音频，不依赖 `/panel`。若要长期使用独立面板，需要另做浏览器会话登录。
- 最近一次语音缓存不按用户隔离，可能在不同 Cloudflare 边缘节点上不一致。它只有一个 GitHub ID 可授权，但同一人授权的多个 OAuth client 都能读取它。
- 代码已有 OAuth 元数据和入口 `401` challenge；当前固定的 MCP SDK 版本尚未输出 OpenAI 新文档建议的逐工具 `securitySchemes`。因此 ChatGPT 的连接/授权 UI 和 MCP Apps 播放器必须在真实账号部署后实测，不能把本地 dry run 当作端到端兼容证明。[OpenAI 说明](https://developers.openai.com/plugins/build/auth)还要求逐工具认证标记以触发工具级登录。
- [ChatGPT 开发者模式支持范围](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)会变；官方目前说明完整 MCP 与 Apps UI 以网页端特定工作区为主，手机 App 不保证支持。不要把移动端播放视为已验证功能。

音频正文会发送给选中的 TTS 厂商。`src/postprocessors/index.ts` 只保留后处理入口，当前没有 binaural 依赖。

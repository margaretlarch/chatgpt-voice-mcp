# voice-mcp：ChatGPT 官方网页中的自定义语音

基于 [Yinglianchun/voice-mcp](https://github.com/Yinglianchun/voice-mcp)，保留原有 Cloudflare Worker、MCP `speak` 工具、MCP Apps 内嵌播放器、`/panel` 页面和 ElevenLabs 历史记录。原项目是 [garan0613/voice-mcp](https://github.com/garan0613/voice-mcp) 的 fork；根目录 `LICENSE` 为 MIT。

## 能做什么

- `speak(text, style?, raw_tags?, scene?)`。旧的 `speak(text)` 和 `speak(text, style)` 继续有效。
- ElevenLabs（复用 fork 的带时间戳接口）、Cartesia Sonic、Azure Speech；旧 DashScope 继续可用。
- 按配置顺序尝试 provider。未配置、429、额度错误、5xx、超时或其他 API 失败时试下一家；不实时查询余额。
- TTS → 可选音频后处理 → MP3 播放器。后处理接口目前为空，没有部署 binaural 服务。
- 中英文按文本是否含汉字做简单选择；混合文本以中文 voice 为主。
- `style` 支持 `normal`、`soft`、`whisper`、`teasing`、`tired`、`laughing`、`excited`。provider 不支持时使用普通说话。

**ChatGPT 边界：** OpenAI 当前说明 MCP Apps 仅支持 ChatGPT **网页端**，手机 App 中的播放器不能保证。Business 与 Enterprise/Edu 的管理员可启用开发者模式并创建自定义 app；Pro 的 MCP 能力有限，本工具是否可调用需要在实际账号验证。ChatGPT 连接远程 HTTPS MCP，不能直接连接本机 Worker。见 [开发者模式说明](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) 和 [MCP Apps UI 文档](https://developers.openai.com/plugins/build/chatgpt-ui)。

## 路由配置

环境变量用逗号表示从左到右尝试。列表里没有的 provider 不会尝试。

| 变量 | 示例 | 使用时机 |
| --- | --- | --- |
| `TTS_PROVIDER_PRIORITY` | `elevenlabs,cartesia,azure` | 场景变量未设置时 |
| `TTS_PRIORITY_ASMR` | `elevenlabs,cartesia,azure` | `scene=asmr`，或 `soft` / `whisper` |
| `TTS_PRIORITY_CONVERSATION` | `cartesia,elevenlabs,azure` | `scene=conversation`，或未指定场景的英文文本 |
| `TTS_PRIORITY_GENERAL` | `elevenlabs,cartesia,azure` | 其他文本 |

显式 `scene` 优先于自动判断。旧部署只设 `TTS_PROVIDER=dashscope` 或 `elevenlabs` 时仍按单 provider 运行。若连 `TTS_PROVIDER` 都没设置，仍默认 DashScope。推荐同时填好三个场景变量，让 Azure 排在最后。

| Provider | 必需 | 可选 |
| --- | --- | --- |
| ElevenLabs | `ELEVENLABS_API_KEY`，`ELEVENLABS_VOICE_ID` 或对应语种 voice | `ELEVENLABS_VOICE_ID_ZH/EN`、`ELEVENLABS_MODEL_ID`、`ELEVENLABS_OUTPUT_FORMAT`、原 fork 的其他调音变量 |
| Cartesia | `CARTESIA_API_KEY`，`CARTESIA_VOICE_ID` 或对应语种 voice | `CARTESIA_VOICE_ID_ZH/EN`、`CARTESIA_MODEL_ID`、`CARTESIA_VERSION` |
| Azure | `AZURE_SPEECH_KEY`，`AZURE_SPEECH_REGION` | `AZURE_VOICE_ZH/EN`，默认 `zh-CN-XiaoxiaoNeural` / `en-US-JennyNeural` |
| DashScope（兼容旧配置） | `DASHSCOPE_API_KEY`、`VOICE_ID` | `TTS_MODEL` |

完整示例见 `.env.example`。Key 只写入 Cloudflare Secrets 或本机未跟踪的 `.dev.vars`，不要提交。播放器要求 MP3，`ELEVENLABS_OUTPUT_FORMAT` 应使用 `mp3_*` 值。Cartesia API 版本默认 `2026-08-14`，模型默认 `sonic-3.6`。Cartesia emotion 只用于英文；`whisper` 没有文档确认的等价控制，因此在 Cartesia 降级为普通说话。Azure 只对默认 voice 映射已确认支持的 style；自定义 voice 默认中性，以免使用它不支持的 style。参见 [Cartesia 字节音频 API](https://docs.cartesia.ai/api-reference/tts/bytes)、[Cartesia emotion](https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion)、[Azure REST TTS](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)、[Azure voice 列表](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)。

## 本机检查（Windows PowerShell）

1. 在 Windows 文件资源管理器打开解压后的项目文件夹（能看到 `package.json`），点地址栏，输入 `powershell` 并回车。新窗口会直接位于这个目录。
2. 逐条运行 `npm ci`、`npx tsc --noEmit`、`npx wrangler deploy --dry-run`。正常情况下类型检查无报错，dry run 显示构建成功；这一步不会部署。
3. 如需本机试读，把 `.env.example` 复制为 `.dev.vars`，在 `.dev.vars` 填写申请的 key 与 voice ID，然后运行 `npm run dev`。正常会显示本机 URL；打开 `<本机 URL>/status` 查看 provider 是否配置，访问 `/panel` 试听。失败时请保留报错前后几行，隐藏 key 后再分享。

`.dev.vars` 已加入 `.gitignore`。仓库保留 `package-lock.json`，依赖下载地址使用 npm 官方 registry。

## Cloudflare Workers 部署

下列命令均在 **Windows PowerShell、仓库目录** 逐条运行。需要自己的 Cloudflare 账号；部署会改变账号状态，请先核对 Worker 名称与费用设置。

1. 运行 `npm ci`。
2. 运行 `npx wrangler login`，在浏览器完成 Cloudflare 登录。
3. 对每个要用的变量运行 `npx wrangler secret put 变量名`，按提示输入值。至少要设置四个优先级变量，以及启用 provider 的 key、voice ID 或 Azure region。参考 `.env.example`，不要把 key 写在命令行参数里。**Cloudflare 当前的 `secret put` 会立即发布一个新版本**；首个 secret 操作后就可能出现公开 Worker 地址，请先确认账号设置与公开访问风险。
4. 运行 `npx wrangler deploy`。成功后 Wrangler 打印形如 `https://你的-worker.workers.dev` 的地址；MCP URL 是该地址加 `/mcp`。
5. 打开 `https://你的-worker.workers.dev/status`：`configured: true` 表示至少一个优先级列表中的 provider 配好了。此状态检查不会发 TTS 请求，也不验证额度。用短句实际试读才能确认能出声。

第 3 步的最小三家配置命令如下，**逐条运行**，每条命令后按提示输入相应的值，不要把整段一次粘贴进终端：

```powershell
npx wrangler secret put TTS_PROVIDER_PRIORITY
npx wrangler secret put TTS_PRIORITY_ASMR
npx wrangler secret put TTS_PRIORITY_CONVERSATION
npx wrangler secret put TTS_PRIORITY_GENERAL
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put ELEVENLABS_VOICE_ID
npx wrangler secret put CARTESIA_API_KEY
npx wrangler secret put CARTESIA_VOICE_ID
npx wrangler secret put AZURE_SPEECH_KEY
npx wrangler secret put AZURE_SPEECH_REGION
```

四个优先级变量的具体值在上表。运行时会看到输入 secret 的提示，成功通常显示 Worker 已更新。失败时保留错误文字，隐藏任何 key 再分享。

**公开访问与费用：** 原仓库的 `/mcp`、`/speak`、`/panel`、`/events/latest` 都没有用户认证；知道 Worker 地址的人可能调用 TTS 或读取最近一次音频。MVP 沿用此方式，适合私下验证，不宜公开传播地址。ChatGPT 当前自定义 MCP 认证要求 OAuth，不能直接提供自定义 API key；本阶段没有加入 OAuth。长期使用前应增加符合 MCP 的认证和使用限额。Cloudflare 免费计划与三家 TTS 的额度、价格会变化，请在各自控制台核对，不要假定 Azure 一定免费或无限量。音频正文会发送给最终选中的 TTS 厂商。

## 接入 ChatGPT 网页端

1. 在电脑浏览器打开 ChatGPT，确认账号/工作区具备自定义 MCP Apps 开发者模式。Business 管理员从 Workspace settings → Apps → Create；Enterprise/Edu 按管理员授予的权限从 Settings → Apps → Create。以 [OpenAI 当前说明](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) 为准。
2. 新建 app，填入 `https://你的-worker.workers.dev/mcp`；当前 Worker 没有 OAuth，选择无认证。点 **Scan Tools**，确认看到 `speak`，再创建草稿 app。
3. 在新聊天中选择这个 app，请 ChatGPT“调用 speak，用 whisper 读这句：……”；正常应出现内嵌播放器，点击播放。浏览器通常禁止未经点击自动播放。
4. 若只看到文字没有播放器，检查是否在 ChatGPT 网页端、工具是否附带 MCP Apps UI、浏览器控制台是否有 iframe/CSP 报错。移动端 App 当前不在官方支持范围内。

## 原有辅助端点

- `GET /status`：配置状态，不显示 key。
- `GET /panel`：原 fork 的可视化页面；`GET /events/latest` 是它的最新音频缓存接口。
- `GET /history?id=...`：原 fork 的 ElevenLabs 历史记录加载接口。
- `GET/POST /speak`：直接返回 MP3；POST JSON 例如 `{ "text": "Hello", "style": "soft", "scene": "conversation" }`。

`/panel` 和最新音频缓存是单实例机制，不按用户隔离，也不保证跨 Cloudflare 边缘节点同步。MCP 内嵌播放器直接接收本次工具结果，不依赖该缓存。

## 以后加入音频后处理

`src/index.ts` 中的 `audioPostprocessors` 在 provider 成功后、输出播放器前顺序运行，目前数组为空。以后加入 binaural/spatial audio 时，应让处理器接收 MP3 并返回 MP3，或同时更新播放器 MIME 与直出接口。第一版没有引入模型、GPU、常驻服务或额外云资源。

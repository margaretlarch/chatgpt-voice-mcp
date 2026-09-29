import { escapeHtml } from "../config";

export const EXT_APPS_MIME = "text/html;profile=mcp-app" as const;
export const VOICE_RESOURCE_URI = "ui://voice-mcp/player.html";

// =============================================================================
// Audio Player HTML (WeChat-style UI)
// =============================================================================

export function getPlayerHTML(botName: string): string {
  const serializedBotName = JSON.stringify(botName).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(botName)} · Voice Player</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      padding: 8px;
    }
    .container {
      background: #fff;
      border-radius: 16px;
      padding: 14px 16px;
      max-width: 100%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .player {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 0;
    }
    .play-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #f5f5f5;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
    }
    .play-btn:hover { background: #eee; }
    .play-btn:active { background: #e0e0e0; }
    .play-btn svg { width: 14px; height: 14px; fill: #333; }
    .play-btn.playing svg { fill: #07c160; }
    .waveform {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 2px;
      height: 24px;
    }
    .wave-bar {
      width: 3px;
      background: #d0d0d0;
      border-radius: 2px;
      transition: background 0.1s;
    }
    .wave-bar.active { background: #07c160; }
    .duration {
      font-size: 13px;
      color: #999;
      min-width: 36px;
      text-align: right;
    }
    .toggle-btn {
      background: none;
      border: none;
      color: #07c160;
      font-size: 12px;
      cursor: pointer;
      padding: 8px 0 4px 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toggle-btn:hover { text-decoration: underline; }
    .toggle-btn .arrow { 
      display: inline-block;
      transition: transform 0.2s; 
      font-size: 10px;
    }
    .toggle-btn.expanded .arrow { transform: rotate(90deg); }
    .text-bubble {
      background: #f7f7f7;
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 8px;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      display: none;
    }
    .text-bubble.show { display: block; }
    .loading {
      text-align: center;
      color: #999;
      font-size: 13px;
      padding: 16px;
    }
    .error {
      color: #fa5151;
      background: #fff2f2;
      padding: 10px;
      border-radius: 8px;
      font-size: 13px;
    }
    @media (prefers-color-scheme: dark) {
      .container { background: #2c2c2c; }
      .play-btn { background: #3a3a3a; }
      .play-btn svg { fill: #e0e0e0; }
      .wave-bar { background: #555; }
      .wave-bar.active { background: #4cd964; }
      .duration { color: #888; }
      .text-bubble { background: #3a3a3a; color: #e0e0e0; }
      .toggle-btn { color: #4cd964; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="content">
      <div class="loading">Loading...</div>
    </div>
  </div>

  <script>
    const contentEl = document.getElementById('content');
    const BOT_NAME = ${serializedBotName};
    let audio = null;
    let waveInterval = null;
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function showError(msg) {
      contentEl.innerHTML = '<div class="error">' + escapeHtml(msg) + '</div>';
    }
    
    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    
    function createWaveform() {
      const heights = [40, 70, 55, 85, 45, 90, 60, 75, 50, 80, 65, 55, 70, 45, 85, 50];
      return heights.map(h => '<div class="wave-bar" style="height:' + h + '%"></div>').join('');
    }
    
    function renderPlayer(text, audioBase64) {
      const audioUrl = 'data:audio/mpeg;base64,' + audioBase64;
      
      contentEl.innerHTML = 
        '<div class="player">' +
          '<button class="play-btn" id="playBtn">' +
            '<svg viewBox="0 0 24 24"><path id="playIcon" d="M8 5v14l11-7z"/></svg>' +
          '</button>' +
          '<div class="waveform" id="waveform">' + createWaveform() + '</div>' +
          '<span class="duration" id="duration">0:00</span>' +
        '</div>' +
        '<button class="toggle-btn" id="toggleBtn">' +
          '<span class="arrow">▶</span> Show transcript' +
        '</button>' +
        '<div class="text-bubble" id="textBubble">' + escapeHtml(text) + '</div>' +
        '<audio id="audio" src="' + audioUrl + '" preload="metadata"></audio>';
      
      audio = document.getElementById('audio');
      const playBtn = document.getElementById('playBtn');
      const playIcon = document.getElementById('playIcon');
      const durationEl = document.getElementById('duration');
      const waveform = document.getElementById('waveform');
      const bars = waveform.querySelectorAll('.wave-bar');
      const toggleBtn = document.getElementById('toggleBtn');
      const textBubble = document.getElementById('textBubble');
      
      audio.addEventListener('loadedmetadata', function() {
        durationEl.textContent = formatTime(audio.duration);
      });
      
      playBtn.addEventListener('click', function() {
        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      });
      
      audio.addEventListener('play', function() {
        playBtn.classList.add('playing');
        playIcon.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
        animateWave(bars, true);
      });
      
      audio.addEventListener('pause', function() {
        playBtn.classList.remove('playing');
        playIcon.setAttribute('d', 'M8 5v14l11-7z');
        animateWave(bars, false);
      });
      
      audio.addEventListener('ended', function() {
        playBtn.classList.remove('playing');
        playIcon.setAttribute('d', 'M8 5v14l11-7z');
        animateWave(bars, false);
        bars.forEach(b => b.classList.remove('active'));
      });
      
      audio.addEventListener('timeupdate', function() {
        const progress = audio.currentTime / audio.duration;
        const activeCount = Math.floor(progress * bars.length);
        bars.forEach((b, i) => b.classList.toggle('active', i < activeCount));
      });
      
      toggleBtn.addEventListener('click', function() {
        const isShow = textBubble.classList.toggle('show');
        toggleBtn.classList.toggle('expanded', isShow);
        toggleBtn.innerHTML = isShow 
          ? '<span class="arrow">▶</span> Hide transcript' 
          : '<span class="arrow">▶</span> Show transcript';
      });
    }
    
    function animateWave(bars, playing) {
      if (waveInterval) clearInterval(waveInterval);
      if (!playing) return;
      
      waveInterval = setInterval(function() {
        bars.forEach(bar => {
          if (!bar.classList.contains('active')) {
            bar.style.opacity = 0.5 + Math.random() * 0.5;
          }
        });
      }, 150);
    }
    
    function handleData(data) {
      if (data.error) { showError(data.error); return; }
      if (data.audio_base64 && data.text) {
        renderPlayer(data.text, data.audio_base64);
      }
    }
    
    function sendToHost(method, params, id) {
      const msg = { jsonrpc: '2.0', method: method, params: params || {} };
      if (id !== undefined) msg.id = id;
      window.parent.postMessage(msg, '*');
    }
    
    window.addEventListener('message', function(event) {
      if (event.source !== window.parent) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      
      if (msg.jsonrpc === '2.0') {
        if (msg.method === 'ui/notifications/tool-input') {
          contentEl.innerHTML = '<div class="loading">Generating voice...</div>';
        }
        if (msg.method === 'ui/notifications/tool-result') {
          const structured = msg.params?.structuredContent;
          const audioBase64 = msg.params?._meta?.audio_base64
            || window.openai?.toolResponseMetadata?.mcp_tool_result?._meta?.audio_base64;
          if (structured) handleData({ ...structured, audio_base64: audioBase64 || structured.audio_base64 });
        }
      }
      if (msg.structuredContent) handleData(msg.structuredContent);
    });
    
    sendToHost('ui/initialize', { name: 'voice-mcp', version: '1.0.0' }, 1);
    setTimeout(function() { sendToHost('ui/notifications/initialized', {}); }, 50);
  </script>
</body>
</html>`;
}

/**
 * 23-player-methods.mjs —— 枚举 `top.player.<方法>` 的真实用法
 *
 * 上一轮已确认：
 *  · `/api/song/play` 在 core 里只是**计数上报**，不是播放接口（所以 player.send('/api/song/play') 是错的）
 *  · `player.getPlaying()` 返回 `{track:{...}, playing:bool}` —— id 在 `.track.id`，不是 `.id`
 *
 * 本轮目标：把所有 `player.xxx(` 的调用点列出来，找出"切歌/播放指定歌"的正规入口。
 *
 * 用法：node scripts/23-player-methods.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0 Safari/537.36';

const FILES = {
  core: 'https://s3.music.126.net/web/s/core_bed3a891fcb580c670f4f4c1580f79b0.js',
  player: 'https://s3.music.126.net/web/s/pt_frame_index_59ebb1c053e87e84c2efeff9f4f5debb.js'
};

async function get(name, url) {
  const cache = path.join(ROOT, 'logs', name + '.bundle.js');
  if (fs.existsSync(cache) && fs.statSync(cache).size > 50000) return fs.readFileSync(cache, 'utf8');
  const txt = await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.text());
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  fs.writeFileSync(cache, txt, 'utf8');
  return txt;
}

const methods = new Map();   // 方法名 → 出现次数
const samples = new Map();   // 方法名 → 示例上下文

for (const [name, url] of Object.entries(FILES)) {
  const code = await get(name, url);
  console.log('\n=== ' + name + ' (' + Math.round(code.length / 1024) + 'KB) ===');

  /* player.xxx(  与  player.xxx=  */
  const re = /\bplayer\.([A-Za-z_$][\w$]{1,28})\s*([(=])/g;
  let m;
  while ((m = re.exec(code))) {
    const fn = m[1];
    methods.set(fn, (methods.get(fn) || 0) + 1);
    if (!samples.has(fn)) {
      const s = Math.max(0, m.index - 120);
      samples.set(fn, code.slice(s, Math.min(code.length, m.index + 200)).replace(/\s+/g, ' '));
    }
  }

  /* top.GPlayer / GPlayer 之类的全局 */
  ['g_player', 'GPlayer', 'GPlayerFrame', 'playerFrame'].forEach((k) => {
    const i = code.indexOf(k);
    if (i >= 0) console.log('  含 ' + k + ' → ' + code.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, ' '));
  });
}

console.log('\n===== player.<方法> 全量（按出现次数）=====');
[...methods.entries()].sort((a, b) => b[1] - a[1]).forEach(([fn, n]) => {
  console.log('  ' + fn.padEnd(24) + String(n).padStart(4) + '   ' + (samples.get(fn) || '').slice(0, 160));
});

fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'logs', 'player-methods.json'),
  JSON.stringify({ at: new Date().toISOString(), methods: Object.fromEntries(methods), samples: Object.fromEntries(samples) }, null, 2),
  'utf8'
);
console.log('\n明细已写入 logs/player-methods.json');

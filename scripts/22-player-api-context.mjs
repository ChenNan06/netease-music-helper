/**
 * 22-player-api-context.mjs —— 把 core bundle 里播放器相关的**上下文代码**抠出来
 *
 * 目标：搞清 `/api/song/play` 到底是被谁、以什么参数调用的；`getPlaying` 在哪个对象上。
 *
 * 用法：node scripts/22-player-api-context.mjs [关键词...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0 Safari/537.36';
const CORE = 'https://s3.music.126.net/web/s/core_bed3a891fcb580c670f4f4c1580f79b0.js';

const cacheFile = path.join(ROOT, 'logs', 'core.bundle.js');
let code;
if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 100000) {
  code = fs.readFileSync(cacheFile, 'utf8');
  console.log('用缓存 bundle: ' + Math.round(code.length / 1024) + 'KB');
} else {
  code = await fetch(CORE, { headers: { 'User-Agent': UA } }).then((r) => r.text());
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  fs.writeFileSync(cacheFile, code, 'utf8');
  console.log('已下载 bundle: ' + Math.round(code.length / 1024) + 'KB');
}

const KEYS = process.argv.slice(2);
const PATTERNS = KEYS.length ? KEYS : [
  '/api/song/play',
  'getPlaying',
  'playById',
  'setPlaying',
  'switchSong',
  'addToPlayList',
  'window.player',
  '.player=',
  'sendSongDetail'
];

function around(text, idx, before = 220, after = 320) {
  const s = Math.max(0, idx - before);
  return text.slice(s, Math.min(text.length, idx + after)).replace(/\s+/g, ' ');
}

for (const pat of PATTERNS) {
  const hits = [];
  let i = -1;
  while ((i = code.indexOf(pat, i + 1)) >= 0 && hits.length < 6) hits.push(i);
  console.log('\n===== ' + pat + '  (命中 ' + hits.length + (hits.length >= 6 ? '+' : '') + ') =====');
  hits.forEach((idx, n) => {
    console.log('--- #' + (n + 1) + ' ---');
    console.log(around(code, idx));
  });
}

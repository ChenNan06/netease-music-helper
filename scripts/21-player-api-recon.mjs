/**
 * 21-player-api-recon.mjs —— 从网易云自己的 JS bundle 里挖出"播放器对象"到底暴露了什么
 *
 * 背景：用户点 ▶ 想播放"载入的歌"，但 playById / send 都不存在，页面 <audio> 也没找到，
 * 结果只能控制网页播放条本身。与其继续猜，不如扒它自己的前端代码。
 *
 * 做法：取首页 → 抓所有 <script src> → 下载 → 在 bundle 里搜播放器相关标识。
 *
 * 用法：node scripts/21-player-api-recon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

const home = await fetch('https://music.163.com/', { headers: { 'User-Agent': UA, Cookie: '' } }).then((r) => r.text());
console.log('首页大小: ' + home.length + ' 字节');

const urls = [...home.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const abs = urls.map((u) => (u.startsWith('//') ? 'https:' + u : u.startsWith('/') ? 'https://music.163.com' + u : u));
console.log('脚本数: ' + abs.length);
abs.forEach((u) => console.log('  ' + u));

const PATTERNS = [
  ['window.player', /window\.player\s*=/],
  ['getPlaying', /getPlaying/],
  ['playById', /playById/],
  ['setPlaying', /setPlaying/],
  ['song/play', /\/api\/song\/play/],
  ['player.send', /\.send\(\s*['"]\/api\//],
  ['addToPlayList', /addToPlayList/],
  ['new Audio', /new\s+Audio\(/],
  ['createElement("audio")', /createElement\(\s*['"]audio['"]\s*\)/],
  ['#g_player', /g_player/],
  ['nmStatic', /nmStatic|nodeMusic/i]
];

const found = {};
for (const u of abs) {
  try {
    const txt = await fetch(u, { headers: { 'User-Agent': UA } }).then((r) => r.text());
    const hit = [];
    for (const [name, re] of PATTERNS) {
      if (re.test(txt)) {
        hit.push(name);
        found[name] = found[name] || [];
        found[name].push(u.split('/').pop() + ' (' + Math.round(txt.length / 1024) + 'KB)');
      }
    }
    console.log('\n' + u.split('/').pop() + '  ' + Math.round(txt.length / 1024) + 'KB  →  ' + (hit.join(', ') || '无命中'));

    /* 抠出 window.player = 附近 200 字符，看看赋的是什么 */
    const m = txt.match(/window\.player\s*=\s*([^;]{0,120})/);
    if (m) console.log('   window.player = ' + m[1].slice(0, 120));

    /* 找 play / 切歌相关的函数名 */
    const names = new Set();
    for (const re of [/\.(\w*[Pp]lay\w*)\s*[:=]/g, /\.(\w*Song\w*)\s*[:=]/g, /\.(\w*Track\w*)\s*[:=]/g]) {
      let mm;
      while ((mm = re.exec(txt))) {
        if (mm[1].length > 3 && mm[1].length < 26) names.add(mm[1]);
      }
    }
    if (names.size) console.log('   候选方法名: ' + [...names].slice(0, 40).join(', '));
  } catch (e) {
    console.log('\n' + u + '  下载失败: ' + e.message);
  }
}

console.log('\n=== 汇总 ===');
for (const [name, where] of Object.entries(found)) console.log(name.padEnd(22) + where.join(' | '));

fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'logs', 'player-api-recon.json'), JSON.stringify({ at: new Date().toISOString(), scripts: abs, found }, null, 2), 'utf8');
console.log('\n明细已写入 logs/player-api-recon.json');

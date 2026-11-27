/**
 * 25-player-public-api.mjs —— 列出 `require("player")` 桥对象（即 top.player）的全部公开成员
 *
 * 依据：bundle 里 `dO8q=c4e("player")`，随后用 `dO8q.xxx=...` 赋值；
 *      这些就是外部（含 userscript）能调用的全部入口。
 *
 * 用法：node scripts/25-player-public-api.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const code = fs.readFileSync(path.join(ROOT, 'logs', 'player.bundle.js'), 'utf8');

/* 1. 确认模块别名 */
const aliasMatch = code.match(/(\w+)\s*=\s*c4e\(\s*["']player["']\s*\)/);
console.log('player 模块别名: ' + (aliasMatch ? aliasMatch[1] : '(未找到)'));
const A = aliasMatch ? aliasMatch[1] : 'dO8q';

/* 2. 枚举该别名下的所有赋值 */
const re = new RegExp('\\b' + A + '\\.([A-Za-z_$][\\w$]{0,30})\\s*=', 'g');
const names = new Map();
let m;
while ((m = re.exec(code))) {
  const n = m[1];
  if (!names.has(n)) {
    const s = Math.max(0, m.index - 60);
    names.set(n, code.slice(s, Math.min(code.length, m.index + 240)).replace(/\s+/g, ' '));
  }
}

console.log('\n===== top.player 公开成员（' + names.size + ' 个）=====');
[...names.keys()].sort().forEach((n) => {
  console.log('\n· ' + n);
  console.log('  ' + names.get(n).slice(0, 220));
});

/* 3. 找队列模块的 caZ0u（addTo 内部调用的那个）签名 */
const q = code.indexOf('caZ0u=');
if (q < 0) {
  const q2 = code.indexOf('caZ0u:');
  console.log('\n caZ0u 定义位置: ' + (q2 >= 0 ? q2 : '未找到'));
  if (q2 >= 0) console.log(code.slice(Math.max(0, q2 - 200), q2 + 700).replace(/\s+/g, ' '));
} else {
  console.log('\n caZ0u 定义位置: ' + q);
  console.log(code.slice(Math.max(0, q - 200), q + 700).replace(/\s+/g, ' '));
}

/* 4. 所有的 playaction 事件 */
let i = -1, n = 0;
console.log('\n===== playaction 事件 =====');
while ((i = code.indexOf('playaction', i + 1)) >= 0 && n < 6) {
  console.log('--- ' + (++n) + ' ---');
  console.log(code.slice(Math.max(0, i - 260), i + 260).replace(/\s+/g, ' '));
}

/**
 * 24-player-object.mjs —— 抠出 `top.player` 这个"桥对象"的完整方法表
 *
 * 已知它至少有 getPlaying / addTo / tipPlay / setLike。
 * 做法：在这些方法名附近（±1200 字符）打印对象字面量，找出同级的其它方法名。
 *
 * 用法：node scripts/24-player-object.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const files = ['player.bundle.js', 'core.bundle.js'];

for (const f of files) {
  const p = path.join(ROOT, 'logs', f);
  if (!fs.existsSync(p)) continue;
  const code = fs.readFileSync(p, 'utf8');
  console.log('\n########## ' + f + ' (' + Math.round(code.length / 1024) + 'KB) ##########');

  for (const key of ['tipPlay', 'addTo', 'getPlaying', 'setLike']) {
    for (const form of [key + ':', key + ' =', key + '=']) {
      const i = code.indexOf(form);
      if (i < 0) continue;
      const s = Math.max(0, i - 700);
      const seg = code.slice(s, Math.min(code.length, i + 900)).replace(/\s+/g, ' ');
      console.log('\n--- ' + key + ' @ ' + i + ' ---');
      console.log(seg);

      /* 从这段里捡出方法名（形如 xxx:function / xxx=function） */
      const names = new Set();
      let m;
      const re = /([A-Za-z_$][\w$]{2,28})\s*[:=]\s*function/g;
      while ((m = re.exec(seg))) names.add(m[1]);
      if (names.size) console.log('>>> 同段方法名: ' + [...names].join(', '));
      break;
    }
  }
}

/**
 * 18-probe-fixes.mjs —— 为三个 bug 取证
 *   ① 云盘删除：/api/cloud/del 到底要 `id` 还是 `ids`（用假 id 探，不会删掉你的任何文件）
 *   ② 页面播放器：music.163.com 的播放器是 iframe 还是全局对象，有没有可调用的播放入口
 *   ③ 载入歌曲的取链：给"播放这首"准备 URL（只取地址，不下载）
 *
 * 用法：node scripts/18-probe-fixes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const session = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'session.json'), 'utf8'));
const C = session.cookies;
const csrf = C.__csrf || '';
const cookieHeader = Object.entries(C).map(([k, v]) => k + '=' + v).join('; ');
const UA = session.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0 Safari/537.36';

const el = () => ({
  style: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  addEventListener() {}, appendChild() {}, insertAdjacentElement() {},
  querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
  remove() {}, attachShadow: () => ({ appendChild() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }),
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }), click() {}
});
const map = new Map();
const ctx = {
  console, crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa, Promise, setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  fetch: () => Promise.reject(new Error('stub')), navigator: { clipboard: { writeText: async () => {} } },
  location: { href: 'https://music.163.com/', hash: '', pathname: '/' },
  localStorage: { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), removeItem() {}, clear() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  document: {
    readyState: 'loading', cookie: '',
    documentElement: { appendChild() {}, classList: { contains: () => false }, setAttribute() {}, getAttribute: () => null },
    body: { appendChild() {}, classList: { contains: () => false } }, head: { appendChild() {} },
    createElement: () => el(), addEventListener() {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [], execCommand: () => false
  },
  GM_info: undefined, GM_getValue: undefined, GM_setValue: undefined,
  GM_xmlhttpRequest: undefined, GM_download: undefined, GM_registerMenuCommand: undefined,
  GM_addStyle: undefined, unsafeWindow: undefined
};
ctx.window = ctx; ctx.self = ctx; ctx.top = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'build', 'ncm-toolkit.user.js'), 'utf8'), ctx, { filename: 'kernel.js' });
const K = ctx.__NCMH_KERNEL__;

async function api(pathname, data) {
  const body = await K.weapiBody(Object.assign({ csrf_token: csrf }, data || {}));
  const url = 'https://music.163.com' + pathname.replace('/api/', '/weapi/') + '?csrf_token=' + encodeURIComponent(csrf);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: cookieHeader },
    body: 'params=' + encodeURIComponent(body.params) + '&encSecKey=' + encodeURIComponent(body.encSecKey)
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = { __raw: text.slice(0, 160) }; }
  return json;
}

console.log('=== ① 云盘删除：参数名探明（用假 id，不会删除真实文件）===');
const cloud = await api('/api/v1/cloud/get', { limit: 5, offset: 0 });
const items = (cloud && cloud.data) || [];
console.log('云盘现有 ' + (cloud.count || 0) + ' 首；样本:', items.slice(0, 2).map((i) => i.songId + '/' + i.songName).join(', ') || '(空)');

for (const [label, payload] of [
  ['id=1（假 id）', { id: 1 }],
  ['ids=[1]', { ids: JSON.stringify([1]) }],
  ['id=1&del=false', { id: 1, del: 'false' }]
]) {
  const r = await api('/api/cloud/del', payload);
  console.log('  ' + label.padEnd(16) + ' → code=' + (r && r.code) + '  ' + JSON.stringify(r).slice(0, 120));
}

console.log('\n=== ② 页面结构：播放器是 iframe 还是全局对象 ===');
const html = await fetch('https://music.163.com/song?id=186016', { headers: { 'User-Agent': UA, Cookie: cookieHeader } }).then((r) => r.text());
console.log('页面大小: ' + html.length + ' 字节');
const checks = [
  ['id="g_player"', /id="g_player"/],
  ['id="g_iframe"', /id="g_iframe"/],
  ['<audio', /<audio/i],
  ['window.player', /window\.player\s*=/],
  ['g_player iframe src', /g_player[\s\S]{0,200}src="([^"]+)"/],
  ['player.send 调用', /player\.send\s*\(/],
  ['/api/song/play', /\/api\/song\/play/],
  ['player-type 脚本', /player/i]
];
for (const [name, re] of checks) {
  const m = html.match(re);
  console.log('  ' + name.padEnd(22) + (m ? '有' + (m[1] ? ' → ' + m[1] : '') : '无'));
}

console.log('\n=== ③ 载入歌曲的播放地址（给"播放这首"用）===');
const songId = 1973665667;
const pl = await api('/api/song/enhance/player/url/v1', { ids: JSON.stringify([songId]), level: 'exhigh', encodeType: 'mp3' });
const d = pl && pl.data && pl.data[0];
console.log('  player/url → ' + (d && d.url ? d.level + ' ' + Math.round(d.size / 1024 / 1024 * 10) / 10 + 'MB  ' + d.url.slice(0, 60) + '…' : '空 code=' + (pl && pl.code)));
const outer = 'https://music.163.com/song/media/outer/url?id=' + songId + '.mp3';
const head = await fetch(outer, { method: 'HEAD', headers: { 'User-Agent': UA, Cookie: cookieHeader }, redirect: 'follow' })
  .then((r) => ({ status: r.status, url: r.url, type: r.headers.get('content-type'), len: r.headers.get('content-length') }))
  .catch((e) => ({ err: e.message }));
console.log('  outer 直链 → ' + JSON.stringify(head).slice(0, 160));

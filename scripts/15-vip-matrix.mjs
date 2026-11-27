/**
 * 15-vip-matrix.mjs —— 登录到底能不能拿到更高音质（用真实热歌榜曲目对照）
 *
 * 做法：取「云音乐热歌榜」(3778678) 前 N 首 → 每首分别用
 *       匿名 / 登录态 请求 ①增强下载 ②试听播放（lossless 与 jymaster），
 *       记录实际返回的 level / 大小 / code。
 *
 * 只读：不下载音频（只请求地址与元信息）。
 * 用法：node scripts/15-vip-matrix.mjs [playlistId] [N]
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
const PLAYLIST = Number(process.argv[2] || '3778678');
const N = Number(process.argv[3] || '6');

const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
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
vm.runInContext(fs.readFileSync(BUILD, 'utf8'), ctx, { filename: 'kernel.js' });
const K = ctx.__NCMH_KERNEL__;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const LOGIN_COOKIE = 'MUSIC_U=' + C.MUSIC_U + (C.__csrf ? '; __csrf=' + C.__csrf : '');

async function call(pathname, data, loggedIn) {
  const body = await K.weapiBody(Object.assign({ csrf_token: C.__csrf || '' }, data || {}));
  const url = 'https://music.163.com' + pathname.replace('/api/', '/weapi/') + '?csrf_token=' + encodeURIComponent(C.__csrf || '');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Referer: 'https://music.163.com/',
      ...(loggedIn ? { Cookie: LOGIN_COOKIE } : {})
    },
    body: 'params=' + encodeURIComponent(body.params) + '&encSecKey=' + encodeURIComponent(body.encSecKey)
  });
  const text = await resp.text();
  try { return JSON.parse(text); } catch (e) { return { __raw: text.slice(0, 120) }; }
}

const LEVELS = ['jymaster', 'lossless'];
const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
const fmt = (d, code) => {
  if (!d) return '—(code ' + code + ')';
  if (!d.url) return '空(code ' + code + ')';
  return d.level + '/' + Math.round((d.size || 0) / 1024 / 1024 * 10) / 10 + 'MB';
};

const out = [];
const pl = await call('/api/v6/playlist/detail', { id: PLAYLIST, n: 1000, s: 8 }, false);
const name = pl.playlist ? pl.playlist.name : '(读取失败)';
const ids = (pl.playlist && (pl.playlist.trackIds || []).slice(0, N).map((t) => t.id)) || [];
console.log('歌单：' + name + '（取前 ' + ids.length + ' 首）\n');

const detailObj = await call('/api/v3/song/detail', { c: JSON.stringify(ids.map((id) => ({ id }))), ids: JSON.stringify(ids) }, false);
const songs = detailObj.songs || [];

for (const s of songs) {
  const row = { id: s.id, name: s.name, fee: s.fee, ana: {}, login: {} };
  for (const level of LEVELS) {
    for (const [tag, loggedIn] of [['ana', false], ['login', true]]) {
      const d1 = await call('/api/song/enhance/download/url/v1', { id: s.id, level, encodeType: 'mp3' }, loggedIn);
      const d2 = await call('/api/song/enhance/player/url/v1', { ids: JSON.stringify([s.id]), level, encodeType: 'mp3' }, loggedIn);
      const x1 = d1 && d1.data ? (Array.isArray(d1.data) ? d1.data[0] : d1.data) : null;
      const x2 = d2 && d2.data ? d2.data[0] : null;
      row[tag][level] = { m1: fmt(x1, d1 && d1.code), m2: fmt(x2, d2 && d2.code) };
    }
  }
  out.push(row);
  const a = row.ana, l = row.login;
  console.log('· ' + s.name + '（fee=' + s.fee + '）');
  console.log('    匿名  母带 ①' + pad(a.jymaster.m1, 14) + '②' + pad(a.jymaster.m2, 14) + '无损 ①' + pad(a.lossless.m1, 14) + '②' + a.lossless.m2);
  console.log('    登录  母带 ①' + pad(l.jymaster.m1, 14) + '②' + pad(l.jymaster.m2, 14) + '无损 ①' + pad(l.lossless.m1, 14) + '②' + l.lossless.m2);
}

fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'logs', 'vip-matrix.json'), JSON.stringify({ playlist: PLAYLIST, name, rows: out }, null, 2), 'utf8');
console.log('\n明细已写入 logs/vip-matrix.json');

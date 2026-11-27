/**
 * 14-identity-matrix.mjs —— 登录态下"请求身份"对音频权限的影响（对照实验）
 *
 * 现象：带上 MUSIC_U 但 privileges.plLevel = none（比匿名还低），取链全空。
 * 怀疑：探针额外带的 os=pc / appver / channel cookie 让服务端以为是 PC 客户端，
 *       而 PC 客户端要求配套的 MUSIC_A / 签名，于是权限被判 none。
 *
 * 做法：固定同一首歌，只改 Cookie 组合与 UA，比对 plLevel / 取链结果。
 *
 * 用法：node scripts/14-identity-matrix.mjs [songId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const session = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'session.json'), 'utf8'));
const C = session.cookies;
const SONG = Number(process.argv[2] || '186016');

/* —— 复用内核的 weapi 实现（与脚本本体完全一致） —— */
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const vm = await import('node:vm');
const { webcrypto } = await import('node:crypto');
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

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const UA_PC = 'NeteaseMusicDesktop/3.1.22';

async function call(pathname, data, cookieHeader, ua) {
  const body = await K.weapiBody(Object.assign({ csrf_token: C.__csrf || '' }, data || {}));
  const url = 'https://music.163.com' + pathname.replace('/api/', '/weapi/') + '?csrf_token=' + encodeURIComponent(C.__csrf || '');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua || UA_WEB,
      Referer: 'https://music.163.com/',
      Cookie: cookieHeader
    },
    body: 'params=' + encodeURIComponent(body.params) + '&encSecKey=' + encodeURIComponent(body.encSecKey)
  });
  const text = await resp.text();
  try { return JSON.parse(text); } catch (e) { return { __raw: text.slice(0, 120) }; }
}

const csrf = C.__csrf || '';
const CASES = [
  ['① 只带 MUSIC_U', 'MUSIC_U=' + C.MUSIC_U, UA_WEB],
  ['② MUSIC_U + csrf', 'MUSIC_U=' + C.MUSIC_U + '; __csrf=' + csrf, UA_WEB],
  ['③ + os=pc/appver', 'MUSIC_U=' + C.MUSIC_U + '; __csrf=' + csrf + '; os=pc; appver=8.9.70; channel=netease', UA_WEB],
  ['④ 只带 MUSIC_U（PC UA）', 'MUSIC_U=' + C.MUSIC_U, UA_PC],
  ['⑤ 匿名（对照）', '', UA_WEB]
];

console.log('曲目: ' + SONG + '\n');
const rows = [];
for (const [name, cookie, ua] of CASES) {
  const detail = await call('/api/v3/song/detail', { c: JSON.stringify([{ id: SONG }]), ids: JSON.stringify([SONG]) }, cookie, ua);
  const p = (detail.privileges || [])[0] || {};
  const s = (detail.songs || [])[0] || {};
  const dl = await call('/api/song/enhance/download/url/v1', { id: SONG, level: 'lossless', encodeType: 'mp3' }, cookie, ua);
  const pl = await call('/api/song/enhance/player/url/v1', { ids: JSON.stringify([SONG]), level: 'lossless', encodeType: 'mp3' }, cookie, ua);
  const d = dl && dl.data ? (Array.isArray(dl.data) ? dl.data[0] : dl.data) : null;
  const d2 = pl && pl.data ? pl.data[0] : null;
  rows.push({
    name,
    code: detail.code,
    pl: p.plLevel,
    dl: p.dlLevel,
    st: p.st,
    fee: s.fee,
    m1: d && d.url ? d.level + ' ' + Math.round((d.size || 0) / 1024) + 'KB' : '空(' + (d && d.code) + ')',
    m2: d2 && d2.url ? d2.level + ' ' + Math.round((d2.size || 0) / 1024) + 'KB' : '空(' + (d2 && d2.code) + ')'
  });
}

const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
console.log(pad('身份', 24) + pad('code', 6) + pad('plLevel', 10) + pad('dlLevel', 10) + pad('st', 5) + pad('① 增强下载', 16) + '② 试听播放');
for (const r of rows) {
  console.log(pad(r.name, 24) + pad(r.code, 6) + pad(r.pl, 10) + pad(r.dl, 10) + pad(r.st, 5) + pad(r.m1, 16) + r.m2);
}

fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'logs', 'identity-matrix.json'), JSON.stringify({ song: SONG, rows }, null, 2), 'utf8');
console.log('\n明细已写入 logs/identity-matrix.json');

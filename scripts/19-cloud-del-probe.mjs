/**
 * 19-cloud-del-probe.mjs —— 探明"删除云盘歌曲"的正确参数/端点（用假 id，绝不动真实文件）
 *
 * 已知：/api/cloud/del + {id:1} 返回 code=400「参数错误」。
 * 做法：枚举端点 × 参数形状，看哪个返回非 400。
 * 安全性：id 一律用 1（云盘里没有这个 id），即使被"接受"也删不掉任何东西。
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
const UA = session.userAgent || 'Mozilla/5.0 Chrome/157';

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
  try { return JSON.parse(text); } catch (e) { return { __raw: text.slice(0, 120) }; }
}

const ENDPOINTS = ['/api/cloud/del', '/api/v1/cloud/del', '/api/cloud/user/song/delete', '/api/cloud/song/del'];
const SHAPES = [
  ['id:1', { id: 1 }],
  ['id:[1]', { id: [1] }],
  ['id:"1"', { id: '1' }],
  ['ids:[1]', { ids: [1] }],
  ['ids:"[1]"', { ids: '[1]' }],
  ['songId:1', { songId: 1 }],
  ['id:1,uploadType:0', { id: 1, uploadType: 0 }],
  ['id:1,type:1', { id: 1, type: 1 }],
  ['ids:[1],del:true', { ids: [1], del: true }]
];

console.log('云盘删除端点 × 参数 探明（id 用 1，云端不存在，不会删除任何东西）\n');
for (const ep of ENDPOINTS) {
  for (const [label, payload] of SHAPES) {
    const r = await api(ep, payload);
    const code = r && r.code;
    const mark = code === 400 || code === 404 ? '  ' : '★ ';
    console.log(mark + ep.padEnd(34) + label.padEnd(22) + 'code=' + code + ' ' + JSON.stringify(r).slice(0, 90));
    await new Promise((res) => setTimeout(res, 120));
  }
  console.log('');
}

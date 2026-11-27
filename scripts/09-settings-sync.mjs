/**
 * 09-settings-sync.mjs —— 回归：设置页改了 → 面板显示必须跟着变（用户报"对不上"）
 *
 * 复现路径：设置页保存 → localStorage 更新 → 另一个标签页收到 storage 事件
 *           → Store.settings 更新 → 面板下拉/提示必须同步
 *
 * 用法：node scripts/09-settings-sync.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const JSDOM_PATH = path.join(ROOT, 'tools', 'node_modules', 'jsdom', 'lib', 'api.js');
const { JSDOM } = await import(pathToFileURL(JSDOM_PATH).href);

const SONGS = [{
  id: 186016, name: '晴天', alia: [], fee: 0, no: 1, cd: '',
  ar: [{ id: 6452, name: '周杰伦' }],
  al: { id: 18914, name: '叶惠美', picUrl: 'http://p1.music.126.net/x.jpg', publishTime: 1057766400000 }, dt: 269000
}];
const PRIVS = [{ id: 186016, fee: 0, pl: 320000, dl: 320000, plLevel: 'lossless', dlLevel: 'lossless', cs: false, st: 0 }];

function route(url, rt) {
  if (rt === 'arraybuffer') return { bytes: Uint8Array.from([0xff, 0xfb, 0x90, 0, 1, 2, 3]) };
  if (/enhance\/download/.test(url)) return { json: { code: 200, data: { url: null } } };
  if (/enhance\/player/.test(url)) return { json: { code: 200, data: [{ id: 186016, url: 'https://m801.music.126.net/a.mp3', level: 'exhigh', size: 1, md5: 'm', br: 320000, type: 'mp3' }] } };
  if (/song\/detail/.test(url)) return { json: { code: 200, songs: SONGS, privileges: PRIVS } };
  if (/song\/lyric/.test(url)) return { json: { code: 200, lrc: { lyric: '[00:01.00]a' } } };
  return { json: { code: 200 } };
}

const dom = new JSDOM(
  `<!DOCTYPE html><html><head><title>t</title></head><body>
   <div class="m-playbar"><div class="words"><div class="name"><a href="/song?id=186016">晴天</a></div></div></div>
   </body></html>`,
  { url: 'https://music.163.com/song?id=186016', runScripts: 'outside-only', pretendToBeVisual: true }
);
const { window } = dom;
window.console = { log() {}, warn() {}, error() {}, info() {} };
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
const gmMap = new Map();
window.GM_info = { scriptHandler: 'jsdom' };
window.GM_getValue = (k, d) => (gmMap.has(k) ? gmMap.get(k) : d);
window.GM_setValue = (k, v) => gmMap.set(k, v);
window.GM_registerMenuCommand = () => {};
window.GM_addStyle = () => {};
window.GM_download = (o) => setTimeout(() => o.onload && o.onload({}), 0);
window.GM_xmlhttpRequest = (o) => setTimeout(() => {
  const r = route(o.url, o.responseType);
  const out = { status: 200, finalUrl: o.url, responseURL: o.url, responseHeaders: '' };
  if (r.bytes) out.response = r.bytes.buffer;
  else { out.responseText = JSON.stringify(r.json); out.response = r.json; }
  o.onload && o.onload(out);
}, 0);
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();

let pass = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n); } else { fails.push(n + (x ? ' -> ' + x : '')); console.log('  [FAIL] ' + n + (x ? '  -> ' + x : '')); } };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const shadow = () => window.document.getElementById('ncmh-host').shadowRoot;

window.eval(fs.readFileSync(BUILD, 'utf8'));
await tick(120);
window.__NCMH__.open();
await tick(250);

const sel = () => shadow().querySelector('#sel-quality');
const stored = () => JSON.parse(window.localStorage.getItem('ncmh.settings.v1') || '{}');

console.log('[1. 初始状态]');
ok('下拉存在', !!sel());
ok('下拉值 = 存储值', sel() && sel().value === (stored().quality || 'jymaster'), 'select=' + (sel() && sel().value) + ' store=' + stored().quality);
const hint0 = shadow().querySelector('#quality-hint');
ok('存在"当前生效"提示行', !!hint0, hint0 ? hint0.textContent.trim() : '缺失');

console.log('[2. 模拟设置页保存（storage 事件跨标签同步）]');
const next = Object.assign({}, stored(), { quality: 'exhigh' });
window.localStorage.setItem('ncmh.settings.v1', JSON.stringify(next));
window.dispatchEvent(new window.StorageEvent('storage', {
  key: 'ncmh.settings.v1',
  newValue: JSON.stringify(next),
  oldValue: JSON.stringify(stored())
}));
await tick(200);
ok('下载音质下拉已同步为 exhigh', sel() && sel().value === 'exhigh', 'select=' + (sel() && sel().value));

console.log('[3. 账号页登录状态跟随接口结果]');
const toolTab = shadow().querySelector('[data-tab="tool"]');
toolTab && toolTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(120);
const loginState = shadow().querySelector('#login-state');
ok('存在登录状态行', !!loginState, loginState ? loginState.textContent.trim() : '缺失');
ok('状态取自接口（不是 cookie 猜测）', !!loginState && !/MUSIC_U/.test(loginState.textContent));

console.log('[4. 面板里改音质 → 存储与提示同步]');
const songTab = shadow().querySelector('[data-tab="song"]');
songTab && songTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(80);
const q = shadow().querySelector('#sel-quality');
q.value = 'lossless';
q.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(120);
ok('存储写回 lossless', stored().quality === 'lossless', 'store=' + stored().quality);
const hint1 = shadow().querySelector('#quality-hint');
ok('提示行跟随', hint1 && hint1.textContent.includes('无损'), hint1 ? hint1.textContent.trim() : '缺失');

console.log('[5. 设置页 postMessage 保存路径（与真实消息同一函数）]');
const internals = window.__NCMH_KERNEL__.internals;
ok('暴露了 applySettingsPatch（测试钩子）', typeof internals.applySettingsPatch === 'function');
internals.applySettingsPatch({ quality: 'jymaster' });
await tick(150);
const q2 = shadow().querySelector('#sel-quality');
ok('面板下拉立刻变 超清母带', q2 && q2.value === 'jymaster', 'select=' + (q2 && q2.value));
songTab && songTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(100);
const hint3 = shadow().querySelector('#quality-hint');
ok('提示行同步到 超清母带', hint3 && hint3.textContent.includes('超清母带'), hint3 ? hint3.textContent.trim() : '缺失');

console.log('[6. 登录态：接口判定（不是 cookie）]');
ok('暴露了 Login', !!internals.Login);
ok('Login 有 ensure/isOn/label', !!(internals.Login && internals.Login.ensure && internals.Login.isOn && internals.Login.label));
ok('DEV_TOOLS 标记存在', typeof internals.DEV_TOOLS === 'boolean', 'DEV_TOOLS=' + internals.DEV_TOOLS);

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
dom.window.close();
process.exit(0);

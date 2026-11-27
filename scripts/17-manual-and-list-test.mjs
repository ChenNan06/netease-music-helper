/**
 * 17-manual-and-list-test.mjs —— 手动输入解析 + 列表翻页/搜索/勾选 的回归
 *
 * 覆盖用户这轮提的三件事：
 *   ① 手动输入：ID / 链接 / 歌单链接 混着粘贴，能自动识别并落到正确的地方
 *   ② 列表：翻页、搜索、单首/多选、选中后的批量目标
 *   ③ 当前对象：auto / page / playing 三种来源切换
 *
 * 用法：node scripts/17-manual-and-list-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const { JSDOM } = await import(pathToFileURL(path.join(ROOT, 'tools', 'node_modules', 'jsdom', 'lib', 'api.js')).href);

/* ============ 1. 纯函数：parseRefs ============ */
console.log('[1. 输入解析（纯函数）]');
const vmMod = await import('node:vm');
const el = () => ({
  style: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  addEventListener() {}, appendChild() {}, insertAdjacentElement() {},
  querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
  remove() {}, attachShadow: () => ({ appendChild() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }),
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }), click() {}
});
const store = new Map();
const ctx = {
  console, crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa, Promise, setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  fetch: () => Promise.reject(new Error('stub')), navigator: { clipboard: { writeText: async () => {} } },
  location: { href: 'https://music.163.com/', hash: '', pathname: '/' },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem() {}, clear() {} },
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
vmMod.createContext(ctx);
vmMod.runInContext(fs.readFileSync(BUILD, 'utf8'), ctx, { filename: 'kernel.js' });
const K = ctx.__NCMH_KERNEL__;

let pass = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n + (x ? '  (' + x + ')' : '')); } else { fails.push(n + (x ? ' -> ' + x : '')); console.log('  [FAIL] ' + n + (x ? ' -> ' + x : '')); } };

const r1 = K.parseRefs('186016');
ok('纯数字 → 歌曲', r1.songs.length === 1 && r1.songs[0] === 186016, JSON.stringify(r1.songs));

const r2 = K.parseRefs('https://music.163.com/#/song?id=186016');
ok('song 链接 → 歌曲', r2.songs[0] === 186016, JSON.stringify(r2.songs));

const r3 = K.parseRefs('https://music.163.com/playlist?id=3778678');
ok('playlist 链接 → 列表（不当成歌曲）', r3.lists.length === 1 && r3.lists[0].type === 'playlist' && r3.lists[0].id === 3778678 && r3.songs.length === 0, JSON.stringify(r3));

const r4 = K.parseRefs('https://music.163.com/#/playlist?id=2884035&userid=1');
ok('带 # 与额外参数的歌单链接', r4.lists[0] && r4.lists[0].id === 2884035, JSON.stringify(r4.lists));

const r5 = K.parseRefs('186016\n3778678  https://music.163.com/album?id=32311');
ok('多行混合：2 首歌 + 1 专辑', r5.songs.length === 2 && r5.lists.length === 1 && r5.lists[0].type === 'album', JSON.stringify({ s: r5.songs, l: r5.lists }));

const r6 = K.parseRefs('186016 186016 999');
ok('去重', r6.songs.length === 2, JSON.stringify(r6.songs));

const r7 = K.parseRefs('随便说点什么 hello');
ok('无法识别的内容进 unknown（不误判成 id）', r7.songs.length === 0 && r7.unknown.length > 0, JSON.stringify(r7.unknown));

const r8 = K.parseRefs('https://music.163.com/artist?id=6452');
ok('artist 链接', r8.lists[0] && r8.lists[0].type === 'artist' && r8.lists[0].id === 6452, JSON.stringify(r8.lists));

/* ============ 2. 列表 UI：翻页 / 搜索 / 勾选 ============ */
console.log('\n[2. 列表交互（jsdom 真挂载）]');
const SONGS = Array.from({ length: 45 }, (_, i) => ({
  id: 1000 + i, name: '歌曲' + (i + 1), ar: [{ id: 1, name: i % 2 ? '歌手A' : '歌手B' }],
  al: { id: 2, name: '专辑' + (i % 3), picUrl: '' }, dt: 200000, fee: 0, no: i + 1
}));
const PRIV = SONGS.map((s) => ({ id: s.id, fee: 0, pl: 320000, dl: 320000, plLevel: 'lossless', dlLevel: 'lossless', cs: false, st: 0 }));

const dom = new JSDOM(
  `<!DOCTYPE html><html><head><title>t</title></head><body>
    <div class="m-playbar"><div class="btns"><a class="prv"></a><a class="nxt"></a><a class="ply"></a></div>
      <div class="words"><div class="name"><a href="/song?id=1000">歌曲1</a></div></div></div>
   </body></html>`,
  { url: 'https://music.163.com/#/playlist?id=3778678', runScripts: 'outside-only', pretendToBeVisual: true }
);
const { window } = dom;
window.console = { log() {}, warn() {}, error() {}, info() {} };
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
const gmMap = new Map();
/* song/detail 的请求体是加密的，桩没法从里面读 id → 用队列精确控制每次返回什么 */
const detailQueue = [];
window.GM_info = { scriptHandler: 'jsdom' };
window.GM_getValue = (k, d) => (gmMap.has(k) ? gmMap.get(k) : d);
window.GM_setValue = (k, v) => gmMap.set(k, v);
window.GM_registerMenuCommand = () => {};
window.GM_addStyle = () => {};
window.GM_download = (o) => setTimeout(() => o.onload && o.onload({}), 0);
window.GM_xmlhttpRequest = (o) => setTimeout(() => {
  let json = { code: 200 };
  if (/account\/get/.test(o.url)) json = { code: 200, account: null, profile: null };
  else if (/playlist\/detail/.test(o.url)) json = { code: 200, playlist: { id: 3778678, name: '测试歌单', trackCount: 45, trackIds: SONGS.map((s) => ({ id: s.id })), creator: { nickname: 'me' } } };
  else if (/song\/detail/.test(o.url)) {
    const next = detailQueue.length ? detailQueue.shift() : null;
    const songs = next || SONGS.slice(0, 12);
    json = { code: 200, songs, privileges: PRIV.slice(0, songs.length) };
  } else if (/song\/lyric/.test(o.url)) json = { code: 200, lrc: { lyric: '[00:01.00]a' } };
  const out = { status: 200, finalUrl: o.url, responseHeaders: '' };
  out.responseText = JSON.stringify(json);
  out.response = json;
  o.onload && o.onload(out);
}, 0);
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();

window.eval(fs.readFileSync(BUILD, 'utf8'));
await new Promise((r) => setTimeout(r, 200));
const UI = window.__NCMH_KERNEL__.internals.UI;
const shadow = window.document.getElementById('ncmh-host').shadowRoot;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

ok('面板已挂载', !!shadow);

/* 切到列表页并灌入 45 首 */
UI.state.list = { type: 'playlist', id: 3778678, title: '测试歌单', total: 45, creator: 'me', songs: window.__NCMH_KERNEL__.internals.normalizeSongs(SONGS, PRIV) };
UI.state.listQuery = { page: 0, size: 20, filter: '' };
UI.state.selected = {};
UI.state.tab = 'list';
UI.renderTabs();
UI.renderBody();
await tick(60);

ok('渲染出列表行', shadow.querySelectorAll('[data-row]').length === 20, String(shadow.querySelectorAll('[data-row]').length));
ok('分页信息出现', !!shadow.querySelector('.pager'));
ok('有搜索框', !!shadow.querySelector('#list-filter'));
ok('载入条收起时只有一个按钮（不在列表页里塞输入框）', !!shadow.querySelector('[data-act="load-open"]') && !shadow.querySelector('#manual-input'));
click(shadow.querySelector('[data-act="load-open"]'));
await tick(80);
ok('点开载入条后出现输入框', !!shadow.querySelector('#manual-input'));

click(shadow.querySelector('[data-act="list-next"]'));
await tick(60);
ok('翻到第 2 页', UI.state.listQuery.page === 1, 'page=' + UI.state.listQuery.page);
ok('第 2 页是 21~40（首行序号 21）', (shadow.querySelector('.lrow .idx') || {}).textContent === '21', (shadow.querySelector('.lrow .idx') || {}).textContent);

/* 搜索 */
const filter = shadow.querySelector('#list-filter');
filter.value = '歌曲4';
filter.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(60);
const visible = shadow.querySelectorAll('[data-row]').length;
ok('搜索"歌曲4"命中 7 条（歌曲4 + 歌曲40~45）', visible === 7, 'visible=' + visible);

filter.value = '';
filter.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick(60);

/* 勾选 */
const cb = shadow.querySelector('[data-check]');
cb.checked = true;
cb.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(60);
ok('勾选后 selected 有 1 条', UI.selectedSongs().length === 1, 'selected=' + UI.selectedSongs().length);
ok('按钮文字变成"下载选中(1)"', (shadow.querySelector('[data-act="list-dl"]') || {}).textContent === '下载选中(1)', (shadow.querySelector('[data-act="list-dl"]') || {}).textContent);

click(shadow.querySelector('[data-act="list-sel-all"]'));
await tick(60);
ok('全选本页 = 20 条', UI.selectedSongs().length === 20, 'selected=' + UI.selectedSongs().length);
const t = UI.targetSongs();
ok('批量目标 = 选中项', t.fromSelection === true && t.songs.length === 20);

click(shadow.querySelector('[data-act="list-sel-none"]'));
await tick(60);
ok('清空选择后目标回落到全部', UI.targetSongs().fromSelection === false && UI.targetSongs().songs.length === 45);

/* ============ 3. 目标来源切换（新方案：只有"另有别的歌"时出现一条细提示） ============ */
console.log('\n[3. 当前对象来源切换]');
ok('默认 auto', UI.state.targetMode === 'auto', UI.state.targetMode);
/* 造一个"卡片是详情页、播放器是另一首"的场景 */
UI.state.song = window.__NCMH_KERNEL__.internals.normalizeSongs([SONGS[7]], [PRIV[7]])[0];
UI.state.songSource = '详情页';
UI.state.targetMode = 'auto';
UI.renderSongCard();
await tick(60);
const alt = shadow.querySelector('.altchip');
ok('卡片下方有"另有一首可切"的细提示（.altchip）', !!alt, alt ? alt.textContent.trim().replace(/\s+/g, ' ') : '没有');
ok('细提示带 data-act=cycle', !!(alt && alt.getAttribute('data-act') === 'cycle'), alt && alt.getAttribute('data-act'));
ok('不再有并列的三个来源 chip', !shadow.querySelector('[data-act="target-page"]') && !shadow.querySelector('[data-act="target-playing"]'));
ok('播放控制是图标按钮（.ibtn 3 个）', shadow.querySelectorAll('.ibtn').length === 3, String(shadow.querySelectorAll('.ibtn').length));
if (alt) click(alt);
await tick(400);
ok('点了细提示后切到"正在播放"', UI.state.targetMode === 'playing', UI.state.targetMode);
ok('卡片来源变成正在播放', UI.state.songSource === '正在播放', UI.state.songSource);

/* ============ 4. 手动输入：单首走卡片，多首走列表 ============ */
console.log('\n[4. 载入条落点]');
UI.state.tab = 'list';
UI.renderTabs();
UI.renderBody();
click(shadow.querySelector('[data-act="load-open"]'));
await tick(80);
const ta = shadow.querySelector('#manual-input');
ta.value = '1005';
ta.dispatchEvent(new window.Event('input', { bubbles: true }));
detailQueue.push([SONGS[5]]);            /* 1005 → 歌曲6（下标 5） */
click(shadow.querySelector('[data-act="manual-parse"]'));
await tick(400);
ok('单个 ID → 切到单曲页并载入卡片', UI.state.tab === 'song' && UI.state.song && String(UI.state.song.id) === '1005',
  'tab=' + UI.state.tab + ' song=' + (UI.state.song && UI.state.song.id));
ok('来源标为"链接载入"', UI.state.songSource === '链接载入', UI.state.songSource);
ok('载入后自动收起输入条', UI.state.loadOpen === false && !shadow.querySelector('#manual-input'));
ok('载入后卡片有高亮反馈（flash 类）', !!shadow.querySelector('#songcard.flash'));

UI.state.tab = 'list';
UI.renderTabs();
UI.renderBody();
await tick(50);
click(shadow.querySelector('[data-act="load-open"]'));
await tick(80);
const ta2 = shadow.querySelector('#manual-input');
ta2.value = '1001 1002 1003';
ta2.dispatchEvent(new window.Event('input', { bubbles: true }));
detailQueue.push([SONGS[1], SONGS[2], SONGS[3]]);
click(shadow.querySelector('[data-act="manual-parse"]'));
await tick(400);
ok('多个 ID → 生成手动列表并停在列表页', UI.state.tab === 'list' && UI.state.list && UI.state.list.manual === true,
  'tab=' + UI.state.tab + ' manual=' + (UI.state.list && UI.state.list.manual));
ok('手动列表里有 3 首', UI.state.list && UI.state.list.songs.length === 3, String(UI.state.list && UI.state.list.songs.length));
ok('列表行渲染出 3 条', shadow.querySelectorAll('[data-row]').length === 3, String(shadow.querySelectorAll('[data-row]').length));

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('手动输入与列表交互全部通过');
process.exit(0);

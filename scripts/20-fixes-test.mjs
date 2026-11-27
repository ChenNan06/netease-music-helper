/**
 * 20-fixes-test.mjs —— 用户报的四个 bug + 两个新要求的回归
 *
 * ① ▶ 能"播放这首"（不是只控制网页播放器）—— 走 player.send / playById / <audio>
 * ② 载入的歌不会被"页面歌曲"抢占（pin 机制）
 * ③ 云盘删除参数名必须是 songIds（ids/id 恒 400）
 * ④ 载入框解析后自动清空、重新打开时自动全选
 * ⑤ ⇄ 在「载入歌曲 / 详情页 / 正在播放」三项间循环
 * ⑥ 底部 2px 极简进度条
 *
 * 用法：node scripts/20-fixes-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const { JSDOM } = await import(pathToFileURL(path.join(ROOT, 'tools', 'node_modules', 'jsdom', 'lib', 'api.js')).href);

let pass = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n + (x ? '  (' + x + ')' : '')); } else { fails.push(n + (x ? ' -> ' + x : '')); console.log('  [FAIL] ' + n + (x ? ' -> ' + x : '')); } };
const section = (t) => console.log('\n[' + t + ']');

/* ============ ① 云盘删除参数（源码级契约 + 真实端点已在 19 探明）============ */
section('1. 云盘删除参数名');
const src = fs.readFileSync(BUILD, 'utf8');
ok('调用 /api/cloud/del 时传 songIds', /cloud\/del'\s*,\s*\{\s*songIds:/.test(src));
ok('不再用 ids: JSON.stringify(...) 这种错参数', !/cloud\/del'\s*,\s*\{\s*ids:/.test(src));
ok('成功判定包含 succIds（部分成功也算）', /succIds/.test(src));

/* ============ ②⑤ 面板：pin / 循环 / 输入框 / 进度条 ============ */
const SONGS = Array.from({ length: 6 }, (_, i) => ({
  id: 2000 + i, name: '歌' + (i + 1), ar: [{ id: 1, name: 'A' }],
  al: { id: 2, name: '专辑', picUrl: '' }, dt: 1000, fee: 0, no: i + 1
}));
const PRIV = SONGS.map((s) => ({ id: s.id, fee: 0, pl: 320000, dl: 320000, plLevel: 'lossless', dlLevel: 'lossless', cs: false, st: 0 }));

const dom = new JSDOM(
  `<!DOCTYPE html><html><head><title>t</title></head><body>
    <div class="m-playbar"><div class="btns"><a class="prv"></a><a class="nxt"></a><a class="ply"></a></div>
      <div class="words"><div class="name"><a href="/song?id=2001">歌2</a></div></div></div>
    <audio id="pageaudio"></audio>
   </body></html>`,
  { url: 'https://music.163.com/song?id=2000', runScripts: 'outside-only', pretendToBeVisual: true }
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
  let json = { code: 200 };
  if (/account\/get/.test(o.url)) json = { code: 200, account: null, profile: null };
  else if (/song\/detail/.test(o.url)) {
    json = { code: 200, songs: [SONGS[0]], privileges: [PRIV[0]] };   /* 真实 id 由 Api.songDetail 接管处理 */
  } else if (/enhance\/player/.test(o.url)) json = { code: 200, data: [{ id: 2000, url: 'https://m801.music.126.net/x.mp3', level: 'lossless', size: 100, type: 'mp3' }] };
  else if (/enhance\/download/.test(o.url)) json = { code: 200, data: { url: null } };
  else if (/song\/lyric/.test(o.url)) json = { code: 200, lrc: { lyric: '[00:01.00]a' } };
  const out = { status: 200, finalUrl: o.url, responseHeaders: '' };
  out.responseText = JSON.stringify(json);
  out.response = json;
  o.onload && o.onload(out);
}, 0);
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.pause = () => {};

window.eval(src);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
await tick(220);
const K = window.__NCMH_KERNEL__;
const I = K.internals;
const UI = I.UI;
/* 请求体是加密的，桩读不出 id → 直接接管 Api.songDetail，按请求的 id 返回对应歌曲
   （这里只测 UI 逻辑，不测 API 层，越权替换是合理的） */
I.Api.songDetail = async (ids) => {
  const want = new Set((Array.isArray(ids) ? ids : [ids]).map(Number));
  const songs = SONGS.filter((s) => want.has(s.id));
  return { code: 200, songs: songs.length ? songs : [SONGS[0]], privileges: PRIV.slice(0, songs.length || 1) };
};
const shadow = () => window.document.getElementById('ncmh-host').shadowRoot;
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

section('2. pin：载入的歌曲不被页面歌曲抢占');
ok('初始跟页面歌曲', String(UI.state.song && UI.state.song.id) === '2000', 'song=' + (UI.state.song && UI.state.song.id));
/* 载入 2005 */
UI.state.tab = 'list';
UI.renderTabs();
UI.renderBody();
click(shadow().querySelector('[data-act="load-open"]'));
await tick(60);
const ta = shadow().querySelector('#manual-input');
ta.value = '2005';
ta.dispatchEvent(new window.Event('input', { bubbles: true }));
/* 已接管 Api.songDetail，无需队列 */
click(shadow().querySelector('[data-act="manual-parse"]'));
await tick(400);
ok('载入后卡片是 2005', String(UI.state.song.id) === '2005', 'song=' + UI.state.song.id);
ok('pin 已设置', !!UI.state.pin && String(UI.state.pin.id) === '2005', JSON.stringify(UI.state.pin));
ok('targetMode=pinned', UI.state.targetMode === 'pinned', UI.state.targetMode);
/* 等 Tracker 跑两轮（1.5s/轮），确认不被页面(id=2000)抢回 */
/* 已接管 Api.songDetail，无需队列 */
await tick(3400);
ok('3 秒后仍是 2005（没被页面歌曲抢走）', String(UI.state.song.id) === '2005', 'song=' + UI.state.song.id);

section('3. 输入框：解析后清空 + 重开自动全选');
ok('解析成功后 manualText 被清空', UI.state.manualText === '', JSON.stringify(UI.state.manualText));
UI.state.tab = 'list';
UI.renderTabs();
UI.renderBody();
click(shadow().querySelector('[data-act="load-open"]'));
await tick(80);
const ta2 = shadow().querySelector('#manual-input');
ok('重新打开时输入框是空的', ta2 && ta2.value === '', ta2 && JSON.stringify(ta2.value));
/* 手动塞点内容再重开，验证全选 */
ta2.value = 'abc';
UI.state.manualText = 'abc';
UI.state.loadOpen = false;
UI.renderLoadbar();
click(shadow().querySelector('[data-act="load-open"]'));
await tick(120);
const ta3 = shadow().querySelector('#manual-input');
const selOk = ta3 && ta3.selectionStart === 0 && ta3.selectionEnd === ta3.value.length && ta3.value.length > 0;
ok('重开时自动全选已有内容（直接粘贴即覆盖）', !!selOk, ta3 ? `[${ta3.selectionStart},${ta3.selectionEnd}] of ${ta3.value.length}` : '无输入框');

section('4. ⇄ 三项循环（载入歌曲 / 详情页 / 正在播放）');
const cands = UI.cycleCandidates();
const kinds = cands.map((c) => c.kind).join(',');
ok('当前是 pin，候选包含 page 与 playing', cands.length >= 2 && cands.some((c) => c.kind === 'page') && cands.some((c) => c.kind === 'playing'), kinds);
const alt = shadow().querySelector('.altchip');
ok('细提示存在且带 data-act=cycle', !!alt && alt.getAttribute('data-act') === 'cycle', alt && alt.getAttribute('data-kind'));
click(alt);
await tick(400);
ok('点一次切到了另一种来源', UI.state.targetMode !== 'pinned' || String(UI.state.song.id) !== '2005',
  'mode=' + UI.state.targetMode + ' song=' + UI.state.song.id);
const kindsSeen = new Set();
for (let i = 0; i < 4; i++) {
  const a = shadow().querySelector('.altchip');
  if (!a) break;
  kindsSeen.add(a.getAttribute('data-kind'));
  click(a);
  await tick(300);
}
ok('循环里出现过 3 种来源', kindsSeen.size === 3, [...kindsSeen].join(','));

section('5. ▶ 播放这首（走 top.player.addTo，而不是只控制网页播放器）');
/* 依据 bundle：top.player.addTo(songs, 替换队列, 立即播放)，getPlaying() 返回 {track, playing} */
let captured = null;
window.player = {
  getPlaying: () => ({ track: { id: 2001, name: '歌2' }, playing: true }),
  addTo: (tracks, replace, play) => { captured = { tracks, replace, play }; },
  pause: () => { captured = captured || {}; captured.paused = true; }
};
UI.state.targetMode = 'pinned';
UI.state.pin = { id: 2005, name: '歌6', source: '链接载入', pageAt: null };
UI.state.song = I.normalizeSongs([SONGS[5]], [PRIV[5]])[0];
UI.state.songSource = '链接载入';
const r5 = await I.playInPage(UI.state.song, { replace: true, play: true });
ok('调用了 addTo', !!captured && Array.isArray(captured.tracks), r5.via || JSON.stringify(r5.attempts));
ok('replace=true（替换播放列表）', captured && captured.replace === true, String(captured && captured.replace));
ok('play=true（立即播放）', captured && captured.play === true, String(captured && captured.play));
ok('传的是这首歌的 id', captured && captured.tracks[0] && Number(captured.tracks[0].id) === 2005, JSON.stringify(captured && captured.tracks[0] && captured.tracks[0].id));
ok('传的是原始 song 结构（不是 normalize 后的）', captured && captured.tracks[0] && !!captured.tracks[0].ar, JSON.stringify(Object.keys((captured.tracks[0] || {})).slice(0, 6)));

section('5b. 用列表替换播放列表（多首）');
captured = null;
const many = I.normalizeSongs(SONGS.slice(0, 4), PRIV.slice(0, 4));
const r5b = await I.playInPage(many, { replace: true, play: true });
ok('多首也能一次替换', !!captured && captured.tracks.length === 4, String(captured && captured.tracks.length));
ok('replace/play 都为 true', captured && captured.replace === true && captured.play === true);

section('6. 无播放器时降级到 <audio> 直连');
delete window.player;
const audio = window.document.getElementById('pageaudio');
const r2 = await I.playInPage(UI.state.song);
ok('走了 audio 通道', r2.ok && r2.via === 'audio', r2.via || (r2.attempts || []).join('|'));
ok('audio.src 被设置成音源地址', !!audio.src && /\.mp3/.test(audio.src), audio.src.slice(0, 60));

section('7. 底部进度条（空闲收起 / 运行展开 + 百分比）');
const bar = shadow().querySelector('#slimbar');
const pct = shadow().querySelector('#pfpct');
ok('存在进度条元素', !!bar && !!pct);
ok('空闲时高度为 0（不占视觉）', bar.className === 'slimbar', 'class=' + bar.className);
UI.slim('indet');
ok('不确定态 = indet 类', bar.className.includes('indet'), bar.className);
ok('不确定态有文字提示（···）', pct.textContent === '···', JSON.stringify(pct.textContent));
UI.slim(42);
const fill = bar.querySelector('i');
ok('确定态 = 宽度 42%', bar.className.includes('on') && fill.style.width === '42%', bar.className + ' ' + fill.style.width);
ok('确定态显示 42%', pct.textContent === '42%', JSON.stringify(pct.textContent));
UI.slim(null);
ok('收起后宽度归零、文字清空', fill.style.width === '0%' && pct.textContent === '' && bar.className === 'slimbar', bar.className);

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('四条 bug + 两个新要求 全部通过');
process.exit(0);

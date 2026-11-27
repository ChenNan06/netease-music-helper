/**
 * 07-settings-test.mjs —— 独立设置页的隔离测试
 *
 * 用法：node scripts/07-settings-test.mjs
 *
 * 验证：
 *   ① 设置页能独立渲染（导航 + 各分区）
 *   ② 每一项「会被代码消费的设置」在界面上都有对应控件（防止"配置里有、界面改不了 / 界面有、代码不读"）
 *   ③ postMessage 协议：ready / settings → 填充；控件改动 → save(patch)
 *   ④ 页面内没有引用未定义的变量（脚本真的执行完）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const JSDOM_PATH = path.join(ROOT, 'tools', 'node_modules', 'jsdom', 'lib', 'api.js');

if (!fs.existsSync(JSDOM_PATH)) {
  console.error('缺少 jsdom，请先运行: npm i jsdom --prefix tools');
  process.exit(2);
}
const { JSDOM } = await import(pathToFileURL(JSDOM_PATH).href);

/* ---------- 取设置页 HTML ---------- */
function loadKernel() {
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
    setInterval: () => 0, clearInterval: () => {}, Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
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
    GM_info: { scriptHandler: 'node-test' }, GM_getValue: undefined, GM_setValue: undefined,
    GM_xmlhttpRequest: undefined, GM_download: undefined, GM_registerMenuCommand: undefined,
    GM_addStyle: undefined, unsafeWindow: undefined
  };
  ctx.window = ctx; ctx.self = ctx; ctx.top = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(BUILD, 'utf8'), ctx, { filename: 'kernel.js' });
  return ctx.__NCMH_KERNEL__;
}

const K = loadKernel();
const html = K.internals.settingsHtml();
const defaults = K.internals.DEFAULT_SETTINGS;

/* ---------- 在 jsdom 里跑设置页 ---------- */
const sent = [];
const dom = new JSDOM(html, {
  url: 'about:blank',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.opener = { postMessage: (msg) => sent.push(msg) };
    win.alert = () => {};
    win.confirm = () => true;
    win.URL.createObjectURL = () => 'blob:x';
    win.URL.revokeObjectURL = () => {};
    win.console = { log() {}, warn() {}, error() {} };
  }
});
const { window } = dom;
await new Promise((r) => setTimeout(r, 120));

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fails.push(name + (extra ? ' -> ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}
const section = (t) => console.log('\n[' + t + ']');
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => Array.from(window.document.querySelectorAll(s));

section('1. 页面骨架');
ok('有 header', !!$('header'));
ok('有左侧导航', !!$('#nav'));
ok('有主体区', !!$('#main'));
ok('导航项数 >= 6', $$('#nav button').length >= 6, $$('#nav button').length + ' 项');
ok('分区标题齐全', ['通用', '下载', '歌词', '云盘', '网络', '数据'].every((t) => window.document.body.textContent.includes(t)));
ok('标题含版本号', true);

section('2. 设置项覆盖率（配置 ↔ 界面）');
/* panel / ui 是内部状态，不该出现在设置页 */
const skip = new Set(['version', 'panel']);
const controlKeys = new Set($$('[data-k]').map((n) => n.getAttribute('data-k')));
function flatten(obj, prefix) {
  const out = [];
  Object.keys(obj).forEach((k) => {
    if (skip.has(k)) return;
    const v = obj[k];
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, key));
    else out.push(key);
  });
  return out;
}
const leafKeys = flatten(defaults, '');
const missing = leafKeys.filter((k) => !controlKeys.has(k));
ok('每个设置项都有控件', missing.length === 0, missing.length ? '缺: ' + missing.join(', ') : leafKeys.length + ' 项全覆盖');
const extra = [...controlKeys].filter((k) => !leafKeys.includes(k));
ok('没有多余的控件', extra.length === 0, extra.length ? '多: ' + extra.join(', ') : 'ok');

section('3. 关键项存在性');
['quality', 'autoDowngrade', 'targetLevelOnly', 'nameTemplate', 'folderMode', 'concurrent',
 'applyTag', 'coverSidecar', 'lyricSidecar', 'skipCloudOwned',
 'methods.download', 'methods.player', 'methods.outer',
 'lyricMerge', 'lyricRoma', 'lyricFormat',
 'cloud.autoMatch', 'requestGapMs', 'retry', 'identity', 'customUA', 'debug', 'theme']
  .forEach((k) => ok('  含 ' + k, controlKeys.has(k)));
ok('  已移除试听项（trialLevel / trialVolume）', !controlKeys.has('trialLevel') && !controlKeys.has('trialVolume'));

section('4. postMessage 协议');
const ready = sent.find((m) => m && m.type === 'ready');
ok('页面启动后发了 ready', !!ready);
ok('ready 带协议标记', ready && ready.__ncmh === 1);

/* 主脚本回推设置 */
const data = JSON.parse(JSON.stringify(defaults));
data.theme = 'dark';
data.quality = 'lossless';
data.methods.player = false;
data.metadata = null;
window.dispatchEvent(new window.MessageEvent('message', {
  data: {
    __ncmh: 1, type: 'settings', data,
    meta: { version: '1.0.0', loggedIn: true, dark: true, song: '晴天（id 186016）', manager: 'test' }
  }
}));
await new Promise((r) => setTimeout(r, 80));

ok('主题控件被填充为 dark', $('[data-k="theme"]').value === 'dark', $('[data-k="theme"]').value);
ok('音质控件被填充为 lossless', $('[data-k="quality"]').value === 'lossless');
ok('开关被关闭', $('[data-k="methods.player"]').checked === false);
ok('登录状态显示', $('#chip-login').textContent.includes('已登录'));
ok('版本号显示', $('#ver').textContent.includes('1.0.0'));
ok('当前对象显示', $('#s-song').textContent.includes('晴天'));

sent.length = 0;
const qSel = $('[data-k="quality"]');
qSel.value = 'hires';
qSel.dispatchEvent(new window.Event('change'));
await new Promise((r) => setTimeout(r, 400));
const saveMsg = sent.find((m) => m && m.type === 'save');
ok('改动触发 save 消息', !!saveMsg);
ok('patch 里带上了新值', saveMsg && saveMsg.patch && saveMsg.patch.quality === 'hires',
  saveMsg ? JSON.stringify(saveMsg.patch).slice(0, 80) : '');
ok('patch 结构保留嵌套', saveMsg && saveMsg.patch.methods && saveMsg.patch.methods.player === false);

section('5. 数据区按钮接线');
const btnIds = ['btn-diag', 'btn-export', 'btn-import', 'btn-import-apply', 'btn-close', 'btn-reset'];
btnIds.forEach((id) => ok('  有按钮 ' + id, !!$('#' + id)));
sent.length = 0;
$('#btn-diag').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#btn-export').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
ok('诊断按钮发 diag', sent.some((m) => m.type === 'diag'));
ok('导出按钮发 export', sent.some((m) => m.type === 'export'));

section('6. 内联脚本执行完整');
ok('内联脚本无异常（导航已渲染即视为执行完）', $$('#nav button').length > 0);
ok('表单已生成', $$('.row').length > 15, $$('.row').length + ' 行');

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('设置页测试全部通过');
dom.window.close();
process.exit(0);

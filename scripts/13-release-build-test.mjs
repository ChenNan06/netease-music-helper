/**
 * 13-release-build-test.mjs —— 正式版（GitHub 发布用）构建门禁
 *
 * 目的：确认 `--release` 真的把"开发期工具"剥干净，而且剥完还能跑。
 *   ① 产物里不再有 exportSession / GM_cookie / @grant GM_cookie
 *   ② DEV_TOOLS === false
 *   ③ 面板仍能正常挂载：4 个标签页、单曲页控件齐全
 *   ④ 工具页没有「导出登录态」按钮，也没有试听器残留
 *   ⑤ node --check 通过
 *
 * 用法：node scripts/13-release-build-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'output');
/** 版本号会变，别写死文件名：构建后按 *-release.user.js 找 */
function findRelease() {
  try {
    const f = fs.readdirSync(OUT_DIR).filter((n) => /-release\.user\.js$/.test(n)).sort().pop();
    return f ? path.join(OUT_DIR, f) : null;
  } catch (e) {
    return null;
  }
}
let RELEASE = findRelease();
const JSDOM_PATH = path.join(ROOT, 'tools', 'node_modules', 'jsdom', 'lib', 'api.js');
const { JSDOM } = await import(pathToFileURL(JSDOM_PATH).href);

let pass = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n + (x ? '  (' + x + ')' : '')); } else { fails.push(n + (x ? ' -> ' + x : '')); console.log('  [FAIL] ' + n + (x ? ' -> ' + x : '')); } };
const section = (t) => console.log('\n[' + t + ']');

section('1. 构建正式版');
let buildOut = '';
try {
  buildOut = execFileSync('python', ['scripts/01-build.py', '--release'], { cwd: ROOT, encoding: 'utf8' });
  console.log(buildOut.trim().split('\n').slice(0, 3).join('\n'));
} catch (e) {
  console.log('构建失败：' + (e.stdout || '') + (e.stderr || '') + e.message);
}
RELEASE = findRelease();
ok('正式版构建成功', !!RELEASE, RELEASE || '找不到 *-release.user.js');

if (!RELEASE) {
  console.log('\n构建没出来，后面无法验证');
  process.exit(1);
}

const src = fs.readFileSync(RELEASE, 'utf8');

section('2. dev-only 内容是否剥干净');
ok('没有 exportSession 实现', !/exportSession/.test(src));
ok('没有 GM_cookie 调用', !/GM_cookie/.test(src));
ok('没有 @grant GM_cookie', !/@grant\s+GM_cookie/.test(src));
ok('没有 dev-only 标记残留', !/\/\/\s*#region dev-only/.test(src) && !/\/\/\s*#endregion dev-only/.test(src));
ok('DEV_TOOLS 为 false', /const DEV_TOOLS = false;/.test(src));
const headerVersion = (src.match(/@version\s+(\S+)/) || [])[1] || '';
ok('版本号与文件名一致', !!headerVersion && path.basename(RELEASE).includes('-v' + headerVersion), headerVersion);

section('3. 语法检查');
try {
  execFileSync('node', ['--check', RELEASE], { encoding: 'utf8' });
  ok('node --check 通过', true);
} catch (e) {
  ok('node --check 通过', false, (e.stderr || '').slice(0, 200));
}

section('4. 正式版仍能正常挂载（jsdom）');
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
  let json = { code: 200 };
  if (/account\/get/.test(o.url)) json = { code: 200, account: null, profile: null };
  else if (/song\/detail/.test(o.url)) json = { code: 200, songs: [{ id: 186016, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美', picUrl: '' }, dt: 1000 }], privileges: [{ id: 186016, plLevel: 'lossless', dlLevel: 'lossless', fee: 0, cs: false }] };
  const out = { status: 200, finalUrl: o.url, responseHeaders: '' };
  out.responseText = JSON.stringify(json);
  out.response = json;
  o.onload && o.onload(out);
}, 0);
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();

window.eval(src);
await new Promise((r) => setTimeout(r, 200));
const host = window.document.getElementById('ncmh-host');
ok('面板已挂载', !!host);
const shadow = host && host.shadowRoot;
ok('Shadow DOM 存在', !!shadow);
if (shadow) {
  ok('4 个标签页', shadow.querySelectorAll('[data-tab]').length === 4, String(shadow.querySelectorAll('[data-tab]').length));
  ok('单曲页音质下拉在', !!shadow.querySelector('#sel-quality'));
  ok('「当前生效」提示在', !!shadow.querySelector('#quality-hint'));
  const tool = shadow.querySelector('[data-tab="tool"]');
  tool && tool.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  ok('工具页没有「导出登录态」按钮', !shadow.querySelector('[data-act="export-session"]'));
  ok('工具页没有试听器', !shadow.querySelector('#trial-audio') && !shadow.querySelector('[data-act="trial"]'));
  ok('工具页有登录状态行', !!shadow.querySelector('#login-state'));
  ok('工具页有「重新检测登录」', !!shadow.querySelector('[data-act="relogin"]'));
}
const K = window.__NCMH_KERNEL__;
ok('DEV_TOOLS 暴露为 false', K && K.internals && K.internals.DEV_TOOLS === false, String(K && K.internals && K.internals.DEV_TOOLS));

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('正式版构建门禁全部通过');
process.exit(0);

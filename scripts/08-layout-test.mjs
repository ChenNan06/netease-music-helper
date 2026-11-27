/**
 * 08-layout-test.mjs —— 面板几何的纯函数测试（用户报"离球很远 / 越来越长盖住球"）
 *
 * jsdom 没有排版引擎（所有 rect 都是 0），所以几何必须抽成纯函数再测：
 *   layoutPanel(vw, vh, ball, 自然宽, 自然高) → {left, top, width, height, maxHeight, placeAbove}
 *
 * 用法：node scripts/08-layout-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');

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
  return ctx.__NCMH_KERNEL__;
}

const K = loadKernel();
const layout = K.internals.layoutPanel;
const GAP = 10;

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fails.push(name + (extra ? ' -> ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}
const section = (t) => console.log('\n[' + t + ']');
const ball = (x, y, size = 48) => ({ left: x, top: y, right: x + size, bottom: y + size });

section('1. 球在右下角（最常见的默认位置）');
{
  const vw = 2560, vh = 1392;
  const b = ball(2560 - 48 - 24, 1392 - 48 - 120);
  const g = layout(vw, vh, b, 372, 420);
  ok('面板贴在球上方', g.placeAbove === true, JSON.stringify(g));
  ok('底边与球顶只隔 10px（不再是几百像素）', Math.abs(g.top + g.height - (b.top - GAP)) < 1.5,
    'panelBottom=' + (g.top + g.height) + ' ballTop=' + b.top);
  ok('不盖住球', g.top + g.height <= b.top - GAP + 1.5);
  ok('不超出视口右/下边', g.left + g.width <= vw - 7 && g.top >= 7);
  ok('宽度就是 372', g.width === 372);
}

section('2. 球在上半屏（面板应该落在球下方）');
{
  const vw = 2560, vh = 1392;
  const b = ball(100, 90);
  const g = layout(vw, vh, b, 372, 420);
  ok('面板在球下方', g.placeAbove === false);
  ok('顶边与球底隔 10px', Math.abs(g.top - (b.bottom + GAP)) < 1.5, 'top=' + g.top + ' ballBottom=' + b.bottom);
  ok('不盖住球', g.top >= b.bottom + GAP - 1.5);
}

section('3. 内容很长（日志/歌词）时不能无限变长');
{
  const vw = 2560, vh = 1392;
  const b = ball(2000, 1240);
  const g = layout(vw, vh, b, 372, 2000);      // 自然高度 2000
  ok('高度被空间收紧', g.height < 2000, 'h=' + g.height);
  ok('maxHeight ≤ 可用空间', g.maxHeight <= b.top - GAP - 8 + 1, 'maxH=' + g.maxHeight);
  ok('仍不盖住球', g.top + g.height <= b.top - GAP + 1.5, 'panelBottom=' + (g.top + g.height));
  ok('至少给到 220px（不会挤成一条）', g.height >= 219, 'h=' + g.height);
}

section('4. 球贴在最下方（空间极小，应换到球上方或夹紧）');
{
  const vw = 1280, vh = 720;
  const b = ball(1200, 700);                    // 球几乎贴底
  const g = layout(vw, vh, b, 372, 420);
  ok('不超出视口', g.top + g.height <= vh - 7, 'bottom=' + (g.top + g.height) + ' vh=' + vh);
  ok('不盖住球', !(g.top < b.bottom && g.top + g.height > b.top) || g.placeAbove === false && g.top >= b.bottom,
    'g=' + JSON.stringify(g) + ' b=' + JSON.stringify(b));
  ok('宽度被视口限制', g.width <= vw - 16, 'w=' + g.width);
}

section('5. 窄视口（372 放不下）');
{
  const vw = 340, vh = 600;
  const b = ball(260, 500);
  const g = layout(vw, vh, b, 372, 420);
  ok('宽度收缩到 vw-16', g.width === vw - 16, 'w=' + g.width);
  ok('left 不为负', g.left >= 7, 'left=' + g.left);
  ok('右边不出界', g.left + g.width <= vw - 7, 'right=' + (g.left + g.width));
}

section('6. 球在左上（左对齐，不越过球左边界）');
{
  const vw = 1920, vh = 1080;
  const b = ball(20, 200);
  const g = layout(vw, vh, b, 372, 420);
  ok('左对齐到球左边', g.left === b.left, 'left=' + g.left + ' ballLeft=' + b.left);
  ok('面板在球下方', g.placeAbove === false);
}

section('7. 球在右上（右对齐到球右边）');
{
  const vw = 1920, vh = 1080;
  const b = ball(1840, 200);
  const g = layout(vw, vh, b, 372, 420);
  ok('右对齐', Math.abs(g.left + g.width - b.right) < 2, 'panelRight=' + (g.left + g.width) + ' ballRight=' + b.right);
}

section('8. 面板自然高度小于可用空间（不留大片空白）');
{
  const vw = 1920, vh = 1080;
  const b = ball(1800, 900);
  const g1 = layout(vw, vh, b, 372, 300);
  const g2 = layout(vw, vh, b, 372, 640);
  ok('矮面板就用真实高度', g1.height === 300, 'h=' + g1.height);
  ok('高面板不超过空间', g2.height <= g2.maxHeight, g2.height + '/' + g2.maxHeight);
  ok('两者底边都贴着球', Math.abs((g1.top + g1.height) - (b.top - GAP)) < 1.5 && Math.abs((g2.top + g2.height) - (b.top - GAP)) < 1.5,
    (g1.top + g1.height) + ' vs ' + (g2.top + g2.height));
}

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('面板几何全部通过');
process.exit(0);

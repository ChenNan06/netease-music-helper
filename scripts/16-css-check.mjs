/**
 * 16-css-check.mjs —— 面板 CSS 静态门禁
 *
 * 为什么要有这条：v1.0.2 改列表 UI 时，一次编辑把 `.lyricbox {` 选择器行吃掉了，
 * 留下 4 行悬空声明 + 花括号不配对（{ 114 / } 115）。jsdom 只丢一句
 * "Could not parse CSS stylesheet"，真实浏览器里那段样式会整段失效。
 * 这类问题肉眼很难发现，必须上机器检查。
 *
 * 检查项：
 *   ① 花括号数量配对
 *   ② 每个规则块都必须以选择器开头（不能有悬空声明）
 *   ③ 整块 CSS 能被解析，规则数 ≥ 100
 *   ④ 关键选择器存在（面板靠它们工作）
 *
 * 用法：node scripts/16-css-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const { JSDOM, VirtualConsole } = await import(pathToFileURL(path.join(ROOT, 'tools', 'node_modules', 'jsdom', 'lib', 'api.js')).href);

const src = fs.readFileSync(BUILD, 'utf8');
const m = src.match(/css\(\)\s*\{\s*return\s*`([\s\S]*?)`;\s*\}/);
if (!m) {
  console.error('❌ 找不到 css() 模板');
  process.exit(1);
}
const css = m[1];

let pass = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n + (x ? '  (' + x + ')' : '')); } else { fails.push(n + (x ? ' -> ' + x : '')); console.log('  [FAIL] ' + n + (x ? '  -> ' + x : '')); } };
const section = (t) => console.log('\n[' + t + ']');

section('1. 括号配对');
const opens = (css.match(/\{/g) || []).length;
const closes = (css.match(/\}/g) || []).length;
ok('花括号数量一致', opens === closes, '{ = ' + opens + ' / } = ' + closes);

section('2. 没有悬空声明（每个块都要有选择器）');
const blocks = [];
let depth = 0, buf = '', start = 0;
const lines = css.split('\n');
let orphan = [];
lines.forEach((ln, i) => {
  const before = depth;
  depth += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length;
  /* 深度为 0 时出现"不以 { 结尾、也不是空行/注释/规则结束"的行 = 悬空声明 */
  const t = ln.trim();
  if (before === 0 && depth === 0 && t && !t.startsWith('/*') && !t.startsWith('@') && !t.endsWith('}') && !t.includes('{')) {
    orphan.push((i + 1) + ': ' + t.slice(0, 70));
  }
});
ok('没有悬空 CSS 声明', orphan.length === 0, orphan.join(' | '));

section('3. 整块可解析');
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const style = dom.window.document.createElement('style');
style.textContent = css;
dom.window.document.head.appendChild(style);
const rules = style.sheet ? style.sheet.cssRules.length : -1;
ok('cssom 能解析', rules > 0, '规则数 ' + rules);
ok('规则数 ≥ 100（没被吃掉大段）', rules >= 100, String(rules));

section('4. 关键选择器存在');
['.panel', '.body', '.lrow', '.lrow.sel', '.loadbar', '.ibtn', '.altchip', '.linkrow', '.qhint', '.lyricbox', '.minilog', '.pager', '.chip']
  .forEach((sel) => ok('  含 ' + sel, css.includes(sel)));

dom.window.close();

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('面板 CSS 门禁通过');
process.exit(0);

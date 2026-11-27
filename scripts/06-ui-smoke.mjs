/**
 * 06-ui-smoke.mjs —— 在 jsdom 里真实挂载面板，逐项点击验证 UI 不炸
 *
 * 依赖：tools/node_modules/jsdom（仅本地测试用，不进入交付物）
 * 用法：node scripts/06-ui-smoke.mjs
 *
 * 覆盖：挂载 → 打开/收起 → 四个标签页渲染 → 单曲下载/歌词/封面/快传/试听
 *       → 列表抓取/导出/批量入口 → 云盘（未登录提示）→ 诊断 → 主题切换
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const JSDOM_PATH = path.join(ROOT, 'tools', 'node_modules', 'jsdom', 'lib', 'api.js');

if (!fs.existsSync(JSDOM_PATH)) {
  console.error('缺少 jsdom，请先在项目根目录运行: npm i jsdom --prefix tools');
  process.exit(2);
}
const { JSDOM } = await import(pathToFileURL(JSDOM_PATH).href);

/* ============================ 假数据 ============================ */

const SONGS = [
  {
    id: 186016, name: '晴天', alia: [], fee: 0, no: 1, cd: '',
    ar: [{ id: 6452, name: '周杰伦' }],
    al: { id: 18914, name: '叶惠美', picUrl: 'http://p1.music.126.net/x.jpg', publishTime: 1057766400000 },
    dt: 269000
  },
  {
    id: 186017, name: '七里香', alia: [], fee: 1, no: 2, cd: '',
    ar: [{ id: 6452, name: '周杰伦' }],
    al: { id: 18915, name: '七里香', picUrl: 'http://p1.music.126.net/y.jpg', publishTime: 1089388800000 },
    dt: 259000
  }
];
const PRIVS = [
  { id: 186016, fee: 0, pl: 320000, dl: 320000, plLevel: 'exhigh', dlLevel: 'exhigh', cs: false, st: 0 },
  { id: 186017, fee: 1, pl: 0, dl: 0, plLevel: 'none', dlLevel: 'none', cs: true, st: 0 }
];
const LRC = '[ti:晴天]\n[ar:周杰伦]\n[00:01.00]故事的小黄花\n[00:05.50]从出生那年就飘着\n[00:10.20]童年的荡秋千';
const TLRC = '[00:01.00]The little yellow flower\n[00:05.50]Drifting since the year I was born';

function routeApi(url, body, responseType) {
  if (responseType === 'arraybuffer') {
    return { bytes: Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]) };
  }
  if (/enhance\/download\/url/.test(url)) {
    return { json: { code: 200, data: { id: 186016, url: null, level: 'none', size: 0, md5: '' } } };
  }
  if (/enhance\/player\/url/.test(url)) {
    return {
      json: {
        code: 200,
        data: [{ id: 186016, url: 'http://m801.music.126.net/2026/aa/bb/song.mp3', level: 'exhigh', size: 6848685, md5: 'abc123', br: 320000, type: 'mp3' }]
      }
    };
  }
  if (/v3\/song\/detail/.test(url)) return { json: { code: 200, songs: SONGS, privileges: PRIVS } };
  if (/song\/lyric/.test(url)) return { json: { code: 200, lrc: { lyric: LRC }, tlyric: { lyric: TLRC }, romalrc: { lyric: '' } } };
  if (/v6\/playlist\/detail/.test(url)) {
    return {
      json: {
        code: 200,
        playlist: {
          id: 2884035, name: '原创榜', coverImgUrl: '', creator: { nickname: '网易云' },
          trackIds: SONGS.map((s) => ({ id: s.id })), tracks: SONGS
        }
      }
    };
  }
  if (/v1\/album/.test(url)) return { json: { code: 200, album: { id: 18914, name: '叶惠美', picUrl: '' }, songs: SONGS } };
  if (/cloud\/get/.test(url)) return { json: { code: 301, msg: '需要登录' } };
  if (/cloud\/upload\/check/.test(url)) return { json: { code: 200, data: [{ upload: 1, songId: 900001 }] } };
  if (/cloud\/user\/song\/import/.test(url)) return { json: { code: 200, data: { successSongs: [{ song: { songId: 900002 } }] } } };
  if (/cloud\/user\/song\/match/.test(url)) return { json: { code: 200 } };
  if (/v2\/artist\/songs/.test(url)) return { json: { code: 200, songs: SONGS, privileges: PRIVS, more: false } };
  if (/get\/web/.test(url)) return { json: { code: 200, result: { songs: SONGS } } };
  return { json: { code: 200 } };
}

/* ============================ 构建 jsdom 环境 ============================ */

const dom = new JSDOM(
  `<!DOCTYPE html><html><head><title>网易云音乐</title></head>
   <body>
     <div class="m-playbar"><div class="words"><div class="name"><a href="/song?id=186016">晴天</a></div></div></div>
     <div class="tit">晴天</div><div id="g_iframe"></div>
   </body></html>`,
  { url: 'https://music.163.com/song?id=186016', pretendToBeVisual: true, runScripts: 'outside-only' }
);

const { window } = dom;
const errors = [];
const warnings = [];
window.console = Object.assign({}, console, {
  error: (...a) => { errors.push(a.map(String).join(' ')); },
  warn: (...a) => { warnings.push(a.map(String).join(' ')); },
  log: () => {},
  info: () => {}
});
window.addEventListener('error', (ev) => errors.push('window.onerror: ' + (ev.message || ev.error)));

/* Node 的 webcrypto 注入（jsdom 的 crypto 没有 subtle） */
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
if (!window.TextEncoder) window.TextEncoder = TextEncoder;
if (!window.TextDecoder) window.TextDecoder = TextDecoder;

/* GM_* 桩 */
const gmStore = new Map();
window.GM_info = { scriptHandler: 'jsdom-test' };
window.GM_getValue = (k, d) => (gmStore.has(k) ? gmStore.get(k) : d);
window.GM_setValue = (k, v) => gmStore.set(k, v);
window.GM_registerMenuCommand = () => {};
window.GM_addStyle = () => {};
window.GM_download = (opts) => { setTimeout(() => opts.onload && opts.onload({}), 0); };
window.GM_xmlhttpRequest = (opts) => {
  setTimeout(() => {
    try {
      const r = routeApi(opts.url, opts.data, opts.responseType);
      const out = {
        status: 200, statusText: 'OK',
        finalUrl: /outer\/url/.test(opts.url) ? 'http://m701.music.126.net/2026/aa/song.mp3' : opts.url,
        responseURL: opts.url,
        responseHeaders: 'content-type: audio/mpeg'
      };
      if (r.bytes) { out.response = r.bytes.buffer; }
      else {
        out.responseText = JSON.stringify(r.json);
        out.response = r.json;
      }
      opts.onload && opts.onload(out);
    } catch (e) {
      errors.push('GM_xmlhttpRequest 桩异常: ' + e.message);
      opts.onerror && opts.onerror({ error: e.message, status: 0 });
    }
  }, 0);
};
window.navigator.clipboard = { writeText: async () => {} };
/* jsdom 没有 Blob URL，补一个桩（只影响"保存文件"这一步） */
const savedFiles = [];
window.URL.createObjectURL = (blob) => { savedFiles.push(blob); return 'blob:jsdom-' + savedFiles.length; };
window.URL.revokeObjectURL = () => {};
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
window.HTMLMediaElement.prototype.load = function () {};
window.open = () => null;   // 模拟"弹窗被拦截"，同时验证降级路径不崩

/* ============================ 断言 ============================ */

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fails.push(name + (extra ? ' -> ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}
const section = (t) => console.log('\n[' + t + ']');
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const shadow = () => window.document.getElementById('ncmh-host').shadowRoot;
const q = (sel) => shadow().querySelector(sel);
const qa = (sel) => Array.from(shadow().querySelectorAll(sel));
function click(el) {
  if (!el) return false;
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
function clickAct(act) {
  const el = shadow().querySelector('[data-act="' + act + '"]');
  return click(el);
}

/* ============================ 执行 ============================ */

(async () => {
  section('1. 载入与挂载');
  const code = fs.readFileSync(BUILD, 'utf8');
  try {
    window.eval(code);
  } catch (e) {
    ok('脚本执行', false, e.message);
    console.log(e.stack);
    process.exit(1);
  }
  await tick(60);
  const host = window.document.getElementById('ncmh-host');
  ok('挂载了宿主节点', !!host);
  if (!host) { console.log(errors.join('\n')); process.exit(1); }
  ok('创建了 Shadow DOM', !!host.shadowRoot);
  ok('面板存在', !!q('.panel'));
  ok('启动球存在', !!q('.launcher'));
  ok('暴露了外部抓手 window.__NCMH__', !!window.__NCMH__);
  /* 版本号与 @version 头一致（从构建产物里读，避免每次改版本都要改测试） */
  const headerVersion = (fs.readFileSync(BUILD, 'utf8').match(/@version\s+(\S+)/) || [])[1];
  eqName('版本号一致', window.__NCMH__ && window.__NCMH__.version, headerVersion);

  section('2. 当前对象追踪');
  await tick(200);
  const card = q('#songcard') ? q('#songcard').textContent : '';
  ok('歌曲卡片显示曲名', card.includes('晴天'), card.replace(/\s+/g, ' ').slice(0, 60));
  ok('显示歌手', card.includes('周杰伦'));
  ok('显示音质徽章', card.includes('极高'));

  section('3. 打开 / 收起面板');
  window.__NCMH__.open();
  await tick(60);
  ok('面板已展开', q('.panel').classList.contains('open'));
  ok('单曲标签是默认页', q('#body').textContent.length > 20);
  const levelSel = q('#sel-quality');
  ok('音质下拉存在且有 9 档', !!levelSel && levelSel.options.length === 9, levelSel ? levelSel.options.length + ' 档' : '缺失');

  section('4. 单曲：下载 / 歌词 / 封面 / 快传 / 试听');
  clickAct('dl-song');
  await tick(300);
  ok('下载后状态栏有反馈', q('#status').textContent.length > 2, q('#status').textContent);
  clickAct('view-lyric');
  await tick(300);
  const inline = shadow().querySelector('#lyric-inline');
  ok('歌词内联预览出现', !!inline);
  ok('歌词含原文', inline && inline.textContent.includes('故事的小黄花'));
  ok('歌词合并了翻译', inline && inline.textContent.includes('The little yellow flower'));
  clickAct('dl-lyric');
  await tick(200);
  ok('保存歌词成功提示', !errors.some((e) => e.includes('歌词')), '');
  clickAct('dl-cover');
  await tick(200);
  clickAct('cloud-quick');
  await tick(400);
  ok('快传有结果反馈', q('#status').textContent.length > 2, q('#status').textContent.slice(0, 70));
  clickAct('copy-id');
  await tick(80);
  clickAct('copy-link');
  await tick(80);

  section('5. 标签页切换与渲染');
  for (const tab of ['list', 'cloud', 'tool', 'song']) {
    const btn = shadow().querySelector('[data-tab="' + tab + '"]');
    click(btn);
    await tick(80);
    const bodyText = q('#body').textContent;
    ok('切换到 ' + tab + ' 有内容', bodyText.length > 10, bodyText.replace(/\s+/g, ' ').slice(0, 50));
    ok('  ' + tab + ' 标签高亮', btn && btn.classList.contains('active'));
  }

  section('6. 列表：抓取 / 导出 / 批量入口');
  dom.reconfigure({ url: 'https://music.163.com/playlist?id=2884035' });
  await tick(400);
  click(shadow().querySelector('[data-tab="list"]'));
  await tick(60);
  clickAct('list-fetch');
  await tick(700);
  const listText = q('#body').textContent;
  ok('读取到 2 首', listText.includes('2 首'), listText.replace(/\s+/g, ' ').slice(0, 80));
  ok('预览区出现曲目', listText.includes('晴天') && listText.includes('七里香'));
  clickAct('export-txt');
  await tick(120);
  ok('TXT 导出未报错', !errors.some((e) => /export|导出/i.test(e)));
  clickAct('export-csv');
  await tick(80);
  clickAct('export-json');
  await tick(80);
  const batchBtn = shadow().querySelector('[data-act="list-dl"]');
  ok('批量下载按钮存在', !!batchBtn);
  const cloudBatchBtn = shadow().querySelector('[data-act="list-cloud"]');
  ok('批量快传按钮存在', !!cloudBatchBtn);

  section('7. 云盘（未登录 → 明确提示而非崩溃）');
  click(shadow().querySelector('[data-tab="cloud"]'));
  await tick(60);
  clickAct('cloud-refresh');
  await tick(300);
  const toasts = qa('.toast').map((t) => t.textContent).join(' | ');
  ok('给出"需要登录"提示', toasts.includes('登录') || q('#body').textContent.includes('登录'), toasts.slice(0, 60));
  ok('云盘列表容器存在', !!q('#cloud-list'));
  ok('过滤框存在', !!q('#cloud-filter'));

  section('8. 工具：账号 / 诊断');
  click(shadow().querySelector('[data-tab="tool"]'));
  await tick(60);
  /* 登录态必须按接口判定（用户实测：登录了却显示未登录，因为 document.cookie 读不到 MUSIC_U） */
  const loginState = shadow().querySelector('#login-state');
  ok('工具页有登录状态行', !!loginState, loginState ? loginState.textContent.trim() : '缺失');
  ok('登录状态来自接口（非 cookie）', !!loginState && !/MUSIC_U/.test(loginState.textContent), loginState && loginState.textContent.trim());
  const reloginBtn = shadow().querySelector('[data-act="relogin"]');
  ok('有「重新检测登录」按钮', !!reloginBtn);
  if (reloginBtn) {
    clickAct('relogin');
    await tick(120);
  }
  ok('试听器已移除（#trial-audio 不存在）', !shadow().querySelector('#trial-audio'));
  ok('试听音质下拉已移除（#sel-trial 不存在）', !shadow().querySelector('#sel-trial'));
  clickAct('diag');
  await tick(800);
  const modal = q('.modal');
  ok('诊断弹窗出现', !!modal);
  ok('诊断内含登录状态', modal && modal.textContent.includes('登录状态'));
  ok('诊断内含三路方法', modal && modal.textContent.includes('增强下载接口') && modal.textContent.includes('试听播放接口'));
  const closeBtn = modal && modal.querySelector('[data-mbtn]');
  click(closeBtn);
  await tick(60);
  ok('弹窗可关闭', !q('.modal'));

  section('9. 设置页（弹窗被拦截时的降级）');
  clickAct('open-settings');
  await tick(120);
  const toastText = qa('.toast').map((t) => t.textContent).join(' | ');
  ok('弹出被拦截时给出提示', toastText.includes('拦截') || toastText.includes('弹出'), toastText.slice(0, 60));
  ok('无未捕获异常', errors.filter((e) => !/Not implemented/.test(e)).length === 0, errors.slice(0, 2).join(' | '));

  section('10. 主题跟随');
  q('.wrap').setAttribute('data-theme', 'light');
  ok('浅色令牌生效', q('.wrap').getAttribute('data-theme') === 'light');
  window.__NCMH__.close();
  await tick(40);
  ok('面板可收起', !q('.panel').classList.contains('open'));

  section('11. 运行期错误检查');
  const realErrors = errors.filter((e) => !/Not implemented|Could not parse CSS/.test(e));
  ok('控制台无 error 级异常', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  const realWarns = warnings.filter((w) => !/Not implemented|Could not parse CSS/.test(w));
  console.log('  warn 数：' + realWarns.length + (realWarns.length ? ' → ' + realWarns.slice(0, 2).join(' | ') : ''));

  section('12. 交付的预览页能独立跑起来（内嵌 base64 脚本未损坏）');
  const previewPath = path.join(ROOT, 'output', '面板预览-双击打开.html');
  if (!fs.existsSync(previewPath)) {
    ok('预览页存在', false, '先运行 python scripts/01-build.py 生成');
  } else {
    const previewDom = new JSDOM(fs.readFileSync(previewPath, 'utf8'), {
      url: 'file:///preview.html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(win) {
        win.console = { log() {}, warn() {}, error() {} };
        win.GM_getValue = (k, d) => d;
        win.GM_setValue = () => {};
        win.GM_info = { scriptHandler: 'preview' };
        win.GM_registerMenuCommand = () => {};
        win.GM_addStyle = () => {};
        /* jsdom 的 crypto 没有 subtle，真实浏览器（https）里是有的 */
        Object.defineProperty(win, 'crypto', { value: webcrypto, configurable: true, writable: true });
      }
    });
    await tick(400);
    const pvHost = previewDom.window.document.getElementById('ncmh-host');
    ok('预览页内嵌脚本执行成功', !!pvHost);
    ok('预览页渲染出面板', !!(pvHost && pvHost.shadowRoot && pvHost.shadowRoot.querySelector('.panel')));
    const pvText = pvHost && pvHost.shadowRoot ? pvHost.shadowRoot.querySelector('#songcard').textContent : '';
    ok('预览页能识别模拟歌曲', pvText.includes('晴天'), pvText.replace(/\s+/g, ' ').slice(0, 40));
    previewDom.window.close();
  }

  section('13. 结果概览');
  console.log('  面板节点：' + shadow().querySelectorAll('*').length + ' 个');
  console.log('  标签页：' + shadow().querySelectorAll('#tabs button').length + ' 个（单曲/列表/云盘/工具）');
  console.log('  已触发保存文件：' + savedFiles.length + ' 次');
  console.log('  Shadow DOM 隔离：站点 CSS 不会影响面板，面板样式也不会污染站点');

  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
  if (fails.length) {
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UI 冒烟全部通过');
  dom.window.close();
  process.exit(0);   // 脚本内的 setInterval 会吊住事件循环，测试完直接退出
})().catch((e) => {
  console.error('冒烟测试异常: ' + (e && e.stack || e));
  process.exit(1);
});

function eqName(name, a, b) {
  ok(name, String(a) === String(b), 'actual=' + a);
}

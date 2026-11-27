/**
 * 10-loggedin-probe.mjs —— 用"导出的登录态"做登录后只读验证
 *
 * 前置：把面板「工具 → 导出登录态」得到的 ncmh-session.json 放到 tools\session.json
 *      （或直接用 --session <路径> 指定）
 *
 * 只调用**只读接口**：歌曲详情 / 歌词 / 下载地址 / 我的云盘列表 / 歌手歌曲。
 * 不做 import、不做 del、不做 match，不会往你的账号里写任何东西。
 *
 * 用法：
 *   node scripts/10-loggedin-probe.mjs
 *   node scripts/10-loggedin-probe.mjs --session "D:\path\session.json" --song 186016
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SESSION_PATH = argOf('--session', path.join(ROOT, 'tools', 'session.json'));
const SONG_ARG = argOf('--song', '');

if (!fs.existsSync(SESSION_PATH)) {
  console.error('❌ 没有登录态文件：' + SESSION_PATH);
  console.error('   打开网易云 → 面板「工具」页 → 点「导出登录态」→ 把 ncmh-session.json 放到 tools\\session.json');
  console.error('   （这个文件等同登录凭据，只留在本机；想失效就在网页版退出登录）');
  process.exit(2);
}
const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
const cookies = session.cookies || {};
if (!cookies.MUSIC_U) {
  console.error('❌ session.json 里没有 MUSIC_U（不是有效的登录态）');
  process.exit(2);
}
const cookieHeader = Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; ');
const UA = session.userAgent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const csrf = cookies.__csrf || '';

/* ---------------- 载入内核（只用其 weapi 加密） ---------------- */
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

async function api(pathname, data) {
  const body = await K.weapiBody(Object.assign({ csrf_token: csrf }, data || {}));
  const url = 'https://music.163.com' + pathname.replace('/api/', '/weapi/') + '?csrf_token=' + encodeURIComponent(csrf);
  const t0 = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          Referer: 'https://music.163.com/',
          Cookie: cookieHeader
        },
        body: 'params=' + encodeURIComponent(body.params) + '&encSecKey=' + encodeURIComponent(body.encSecKey)
      });
      let json = null;
      try { json = await resp.json(); } catch (e) { json = { __parseError: String(e) }; }
      return { status: resp.status, json, ms: Date.now() - t0, path: pathname };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  const err = new Error('网络不可用：' + (lastErr && lastErr.message));
  err.network = true;
  throw err;
}

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fails.push(name + (extra ? ' -> ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}
const section = (t) => console.log('\n[' + t + ']');

(async () => {
  section('0. 登录态');
  console.log('  文件: ' + SESSION_PATH + '（导出时间 ' + (session.exportedAt || '?') + '）');
  console.log('  cookie 项: ' + Object.keys(cookies).join(', '));

  section('1. 账号身份');
  const acct = await api('/api/w/nuser/account/get', {});
  const profile = acct.json && (acct.json.profile || (acct.json.account && acct.json.profile));
  ok('account/get 200', acct.json && acct.json.code === 200, 'code=' + (acct.json && acct.json.code));
  if (profile) console.log('  登录账号: ' + profile.nickname + '（uid ' + profile.userId + '，VIP ' + (profile.vipType || 0) + '）');
  ok('拿到用户资料', !!profile);

  section('2. 取链能力（登录 vs 匿名，用真实热歌榜曲目）');
  /* 186016「晴天」是 st=-200（无版权）这种样本没有意义，改成动态取热歌榜前 3 首 */
  let SONG = Number(SONG_ARG || 0);
  if (!SONG) {
    const hot = await api('/api/v6/playlist/detail', { id: 3778678, n: 1000, s: 8 });
    SONG = (hot.json && hot.json.playlist && hot.json.playlist.trackIds && hot.json.playlist.trackIds[0] && hot.json.playlist.trackIds[0].id) || 0;
  }
  const detail = await api('/api/v3/song/detail', { c: JSON.stringify([{ id: SONG }]), ids: JSON.stringify([SONG]) });
  const s0 = detail.json && detail.json.songs && detail.json.songs[0];
  const p0 = detail.json && detail.json.privileges && detail.json.privileges[0];
  console.log('  样本曲目: ' + (s0 ? s0.name : '?') + '（id ' + SONG + '，fee=' + (s0 && s0.fee) + '，plLevel=' + (p0 && p0.plLevel) + '）');
  ok('拿到曲目详情', !!s0);
  ok('曲目没有下架（st >= 0）', !!(p0 && Number(p0.st) >= 0), 'st=' + (p0 && p0.st));

  const levels = ['jymaster', 'hires', 'lossless', 'exhigh'];
  const got = {};
  for (const level of levels) {
    const dl = await api('/api/song/enhance/download/url/v1', { id: SONG, level, encodeType: 'mp3' });
    const d = dl.json && (Array.isArray(dl.json.data) ? dl.json.data[0] : dl.json.data);
    const pl = await api('/api/song/enhance/player/url/v1', { ids: JSON.stringify([SONG]), level, encodeType: 'mp3' });
    const d2 = pl.json && pl.json.data && pl.json.data[0];
    const any = (d && d.url) ? d : (d2 && d2.url ? d2 : null);
    got[level] = any ? any.level : null;
    ok(
      level + '：至少一路有地址',
      !!any,
      '①=' + (d && d.url ? (d.level + ' ' + (Math.round(d.size / 1024 / 1024 * 10) / 10) + 'MB') : '空') +
      ' ②=' + (d2 && d2.url ? (d2.level + ' ' + (Math.round(d2.size / 1024 / 1024 * 10) / 10) + 'MB') : '空')
    );
  }
  ok(
    '请求无损时实际拿到无损或更高',
    got.lossless === 'lossless' || got.lossless === 'hires' || got.lossless === 'jymaster',
    '实际=' + got.lossless
  );
  console.log('  各档实际返回: ' + levels.map((l) => l + '→' + (got[l] || '无')).join('  '));

  section('3. 我的云盘（读）');
  const cloud = await api('/api/v1/cloud/get', { limit: 20, offset: 0 });
  const n = cloud.json && cloud.json.count;
  ok('cloud/get 200', cloud.json && cloud.json.code === 200, 'code=' + (cloud.json && cloud.json.code));
  ok('拿到云盘数量', typeof n === 'number', '共 ' + n + ' 首');
  const items = (cloud.json && cloud.json.data) || [];
  if (items.length) {
    console.log('  前 3 首：');
    items.slice(0, 3).forEach((it) => console.log('    · ' + it.songName + ' — ' + it.artist + '（' + Math.round(it.fileSize / 1024 / 1024 * 10) / 10 + 'MB）'));
  }

  section('4. 快传检查（只读：不 import、不 match）');
  const first = items[0];
  if (first && first.md5) {
    const check = await api('/api/cloud/upload/check/v2', {
      uploadType: 0,
      songs: JSON.stringify([{ md5: first.md5, songId: first.songId, bitrate: first.bitrate || 320, fileSize: first.fileSize || 1 }])
    });
    ok('check 接口可用', check.json && typeof check.json.code === 'number', 'code=' + (check.json && check.json.code) + ' data=' + JSON.stringify(check.json && check.json.data).slice(0, 80));
  } else {
    console.log('  （云盘里没有带 md5 的样本，跳过；不影响结论）');
  }

  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'logs', 'loggedin-probe.json'),
    JSON.stringify({ at: new Date().toISOString(), song: SONG, profile: profile ? { nickname: profile.nickname, userId: profile.userId, vipType: profile.vipType } : null, cloudCount: n, pass, fails }, null, 2),
    'utf8'
  );
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('登录后只读探测全部通过');
})().catch((e) => {
  if (e && e.network) {
    console.error('⚠️ ' + e.message);
    console.error('   这是网络问题，不是代码结论失败；稍后重跑即可（python scripts\\02-verify.py 会自动重试一次）');
    process.exit(3);           /* 3 = 跳过（环境问题） */
  }
  console.error('探测异常: ' + (e && e.stack || e));
  process.exit(1);
});

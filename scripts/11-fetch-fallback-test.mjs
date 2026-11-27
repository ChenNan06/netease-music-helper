/**
 * 11-fetch-fallback-test.mjs —— 专门测"脚本管理器把 CDN 请求拦了"这条现实路径
 *
 * 背景（用户第一版实测）：GM_xmlhttpRequest 打 p2/m704.music.126.net 全部失败，
 * 旧代码只报 `unknown`，整单直接失败。v1.0.1 改成三通道 + 直链降级，本脚本就是它的回归。
 *
 * 覆盖：
 *   ① GM 失败 → 页面 fetch 成功（应走 fetch 通道，能拿到字节）
 *   ② GM 失败 + fetch 失败 → 匿名 GM 成功
 *   ③ 三通道全失败 → 返回 ok:false，且 attempts 里带得出每通道的真实原因
 *   ④ 三通道全失败 + 开了"写标签" → 降级为直链下载（ok:true / degraded:true / audioVia=anchor）
 *   ⑤ 错误信息必须包含管理器给的原因（不再是 "unknown"）
 *
 * 用法：node scripts/11-fetch-fallback-test.mjs
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

/* ============================ 全局桩 ============================ */

const RAW_SONG = {
  id: 3461158955, name: '侵略', alia: [], fee: 0, no: 1, cd: '',
  ar: [{ id: 1, name: '某歌手' }],
  al: { id: 2, name: '某专辑', picUrl: 'https://p2.music.126.net/x.jpg', publishTime: 0 },
  dt: 200000
};
const RAW_PRIV = { id: 3461158955, fee: 0, pl: 320000, dl: 0, plLevel: 'exhigh', dlLevel: 'none', cs: false, st: 0 };

/** 模拟"媒体请求被拦"：music.163.com 的 weapi 正常，*.126.net 的媒体请求按策略失败 */
function makeGm(strategy) {
  return (o) => {
    const isMedia = /music\.126\.net|nos\.netease/.test(o.url);
    const isApi = /music\.163\.com\/weapi/.test(o.url);
    setTimeout(() => {
      if (isApi) {
        let json = { code: 200, data: [] };
        if (/v3\/song\/detail/.test(o.url)) json = { code: 200, songs: [RAW_SONG], privileges: [RAW_PRIV] };
        else if (/enhance\/player\/url/.test(o.url)) {
          json = { code: 200, data: [{ id: RAW_SONG.id, url: 'https://m801.music.126.net/a/b/song.mp3', level: 'exhigh', size: 300000, md5: 'md5x', br: 320000, type: 'mp3' }] };
        } else if (/enhance\/download\/url/.test(o.url)) json = { code: 200, data: { url: null } };
        else if (/song\/lyric/.test(o.url)) json = { code: 200, lrc: { lyric: '[00:01.00]x' } };
        const out = { status: 200, finalUrl: o.url, responseURL: o.url, responseHeaders: '' };
        out.responseText = JSON.stringify(json);
        out.response = json;
        return o.onload(out);
      }
      if (isMedia) {
        if (strategy.media === 'gm-ok' && !o.anonymous) {
          const out = { status: 200, finalUrl: o.url, responseHeaders: '', response: new Uint8Array([0xff, 0xfb, 0x90, 0, 1, 2, 3, 4]).buffer };
          return o.onload(out);
        }
        if (strategy.media === 'anon-ok' && o.anonymous) {
          const out = { status: 200, finalUrl: o.url, responseHeaders: '', response: new Uint8Array([0xff, 0xfb, 0x90, 0, 1, 2, 3]).buffer };
          return o.onload(out);
        }
        return o.onerror({ error: 'not whitelisted', errorText: 'domain is not in @connect', status: 0 });
      }
      return o.onload({ status: 200, responseText: '{}', response: {} });
    }, 0);
  };
}

async function boot(strategy) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><title>t</title></head><body>
      <div class="m-playbar"><div class="words"><div class="name"><a href="/song?id=${RAW_SONG.id}">侵略</a></div></div></div>
     </body></html>`,
    { url: 'https://music.163.com/song?id=' + RAW_SONG.id, runScripts: 'outside-only', pretendToBeVisual: true }
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
  window.GM_xmlhttpRequest = makeGm(strategy);
  window.GM_download = (o) => setTimeout(() => {
    if (strategy.gmDownload === 'ok') o.onload && o.onload({});
    else o.onerror && o.onerror({ error: 'download blocked' });
  }, 0);
  /* 页面内 fetch：按策略决定能不能拿到字节 */
  window.fetch = async (url) => {
    if (strategy.fetch === 'ok') {
      const body = Uint8Array.from([0xff, 0xfb, 0x90, 0, 9, 9, 9]);
      return {
        ok: true,
        status: 200,
        url: String(url),
        arrayBuffer: async () => body.buffer,
        text: async () => '{}',
        headers: { get: () => null }
      };
    }
    if (strategy.fetch === 'cors') throw new TypeError('Failed to fetch');
    throw new Error('模拟 fetch 被拦');
  };
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();

  window.eval(fs.readFileSync(BUILD, 'utf8'));
  const K = window.__NCMH_KERNEL__;
  const I = K.internals;
  if (!I.Store.settings) I.Store.load();
  return { dom, window, K, I, shadow: () => window.document.getElementById('ncmh-host').shadowRoot };
}

/* ============================ 断言 ============================ */

let pass = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  [PASS] ' + n + (x ? '  (' + x + ')' : '')); } else { fails.push(n + (x ? ' -> ' + x : '')); console.log('  [FAIL] ' + n + (x ? '  -> ' + x : '')); } };
const section = (t) => console.log('\n[' + t + ']');

const MEDIA = 'https://m801.music.126.net/a/b/song.mp3';

/* ---------- ① GM 被拦，fetch 能拿 ---------- */
section('1. GM 被 @connect 拦 → 自动走页面 fetch');
{
  const { dom, I, window } = await boot({ media: 'fail', fetch: 'ok' });
  const r = await I.fetchBinary(MEDIA);
  ok('拿到字节', !!(r.ok && r.bytes && r.size > 0), 'size=' + r.size);
  ok('通道标记为 fetch', r.via === 'fetch', 'via=' + r.via);
  ok('attempts 里能看到 GM 失败原因', (r.attempts || []).some((a) => /not whitelisted|@connect/.test(a)), (r.attempts || [])[0]);
  dom.window.close();
}

/* ---------- ② GM 与 fetch 都失败，匿名 GM 能拿 ---------- */
section('2. GM 与 fetch 都失败 → 退到匿名 GM');
{
  const { dom, I } = await boot({ media: 'anon-ok', fetch: 'cors' });
  const r = await I.fetchBinary(MEDIA);
  ok('拿到字节', !!(r.ok && r.size > 0), 'size=' + r.size);
  ok('通道标记为 GM-anon', r.via === 'GM-anon', 'via=' + r.via);
  ok('记录了两条失败通道', (r.attempts || []).length >= 2, (r.attempts || []).join(' | ').slice(0, 90));
  dom.window.close();
}

/* ---------- ③ 三条全失败 ---------- */
section('3. 三条通道全失败 → 结构化失败（不是抛异常）');
{
  const { dom, I } = await boot({ media: 'fail', fetch: 'cors' });
  const r = await I.fetchBinary(MEDIA);
  ok('ok=false', r.ok === false);
  ok('bytes 为空', !r.bytes || r.size === 0);
  ok('三条通道都有记录', (r.attempts || []).length === 3, (r.attempts || []).length + ' 条');
  const all = (r.attempts || []).join(' | ');
  ok('原因里含管理器原文', /not whitelisted|@connect/.test(all), all.slice(0, 100));
  ok('原因里不再只有 unknown', !/^unknown$/.test(all) && all.length > 20);
  dom.window.close();
}

/* ---------- ④ 降级：三通道全失败但整单不失败 ---------- */
section('4. 取字节全失败时，下载要降级成功（不写标签）');
{
  const { dom, I, K, window } = await boot({ media: 'fail', fetch: 'cors', gmDownload: 'fail' });
  const song = K.normalizeSong(RAW_SONG, RAW_PRIV);
  I.Store.save({ applyTag: true, lyricSidecar: false, coverSidecar: false, methods: { download: false, player: true, outer: false } });
  const r = await I.downloadSong(song);
  ok('整单仍算成功', r.ok === true, 'reason=' + (r.reason || ''));
  ok('标记为降级', r.degraded === true);
  ok('记录走的是直链通道', r.audioVia === 'anchor', 'audioVia=' + r.audioVia);
  ok('给出了可读原因', /直链|未写标签|取字节/.test(r.reason || ''), r.reason);
  dom.window.close();
}

/* ---------- ⑤ 正常情况：GM 可用 → 走 GM（不受新逻辑影响） ---------- */
section('5. GM 可用时仍走 GM 首通道（无回归）');
{
  const { dom, I } = await boot({ media: 'gm-ok', fetch: 'cors' });
  const r = await I.fetchBinary(MEDIA);
  ok('通道=GM', r.via === 'GM', 'via=' + r.via);
  ok('只尝试了一次', (r.attempts || []).length === 0);
  dom.window.close();
}

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('取字节降级链全部通过');
process.exit(0);

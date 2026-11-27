/**
 * 04-net-probe.mjs —— 真实接口探测：确认每个接口/取链方法在当前网络与匿名态下的实际表现
 *
 * 用法：node scripts/04-net-probe.mjs
 * 产物：logs/net-probe.json（机器可读）+ 控制台报表
 *
 * 说明：本脚本只读，不写云端数据（不调用任何 import / del / manipulate 接口）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/* ---------- 载入内核（复用构建产物里的纯函数） ---------- */
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
    GM_info: undefined, GM_getValue: undefined, GM_setValue: undefined,
    GM_xmlhttpRequest: undefined, GM_download: undefined, GM_registerMenuCommand: undefined, GM_addStyle: undefined,
    unsafeWindow: undefined
  };
  ctx.window = ctx; ctx.self = ctx; ctx.top = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(BUILD, 'utf8'), ctx, { filename: 'kernel.js' });
  return ctx.__NCMH_KERNEL__;
}

const K = loadKernel();

/* ---------- 请求封装 ---------- */
async function weapi(pathname, data) {
  const body = await K.weapiBody(Object.assign({ csrf_token: '' }, data || {}));
  const url = 'https://music.163.com' + pathname.replace('/api/', '/weapi/') + '?csrf_token=';
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: 'https://music.163.com/' },
    body: 'params=' + encodeURIComponent(body.params) + '&encSecKey=' + encodeURIComponent(body.encSecKey)
  });
  let json = null;
  try { json = await resp.json(); } catch (e) { json = { __parseError: String(e) }; }
  return { status: resp.status, json, ms: Date.now() - t0, path: pathname };
}

const results = [];
function record(name, r, verdict, detail) {
  results.push({ name, path: r && r.path, status: r && r.status, code: r && r.json && r.json.code, ms: r && r.ms, verdict, detail: detail || null });
  console.log(`  ${verdict}  ${name.padEnd(28)} HTTP ${r ? r.status : '-'}  code=${r && r.json ? r.json.code : '-'}  ${r ? r.ms + 'ms' : ''}`);
}

const main = async () => {
  console.log('=== 1. 基础接口 ===');
  const detail = await weapi('/api/v3/song/detail', { c: JSON.stringify([{ id: 186016 }]), ids: JSON.stringify([186016]) });
  const song = detail.json && detail.json.songs && detail.json.songs[0];
  record('歌曲详情', detail, song ? 'OK' : 'FAIL', song ? { id: song.id, name: song.name, fee: song.fee, albumId: song.al && song.al.id } : null);

  const lyric = await weapi('/api/song/lyric/v1', { id: 186016, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 });
  record('歌词', lyric, lyric.json && lyric.json.lrc && lyric.json.lrc.lyric ? 'OK' : 'FAIL',
    lyric.json && lyric.json.lrc ? { lines: lyric.json.lrc.lyric.split('\n').length, hasTrans: !!(lyric.json.tlyric && lyric.json.tlyric.lyric) } : null);

  const search = await weapi('/api/cloudsearch/get/web', { s: '晴天 周杰伦', type: 1, limit: 5, offset: 0 });
  const hits = (search.json && search.json.result && (search.json.result.songs || [])) || [];
  record('搜索(cloudsearch)', search, hits.length ? 'OK' : 'FAIL', { hits: hits.length, code: search.json && search.json.code });
  const search2 = await weapi('/api/search/get/web', { s: '晴天 周杰伦', type: 1, limit: 5, offset: 0 });
  const hits2 = (search2.json && search2.json.result && (search2.json.result.songs || [])) || [];
  record('搜索(legacy)', search2, hits2.length ? 'OK' : 'FAIL', { hits: hits2.length, code: search2.json && search2.json.code, first: hits2[0] && hits2[0].name });

  const albumId = song && song.al && song.al.id;
  if (albumId) {
    const album = await weapi('/api/v1/album/' + albumId, {});
    record('专辑', album, album.json && album.json.songs ? 'OK' : 'FAIL', { songs: (album.json && album.json.songs || []).length });
  }

  const playlist = await weapi('/api/v6/playlist/detail', { id: 3778678, n: 100000, s: 8 });
  const pl = playlist.json && playlist.json.playlist;
  record('歌单详情', playlist, pl ? 'OK' : 'FAIL', pl ? { name: pl.name, trackIds: (pl.trackIds || []).length, hasTracks: (pl.tracks || []).length } : null);

  const artist = await weapi('/api/v2/artist/songs', { id: 6452, private_cloud: true, work_type: 1, order: 'hot', offset: 0, limit: 20 });
  record('歌手歌曲', artist, artist.json && artist.json.songs ? 'OK' : 'FAIL', { songs: (artist.json && artist.json.songs || []).length, more: artist.json && artist.json.more });

  console.log('\n=== 2. 三路取链（匿名态，逐音质） ===');
  /* 先找一首"免费且有音源"的歌：没有免费歌时，取链必然空，无法说明实现是否正确 */
  let freeSong = null;
  const scanPlaylists = [2884035, 19723756, 3778678, 3779629];
  for (const pid of scanPlaylists) {
    if (freeSong) break;
    const pl2 = await weapi('/api/v6/playlist/detail', { id: pid, n: 60, s: 8 });
    const ids = ((pl2.json && pl2.json.playlist && pl2.json.playlist.trackIds) || []).slice(0, 120).map((t) => t.id);
    if (!ids.length) continue;
    const det = await weapi('/api/v3/song/detail', { c: JSON.stringify(ids.map((id) => ({ id }))), ids: JSON.stringify(ids) });
    const songs = (det.json && det.json.songs) || [];
    const prives = (det.json && det.json.privileges) || [];
    for (let i = 0; i < songs.length; i++) {
      const p = prives.find((x) => x.id === songs[i].id);
      if (songs[i].fee === 0 && p && p.plLevel && p.plLevel !== 'none') {
        freeSong = { id: songs[i].id, name: songs[i].name, fee: songs[i].fee, plLevel: p.plLevel, dlLevel: p.dlLevel, playlist: pid };
        break;
      }
    }
    console.log(`  扫描歌单 ${pid}：${ids.length} 首，找到免费样本：${freeSong ? freeSong.name : '无'}`);
  }
  console.log('  免费样本: ' + (freeSong ? `${freeSong.name} (id=${freeSong.id}, plLevel=${freeSong.plLevel})` : '未找到'));

  const targetId = freeSong ? freeSong.id : 186016;
  const levels = ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'];
  const chainRows = [];
  for (const level of levels) {
    const dl = await weapi('/api/song/enhance/download/url/v1', { id: targetId, level, encodeType: 'mp3' });
    const d1 = dl.json && (Array.isArray(dl.json.data) ? dl.json.data[0] : dl.json.data);
    const p1 = await weapi('/api/song/enhance/player/url/v1', { ids: JSON.stringify([targetId]), level, encodeType: 'mp3' });
    const d2 = p1.json && p1.json.data && p1.json.data[0];
    chainRows.push({
      level,
      download: { code: dl.json && dl.json.code, hasUrl: !!(d1 && d1.url), actualLevel: d1 && d1.level, size: d1 && d1.size, md5: d1 && d1.md5 },
      player: { code: p1.json && p1.json.code, hasUrl: !!(d2 && d2.url), actualLevel: d2 && d2.level, size: d2 && d2.size, md5: d2 && d2.md5 }
    });
    console.log(`  ${level.padEnd(9)} download:${d1 && d1.url ? '有地址' : '无'}(${d1 && d1.level || '-'})  player:${d2 && d2.url ? '有地址' : '无'}(${d2 && d2.level || '-'})`);
  }

  console.log('\n=== 3. 外链直取（跟随 302） ===');
  let outer = null;
  try {
    const resp = await fetch('https://music.163.com/song/media/outer/url?id=' + targetId + '.mp3', {
      method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow'
    });
    outer = { status: resp.status, finalUrl: resp.url, contentType: resp.headers.get('content-type'), length: resp.headers.get('content-length') };
    console.log(`  外链 HTTP ${resp.status} -> ${resp.url.slice(0, 100)}  ${outer.contentType || ''} ${outer.length || ''}`);
  } catch (e) {
    outer = { error: String(e) };
    console.log('  外链失败: ' + e.message);
  }

  console.log('\n=== 4. 云盘接口（匿名态预期未登录） ===');
  const cloud = await weapi('/api/v1/cloud/get', { limit: 10, offset: 0 });
  record('我的云盘', cloud, cloud.json && cloud.json.code === 200 ? 'OK' : 'NEED_LOGIN', { count: cloud.json && cloud.json.count });

  const check = await weapi('/api/cloud/upload/check/v2', { uploadType: 0, songs: JSON.stringify([{ md5: 'x', songId: 186016, bitrate: 320, fileSize: 1 }]) });
  record('快传检查', check, 'INFO', { code: check.json && check.json.code, msg: check.json && (check.json.msg || check.json.message) });

  console.log('\n=== 5. 汇总 ===');
  const okCount = results.filter((r) => r.verdict === 'OK').length;
  console.log(`  接口 OK ${okCount} / ${results.length}`);
  const usableMethods = [];
  if (chainRows.some((r) => r.download.hasUrl)) usableMethods.push('download');
  if (chainRows.some((r) => r.player.hasUrl)) usableMethods.push('player');
  if (outer && outer.status && outer.finalUrl && /music\.126\.net/.test(outer.finalUrl)) usableMethods.push('outer');
  console.log('  匿名态可用取链方法：' + (usableMethods.join(' / ') || '无（需要登录）'));

  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'logs', 'net-probe.json'),
    JSON.stringify({ at: new Date().toISOString(), results, chainRows, outer, usableMethods }, null, 2),
    'utf8'
  );
  console.log('\n  明细已写入 logs/net-probe.json');
};

main().catch((e) => {
  console.error('探测失败: ' + (e && e.stack || e));
  process.exit(1);
});

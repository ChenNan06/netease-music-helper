/**
 * 03-unit-test.mjs —— 内核纯函数单元测试 +（可选）真实接口连通性验证
 *
 * 用法：node scripts/03-unit-test.mjs [--net]
 *   --net  额外跑一次真实 weapi 请求，验证加密实现对服务器有效
 *
 * 覆盖：文件名/目录、音质链、RSA 解析、AES 往返、weapi 结构、
 *       ID3v2.4 写入回读、LRC 解析合并、音频格式识别、列表导出、真实握手。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const BUILD = path.join(ROOT, 'build', 'ncm-toolkit.user.js');
const NET = process.argv.includes('--net');

if (!fs.existsSync(BUILD)) {
  console.error('缺少构建产物，请先运行: python scripts/01-build.py');
  process.exit(2);
}

/* ============================ 最小 DOM 桩 ============================ */

function makeEl() {
  return {
    style: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    insertAdjacentElement() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    getAttribute: () => null,
    remove() {},
    attachShadow: () => makeShadow(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    click() {}
  };
}
function makeShadow() {
  return { appendChild() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
}

const localStorageStub = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size; }
  };
})();

const documentStub = {
  readyState: 'loading',
  cookie: '',
  documentElement: { appendChild() {}, classList: { contains: () => false }, setAttribute() {}, getAttribute: () => null },
  body: { appendChild() {}, classList: { contains: () => false } },
  head: { appendChild() {} },
  createElement: () => makeEl(),
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  execCommand: () => false
};

const context = {
  console,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  atob,
  btoa,
  Promise,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  Blob: class Blob { constructor(parts) { this.parts = parts; } },
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
  fetch: () => Promise.reject(new Error('stub')),
  navigator: { clipboard: { writeText: async () => {} } },
  location: { href: 'https://music.163.com/song?id=1', hash: '', pathname: '/song' },
  localStorage: localStorageStub,
  MutationObserver: class { observe() {} disconnect() {} },
  document: documentStub,
  GM_info: undefined,
  GM_getValue: undefined,
  GM_setValue: undefined,
  GM_xmlhttpRequest: undefined,
  GM_download: undefined,
  GM_registerMenuCommand: undefined,
  GM_addStyle: undefined,
  unsafeWindow: undefined
};
context.window = context;
context.self = context;
context.top = context;
context.globalThis = context;
vm.createContext(context);

vm.runInContext(fs.readFileSync(BUILD, 'utf8'), context, { filename: 'ncm-toolkit.user.js' });

const K = context.__NCMH_KERNEL__;
if (!K) {
  console.error('内核导出缺失：__NCMH_KERNEL__ 未定义');
  process.exit(2);
}

/* ============================ 断言工具 ============================ */

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fails.push(name + (extra ? '  ->  ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? '  ->  ' + extra : '')); }
}
function eq(name, actual, expect) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expect), 'actual=' + JSON.stringify(actual) + ' expect=' + JSON.stringify(expect));
}
const section = (t) => console.log('\n[' + t + ']');

/* ============================ 1. 文件名 ============================ */

section('文件名与目录');
eq('非法字符替换', K.sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a／b／c d e f g h i j');
eq('保留中文', K.sanitizeFilename('周杰伦 - 晴天'), '周杰伦 - 晴天');
eq('去掉尾部点与空格', K.sanitizeFilename('abc.  '), 'abc');
eq('设备名加前缀', K.sanitizeFilename('CON'), '_CON');
eq('空值兜底', K.sanitizeFilename(''), 'unnamed');

const song = {
  id: 186016,
  name: '晴天',
  alias: ['Live'],
  artists: [{ id: 6452, name: '周杰伦' }],
  album: { id: 1, name: '叶惠美', picUrl: '', publishTime: 0 },
  no: 3,
  cd: '',
  duration: 269000,
  privilege: { plLevel: 'lossless', dlLevel: 'lossless', cs: false }
};
eq('模板 {artist} - {title}', K.buildFileName(song, { template: '{artist} - {title}' }), '周杰伦 - 晴天');
eq('模板 {title} - {artist}', K.buildFileName(song, { template: '{title} - {artist}' }), '晴天 - 周杰伦');
eq('模板带序号', K.buildFileName(song, { template: '{index}. {title}', index: 3 }), '3. 晴天');
eq('目录=歌手', K.buildFolder(song, 'artist'), '周杰伦/');
eq('目录=歌手/专辑', K.buildFolder(song, 'artist-album'), '周杰伦/叶惠美/');
eq('目录=无', K.buildFolder(song, 'none'), '');

/* ============================ 2. 音质链 ============================ */

section('音质降级链');
eq('hires 起降档', K.levelChain('hires', true), ['hires', 'lossless', 'exhigh', 'higher', 'standard']);
eq('关闭降档', K.levelChain('hires', false), ['hires']);
eq('jymaster 全链长度', K.levelChain('jymaster', true).length, 9);
ok('权重单调', K.weightOf('jymaster') > K.weightOf('lossless') && K.weightOf('lossless') > K.weightOf('standard'));
eq('音质中文名', K.pickLevelLabel('jymaster'), '超清母带');

/* ============================ 3. RSA ============================ */

section('RSA 公钥解析');
const PEM = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clF',
  'Ss6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldcz',
  'hC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB',
  '-----END PUBLIC KEY-----'
].join('\n');
let key = null;
try {
  key = K.parseRsaPublicKey(K.pemToDer(PEM));
} catch (e) {
  key = null;
  ok('解析公钥', false, e.message);
}
if (key) {
  ok('解析公钥成功', true);
  eq('模长 1024 位', key.n.toString(2).length, 1024);
  eq('指数 65537', key.e.toString(), '65537');
}
const hex = K.rsaEncryptHex(new TextEncoder().encode('abcdefghijklmnop'));
eq('encSecKey 长度 256 位十六进制', hex.length, 256);
ok('encSecKey 为合法十六进制', /^[0-9a-f]{256}$/.test(hex));
ok('encSecKey 非全零', /[1-9a-f]/.test(hex));

/* ============================ 4. AES 往返 ============================ */

section('AES-CBC 往返');
const b64 = await K.aesCbcB64('{"hello":"世界"}', K.PRESET_KEY);
ok('密文为 base64', /^[A-Za-z0-9+/]+=*$/.test(b64));
const keyObj = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(K.PRESET_KEY), { name: 'AES-CBC' }, false, ['decrypt']);
const plainBuf = await webcrypto.subtle.decrypt(
  { name: 'AES-CBC', iv: new TextEncoder().encode(K.IV) },
  keyObj,
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
);
eq('解密回原文', new TextDecoder().decode(plainBuf), '{"hello":"世界"}');

/* ============================ 5. weapi 结构 ============================ */

section('weapi 请求体');
const body = await K.weapiBody({ id: 186016, level: 'lossless' });
ok('params 存在且可解码', typeof body.params === 'string' && atob(body.params).length > 0);
ok('encSecKey 256 位', body.encSecKey.length === 256);
ok('encSecKey 每次不同（随机密钥）', body.encSecKey !== (await K.weapiBody({ id: 1 })).encSecKey);
const secret = K.randomSecretKey();
eq('随机密钥长度 16', secret.length, 16);
ok('随机密钥字符集合法', /^[0-9a-zA-Z]{16}$/.test(secret));

/* ============================ 6. ID3 ============================ */

section('ID3v2.4 标签');
const coverBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const tag = K.buildId3Tag({
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  albumArtist: '周杰伦',
  track: '3',
  year: '2003',
  cover: { bytes: coverBytes, mime: 'image/jpeg' },
  lyric: '[00:01.00]故事的小黄花'
});
ok('生成标签非空', !!tag && tag.length > 100);
const asText = Buffer.from(tag).toString('latin1');
eq('头部 ID3 版本 4', asText.slice(0, 4), 'ID3\x04');
ok('含 TIT2', asText.indexOf('TIT2') > 0);
ok('含 TPE1', asText.indexOf('TPE1') > 0);
ok('含 TALB', asText.indexOf('TALB') > 0);
ok('含 TRCK', asText.indexOf('TRCK') > 0);
ok('含 APIC', asText.indexOf('APIC') > 0);
ok('含 USLT', asText.indexOf('USLT') > 0);
ok('含 UTF-8 中文标题', Buffer.from(tag).includes(Buffer.from('晴天', 'utf8')));
ok('含封面 MIME', asText.indexOf('image/jpeg') > 0);
const declared = (tag[6] & 0x7f) << 21 | (tag[7] & 0x7f) << 14 | (tag[8] & 0x7f) << 7 | (tag[9] & 0x7f);
eq('syncsafe 声明长度与实际一致', declared, tag.length - 10);

const fakeAudio = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
const withTag = Uint8Array.from([...tag, ...fakeAudio]);
const stripped = K.stripId3(withTag);
eq('stripId3 能还原原音频', Array.from(stripped), Array.from(fakeAudio));

/* ============================ 7. LRC ============================ */

section('LRC 解析与合并');
const lrc = ['[ti:晴天]', '[ar:周杰伦]', '[00:01.00]故事的小黄花', '[00:05.500]从出生那年就飘着', '[00:10.20]'].join('\n');
const parsed = K.parseLrc(lrc);
eq('解析行数（去掉元信息行）', parsed.filter((l) => l.time >= 0).length, 3);
const first = parsed.find((l) => l.time >= 0);
eq('时间换算', first.time, 1);
eq('内容提取', first.content, '故事的小黄花');
ok('小数位处理 05.500', parsed.some((l) => l.time === 5.5));

const trans = ['[00:01.00]The little yellow flower', '[00:05.50]飘落自出生那年'].join('\n');
const merged = K.mergeLyric(lrc, trans, ' / ');
ok('保留原行', merged.includes('故事的小黄花'));
ok('合并译文', merged.includes('The little yellow flower'));
ok('译文接在同行', /\[00:01\.00\]故事的小黄花 \/ The little yellow flower/.test(merged));
ok('保留元信息头', merged.includes('[ti:晴天]'));
const plain = K.lyricToPlain(merged);
ok('纯文本去时间戳', !plain.includes('[00:01'));
ok('纯文本含内容', plain.includes('故事的小黄花'));

/* ============================ 8. 音频格式 ============================ */

section('音频格式识别');
eq('FLAC', K.detectAudioFormat(Uint8Array.from([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0x22, 1, 2, 3, 4])), 'flac');
eq('MP3（无 ID3）', K.detectAudioFormat(Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8])), 'mp3');
eq('MP3（带 ID3）', K.detectAudioFormat(Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0, 1, 2])), 'mp3');
eq('M4A', K.detectAudioFormat(Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])), 'm4a');
eq('WAV', K.detectAudioFormat(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])), 'wav');
eq('未知', K.detectAudioFormat(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), 'unknown');

/* ============================ 9. 列表导出 ============================ */

section('列表导出');
const list = {
  type: 'playlist',
  id: 1,
  title: '测试歌单',
  songs: [song, Object.assign({}, song, { id: 2, name: '七里香', privilege: { plLevel: 'hires', cs: true } })]
};
const txt = K.buildListExport(list, 'txt');
ok('TXT 含标题', txt.text.includes('测试歌单'));
ok('TXT 含两首歌', txt.text.includes('晴天') && txt.text.includes('七里香'));
ok('TXT 标注云盘', txt.text.includes('[云盘]'));
const csv = K.buildListExport(list, 'csv');
ok('CSV 有表头', csv.text.includes('序号,歌曲ID,歌曲名'));
ok('CSV 带 BOM', csv.text.charCodeAt(0) === 0xfeff);
const json = K.buildListExport(list, 'json');
let parsedJson = null;
try { parsedJson = JSON.parse(json.text); } catch (e) { /* ignore */ }
ok('JSON 可解析', !!parsedJson);
eq('JSON 曲目数', parsedJson ? parsedJson.songs.length : -1, 2);

/* ============================ 10. 真实握手 ============================ */

if (NET) {
  section('真实接口握手（weapi）');
  try {
    const b = await K.weapiBody({ c: JSON.stringify([{ id: 186016 }]), ids: JSON.stringify([186016]) });
    const resp = await fetch('https://music.163.com/weapi/v3/song/detail?csrf_token=', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: 'https://music.163.com/'
      },
      body: 'params=' + encodeURIComponent(b.params) + '&encSecKey=' + encodeURIComponent(b.encSecKey)
    });
    const data = await resp.json();
    ok('HTTP 200', resp.status === 200, 'status=' + resp.status);
    eq('业务 code=200', data.code, 200);
    ok('返回歌曲数组', Array.isArray(data.songs) && data.songs.length > 0);
    if (data.songs && data.songs[0]) {
      ok('歌曲名为「晴天」', data.songs[0].name === '晴天', data.songs[0].name);
      ok('含艺术家信息', Array.isArray(data.songs[0].ar) && data.songs[0].ar.length > 0);
    }
    ok('加密实现被服务器接受（无 -460 / 400）', data.code !== -460 && data.code !== 400);
  } catch (e) {
    ok('真实握手', false, (e && e.message) || String(e));
  }

  section('真实歌词接口');
  try {
    const b = await K.weapiBody({ id: 186016, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 });
    const resp = await fetch('https://music.163.com/weapi/song/lyric/v1?csrf_token=', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: 'https://music.163.com/'
      },
      body: 'params=' + encodeURIComponent(b.params) + '&encSecKey=' + encodeURIComponent(b.encSecKey)
    });
    const data = await resp.json();
    eq('歌词接口 code=200', data.code, 200);
    ok('拿到 lrc 文本', !!(data.lrc && data.lrc.lyric && data.lrc.lyric.length > 20));
    ok('lrc 含时间戳', !!(data.lrc && /\[\d+:\d+/.test(data.lrc.lyric)));
  } catch (e) {
    ok('歌词接口', false, (e && e.message) || String(e));
  }
}

/* ============================ 汇总 ============================ */

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  console.log('失败明细：');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部通过');

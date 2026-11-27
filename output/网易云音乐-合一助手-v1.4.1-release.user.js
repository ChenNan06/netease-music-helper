// ==UserScript==
// @name         网易云音乐 · 合一助手
// @name:en      NetEase Music · All-in-One Toolkit
// @namespace    https://github.com/ChenNan06/ncm-toolkit
// @version      1.4.1
// @description  合并「NetEase 网易云音乐助手」与「网易云音乐:歌曲下载&转存云盘」两个脚本：悬浮面板统一入口；单曲/歌单/专辑/歌手完整列表批量下载（三路取链自动降级）、封面与歌词（可合并翻译/罗马音）、云盘快传与云盘管理、音源探测、独立设置页。不改造网易云原生界面。
// @author       Xs (合并自 RunningCheese / cinvin 的 MIT 脚本)
// @license      MIT
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjgiIGZpbGw9IiNFQzQxNDEiLz48cGF0aCBkPSJNMTAuOCA0LjJ2NS4xYTEuNiAxLjYgMCAxIDEtMS4xLTEuNXYtMy4yeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==
// @match        https://music.163.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      music.163.com
// @connect      *.music.163.com
// @connect      interface.music.163.com
// @connect      *.music.126.net
// @connect      *.126.net
// @connect      *.netease.com
// @connect      nos.netease.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/* ---------------------------------------------------------------------------
 * 本文件由 scripts/01-build.py 自动拼装，请勿直接编辑。
 * 源码分片：src/parts/*.js
 * 说明：构建不写入时间戳，同样的源码永远得到同样的字节（便于 diff 与校验哈希）。
 * ------------------------------------------------------------------------- */
/* ===== part: 10-core.js ===== */
/* ============================================================================
 * 网易云音乐 · 合一助手  (NetEase Music · All-in-One Toolkit)
 * ----------------------------------------------------------------------------
 * 合并自两个 MIT 脚本：
 *   - 「NetEase 网易云音乐助手」v2.1            by RunningCheese
 *   - 「歌曲下载&转存云盘…」v4.4.6                by cinvin
 * 本文件为全新组织：统一取链层 / 统一 UI / 统一设置，保留两边的独特能力。
 *
 * 结构（自下而上，全部装在一个 IIFE 里）：
 *   10-core     常量、工具、设置存储、weapi 加密
 *   20-api      网易云接口封装（weapi / 明文 / 音频流）
 *   30-engine   取链降级、下载、歌词、封面、云盘快传
 *   40-ui       悬浮面板（Shadow DOM，网易云配色）
 *   50-settings 独立设置页（新标签页，postMessage 双向同步）
 *   60-boot     路由监听、当前歌曲追踪、菜单、启动
 * ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
   * 10-core · 常量
   * ======================================================================== */

  const VERSION = '1.4.1';
  const LOG_PREFIX = '[NCMH]';
  const ORIGIN = 'https://music.163.com';
  /**
   * 开发期工具开关（导出登录态等"只给排错用"的入口）。
   * 构建正式版时用 `python scripts\01-build.py --release` 会把它改成 false，
   * 并把标记了 `#region dev-only` 的实现整段剥掉。
   */
  const DEV_TOOLS = false;

  /** 音质：值 -> 中文名（与网易云前端一致） */
  const LEVEL_LABEL = {
    jymaster: '超清母带',
    dolby: '杜比全景声',
    sky: '沉浸环绕声',
    jyeffect: '高清臻音',
    hires: '高解析度无损',
    lossless: '无损',
    exhigh: '极高',
    higher: '较高',
    standard: '标准',
    unknown: '未知音质',
    none: '不可播放'
  };
  /** 音质降级次序（权重由高到低） */
  const LEVEL_CHAIN = ['jymaster', 'dolby', 'sky', 'jyeffect', 'hires', 'lossless', 'exhigh', 'higher', 'standard'];
  const LEVEL_WEIGHT = {
    jymaster: 9, dolby: 8, sky: 7, jyeffect: 6, hires: 5,
    lossless: 4, exhigh: 3, higher: 2, standard: 1, none: 0
  };

  /** 取链方法标识（顺序即默认优先级） */
  const METHOD_META = {
    download: { name: '增强下载接口', path: '/api/song/enhance/download/url/v1' },
    player: { name: '试听播放接口', path: '/api/song/enhance/player/url/v1' },
    outer: { name: '外链直取', path: '/song/media/outer/url' }
  };
  const METHOD_ORDER = ['download', 'player', 'outer'];

  const STORE_SETTINGS = 'ncmh.settings.v1';
  const STORE_UI = 'ncmh.ui.v1';
  const STORE_CACHE = 'ncmh.cache.v1';

  /* weapi 加密常量（网易云前端硬编码，公开且固定） */
  const PRESET_KEY = '0CoJUm6Qyw8W8jud';
  const IV = '0102030405060708';
  const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const NET_UA_WEB =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const NET_UA_PC =
    'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.22.204707';
  const NET_UA_ANDROID =
    'NeteaseMusic/9.1.78.241009150147(9001078);Dalvik/2.1.0 (Linux; U; Android 14; V2318A Build/TP1A.220624.014)';
  const NET_COOKIE_PC = 'os=pc;appver=3.1.22.204707;channel=netease;osver=Microsoft-Windows-10-Professional-build-19045-64bit;';
  const NET_COOKIE_ANDROID = 'os=android;appver=9.1.78;channel=netease;osver=14;buildver=241009150147;';

  /* RSA 公钥：weapi 的 encSecKey 用它加密 16 字节随机密钥（原样取自网易云前端） */
  const RSA_PUBLIC_PEM = [
    '-----BEGIN PUBLIC KEY-----',
    'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clF',
    'Ss6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldcz',
    'hC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB',
    '-----END PUBLIC KEY-----'
  ].join('\n');

  /* ==========================================================================
   * 10-core · 默认设置
   * ======================================================================== */

  const DEFAULT_SETTINGS = {
    version: 1,
    /* 外观 */
    theme: 'auto',                 // auto | light | dark
    panel: {
      open: false,
      x: null,
      y: null,
      tab: 'song',
      opacity: 1
    },
    /* 下载 */
    quality: 'jymaster',
    autoDowngrade: true,           // 请求音质拿不到 url 时自动降档
    targetLevelOnly: false,        // 只接受与请求完全一致的音质
    nameTemplate: '{artist} - {title}',
    folderMode: 'none',            // none | artist | artist-album
    applyTag: true,                // mp3 写入 ID3（标题/歌手/专辑/封面/歌词）
    coverSidecar: true,            // 另存同名封面
    lyricSidecar: true,            // 另存同名歌词
    concurrent: 4,
    listPageSize: 20,              // 列表每页条数（列表页也能改，改完记住）
    skipCloudOwned: false,
    methods: { download: true, player: true, outer: true },
    requestGapMs: 120,
    retry: 1,
    /* 歌词 */
    lyricMerge: true,              // 合并翻译
    lyricRoma: false,              // 合并罗马音
    lyricFormat: 'lrc',            // lrc | txt
    /* 云盘 */
    cloud: { autoMatch: true },
    /* 网络身份 */
    identity: 'web',               // web | pc | android
    customUA: '',
    /* 诊断 */
    debug: false
  };

  /* ==========================================================================
   * 10-core · 日志与诊断
   * ======================================================================== */

  const DIAG = {
    ring: [],
    push(level, args) {
      const line = {
        t: new Date().toISOString().slice(11, 19),
        level,
        text: args.map((a) => {
          if (a instanceof Error) return a.message;
          if (typeof a === 'string') return a;
          try {
            const s = JSON.stringify(a);
            return s && s.length > 600 ? s.slice(0, 600) + '…' : String(s);
          } catch (e) {
            return String(a);
          }
        }).join(' ')
      };
      this.ring.push(line);
      if (this.ring.length > 400) this.ring.shift();
      return line;
    },
    text() {
      return this.ring.map((l) => `${l.t} ${l.level.toUpperCase()} ${l.text}`).join('\n');
    },
    clear() {
      this.ring.length = 0;
    }
  };

  function log(...args) {
    DIAG.push('info', args);
    try {
      console.log(LOG_PREFIX, ...args);
    } catch (e) { /* ignore */ }
  }
  function warn(...args) {
    DIAG.push('warn', args);
    try {
      console.warn(LOG_PREFIX, ...args);
    } catch (e) { /* ignore */ }
  }
  function logError(...args) {
    DIAG.push('error', args);
    try {
      console.error(LOG_PREFIX, ...args);
    } catch (e) { /* ignore */ }
  }

  /* ==========================================================================
   * 10-core · 通用工具
   * ======================================================================== */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function uid(prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>'"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]
    ));
  }

  function formatBytes(n) {
    n = Number(n);
    if (!n || n <= 0 || isNaN(n)) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
    return (n / 1024 ** 3).toFixed(2) + ' GB';
  }

  function formatDuration(ms) {
    if (!ms || ms <= 0) return '--:--';
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  /** Windows / macOS 通用安全文件名（保留中文） */
  function sanitizeFilename(name) {
    if (!name) return 'unnamed';
    let out = String(name)
      .replace(/[/\\]/g, '／')
      .replace(/[<>:"|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\s.]+$/, '');
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(out)) out = '_' + out;
    if (out.length > 120) out = out.slice(0, 120).trim();
    return out || 'unnamed';
  }

  /** 按模板拼文件名（不含扩展名）。占位符：{title} {artist} {album} {index} {id} {alias} */
  function buildFileName(song, opts) {
    const o = opts || {};
    const tpl = o.template || DEFAULT_SETTINGS.nameTemplate;
    const artists = (song.artists || []).map((a) => a.name).filter(Boolean).join('; ');
    const album = (song.album && song.album.name) || '';
    const alias = (song.alias || []).join(' / ');
    let s = tpl
      .replace(/\{title\}/g, song.name || '')
      .replace(/\{artist\}/g, artists || '未知歌手')
      .replace(/\{album\}/g, album)
      .replace(/\{alias\}/g, alias)
      .replace(/\{id\}/g, String(song.id || ''))
      .replace(/\{index\}/g, String(o.index == null ? '' : o.index));
    s = s.replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '');
    return sanitizeFilename(s);
  }

  /** 目录分级 */
  function buildFolder(song, mode) {
    if (!mode || mode === 'none') return '';
    const artist = sanitizeFilename((song.artists || []).map((a) => a.name).join('、') || '未知歌手');
    if (mode === 'artist') return artist + '/';
    if (mode === 'artist-album') {
      const album = sanitizeFilename((song.album && song.album.name) || '未知专辑');
      return artist + '/' + album + '/';
    }
    return '';
  }

  function pickLevelLabel(level) {
    return LEVEL_LABEL[level] || level || '未知';
  }

  function weightOf(level) {
    return LEVEL_WEIGHT[level] == null ? -1 : LEVEL_WEIGHT[level];
  }

  /** 请求音质 → 降级尝试链 */
  function levelChain(requested, allowDowngrade) {
    if (!allowDowngrade) return [requested];
    const start = LEVEL_CHAIN.indexOf(requested);
    if (start < 0) return [requested];
    return LEVEL_CHAIN.slice(start);
  }

  /**
   * 登录态：**不能**用 document.cookie 判断。
   * 实测：用户明明已登录，`document.cookie` 里却读不到 MUSIC_U（HttpOnly / 沙箱代理），
   * 于是旧实现把"已登录"误判成"未登录"，云盘与音质判断全部走错分支。
   * 现在一律以接口为准（见 20-api 的 Login），这里只读它缓存的结果。
   */
  function isLoggedIn() {
    try {
      return typeof Login !== 'undefined' && Login.isOn();
    } catch (e) {
      return false;
    }
  }

  function managerName() {
    try {
      if (typeof GM_info !== 'undefined' && GM_info && GM_info.scriptHandler) return GM_info.scriptHandler;
    } catch (e) { /* ignore */ }
    return '未知';
  }

  function getCsrfToken() {
    const m = document.cookie.match(/_csrf=([^(;|$)]+)/);
    return m ? m[1] : '';
  }

  function bytesToB64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const textEncoder = new TextEncoder();

  /* ==========================================================================
   * 10-core · 设置存储（localStorage + GM 双写，跨标签同步）
   * ======================================================================== */

  const GM_AVAILABLE = {
    getValue: typeof GM_getValue === 'function',
    setValue: typeof GM_setValue === 'function',
    xhr: typeof GM_xmlhttpRequest === 'function',
    download: typeof GM_download === 'function',
    menu: typeof GM_registerMenuCommand === 'function'
  };

  function gmGet(key, fallback) {
    if (!GM_AVAILABLE.getValue) return fallback;
    try {
      const v = GM_getValue(key, null);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function gmSet(key, value) {
    if (!GM_AVAILABLE.setValue) return;
    try {
      GM_setValue(key, value);
    } catch (e) {
      warn('GM_setValue 失败', e);
    }
  }

  function readJsonRaw(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (e) {
      warn('读取本地设置失败', key, e);
      return null;
    }
  }
  function writeJsonRaw(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) {
      warn('写入本地设置失败', key, e);
    }
  }

  function deepMerge(base, extra) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!extra || typeof extra !== 'object') return out;
    Object.keys(extra).forEach((k) => {
      const v = extra[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    });
    return out;
  }

  const settingsBus = {
    handlers: [],
    on(fn) {
      this.handlers.push(fn);
      return () => {
        const i = this.handlers.indexOf(fn);
        if (i >= 0) this.handlers.splice(i, 1);
      };
    },
    emit(settings, meta) {
      this.handlers.slice().forEach((fn) => {
        try {
          fn(settings, meta || {});
        } catch (e) {
          logError('设置监听器出错', e);
        }
      });
    }
  };

  const Store = {
    settings: null,
    ui: null,
    load() {
      let s = readJsonRaw(STORE_SETTINGS);
      if (!s) {
        const fromGm = gmGet(STORE_SETTINGS, null);
        if (fromGm) {
          try {
            s = typeof fromGm === 'string' ? JSON.parse(fromGm) : fromGm;
          } catch (e) {
            s = null;
          }
        }
      }
      this.settings = deepMerge(DEFAULT_SETTINGS, s || {});
      this.ui = deepMerge(
        { open: DEFAULT_SETTINGS.panel.open, x: null, y: null, tab: 'song', collapsed: true },
        readJsonRaw(STORE_UI) || {}
      );
      return this.settings;
    },
    save(patch, meta) {
      const next = patch ? deepMerge(this.settings, patch) : this.settings;
      this.settings = next;
      writeJsonRaw(STORE_SETTINGS, next);
      gmSet(STORE_SETTINGS, next);
      settingsBus.emit(next, meta || { source: 'panel' });
      return next;
    },
    reset() {
      this.settings = deepMerge(DEFAULT_SETTINGS, {});
      writeJsonRaw(STORE_SETTINGS, this.settings);
      gmSet(STORE_SETTINGS, this.settings);
      settingsBus.emit(this.settings, { source: 'reset' });
      return this.settings;
    },
    saveUi(patch) {
      this.ui = deepMerge(this.ui, patch || {});
      writeJsonRaw(STORE_UI, this.ui);
      return this.ui;
    }
  };

  function watchSettings() {
    window.addEventListener('storage', (ev) => {
      if (ev.key !== STORE_SETTINGS) return;
      let obj = null;
      try {
        obj = ev.newValue ? JSON.parse(ev.newValue) : null;
      } catch (e) {
        obj = null;
      }
      Store.settings = deepMerge(DEFAULT_SETTINGS, obj || {});
      settingsBus.emit(Store.settings, { source: 'storage' });
    });
  }

  /* ==========================================================================
   * 10-core · weapi 加密（WebCrypto AES-CBC + BigInt RSA，零外部依赖）
   * ======================================================================== */

  const aesKeyCache = new Map();

  function getAesKey(keyStr) {
    if (aesKeyCache.has(keyStr)) return aesKeyCache.get(keyStr);
    const p = crypto.subtle.importKey('raw', textEncoder.encode(keyStr), { name: 'AES-CBC' }, false, ['encrypt']);
    aesKeyCache.set(keyStr, p);
    return p;
  }

  async function aesCbcB64(text, keyStr) {
    const key = await getAesKey(keyStr);
    const buf = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: textEncoder.encode(IV) },
      key,
      textEncoder.encode(text)
    );
    return bytesToB64(new Uint8Array(buf));
  }

  function pemToDer(pem) {
    const b64 = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
    return b64ToBytes(b64);
  }

  /** 从 SubjectPublicKeyInfo DER 里取出 (n, e) */
  function parseRsaPublicKey(der) {
    let i = 0;
    const readLen = () => {
      let l = der[i++];
      if (l & 0x80) {
        const n = l & 0x7f;
        l = 0;
        for (let k = 0; k < n; k++) l = (l << 8) | der[i++];
      }
      return l;
    };
    const readTag = (expect) => {
      const t = der[i++];
      if (t !== expect) throw new Error('DER 结构异常: 期望 0x' + expect.toString(16) + '，实际 0x' + t.toString(16));
    };
    const readInt = () => {
      readTag(0x02);
      const len = readLen();
      let v = 0n;
      for (let k = 0; k < len; k++) v = (v << 8n) | BigInt(der[i++]);
      return v;
    };
    readTag(0x30); readLen();          // SPKI SEQUENCE
    readTag(0x30); const algLen = readLen(); i += algLen;  // AlgorithmIdentifier
    readTag(0x03); readLen(); i += 1;  // BIT STRING（跳过 unused bits）
    readTag(0x30); readLen();          // RSAPublicKey SEQUENCE
    const n = readInt();
    const e = readInt();
    return { n, e };
  }

  function modPow(base, exp, mod) {
    let result = 1n;
    let b = base % mod;
    let ee = exp;
    while (ee > 0n) {
      if (ee & 1n) result = (result * b) % mod;
      b = (b * b) % mod;
      ee >>= 1n;
    }
    return result;
  }

  let RSA_KEY = null;
  function getRsaKey() {
    if (!RSA_KEY) RSA_KEY = parseRsaPublicKey(pemToDer(RSA_PUBLIC_PEM));
    return RSA_KEY;
  }

  /** 与 forge 的 publicKey.encrypt(str, 'NONE') 等价：对大整数做裸模幂，左侧补零到 128 字节 */
  function rsaEncryptHex(bytes) {
    const { n, e } = getRsaKey();
    let m = 0n;
    for (let i = 0; i < bytes.length; i++) m = (m << 8n) | BigInt(bytes[i]);
    const c = modPow(m, e, n);
    return c.toString(16).padStart(256, '0');
  }

  function randomSecretKey() {
    const rnd = new Uint8Array(16);
    crypto.getRandomValues(rnd);
    let s = '';
    for (let i = 0; i < 16; i++) s += BASE62[rnd[i] % 62];
    return s;
  }

  /** weapi 请求体：{ params, encSecKey } */
  async function weapiBody(data) {
    const text = JSON.stringify(data || {});
    const secret = randomSecretKey();
    const inner = await aesCbcB64(text, PRESET_KEY);
    const params = await aesCbcB64(inner, secret);
    const encSecKey = rsaEncryptHex(textEncoder.encode(secret.split('').reverse().join('')));
    return { params, encSecKey };
  }

  /* 供单元测试/诊断使用的内核导出 */
  const KERNEL = {
    VERSION,
    LEVEL_LABEL,
    LEVEL_CHAIN,
    LEVEL_WEIGHT,
    DEFAULT_SETTINGS,
    METHOD_META,
    METHOD_ORDER,
    sanitizeFilename,
    buildFileName,
    buildFolder,
    levelChain,
    pickLevelLabel,
    weightOf,
    formatBytes,
    formatDuration,
    escapeHtml,
    deepMerge,
    weapiBody,
    parseRsaPublicKey,
    rsaEncryptHex,
    aesCbcB64,
    pemToDer,
    randomSecretKey,
    modPow,
    PRESET_KEY,
    IV,
    DIAG
  };

/* ===== part: 20-api.js ===== */
  /* ==========================================================================
   * 20-api · 网络请求层
   * ======================================================================== */

  let lastRequestAt = 0;

  /** 按设置的间隔排队，避免把接口打爆 */
  async function requestGate() {
    const gap = clamp(Number(Store.settings.requestGapMs) || 0, 0, 3000);
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + gap - now);
    lastRequestAt = now + wait;
    if (wait > 0) await sleep(wait);
  }

  function identityHeaders() {
    const id = Store.settings.identity || 'web';
    const ua =
      Store.settings.customUA && Store.settings.customUA.trim()
        ? Store.settings.customUA.trim()
        : id === 'pc'
          ? NET_UA_PC
          : id === 'android'
            ? NET_UA_ANDROID
            : NET_UA_WEB;
    const headers = { 'User-Agent': ua, Referer: ORIGIN + '/' };
    if (id === 'pc' || id === 'android') {
      headers.Cookie = id === 'pc' ? NET_COOKIE_PC : NET_COOKIE_ANDROID;
    }
    return headers;
  }

  /** 媒体地址统一升级到 https：http 的 CDN 地址在 https 页面里会被混合内容策略拦掉 */
  function normalizeMediaUrl(url) {
    if (!url) return url;
    if (/^http:\/\//i.test(url) && /(^|\.)(music\.126\.net|126\.net|music\.163\.com|163\.com)(:|\/)/i.test(url)) {
      return url.replace(/^http:/i, 'https:');
    }
    return url;
  }

  /**
   * 底层请求（GM_xmlhttpRequest 包装）
   * @returns {Promise<any>} responseType=json 时返回对象，否则返回 {text, bytes, finalUrl, headers}
   */
  function gmRequest(opts) {
    const o = opts || {};
    const retries = Math.max(0, Number(o.retries == null ? Store.settings.retry : o.retries) || 0);
    let attempt = 0;

    const once = () => new Promise((resolve, reject) => {
      if (!GM_AVAILABLE.xhr) {
        // 极端情况下退化到 fetch（跨域可能失败，但至少能试）
        fetch(o.url, {
          method: o.method || 'GET',
          credentials: 'include',
          headers: o.headers || {},
          body: o.data
        })
          .then(async (r) => {
            if (o.responseType === 'arraybuffer') {
              const buf = await r.arrayBuffer();
              return resolve({ status: r.status, bytes: new Uint8Array(buf), finalUrl: r.url });
            }
            const text = await r.text();
            let json = null;
            try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
            resolve({ status: r.status, statusText: r.statusText, text, json, finalUrl: r.url });
          })
          .catch(reject);
        return;
      }
      GM_xmlhttpRequest({
        method: o.method || 'GET',
        url: o.url,
        headers: o.headers || {},
        data: o.data,
        timeout: o.timeout || 30000,
        responseType: o.responseType || 'text',
        anonymous: !!o.anonymous,
        onload(res) {
          resolve(res);
        },
        onerror(res) {
          /* ⚠️ 这里必须把 error/errorText 带出来，否则排错只剩 "unknown"（用户实测踩到） */
          const detail = [
            res && res.error,
            res && res.errorText,
            res && res.status ? 'HTTP ' + res.status : null
          ].filter(Boolean).join(' / ');
          const err = new Error('网络错误: ' + (detail || '无返回（多半是 @connect 白名单或管理器拦截）'));
          err.gm = res;
          reject(err);
        },
        ontimeout() {
          reject(new Error('请求超时: ' + o.url));
        },
        onabort() {
          reject(new Error('请求被中断'));
        }
      });
    });

    const run = async () => {
      await requestGate();
      try {
        const res = await once();
        if (res.status >= 500 && attempt < retries) throw new Error('HTTP ' + res.status);
        return res;
      } catch (e) {
        if (attempt < retries) {
          attempt += 1;
          warn('请求失败，重试', attempt, o.url, e && e.message);
          await sleep(300 * attempt);
          return run();
        }
        throw e;
      }
    };
    return run();
  }

  function parseBody(res, responseType) {
    if (responseType === 'arraybuffer') {
      if (res.bytes && res.bytes.length !== undefined) return res.bytes;
      const r = res.response;
      if (!r) return null;
      if (r instanceof Uint8Array) return r;
      if (typeof ArrayBuffer !== 'undefined' && r instanceof ArrayBuffer) return new Uint8Array(r);
      try {
        return new Uint8Array(r);
      } catch (e) {
        return null;
      }
    }
    if (res.json && typeof res.json === 'object') return res.json;
    const text = res.text != null ? res.text : res.responseText;
    if (typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return { __raw: text };
    }
  }

  /**
   * weapi 调用（自动把 /api/ 映射成 /weapi/）
   * @param {string} path 例：/api/v3/song/detail
   * @param {object} data 明文参数
   */
  async function weapi(path, data, opt) {
    const o = opt || {};
    const weapiPath = path.indexOf('/weapi/') === 0 ? path : path.replace('/api/', '/weapi/');
    const body = await weapiBody(Object.assign({ csrf_token: getCsrfToken() }, data || {}));
    const url = ORIGIN + weapiPath + '?csrf_token=' + encodeURIComponent(getCsrfToken());
    const payload = 'params=' + encodeURIComponent(body.params) + '&encSecKey=' + encodeURIComponent(body.encSecKey);
    const headers = Object.assign(
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      identityHeaders()
    );
    const res = await gmRequest({
      url,
      method: 'POST',
      headers,
      data: payload,
      anonymous: !!o.anonymous,
      timeout: o.timeout,
      retries: o.retries
    });
    const json = parseBody(res, 'json');
    if (!json || typeof json !== 'object' || json.__raw != null) {
      throw new Error('接口返回异常: ' + path + ' / ' + String(res.status));
    }
    if (Store.settings.debug) log('API', path, json.code, data);
    return json;
  }

  /**
   * 取二进制（封面 / 音频）：三条通道依次尝试，任何一条成功即返回。
   * ① GM_xmlhttpRequest（需要 @connect；失败会带上管理器给的真实原因）
   * ② 页面内 fetch（网易云 CDN 实测带 `Access-Control-Allow-Origin: *`，可直接读字节）
   * ③ GM_xmlhttpRequest 匿名（去掉 cookie 再试一次）
   */
  async function fetchBinary(url, opt) {
    const o = opt || {};
    const target = normalizeMediaUrl(url);
    const attempts = [];
    const headers = Object.assign({}, identityHeaders(), o.headers || {});
    const done = (bytes, via, finalUrl) => ({
      ok: true,
      status: 200,
      bytes,
      via,
      finalUrl: finalUrl || target,
      size: bytes.length,
      attempts
    });

    /* ① GM 通道 */
    try {
      const res = await gmRequest({
        url: target,
        method: 'GET',
        responseType: 'arraybuffer',
        headers,
        timeout: o.timeout || 120000,
        retries: 0
      });
      const bytes = parseBody(res, 'arraybuffer');
      if (bytes && bytes.length) return done(bytes, 'GM', res.finalUrl || res.responseURL);
      attempts.push('GM: 空响应 HTTP ' + res.status);
    } catch (e) {
      attempts.push('GM: ' + ((e && e.message) || e));
    }

    /* ② 页面 fetch（CORS 允许时最稳，完全不经过脚本管理器的白名单） */
    try {
      const resp = await fetch(target, { credentials: 'omit', mode: 'cors', cache: 'no-store' });
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        if (buf && buf.byteLength) return done(new Uint8Array(buf), 'fetch', resp.url);
        attempts.push('fetch: 空响应');
      } else {
        attempts.push('fetch: HTTP ' + resp.status);
      }
    } catch (e) {
      attempts.push('fetch: ' + ((e && e.message) || e));
    }

    /* ③ GM 匿名通道 */
    try {
      const res = await gmRequest({
        url: target,
        method: 'GET',
        responseType: 'arraybuffer',
        headers: {},
        anonymous: true,
        timeout: o.timeout || 120000,
        retries: 0
      });
      const bytes = parseBody(res, 'arraybuffer');
      if (bytes && bytes.length) return done(bytes, 'GM-anon', res.finalUrl || res.responseURL);
      attempts.push('GM(anon): 空响应 HTTP ' + res.status);
    } catch (e) {
      attempts.push('GM(anon): ' + ((e && e.message) || e));
    }

    warn('取二进制失败', target, attempts.join(' | '));
    return { ok: false, status: 0, bytes: null, size: 0, attempts, finalUrl: target };
  }

  /** 探测资源是否存在（HEAD → Range GET → 页面 fetch，三级；任一给出 2xx/finalUrl 即算通） */
  async function probeUrl(url) {
    const target = normalizeMediaUrl(url);
    try {
      const res = await gmRequest({
        url: target,
        method: 'HEAD',
        headers: identityHeaders(),
        timeout: 15000,
        retries: 0
      });
      return { status: res.status, finalUrl: res.finalUrl || res.responseURL || target, headers: res.responseHeaders || '' };
    } catch (e) {
      /* 管理器拦了就换通道 */
    }
    try {
      const res = await gmRequest({
        url: target,
        method: 'GET',
        headers: Object.assign({ Range: 'bytes=0-1' }, identityHeaders()),
        timeout: 15000,
        retries: 0
      });
      return { status: res.status, finalUrl: res.finalUrl || res.responseURL || target, headers: res.responseHeaders || '' };
    } catch (e) {
      /* fallthrough */
    }
    try {
      const resp = await fetch(target, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow', cache: 'no-store' });
      return { status: resp.status, finalUrl: resp.url || target, headers: '' };
    } catch (e) {
      return { status: 0, finalUrl: target, headers: '' };
    }
  }

  /* ==========================================================================
   * 20-api · 业务接口
   * ======================================================================== */

  const Api = {
    /** 歌曲详情（自动分片，最多 300 首/次） */
    async songDetail(ids) {
      const list = (ids || []).map(Number).filter((n) => n > 0);
      if (!list.length) return { songs: [], privileges: [] };
      const out = { songs: [], privileges: [] };
      const chunk = 300;
      for (let i = 0; i < list.length; i += chunk) {
        const part = list.slice(i, i + chunk);
        const res = await weapi('/api/v3/song/detail', {
          ids: JSON.stringify(part),
          c: JSON.stringify(part.map((id) => ({ id })))
        });
        if (res.songs) out.songs = out.songs.concat(res.songs);
        if (res.privileges) out.privileges = out.privileges.concat(res.privileges);
      }
      return out;
    },

    /** 增强下载接口 */
    async downloadUrl(id, level) {
      const res = await weapi('/api/song/enhance/download/url/v1', { id, level, encodeType: 'mp3' });
      const d = res && res.data;
      return {
        code: res && res.code,
        data: Array.isArray(d) ? d[0] : d,
        raw: res
      };
    },

    /** 试听播放接口（可批量） */
    async playerUrl(ids, level) {
      const res = await weapi('/api/song/enhance/player/url/v1', {
        ids: JSON.stringify((ids || []).map(Number)),
        level,
        encodeType: 'mp3'
      });
      return { code: res && res.code, data: (res && res.data) || [], raw: res };
    },

    /** 歌词（含翻译/罗马音/逐字） */
    async lyric(id) {
      return weapi('/api/song/lyric/v1', {
        id,
        cp: false,
        tv: 0,
        lv: 0,
        rv: 0,
        kv: 0,
        yv: 0,
        ytv: 0,
        yrv: 0
      });
    },

    /** 歌单详情（拿到完整 trackIds） */
    async playlist(id) {
      return weapi('/api/v6/playlist/detail', { id, n: 100000, s: 8 });
    },

    /** 专辑详情 */
    async album(id) {
      return weapi('/api/v1/album/' + id, {});
    },

    /** 歌手歌曲（分页拉全） */
    async artistSongs(id, onProgress) {
      const pageSize = 200;
      let offset = 0;
      let songs = [];
      let privileges = [];
      for (let guard = 0; guard < 60; guard++) {
        const res = await weapi('/api/v2/artist/songs', {
          id,
          private_cloud: true,
          work_type: 1,
          order: 'hot',
          offset,
          limit: pageSize
        });
        const got = res.songs || [];
        songs = songs.concat(got);
        if (res.privileges) privileges = privileges.concat(res.privileges);
        if (onProgress) onProgress(songs.length, got.length);
        if (!res.more || got.length < pageSize) break;
        offset += pageSize;
      }
      return { songs, privileges };
    },

    /** 我的云盘 */
    async cloudList(offset, limit) {
      return weapi('/api/v1/cloud/get', { limit: limit || 200, offset: offset || 0 });
    },

    /** 删除云盘文件（参数名必须是 songIds 数组；实测 ids / id 都返回 400「参数错误」） */
    async cloudDelete(songIds) {
      const arr = (Array.isArray(songIds) ? songIds : [songIds]).map(Number).filter(Boolean);
      return weapi('/api/cloud/del', { songIds: arr });
    },

    /** 快传 · 第 1 步：检查服务器是否已有同 md5 资源 */
    async cloudUploadCheck(songId, md5, bitrate, fileSize) {
      return weapi('/api/cloud/upload/check/v2', {
        uploadType: 0,
        songs: JSON.stringify([{ md5, songId, bitrate, fileSize }])
      });
    },

    /** 快传 · 第 2 步：把云资源导入自己的云盘 */
    async cloudImport(cloudSongId, bitrate, meta) {
      return weapi('/api/cloud/user/song/import', {
        uploadType: 0,
        songs: JSON.stringify([
          {
            songId: cloudSongId,
            bitrate,
            song: meta.song,
            artist: meta.artist,
            album: meta.album,
            fileName: meta.fileName
          }
        ])
      });
    },

    /** 快传 · 第 3 步：把云盘文件关联到曲库歌曲 */
    async cloudMatch(cloudSongId, adjustSongId) {
      return weapi('/api/cloud/user/song/match', { songId: cloudSongId, adjustSongId });
    },

    /** 外链（302 到 CDN） */
    outerUrl(id) {
      return ORIGIN + '/song/media/outer/url?id=' + id + '.mp3';
    },

    /** 账号信息：登录态的唯一可靠判据（匿名返回 {code:200, account:null, profile:null}） */
    account() {
      return weapi('/api/w/nuser/account/get', {});
    }
  };

  /* ==========================================================================
   * 20-api · 登录态（接口判定，不碰 cookie）
   * ======================================================================== */

  const Login = {
    state: 'unknown',   // unknown | yes | no
    profile: null,
    checkedAt: 0,
    lastError: '',
    inflight: null,

    isOn() {
      return this.state === 'yes';
    },
    isKnown() {
      return this.state !== 'unknown';
    },
    label() {
      if (this.state === 'unknown') return '检测中';
      if (this.state === 'no') return '未登录';
      const n = this.profile && this.profile.nickname;
      return n ? '已登录（' + n + '）' : '已登录';
    },
    vipLabel() {
      if (!this.isOn() || !this.profile) return '';
      const t = this.profile.vipType;
      if (t === 11 || t === 1 || t === 2) return 'VIP';
      return t ? 'VIP(' + t + ')' : '';
    },

    /** 60 秒内复用结果；force 强制重查 */
    async ensure(force) {
      if (!force && this.isKnown() && Date.now() - this.checkedAt < 60000) return this.isOn();
      if (this.inflight) return this.inflight;
      this.inflight = (async () => {
        try {
          const res = await Api.account();
          if (res && res.code === 200) {
            this.profile = res.profile || null;
            this.account = res.account || null;
            this.state = this.profile && (this.profile.userId || this.profile.nickname) ? 'yes' : 'no';
          } else {
            /* 接口异常时不要武断判成"未登录"，保持原状态并把原因留档 */
            this.lastError = 'code ' + (res && res.code);
          }
        } catch (e) {
          this.lastError = (e && e.message) || '请求失败';
          warn('登录态检测失败', this.lastError);
        } finally {
          this.checkedAt = Date.now();
        }
        if (this.state !== 'unknown' && Store.settings.debug) log('登录态', this.state, this.profile && this.profile.nickname);
        return this.isOn();
      })();
      try {
        return await this.inflight;
      } finally {
        this.inflight = null;
      }
    }
  };

/* ===== part: 30-engine.js ===== */
  /* ==========================================================================
   * 30-engine · 数据规范化
   * ======================================================================== */

  function normalizeSong(raw, privilege) {
    if (!raw) return null;
    const p = privilege || raw.privilege || {};
    const al = raw.al || raw.album || {};
    const ar = raw.ar || raw.artists || [];
    return {
      id: raw.id,
      name: raw.name || raw.songName || '',
      alias: raw.alia || raw.ala || raw.tns || [],
      /* ⚠️ 保留原始对象：网页播放器的 addTo() 要的就是这种 song 结构，自己拼容易缺字段 */
      raw,
      artists: ar.map((a) => ({ id: a.id, name: a.name || '' })).filter((a) => a.name),
      album: {
        id: al.id || 0,
        name: al.name || '',
        picUrl: al.picUrl || '',
        publishTime: al.publishTime || 0
      },
      duration: raw.dt || raw.duration || 0,
      fee: raw.fee || 0,
      no: raw.no || 0,
      cd: raw.cd || '',
      privilege: {
        st: p.st,
        fee: p.fee,
        pl: p.pl,
        dl: p.dl,
        plLevel: p.plLevel || 'none',
        dlLevel: p.dlLevel || 'none',
        cs: !!p.cs,
        toast: !!p.toast,
        maxBrLevel: p.maxBrLevel || 'none'
      }
    };
  }

  function normalizeSongs(songs, privileges) {
    const byId = Object.create(null);
    (privileges || []).forEach((p) => { byId[p.id] = p; });
    return (songs || []).map((s) => normalizeSong(s, byId[s.id])).filter(Boolean);
  }

  /** 封面原图（去掉 ?param=130y130 之类）；接口没给时退化为页面 DOM（原「助手」脚本的做法） */
  function coverUrlOf(song, size) {
    let u = (song && song.album && song.album.picUrl) || '';
    if (!u) {
      try {
        const img =
          document.querySelector('.u-cover img.j-img') ||
          document.querySelector('img[src*="music.126.net"]') ||
          document.querySelector('img[data-src*="music.126.net"]');
        if (img) u = img.getAttribute('data-src') || img.src || '';
      } catch (e) { /* ignore */ }
    }
    if (!u) return '';
    u = u.split('?')[0];
    return size ? u + '?param=' + size + 'y' + size : u;
  }

  /* ==========================================================================
   * 30-engine · 取链降级（核心：两套脚本各用一套方法，这里合并成一条链）
   * ======================================================================== */

  /**
   * 解析某首歌的可用下载地址。
   * 尝试顺序：启用的方法 × 音质降级链；任一方法给出非空 url 即返回。
   * @returns {{ok:boolean, url?:string, method?:string, level?:string, size?:number,
   *            md5?:string, br?:number, ext?:string, tried:Array, reason?:string}}
   */
  async function resolveSongUrl(song, opts) {
    const o = opts || {};
    const settings = Store.settings;
    const requested = o.level || settings.quality;
    let methods = METHOD_ORDER.filter((m) => settings.methods && settings.methods[m]);
    if (!methods.length) {
      return { ok: false, tried: [], requested, reason: '未启用任何取链方式（设置 → 下载 → 方法①②③）' };
    }
    /* 实测：未登录时「增强下载」恒返回 code 301，白白多一次请求 → 明确未登录时跳过它 */
    let skipped = '';
    if (methods.indexOf('download') >= 0 && typeof Login !== 'undefined' && Login.state === 'no') {
      methods = methods.filter((m) => m !== 'download');
      skipped = '未登录，已跳过增强下载接口';
      if (!methods.length) {
        return { ok: false, tried: [], requested, reason: '未登录且只启用了「增强下载接口」（该接口需要登录）', skipped };
      }
    }
    const chain = levelChain(requested, settings.autoDowngrade !== false && !settings.targetLevelOnly);
    const tried = [];
    let best = null;

    const consider = (cand) => {
      if (!best) best = cand;
      else if (weightOf(cand.level) > weightOf(best.level)) best = cand;
    };

    for (const level of chain) {
      for (const method of methods) {
        let cand = null;
        try {
          if (method === 'download') {
            const res = await Api.downloadUrl(song.id, level);
            const d = res.data;
            if (d && d.url) {
              cand = {
                url: d.url, level: d.level || level, size: d.size || 0,
                md5: d.md5 || '', br: d.br || 0, ext: (d.type || 'mp3').toLowerCase()
              };
            }
          } else if (method === 'player') {
            const res = await Api.playerUrl([song.id], level);
            const d = (res.data || [])[0];
            if (d && d.url) {
              cand = {
                url: d.url, level: d.level || level, size: d.size || 0,
                md5: d.md5 || '', br: d.br || 0, ext: (d.type || 'mp3').toLowerCase()
              };
            }
          } else if (method === 'outer') {
            const probe = await probeUrl(Api.outerUrl(song.id));
            const final = probe.finalUrl || '';
            if (/\.(mp3|flac|m4a|wav|ape|ogg)(\?|$)/i.test(final) || /music\.126\.net/i.test(final)) {
              const extMatch = final.match(/\.(mp3|flac|m4a|wav|ape|ogg)(\?|$)/i);
              cand = {
                url: Api.outerUrl(song.id),
                level: 'unknown',          // 外链不告诉你音质，别冒充目标音质
                size: 0, md5: '', br: 0,
                ext: extMatch ? extMatch[1].toLowerCase() : 'mp3'
              };
            }
          }
        } catch (e) {
          cand = null;
          tried.push({ method, level, error: e && e.message });
          continue;
        }
        tried.push({ method, level, hit: !!cand, actualLevel: cand && cand.level });
        if (cand) {
          cand.method = method;
          cand.url = normalizeMediaUrl(cand.url);
          if (settings.targetLevelOnly) {
            if (weightOf(cand.level) === weightOf(requested)) {
              return Object.assign(cand, { ok: true, requested, tried });
            }
            continue;
          }
          consider(cand);
          if (weightOf(cand.level) >= weightOf(requested)) {
            return Object.assign(cand, { ok: true, requested, tried });
          }
        }
      }
      /* 本档已经拿到可用地址 → 再往下只会更低，停止降档 */
      if (best) break;
    }

    if (best) {
      best.url = normalizeMediaUrl(best.url);
      return Object.assign(best, { ok: true, requested, tried, downgraded: weightOf(best.level) < weightOf(requested) });
    }
    return { ok: false, tried, requested, reason: '所有取链方式均未取到地址' };
  }

  /* ==========================================================================
   * 30-engine · 音频格式与 ID3v2.4 写入（零依赖，替代原脚本的 mp3tag.js）
   * ======================================================================== */

  function detectAudioFormat(bytes) {
    if (!bytes || bytes.length < 12) return 'unknown';
    const b = bytes;
    if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return 'flac';       // fLaC
    if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';        // OggS
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'wav';        // RIFF
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'm4a';        // ftyp
    if (b[0] === 0x41 && b[1] === 0x50 && b[2] === 0x45 && b[3] === 0x54) return 'ape';        // APET
    let start = 0;
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {                                     // ID3
      const size = (b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f);
      start = 10 + size;
    }
    const end = Math.min(b.length - 1, start + 65536);
    for (let i = start; i < end; i++) {
      if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) return 'mp3';
    }
    return 'unknown';
  }

  function syncSafe(n) {
    return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
  }

  function concatBytes(list) {
    let total = 0;
    list.forEach((a) => { total += a.length; });
    const out = new Uint8Array(total);
    let off = 0;
    list.forEach((a) => { out.set(a, off); off += a.length; });
    return out;
  }

  function textFrame(id, value) {
    if (!value) return null;
    const payload = textEncoder.encode(String(value));
    const body = new Uint8Array(1 + payload.length);
    body[0] = 0x03;                     // UTF-8
    body.set(payload, 1);
    const head = new Uint8Array(10);
    for (let i = 0; i < 4; i++) head[i] = id.charCodeAt(i);
    head.set(syncSafe(body.length), 4);
    return concatBytes([head, body]);
  }

  function apicFrame(cover) {
    if (!cover || !cover.bytes || !cover.bytes.length) return null;
    const mime = textEncoder.encode(cover.mime || 'image/jpeg');
    const desc = new Uint8Array(1);      // 空描述，ISO-8859-1 终止符
    desc[0] = 0x00;
    const body = concatBytes([
      new Uint8Array([0x00]),           // 编码：ISO-8859-1（mime/desc 用）
      mime,
      desc,
      new Uint8Array([0x03]),           // 图片类型：3 = 封面
      desc,
      cover.bytes
    ]);
    const head = new Uint8Array(10);
    'APIC'.split('').forEach((c, i) => { head[i] = c.charCodeAt(0); });
    head.set(syncSafe(body.length), 4);
    return concatBytes([head, body]);
  }

  function usltFrame(lyric) {
    if (!lyric) return null;
    const text = textEncoder.encode(String(lyric));
    const body = concatBytes([
      new Uint8Array([0x03]),                       // UTF-8
      textEncoder.encode('eng'),                    // 语言
      new Uint8Array([0x00]),                       // 空描述
      text
    ]);
    const head = new Uint8Array(10);
    'USLT'.split('').forEach((c, i) => { head[i] = c.charCodeAt(0); });
    head.set(syncSafe(body.length), 4);
    return concatBytes([head, body]);
  }

  /** 生成 ID3v2.4 标签块 */
  function buildId3Tag(meta) {
    const m = meta || {};
    const frames = [];
    const push = (f) => { if (f) frames.push(f); };
    push(textFrame('TIT2', m.title));
    push(textFrame('TPE1', m.artist));
    push(textFrame('TPE2', m.albumArtist || m.artist));
    push(textFrame('TALB', m.album));
    push(textFrame('TRCK', m.track));
    push(textFrame('TPOS', m.disc));
    push(textFrame('TDRC', m.year));
    push(apicFrame(m.cover));
    push(usltFrame(m.lyric));
    if (!frames.length) return null;
    const bodyLen = frames.reduce((n, f) => n + f.length, 0);
    const header = concatBytes([
      textEncoder.encode('ID3'),
      new Uint8Array([0x04, 0x00, 0x00]),
      new Uint8Array(syncSafe(bodyLen))
    ]);
    return concatBytes([header].concat(frames));
  }

  /** 去掉已有的 ID3v2 头，避免标签叠加 */
  function stripId3(bytes) {
    if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const size = (bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f);
      return bytes.subarray(10 + size);
    }
    return bytes;
  }

  function mimeOfImage(bytes) {
    if (bytes && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    return 'image/jpeg';
  }

  /* ==========================================================================
   * 30-engine · 落盘
   * ======================================================================== */

  const saveQueue = [];
  let saveRunning = false;

  function saveBytes(bytes, filename, mime) {
    return new Promise((resolve) => {
      saveQueue.push({ bytes, filename, mime, resolve });
      if (!saveRunning) pumpSave();
    });
  }

  async function pumpSave() {
    saveRunning = true;
    while (saveQueue.length) {
      const job = saveQueue.shift();
      try {
        const blob = new Blob([job.bytes], { type: job.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = job.filename;
        a.style.display = 'none';
        // 网易云是 SPA，全局捕获阶段的点击监听会劫持下载
        a.addEventListener('click', (ev) => ev.stopImmediatePropagation(), true);
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try { a.remove(); } catch (e) { /* ignore */ }
          URL.revokeObjectURL(url);
        }, 5000);
        job.resolve({ ok: true, filename: job.filename, size: job.bytes.length });
      } catch (e) {
        warn('保存文件失败', job.filename, e);
        job.resolve({ ok: false, error: e && e.message });
      }
      await sleep(150);
    }
    saveRunning = false;
  }

  /** 用 GM_download 直接下 URL（不占内存、不进页面内存），失败退化到 fetch+save */
  function gmDownload(url, filename) {
    return new Promise((resolve) => {
      if (!GM_AVAILABLE.download) {
        resolve({ ok: false, unsupported: true });
        return;
      }
      try {
        GM_download({
          url,
          name: filename,
          saveAs: false,
          onload: () => resolve({ ok: true, filename }),
          onerror: (e) => resolve({ ok: false, error: (e && (e.error || e.details)) || 'GM_download 失败' }),
          ontimeout: () => resolve({ ok: false, error: '下载超时' })
        });
      } catch (e) {
        resolve({ ok: false, error: e && e.message });
      }
    });
  }

  /** 找页面里真正的 <audio>（可能在 iframe 里） */
  function findPageAudio(win) {
    const docs = [];
    try {
      if (win && win.document) docs.push(win.document);
    } catch (e) { /* ignore */ }
    try {
      if (document) docs.push(document);
    } catch (e) { /* ignore */ }
    try {
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          if (f.contentDocument) docs.push(f.contentDocument);
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    for (const d of docs) {
      let list = [];
      try {
        list = Array.from(d.querySelectorAll('audio'));
      } catch (e) { continue; }
      if (!list.length) continue;
      /* 优先选有 src 的、再选时长最长/最像播放器的 */
      const withSrc = list.find((a) => a.currentSrc || a.src);
      return withSrc || list[0];
    }
    return null;
  }

  /**
   * 让网易云页面播放指定歌曲 / 替换它的播放列表。
   *
   * 依据（扒 core/player bundle 得到的事实，2026-11-25）：
   *   top.player 对外只有 addTo / getPlaying / pause / tipPlay / setLike / hotkeys 六个成员；
   *   addTo(songs, 替换队列, 立即播放) → 内部 caZ0u(songs, replace, play)：
   *     replace 为真 → this.jI6C = songs（**直接替换播放列表**）
   *     play 为真    → 定位到第一首并 ey8y()（**立即播放**）
   *   getPlaying() 返回 {track:{...}, playing:bool} —— id 在 **.track.id**，不是 .id
   *
   * @param {object|Array} songs 单曲对象或数组（normalizeSong 结果，或原始 song 对象）
   * @param {object} opts { replace=true, play=true, url }
   * @returns {Promise<{ok:boolean, via?:string, attempts:string[], reason?:string}>}
   */
  async function playInPage(songs, opts) {
    const o = opts || {};
    const replace = o.replace !== false;
    const play = o.play !== false;
    const arr = (Array.isArray(songs) ? songs : [songs]).filter(Boolean);
    const attempts = [];
    if (!arr.length) return { ok: false, attempts, reason: '没有要播放的歌曲' };

    /* 播放器要的是原始 song 结构 */
    const tracks = arr.map((s) => (s && s.raw) ? s.raw : s);

    let win = window;
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) win = unsafeWindow;
    } catch (e) { /* ignore */ }

    /* 收集所有可能的播放器对象：top.player 是权威入口（bundle 里就是 top.player.getPlaying()） */
    const objs = [];
    const push = (tag, p) => {
      if (p && objs.every((x) => x[1] !== p)) objs.push([tag, p]);
    };
    try { if (win.top && win.top.player) push('top.player', win.top.player); } catch (e) { /* cross-origin */ }
    try { if (win.player) push('win.player', win.player); } catch (e) { /* ignore */ }
    try { if (win.g_player) push('win.g_player', win.g_player); } catch (e) { /* ignore */ }
    try {
      const fr = document.querySelector('#g_player iframe, iframe#g_player');
      if (fr && fr.contentWindow) {
        if (fr.contentWindow.player) push('g_player.player', fr.contentWindow.player);
        if (fr.contentWindow.g_player) push('g_player.g_player', fr.contentWindow.g_player);
      }
    } catch (e) { /* ignore */ }

    /* ① addTo（唯一能替换队列并播放的正规入口） */
    for (const [tag, p] of objs) {
      if (typeof p.addTo !== 'function') continue;
      try {
        p.addTo(tracks, replace, play);
        return { ok: true, via: tag + '.addTo', attempts, count: tracks.length, replaced: replace, played: play };
      } catch (e) {
        attempts.push(tag + '.addTo: ' + ((e && e.message) || e));
      }
    }
    /* ② playById（老版本 / 某些壳） */
    for (const [tag, p] of objs) {
      if (typeof p.playById !== 'function' || !play) continue;
      try {
        p.playById(tracks[0].id);
        return { ok: true, via: tag + '.playById', attempts, count: 1, played: true };
      } catch (e) {
        attempts.push(tag + '.playById: ' + ((e && e.message) || e));
      }
    }

    /* ③ 页面 <audio> 直连（不替换队列，只出声） */
    if (play) {
      let url = o.url || '';
      if (!url) {
        try {
          const r = await resolveSongUrl(arr[0], { level: Store.settings.quality });
          if (r.ok) url = r.url;
          else attempts.push('取链失败: ' + (r.reason || ''));
        } catch (e) {
          attempts.push('取链异常: ' + ((e && e.message) || e));
        }
      }
      const audio = findPageAudio(win);
      if (audio && url) {
        try {
          audio.src = url;
          const pr = audio.play();
          if (pr && pr.catch) pr.catch(() => {});
          return { ok: true, via: 'audio', url, attempts, count: 1, played: true, audio };
        } catch (e) {
          attempts.push('audio: ' + ((e && e.message) || e));
        }
      }
      if (!audio) attempts.push('页面里找不到 <audio>');
      if (!url) attempts.push('没有可播放地址');
    }

    return { ok: false, attempts, reason: attempts.slice(-2).join(' | ') || '所有播放通道都不可用' };
  }

  /** 暂停网页播放器（top.player.pause 是 bundle 里公开的） */
  function pauseInPage() {
    let win = window;
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) win = unsafeWindow;
    } catch (e) { /* ignore */ }
    const cands = [];
    try { if (win.top && win.top.player) cands.push(win.top.player); } catch (e) { /* ignore */ }
    try { if (win.player) cands.push(win.player); } catch (e) { /* ignore */ }
    for (const p of cands) {
      if (typeof p.pause === 'function') {
        try { p.pause(); return { ok: true }; } catch (e) { /* ignore */ }
      }
    }
    return { ok: false };
  }

  /** 用页面内 <a download> 直接下载（不经过脚本管理器，跨域时文件名可能被浏览器改写） */
  function downloadByAnchor(url, filename) {
    return new Promise((resolve) => {
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || '';
        a.rel = 'noopener';
        a.style.display = 'none';
        a.addEventListener('click', (ev) => ev.stopImmediatePropagation(), true);
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try { a.remove(); } catch (e) { /* ignore */ }
        }, 3000);
        resolve({ ok: true, filename });
      } catch (e) {
        resolve({ ok: false, error: e && e.message });
      }
    });
  }

  /* ==========================================================================
   * 30-engine · 手动输入解析（歌曲 ID / 歌曲链接 / 歌单链接 / 裸数字）
   * ======================================================================== */

  /**
   * 从任意文本里抽出引用：
   *   纯数字            → 歌曲 id
   *   song?id=123       → 歌曲
   *   /song/123         → 歌曲
   *   playlist?id=123   → 歌单
   *   album/123、artist?id=123、discover/toplist?id=123 → 对应列表
   * @returns {{songs:number[], lists:{type:string,id:number,raw:string}[], unknown:string[]}}
   */
  function parseRefs(text) {
    const songs = [];
    const lists = [];
    const unknown = [];
    const seenSong = new Set();
    const seenList = new Set();
    const pushSong = (id) => {
      const n = Number(id);
      if (!n || seenSong.has(n)) return;
      seenSong.add(n);
      songs.push(n);
    };
    const pushList = (type, id, raw) => {
      const n = Number(id);
      if (!n) return;
      const k = type + ':' + n;
      if (seenList.has(k)) return;
      seenList.add(k);
      lists.push({ type, id: n, raw: raw || '' });
    };

    const tokens = String(text || '')
      .split(/[\s,;，；、'"‘’“”()（）<>《》]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    for (const tok of tokens) {
      /* 列表类优先（否则 playlist?id= 会被当成歌曲） */
      let m = tok.match(/(playlist|album|artist|toplist|discover\/toplist)[^\d]{0,6}(\d+)/i);
      if (m) {
        const kind = /playlist|toplist|discover/i.test(m[1]) ? 'playlist' : m[1].toLowerCase();
        pushList(kind, m[2], tok);
        continue;
      }
      m = tok.match(/\/playlist\/(\d+)/i);
      if (m) { pushList('playlist', m[1], tok); continue; }
      m = tok.match(/\/album\/(\d+)/i);
      if (m) { pushList('album', m[1], tok); continue; }
      m = tok.match(/\/artist\/(\d+)/i);
      if (m) { pushList('artist', m[1], tok); continue; }
      /* 歌曲 */
      m = tok.match(/song[^\d]{0,6}(\d+)/i) || tok.match(/\/song\/(\d+)/i);
      if (m) { pushSong(m[1]); continue; }
      if (/^\d{3,12}$/.test(tok)) { pushSong(tok); continue; }
      unknown.push(tok);
    }
    return { songs, lists, unknown };
  }

  /* ==========================================================================
   * 30-engine · 歌词
   * ======================================================================== */

  const TS_RE = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;

  function parseLrc(text) {
    const out = [];
    if (!text) return out;
    String(text).split(/\r?\n/).forEach((line) => {
      const stamps = [];
      let m;
      TS_RE.lastIndex = 0;
      while ((m = TS_RE.exec(line))) {
        const min = Number(m[1]);
        const sec = Number(m[2]);
        const fracRaw = m[3] || '0';
        const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
        stamps.push({ time: min * 60 + sec + frac, raw: m[0] });
      }
      const content = line.replace(TS_RE, '').trim();
      if (!stamps.length) {
        if (line.trim()) out.push({ time: -1, raw: '', content: line.trim(), line });
        return;
      }
      stamps.forEach((s) => out.push({ time: s.time, raw: s.raw, content, line: s.raw + content }));
    });
    return out;
  }

  const LYRIC_HEADER_RE = /^\[(ti|ar|al|by|offset|re|ve|length):/i;

  function splitLrcHeader(text) {
    const headers = [];
    const body = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      if (LYRIC_HEADER_RE.test(line)) headers.push(line);
      else if (line.trim()) body.push(line);
    });
    return { headers, body };
  }

  /** 合并原文与译文/罗马音（按时间戳对齐，追加在同一行） */
  function mergeLyric(primary, secondary, separator) {
    if (!secondary) return primary || '';
    const sec = parseLrc(secondary).filter((l) => l.time >= 0);
    if (!sec.length) return primary || '';
    const map = new Map();
    sec.forEach((l) => {
      const key = Math.round(l.time * 100) / 100;
      if (!map.has(key)) map.set(key, l.content);
    });
    const { headers, body } = splitLrcHeader(primary);
    const merged = body.map((line) => {
      const stamps = [];
      let m;
      const re = new RegExp(TS_RE.source, 'g');
      while ((m = re.exec(line))) {
        const fracRaw = m[3] || '0';
        const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
        stamps.push({ key: Math.round((Number(m[1]) * 60 + Number(m[2]) + frac) * 100) / 100 });
      }
      const text = line.replace(new RegExp(TS_RE.source, 'g'), '').trim();
      const prefix = (line.match(/^(?:\[[^\]]+\])+/) || [''])[0];
      const extra = stamps.map((s) => map.get(s.key)).filter(Boolean)[0];
      if (!extra) return line;
      return prefix + text + (separator || ' / ') + extra;
    });
    return headers.concat(merged).join('\n');
  }

  /** 纯文本歌词（去掉时间戳与元信息） */
  function lyricToPlain(text) {
    return parseLrc(text)
      .filter((l) => l.content)
      .map((l) => l.content)
      .join('\n');
  }

  /**
   * 取歌词（一次请求拿全 lrc / 翻译 / 罗马音 / 逐字）
   * @returns {{lrc:string, trans:string, roma:string, yrc:string, pureMusic:boolean,
   *            merged:string, hasTrans:boolean, lineCount:number}}
   */
  async function getLyric(songId, opts) {
    const o = opts || {};
    const res = await Api.lyric(songId);
    const lrc = (res && res.lrc && res.lrc.lyric) || '';
    const trans = (res && res.tlyric && res.tlyric.lyric) || '';
    const roma = (res && res.romalrc && res.romalrc.lyric) || '';
    const yrc = (res && res.yrc && res.yrc.lyric) || '';
    const pureMusic = !!(res && (res.pureMusic || res.needDesc)) || (!lrc && !yrc);
    let merged = lrc;
    if (!merged && yrc) merged = yrc.replace(/\(\d+,\d+,\d+\)/g, '');
    if (o.merge !== false && trans) merged = mergeLyric(merged, trans, ' / ');
    if (o.roma && roma) merged = mergeLyric(merged, roma, ' / ');
    const lineCount = parseLrc(merged).filter((l) => l.time >= 0 && l.content).length;
    return { lrc: merged || lrc, raw: lrc, trans, roma, yrc, pureMusic, merged: merged || lrc, hasTrans: !!trans, lineCount, res };
  }

  /* ==========================================================================
   * 30-engine · 单曲下载
   * ======================================================================== */

  /**
   * 下载一首歌（含可选标签/封面/歌词）
   * @param {object} song normalizeSong 的结果
   * @returns {Promise<{ok:boolean, level?:string, method?:string, file?:string, reason?:string}>}
   */
  async function downloadSong(song, opts) {
    const o = opts || {};
    const settings = Store.settings;
    const resolved = await resolveSongUrl(song, { level: o.level });
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason || '无可用下载地址', tried: resolved.tried };
    }
    const ext = resolved.ext || 'mp3';
    const folder = buildFolder(song, o.folderMode || settings.folderMode);
    const base = buildFileName(song, { template: o.nameTemplate || settings.nameTemplate, index: o.index });
    const fileName = folder + base + '.' + ext;
    const wantTag = o.applyTag != null ? o.applyTag : settings.applyTag;
    const canTag = ext === 'mp3' && wantTag;
    const wantLyric = o.lyricSidecar != null ? o.lyricSidecar : settings.lyricSidecar;
    const wantCover = o.coverSidecar != null ? o.coverSidecar : settings.coverSidecar;

    let lyric = null;
    if (canTag || wantLyric) {
      try {
        lyric = await getLyric(song.id, { merge: settings.lyricMerge, roma: settings.lyricRoma });
      } catch (e) {
        warn('取歌词失败', song.name, e);
      }
    }

    let cover = null;
    if (canTag || wantCover) {
      const cu = coverUrlOf(song, 500);
      if (cu) {
        try {
          const b = await fetchBinary(cu);
          if (b.ok && b.bytes && b.size > 100) cover = { bytes: b.bytes, mime: mimeOfImage(b.bytes) };
          else if (Store.settings.debug) warn('取封面失败', song.name, (b.attempts || []).join(' | '));
        } catch (e) {
          warn('取封面失败', song.name, e);
        }
      }
    }

    /* 音频：优先"取字节 → 写标签"；取不到字节就降级为直链下载，绝不整单失败 */
    const dlUrl = normalizeMediaUrl(resolved.url);
    let audioVia = 'none';
    let degraded = false;

    if (canTag) {
      const got = await fetchBinary(dlUrl);
      if (got.ok && got.bytes && got.size) {
        const audio = stripId3(got.bytes);
        const tag = buildId3Tag({
          title: song.name + (song.alias && song.alias.length ? ' (' + song.alias[0] + ')' : ''),
          artist: song.artists.map((a) => a.name).join('; '),
          album: song.album.name,
          albumArtist: song.artists.length === 1 ? song.artists[0].name : song.artists.map((a) => a.name).join('; '),
          track: song.no ? String(song.no) : '',
          disc: song.cd ? String(song.cd) : '',
          year: song.album.publishTime ? String(new Date(song.album.publishTime).getFullYear()) : '',
          cover,
          lyric: lyric && !lyric.pureMusic ? lyric.merged : ''
        });
        const out = tag ? concatBytes([tag, audio]) : audio;
        const res = await saveBytes(out, fileName, 'audio/mpeg');
        if (!res.ok) return { ok: false, reason: '保存失败: ' + res.error };
        audioVia = 'tag';
      } else {
        /* 降级 1：GM_download 直链 */
        degraded = true;
        const viaGm = await gmDownload(dlUrl, fileName);
        if (viaGm.ok) {
          audioVia = 'gm';
        } else {
          /* 降级 2：页面内 <a download>（不经过管理器，最原始但最可靠） */
          const viaAnchor = await downloadByAnchor(dlUrl, fileName);
          if (!viaAnchor.ok) {
            return {
              ok: false,
              reason: '音频下载失败（' + ((got.attempts || []).join(' | ') || viaAnchor.error || '未知') + '）'
            };
          }
          audioVia = 'anchor';
        }
      }
    } else {
      const viaGm = await gmDownload(dlUrl, fileName);
      if (viaGm.ok) {
        audioVia = 'gm';
      } else {
        const got = await fetchBinary(dlUrl);
        if (got.ok && got.bytes && got.size) {
          const res = await saveBytes(got.bytes, fileName, 'audio/' + ext);
          if (!res.ok) return { ok: false, reason: '保存失败: ' + res.error };
          audioVia = 'bytes';
        } else {
          const viaAnchor = await downloadByAnchor(dlUrl, fileName);
          if (!viaAnchor.ok) {
            return {
              ok: false,
              reason: '音频下载失败（' + ((got.attempts || []).join(' | ') || viaAnchor.error || '未知') + '）'
            };
          }
          audioVia = 'anchor';
        }
      }
    }

    /* 旁挂文件 */
    if (wantLyric && lyric && !lyric.pureMusic && lyric.merged) {
      const fmt = settings.lyricFormat === 'txt' ? 'txt' : 'lrc';
      const text = fmt === 'txt' ? lyricToPlain(lyric.merged) : lyric.merged;
      await saveBytes(textEncoder.encode(text), folder + base + '.' + fmt, 'text/plain;charset=utf-8');
    }
    if (wantCover && cover && !canTag) {
      const mime = cover.mime;
      await saveBytes(cover.bytes, folder + base + (mime === 'image/png' ? '.png' : '.jpg'), mime);
    } else if (wantCover && cover && canTag && o.forceCoverFile) {
      await saveBytes(cover.bytes, folder + base + '.jpg', cover.mime);
    }

    return {
      ok: true,
      level: resolved.level,
      method: resolved.method,
      downgraded: !!resolved.downgraded,
      degraded,
      audioVia,
      file: fileName,
      size: resolved.size,
      md5: resolved.md5,
      reason: degraded ? '取字节失败，已直接下载原文件（未写入标签）' : ''
    };
  }

  /* ==========================================================================
   * 30-engine · 批量任务
   * ======================================================================== */

  const Job = {
    running: false,
    cancelled: false,
    total: 0,
    done: 0,
    ok: 0,
    skip: 0,
    fail: 0,
    startAt: 0,
    failures: [],
    listener: null,
    emit() {
      if (this.listener) {
        try {
          this.listener(this.snapshot());
        } catch (e) {
          logError('批量任务回调出错', e);
        }
      }
    },
    snapshot() {
      const elapsed = this.startAt ? (Date.now() - this.startAt) / 1000 : 0;
      return {
        running: this.running,
        total: this.total,
        done: this.done,
        ok: this.ok,
        skip: this.skip,
        fail: this.fail,
        elapsed,
        speed: elapsed > 0 ? this.done / elapsed : 0,
        failures: this.failures.slice(0, 5)
      };
    },
    reset(total) {
      this.running = true;
      this.cancelled = false;
      this.total = total;
      this.done = 0;
      this.ok = 0;
      this.skip = 0;
      this.fail = 0;
      this.failures = [];
      this.startAt = Date.now();
      this.emit();
    }
  };

  /**
   * 批量下载
   * @param {Array} songs
   * @param {object} opts { onProgress, filter }
   */
  async function downloadBatch(songs, opts) {
    const o = opts || {};
    if (Job.running) return { ok: false, reason: '已有任务在运行' };
    const settings = Store.settings;
    const queue = songs.filter((s) => s && s.id);
    Job.reset(queue.length);
    Job.listener = o.onProgress || null;
    let cursor = 0;
    const workers = clamp(Number(o.concurrent || settings.concurrent) || 4, 1, 8);

    const worker = async () => {
      for (;;) {
        if (Job.cancelled) return;
        const idx = cursor++;
        if (idx >= queue.length) return;
        const song = queue[idx];
        try {
          if (settings.skipCloudOwned && song.privilege && song.privilege.cs) {
            Job.skip += 1;
          } else {
            const r = await downloadSong(song, { index: idx + 1 });
            if (r.ok) Job.ok += 1;
            else if (/跳过/.test(r.reason || '')) Job.skip += 1;
            else {
              Job.fail += 1;
              Job.failures.push({ name: song.name, reason: r.reason });
              warn('下载失败', song.name, r.reason);
            }
          }
        } catch (e) {
          Job.fail += 1;
          Job.failures.push({ name: song.name, reason: (e && e.message) || '异常' });
          logError('下载异常', song.name, e);
        } finally {
          Job.done += 1;
          Job.emit();
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, worker));
    Job.running = false;
    Job.emit();
    return {
      ok: true,
      total: Job.total,
      success: Job.ok,
      skip: Job.skip,
      fail: Job.fail,
      failures: Job.failures.slice(0, 20),
      cancelled: Job.cancelled
    };
  }

  /* ==========================================================================
   * 30-engine · 云盘快传（原脚本的核心逻辑：只靠 md5 认领，不占上传带宽）
   * ======================================================================== */

  /**
   * 快传：把某首歌"认领"到自己的音乐云盘
   * 步骤：取文件指纹 → 检查服务器是否已有同文件 → 导入云盘 → 关联曲库歌曲
   */
  async function cloudQuickUpload(song, opts) {
    const o = opts || {};
    const onStep = o.onStep || (() => {});
    const meta = {
      song: song.name,
      artist: song.artists.map((a) => a.name).join(' / '),
      album: song.album.name
    };

    onStep(1, '获取文件指纹');
    let fp = null;
    try {
      const res = await Api.downloadUrl(song.id, o.level || Store.settings.quality);
      const d = res.data;
      if (d && d.md5) {
        fp = { md5: d.md5, size: d.size, br: d.br, ext: (d.type || 'mp3').toLowerCase(), url: d.url, level: d.level };
      }
    } catch (e) {
      warn('取指纹失败(下载接口)', e);
    }
    if (!fp) {
      try {
        const res = await Api.playerUrl([song.id], o.level || Store.settings.quality);
        const d = (res.data || [])[0];
        if (d && d.md5) {
          fp = { md5: d.md5, size: d.size, br: d.br, ext: (d.type || 'mp3').toLowerCase(), url: d.url, level: d.level };
        }
      } catch (e) {
        warn('取指纹失败(试听接口)', e);
      }
    }
    if (!fp || !fp.md5) {
      return { ok: false, stage: 'fingerprint', reason: '拿不到文件指纹（该曲可能无可用音源）' };
    }

    const bitrate = Math.floor((fp.br || 128000) / 1000);
    const fileName = buildFileName(song, { template: '{artist} - {title}' }) + '.' + fp.ext;

    onStep(2, '检查云端资源');
    const check = await Api.cloudUploadCheck(song.id, fp.md5, bitrate, fp.size || 0);
    const info = check && check.data && check.data[0];
    if (!info) {
      return { ok: false, stage: 'check', reason: '检查接口无返回（可能需要登录）' };
    }
    if (info.upload === 0) {
      return { ok: true, stage: 'already', cloudSongId: info.songId, level: fp.level, message: '云盘里已有该文件' };
    }
    if (info.upload !== 1) {
      return { ok: false, stage: 'check', reason: '该文件不可快传（upload=' + info.upload + '）' };
    }

    onStep(3, '导入云盘');
    const imp = await Api.cloudImport(info.songId, bitrate, Object.assign({ fileName }, meta));
    const success = imp && imp.data && imp.data.successSongs && imp.data.successSongs[0];
    if (!success || !success.song) {
      return { ok: false, stage: 'import', reason: '导入云盘失败', raw: imp };
    }
    const cloudSongId = success.song.songId;

    if (Store.settings.cloud.autoMatch && cloudSongId && cloudSongId !== song.id) {
      onStep(4, '关联曲库');
      try {
        const match = await Api.cloudMatch(cloudSongId, song.id);
        return {
          ok: match && match.code === 200,
          stage: 'match',
          cloudSongId,
          level: fp.level,
          message: match && match.code === 200 ? '已关联到曲库歌曲' : '文件已入云盘，但关联曲库失败'
        };
      } catch (e) {
        return { ok: true, stage: 'match', cloudSongId, level: fp.level, message: '文件已入云盘，关联失败：' + (e && e.message) };
      }
    }
    return { ok: true, stage: 'done', cloudSongId, level: fp.level, message: '已入云盘' };
  }

  /* ==========================================================================
   * 30-engine · 列表抓取（歌单 / 专辑 / 歌手 / 搜索结果）
   * ======================================================================== */

  const ListSource = {
    /** 当前页面属于哪种可批量抓取的列表 */
    detect() {
      const url = location.href;
      const hash = location.hash || '';
      const all = url + ' ' + hash;
      const m = (re) => {
        const r = all.match(re);
        return r ? r[1] : null;
      };
      if (/\/playlist\b|\/my\/m\/music\/playlist/.test(all)) {
        const id = m(/[?&#]id=(\d+)/);
        if (id) return { type: 'playlist', id, title: '歌单' };
      }
      if (/\/album\b/.test(all)) {
        const id = m(/[?&#]id=(\d+)/);
        if (id) return { type: 'album', id, title: '专辑' };
      }
      if (/\/artist\b/.test(all)) {
        const id = m(/[?&#]id=(\d+)/);
        if (id) return { type: 'artist', id, title: '歌手' };
      }
      if (/\/discover\/toplist|\/discover/.test(all)) return null;
      if (/\/search\b/.test(all)) {
        const kw = m(/[?&#](?:s|keyword|q)=([^&#]+)/);
        if (kw) return { type: 'search', id: decodeURIComponent(kw), title: '搜索：' + decodeURIComponent(kw) };
      }
      if (/\/song\b/.test(all)) return null;
      return null;
    },

    /** 抓取列表（返回 {title, songs, total}） */
    async fetch(source, onProgress) {
      if (!source) throw new Error('当前页面不是可批量处理的列表页');
      const report = onProgress || (() => {});
      if (source.type === 'playlist') {
        report('读取歌单信息');
        const res = await Api.playlist(source.id);
        const pl = res && res.playlist;
        if (!pl) throw new Error('歌单不存在或需要登录');
        const ids = (pl.trackIds || []).map((t) => t.id);
        report(`歌单共 ${ids.length} 首，正在读取详情`);
        const detail = await Api.songDetail(ids);
        return {
          type: 'playlist',
          id: source.id,
          title: pl.name || '歌单',
          cover: pl.coverImgUrl || '',
          creator: (pl.creator && pl.creator.nickname) || '',
          total: ids.length,
          songs: normalizeSongs(detail.songs, detail.privileges)
        };
      }
      if (source.type === 'album') {
        report('读取专辑信息');
        const res = await Api.album(source.id);
        const album = res && res.album;
        if (!album) throw new Error('专辑不存在');
        const songs = normalizeSongs(res.songs || [], (res.songs || []).map((s) => s.privilege));
        // album 接口的 songs 自带 privilege 字段，缺失时补一次详情
        let list = songs;
        if (!list.length || !list[0].privilege.plLevel || list[0].privilege.plLevel === 'none') {
          const detail = await Api.songDetail((res.songs || []).map((s) => s.id));
          list = normalizeSongs(detail.songs, detail.privileges);
        }
        return {
          type: 'album',
          id: source.id,
          title: album.name || '专辑',
          cover: album.picUrl || '',
          creator: (album.artist && album.artist.name) || '',
          total: list.length,
          songs: list
        };
      }
      if (source.type === 'artist') {
        report('读取歌手歌曲');
        const res = await Api.artistSongs(source.id, (n) => report('已读取 ' + n + ' 首'));
        const list = normalizeSongs(res.songs, res.privileges);
        return {
          type: 'artist',
          id: source.id,
          title: '歌手歌曲',
          cover: list.length && list[0].album.picUrl ? list[0].album.picUrl : '',
          creator: '',
          total: list.length,
          songs: list
        };
      }
      if (source.type === 'search') {
        report('搜索歌曲');
        const params = { s: source.id, type: 1, limit: 100, offset: 0 };
        let res = await weapi('/api/cloudsearch/get/web', params);
        let raw = (res && res.result && (res.result.songs || [])) || [];
        if (!raw.length) {
          /* 实测：匿名/风控下 cloudsearch 会返回 code 50000005，legacy 搜索仍可用 */
          report('改用兼容搜索接口');
          res = await weapi('/api/search/get/web', params);
          raw = (res && res.result && (res.result.songs || [])) || [];
        }
        const list = normalizeSongs(raw, []);
        const detail = await Api.songDetail(list.map((s) => s.id));
        const withPriv = normalizeSongs(detail.songs, detail.privileges);
        return {
          type: 'search',
          id: source.id,
          title: '搜索：' + source.id,
          cover: '',
          creator: '',
          total: withPriv.length,
          songs: withPriv
        };
      }
      throw new Error('不支持的列表类型');
    }
  };

  /* ==========================================================================
   * 30-engine · 导出列表
   * ======================================================================== */

  function buildListExport(list, format) {
    const rows = list.songs || [];
    const title = sanitizeFilename(list.title || '歌单');
    if (format === 'csv') {
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = ['序号,歌曲ID,歌曲名,歌手,专辑,时长,音质'];
      rows.forEach((s, i) => {
        lines.push([
          i + 1, s.id, esc(s.name), esc(s.artists.map((a) => a.name).join(' / ')),
          esc(s.album.name), formatDuration(s.duration), pickLevelLabel(s.privilege.plLevel)
        ].join(','));
      });
      return { name: title + '.csv', text: '\ufeff' + lines.join('\r\n'), mime: 'text/csv;charset=utf-8' };
    }
    if (format === 'json') {
      const data = rows.map((s, i) => ({
        index: i + 1, id: s.id, name: s.name,
        artists: s.artists.map((a) => a.name), album: s.album.name,
        duration: s.duration, fee: s.fee,
        plLevel: s.privilege.plLevel, dlLevel: s.privilege.dlLevel, cloud: s.privilege.cs
      }));
      return { name: title + '.json', text: JSON.stringify({ title: list.title, total: rows.length, songs: data }, null, 2), mime: 'application/json' };
    }
    const lines = rows.map((s, i) => `${i + 1}. ${s.name} - ${s.artists.map((a) => a.name).join(' / ')}` +
      (s.privilege.cs ? '  [云盘]' : ''));
    const head = ['# ' + (list.title || '歌单'), '# 共 ' + rows.length + ' 首', ''];
    return { name: title + '.txt', text: head.concat(lines).join('\r\n'), mime: 'text/plain;charset=utf-8' };
  }

/* ===== part: 40-ui.js ===== */
  /* ==========================================================================
   * 40-ui · 悬浮面板（Shadow DOM 隔离，配色对齐网易云）
   * ======================================================================== */

  const UI = {
    host: null,
    shadow: null,
    state: {
      tab: 'song',
      song: null,
      songSource: '',
      targetMode: 'auto',
      pin: null,
      localAudio: null,
      list: null,
      listError: '',
      listQuery: { page: 0, size: 20, filter: '' },
      loadOpen: false,
      loadFocusPending: false,
      manualText: '',
      selected: {},
      cloud: { items: [], count: 0, offset: 0, filter: '', loading: false },
      log: [],
      busy: '',
      lyric: null
    },

    /* ---------------- 生命周期 ---------------- */

    mount() {
      if (this.host) return;
      const host = document.createElement('div');
      host.id = 'ncmh-host';
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;inset:auto;';
      document.documentElement.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = this.css();
      shadow.appendChild(style);
      const wrap = document.createElement('div');
      wrap.className = 'wrap';
      wrap.innerHTML = this.frameHtml();
      shadow.appendChild(wrap);

      this.host = host;
      this.shadow = shadow;
      this.wrap = wrap;
      this.bindEvents();
      this.applyTheme();
      this.positionLauncher();
      this.positionPanel();
      this.renderAll();
      this.watchPanelSize();
      if (Store.ui.open) this.open(true);
    },

    /* ---------------- 样式 ---------------- */

    css() {
      return `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  --bg: #ffffff;
  --bg2: #f6f6f8;
  --bg3: #eeeef1;
  --text: #1f1f1f;
  --text2: #666666;
  --text3: #9a9a9a;
  --border: #e7e7ea;
  --accent: #ec4141;
  --accent2: #c62f2f;
  --accent-soft: rgba(236, 65, 65, 0.10);
  --shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
  --ok: #2ea44f;
  --warn: #e6a23c;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}
.wrap[data-theme="dark"] {
  --bg: #252525;
  --bg2: #2f2f2f;
  --bg3: #3a3a3a;
  --text: #ededed;
  --text2: #a8a8a8;
  --text3: #7c7c7c;
  --border: #3b3b3b;
  --accent-soft: rgba(236, 65, 65, 0.18);
  --shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
}
.launcher {
  position: fixed;
  width: 48px; height: 48px;
  border-radius: 50%;
  background: linear-gradient(150deg, #f25f5f, #e03232);
  box-shadow: 0 6px 18px rgba(224, 50, 50, 0.38), 0 2px 6px rgba(0,0,0,.2);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  user-select: none;
  transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease;
  opacity: .92;
}
.launcher:hover { transform: scale(1.07); opacity: 1; box-shadow: 0 8px 22px rgba(224, 50, 50, .48); }
.launcher.dragging { transition: none; }
.launcher svg { width: 24px; height: 24px; display: block; pointer-events: none; }
.launcher .dot {
  position: absolute; right: 2px; top: 2px;
  width: 9px; height: 9px; border-radius: 50%;
  background: #35c759; border: 2px solid #fff;
}
.wrap[data-theme="dark"] .launcher .dot { border-color: #252525; }

.panel {
  position: fixed;
  width: 372px;
  max-height: 78vh;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  display: none;
  flex-direction: column;
  overflow: hidden;
}
.panel.open { display: flex; }
.ph { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--bg); flex: 0 0 auto; }
.ph .logo { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(150deg,#f25f5f,#e03232); display:flex; align-items:center; justify-content:center; }
.ph .logo svg { width: 13px; height: 13px; }
.ph .title { font-size: 13px; font-weight: 600; letter-spacing: .2px; }
.ph .ver { font-size: 11px; color: var(--text3); margin-left: 2px; }
.ph .sp { flex: 1; }
.iconbtn {
  width: 26px; height: 26px; border-radius: 6px; border: none; background: transparent;
  color: var(--text2); cursor: pointer; display:flex; align-items:center; justify-content:center;
}
.iconbtn:hover { background: var(--bg3); color: var(--text); }
.iconbtn svg { width: 15px; height: 15px; }

/* ===== 卡片 = 播放控制台：左边当前对象，右边播放器与来源切换 ===== */
.songcard {
  display: grid; grid-template-columns: 52px 1fr auto; gap: 8px;
  padding: 9px 12px; align-items: center; flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
}
.songcard .cover {
  width: 52px; height: 52px; border-radius: 8px; background: var(--bg3);
  object-fit: cover; cursor: zoom-in; grid-row: 1 / span 2;
}
.songcard .meta { min-width: 0; grid-column: 2; }
.songcard .name {
  font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.songcard .sub {
  font-size: 11.5px; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;
}
.songcard .tags { display: flex; gap: 4px; margin-top: 4px; flex-wrap: nowrap; overflow: hidden; }
.songcard .ctrl { grid-column: 3; display: flex; gap: 2px; align-items: center; }
.songcard .ctr { color: var(--text3); font-size: 11px; }
/* 来源切换：只在"另有别的歌可切"时出现，一个按钮，不占地方 */
.altchip {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 6px;
  margin-top: 7px; padding-top: 7px; border-top: 1px dashed var(--border);
  font-size: 11px; color: var(--text3); cursor: pointer;
}
.altchip:hover { color: var(--accent); }
.altchip .arrow { font-size: 10px; }
.altchip b { font-weight: 500; color: var(--text2); max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.altchip:hover b { color: var(--accent); }
.songcard.flash { animation: ncmh-flash 900ms ease; }
@keyframes ncmh-flash {
  0% { background: var(--accent-soft); }
  100% { background: transparent; }
}

/* 图标按钮（播放器控制）：只放符号，22px，不抢视线 */
.ibtn {
  width: 26px; height: 26px; border: none; background: transparent; color: var(--text2);
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 12px; line-height: 1; padding: 0;
}
.ibtn:hover { background: var(--bg2); color: var(--accent); }
.ibtn.play { color: var(--text); font-size: 13px; }
.badges { display: flex; gap: 4px; flex-wrap: wrap; }
.badge {
  font-size: 10.5px; line-height: 1; padding: 3px 6px; border-radius: 4px;
  background: var(--bg2); color: var(--text2); border: 1px solid var(--border);
}
.badge.red { color: var(--accent); border-color: var(--accent-soft); background: var(--accent-soft); }
.badge.ok { color: var(--ok); border-color: rgba(46,164,79,.35); background: rgba(46,164,79,.10); }
.badge.src { color: var(--text3); }

/* ===== 载入条（在标签页之上，收起时只有一行） ===== */
.loadbar { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
.loadbar .lk { flex: 1; min-width: 0; text-align: left; }
.loadbar .lkbtn {
  flex: 1; min-width: 0; border: 1px dashed var(--border); background: var(--bg2); color: var(--text3);
  border-radius: 7px; padding: 5px 9px; font-size: 11px; cursor: pointer; font-family: inherit;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
}
.loadbar .lkbtn:hover { border-color: var(--accent); color: var(--accent); }
.loadbar.open { display: block; padding: 10px 12px; }
.loadbar.open textarea { width: 100%; box-sizing: border-box; }
.loadbar .lbrow { display: flex; gap: 6px; margin-top: 6px; }

.tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--border); background: var(--bg); flex: 0 0 auto; }
.tabs button {
  flex: 1; border: none; background: transparent; color: var(--text2);
  font-size: 12.5px; padding: 9px 0 8px; cursor: pointer; border-bottom: 2px solid transparent;
  font-family: inherit;
}
.tabs button.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
.tabs button:hover { color: var(--text); }

.body { padding: 12px; overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 0; }
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }
.body::-webkit-scrollbar-track { background: transparent; }

.row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.row > label { font-size: 12px; color: var(--text2); flex: 0 0 34px; }
.row > .grow { flex: 1; min-width: 0; }
.qhint {
  font-size: 10.5px; color: var(--text3); flex: 0 0 auto; max-width: 118px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 次级操作做成文本链接行，比一排描边小按钮轻得多 */
.linkrow { display: flex; flex-wrap: wrap; gap: 10px; margin: 2px 0 6px; }
.linkrow a {
  font-size: 11.5px; color: var(--text3); cursor: pointer; text-decoration: none;
  border-bottom: 1px solid transparent; padding-bottom: 1px;
}
.linkrow a:hover { color: var(--accent); border-bottom-color: var(--accent-soft); }
select, input[type="text"], input[type="number"] {
  font-family: inherit; font-size: 12px; color: var(--text);
  background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
  padding: 5px 8px; outline: none; width: 100%;
}
select:focus, input:focus { border-color: var(--accent); background: var(--bg); }
input[type="checkbox"] { accent-color: var(--accent); }

.btns { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
button.btn {
  font-family: inherit; font-size: 12px; line-height: 1; padding: 8px 10px;
  border-radius: 6px; border: 1px solid var(--border); background: var(--bg2); color: var(--text);
  cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
}
button.btn:hover { border-color: var(--accent); color: var(--accent); }
button.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.btn.primary:hover { background: var(--accent2); border-color: var(--accent2); color: #fff; }
button.btn:disabled { opacity: .5; cursor: not-allowed; }
button.btn.mini { padding: 5px 7px; font-size: 11px; }

.note { font-size: 11.5px; color: var(--text3); line-height: 1.6; }
.sect-title { font-size: 11.5px; color: var(--text3); margin: 10px 0 6px; letter-spacing: .3px; }
.divider { height: 1px; background: var(--border); margin: 10px 0; }

.progress { height: 4px; border-radius: 2px; background: var(--bg3); overflow: hidden; margin: 6px 0; }
.progress > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s ease; }
.progress-text { font-size: 11.5px; color: var(--text2); display: flex; justify-content: space-between; gap: 8px; }

.list { max-height: 190px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
.list::-webkit-scrollbar { width: 8px; }
.list::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }
.list .item {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 11.5px;
  border-bottom: 1px solid var(--border); color: var(--text2);
}
.list .item:last-child { border-bottom: none; }
.list .item .idx { width: 22px; color: var(--text3); flex: 0 0 auto; text-align: right; }
.list .item .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.list .item .tag { font-size: 10px; color: var(--text3); flex: 0 0 auto; }
.list .item.owned .nm { color: var(--text2); }

.chip {
  font-size: 11px; line-height: 1; padding: 4px 8px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg2); color: var(--text2);
}
.chip:hover { border-color: var(--accent); color: var(--accent); }
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.chip[disabled] { opacity: .45; cursor: not-allowed; }
.list-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.list-toolbar .grow { flex: 1 1 auto; min-width: 90px; }
.list-toolbar input[type="text"] { width: 100%; }
.list-rows { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.lrow {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-size: 12px;
  border-bottom: 1px solid var(--border); cursor: pointer;
}
.lrow:last-child { border-bottom: none; }
.lrow:hover { background: var(--bg2); }
.lrow.sel { background: rgba(236, 65, 65, .08); }
.lrow input[type="checkbox"] { margin: 0 2px 0 0; cursor: pointer; }
.lrow .idx { width: 22px; color: var(--text3); font-size: 11px; text-align: right; }
.lrow .nm { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lrow .ar { color: var(--text3); font-size: 11px; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lrow .tag { font-size: 10px; color: var(--text3); }
.lrow .mini-act {
  font-size: 11px; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text2); cursor: pointer;
}
.lrow .mini-act:hover { border-color: var(--accent); color: var(--accent); }
.pager { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 8px 0 2px; font-size: 11px; color: var(--text2); }
textarea {
  width: 100%; min-height: 58px; resize: vertical; box-sizing: border-box;
  font-size: 12px; padding: 6px 8px; border-radius: 8px; font-family: inherit;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
}
textarea:focus { outline: none; border-color: var(--accent); }

.lyricbox {
  max-height: 180px; overflow: auto; background: var(--bg2); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px; font-size: 12px; line-height: 1.9; white-space: pre-wrap;
  color: var(--text2);
}
.lyricbox::-webkit-scrollbar { width: 8px; }
.lyricbox::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }

.minilog {
  margin-top: 8px; max-height: 78px; overflow-y: auto; font-size: 11px; color: var(--text3);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; line-height: 1.6;
}
.minilog::-webkit-scrollbar { width: 8px; }
.minilog::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }

.pf { display: flex; flex-direction: column; border-top: 1px solid var(--border); background: var(--bg); flex: 0 0 auto; }
.pfrow { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
/* 进度条：**空闲时高度 0（完全不占视觉），有任务才展开 3px** + 右下角百分比文字 */
.slimbar { height: 0; background: var(--bg3); overflow: hidden; position: relative; transition: height .15s ease; }
.slimbar.on, .slimbar.indet { height: 3px; }
.slimbar > i {
  display: block; height: 100%; width: 0; background: var(--accent);
  transition: width .25s ease; opacity: 0;
}
.slimbar.on > i { opacity: 1; }
.slimbar.indet > i { width: 45%; opacity: 1; animation: ncmh-slide 1.1s ease-in-out infinite; }
@keyframes ncmh-slide {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(330%); }
}
.pfpct {
  margin-left: auto; flex: 0 0 auto; font-size: 11px; color: var(--accent);
  font-variant-numeric: tabular-nums; letter-spacing: .3px;
}
.pf .status { flex: 1; font-size: 11.5px; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.toasts { position: fixed; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
.toast {
  background: rgba(20, 20, 20, .92); color: #fff; font-size: 12px; padding: 8px 12px;
  border-radius: 8px; max-width: 340px; box-shadow: 0 6px 18px rgba(0,0,0,.3);
  animation: ncmh-in .18s ease;
}
.toast.err { background: rgba(200, 40, 40, .95); }
.toast.ok { background: rgba(35, 150, 70, .95); }
@keyframes ncmh-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.modal-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center;
  justify-content: center; z-index: 9;
}
.modal {
  width: 340px; max-height: 70vh; background: var(--bg); border-radius: 12px; border: 1px solid var(--border);
  box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden;
}
.modal .mh { padding: 12px 14px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--border); }
.modal .mb { padding: 12px 14px; font-size: 12.5px; color: var(--text2); overflow: auto; line-height: 1.7; white-space: pre-wrap; }
.modal .mf { padding: 10px 14px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border); }
.hidden { display: none !important; }
.kv { display: flex; gap: 8px; font-size: 11.5px; color: var(--text2); padding: 2px 0; }
.kv b { color: var(--text); font-weight: 500; flex: 0 0 auto; }
`;
    },

    frameHtml() {
      return `
<div class="launcher" id="launcher" title="网易云助手（Alt+Shift+M 开关）">
  <svg viewBox="0 0 24 24" fill="none"><path d="M16.5 4.2v11.1a3.1 3.1 0 11-2-2.9V6.6l-5 1.1v9.3a3.1 3.1 0 11-2-2.9V6.1l9-1.9z" fill="#fff"/></svg>
  <span class="dot"></span>
</div>
<div class="panel" id="panel">
  <div class="ph">
    <span class="logo"><svg viewBox="0 0 24 24" fill="none"><path d="M16.5 4.2v11.1a3.1 3.1 0 11-2-2.9V6.6l-5 1.1v9.3a3.1 3.1 0 11-2-2.9V6.1l9-1.9z" fill="#fff"/></svg></span>
    <span class="title">网易云助手</span><span class="ver">v${VERSION}</span>
    <span class="sp"></span>
    <button class="iconbtn" data-act="open-settings" title="打开完整设置页">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8.5A3.5 3.5 0 1012 15.5 3.5 3.5 0 0012 8.5zm8.3 3.5c0 .4 0 .8-.1 1.2l2 1.6-1.9 3.3-2.4-1a7.6 7.6 0 01-2 1.2l-.4 2.6h-3.9l-.4-2.6a7.6 7.6 0 01-2-1.2l-2.4 1L3.8 14.8l2-1.6a8.6 8.6 0 010-2.4l-2-1.6 1.9-3.3 2.4 1a7.6 7.6 0 012-1.2l.4-2.6h3.9l.4 2.6c.7.3 1.4.7 2 1.2l2.4-1 1.9 3.3-2 1.6c.1.4.1.8.1 1.2z"/></svg>
    </button>
    <button class="iconbtn" data-act="close-panel" title="收起">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 12h12"/></svg>
    </button>
  </div>
  <div class="songcard" id="songcard"></div>
  <div class="loadbar" id="loadbar"></div>
  <div class="tabs" id="tabs">
    <button data-act="tab" data-tab="song">单曲</button>
    <button data-act="tab" data-tab="list">列表</button>
    <button data-act="tab" data-tab="cloud">云盘</button>
    <button data-act="tab" data-tab="tool">工具</button>
  </div>
  <div class="body" id="body"></div>
  <div class="pf">
    <div class="slimbar" id="slimbar"><i></i></div>
    <div class="pfrow"><span class="status" id="status">就绪</span><span class="pfpct" id="pfpct"></span></div>
  </div>
</div>
<div class="toasts" id="toasts"></div>`;
    },

    /* ---------------- 主题与定位 ---------------- */

    isDark() {
      const t = Store.settings.theme;
      if (t === 'dark') return true;
      if (t === 'light') return false;
      const html = document.documentElement;
      if (html.classList.contains('night') || html.classList.contains('m-night')) return true;
      if (document.body && document.body.classList.contains('night')) return true;
      if (html.getAttribute('data-theme') === 'dark') return true;
      if (document.body && document.body.getAttribute && document.body.getAttribute('data-theme') === 'dark') return true;
      /* 最后兜底：看页面实际底色亮度（只在不透明时判断，避免 rgba(0,0,0,0) 误判成深色） */
      try {
        const bg = getComputedStyle(document.body).backgroundColor || '';
        const m = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
        if (m) {
          const alpha = m[4] == null ? 1 : Number(m[4]);
          if (alpha > 0.5) {
            const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
            if (lum < 90) return true;
            if (lum > 200) return false;
          }
        }
      } catch (e) { /* ignore */ }
      return false;
    },

    applyTheme() {
      if (!this.wrap) return;
      this.wrap.setAttribute('data-theme', this.isDark() ? 'dark' : 'light');
    },

    positionLauncher() {
      const el = this.wrap.querySelector('#launcher');
      if (!el) return;
      const size = 48;
      let x = Store.ui.x;
      let y = Store.ui.y;
      if (x == null || y == null) {
        x = window.innerWidth - size - 24;
        y = window.innerHeight - size - 120;
      }
      x = clamp(x, 6, window.innerWidth - size - 6);
      y = clamp(y, 6, window.innerHeight - size - 6);
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      this.positionPanel();
    },

    /**
     * 纯几何：把面板贴到圆球旁边（与 DOM 无关，便于单元测试）
     * 目标：① 与球保持 10px 间隙、不盖住球；② 永不超出视口；③ 内容再长也只会内部滚动。
     * @returns {{left:number, top:number, width:number, height:number, maxHeight:number, placeAbove:boolean}}
     */
    layoutPanel(vw, vh, ball, naturalW, naturalH) {
      const GAP = 10;
      const EDGE = 8;
      const width = Math.min(naturalW || 372, vw - EDGE * 2);
      const above = ball.top - GAP - EDGE;
      const below = vh - (ball.bottom + GAP) - EDGE;
      let placeAbove = ball.top > vh / 2;
      let maxHeight = placeAbove ? above : below;
      if (maxHeight < 260) {
        const alt = placeAbove ? below : above;
        if (alt > maxHeight) {
          maxHeight = alt;
          placeAbove = !placeAbove;
        }
      }
      maxHeight = Math.max(220, Math.min(maxHeight, vh - EDGE * 2));
      const height = Math.min(naturalH || 420, maxHeight);
      let top = placeAbove ? ball.top - GAP - height : ball.bottom + GAP;
      top = clamp(top, EDGE, Math.max(EDGE, vh - height - EDGE));
      let left = ball.left < vw / 2 ? ball.left : ball.right - width;
      left = clamp(left, EDGE, Math.max(EDGE, vw - width - EDGE));
      return {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
        maxHeight: Math.round(maxHeight),
        placeAbove
      };
    },

    /** 把上面的几何结果套到真实 DOM 上 */
    positionPanel() {
      const panel = this.wrap && this.wrap.querySelector('#panel');
      const launcher = this.wrap && this.wrap.querySelector('#launcher');
      if (!panel || !launcher) return;
      const lr = launcher.getBoundingClientRect();
      const isOpen = panel.classList.contains('open');

      /* 先放开上限，量"内容自然高度"（同一帧内恢复，用户看不到） */
      panel.style.maxHeight = 'none';
      const naturalH = isOpen ? panel.getBoundingClientRect().height : 420;
      const g = this.layoutPanel(
        window.innerWidth,
        window.innerHeight,
        { left: lr.left, right: lr.right, top: lr.top, bottom: lr.bottom },
        372,
        naturalH
      );
      panel.style.width = g.width + 'px';
      panel.style.maxHeight = g.maxHeight + 'px';
      panel.style.left = g.left + 'px';
      panel.style.top = g.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      this._geom = g;
    },

    /** 内容变化（日志、歌词、进度）时重新贴合圆球，避免越滚越长盖住球 */
    watchPanelSize() {
      const panel = this.wrap && this.wrap.querySelector('#panel');
      if (!panel || typeof ResizeObserver === 'undefined' || this._ro) return;
      let pending = false;
      this._ro = new ResizeObserver(() => {
        if (pending) return;
        pending = true;
        const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
        raf(() => {
          pending = false;
          const r = panel.getBoundingClientRect();
          const g = this._geom;
          if (g && Math.abs(r.height - g.height) < 2 && Math.abs(r.width - g.width) < 2) return;
          this.positionPanel();
        });
      });
      this._ro.observe(panel);
    },

    open(silent) {
      const panel = this.wrap.querySelector('#panel');
      panel.classList.add('open');
      Store.saveUi({ open: true });
      this.positionPanel();
      if (!silent && typeof Tracker !== 'undefined') Tracker.refresh(false);
    },
    close() {
      const panel = this.wrap.querySelector('#panel');
      panel.classList.remove('open');
      Store.saveUi({ open: false });
    },

    toggle() {
      const panel = this.wrap.querySelector('#panel');
      if (panel.classList.contains('open')) this.close();
      else this.open();
    },

    /* ---------------- 事件 ---------------- */

    bindEvents() {
      const launcher = this.wrap.querySelector('#launcher');
      let drag = null;

      launcher.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        drag = { sx: ev.clientX, sy: ev.clientY, ox: launcher.offsetLeft, oy: launcher.offsetTop, moved: false };
        launcher.classList.add('dragging');
        launcher.setPointerCapture(ev.pointerId);
      });
      launcher.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const dx = ev.clientX - drag.sx;
        const dy = ev.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        const x = clamp(drag.ox + dx, 6, window.innerWidth - 54);
        const y = clamp(drag.oy + dy, 6, window.innerHeight - 54);
        launcher.style.left = x + 'px';
        launcher.style.top = y + 'px';
        this.positionPanel();
      });
      launcher.addEventListener('pointerup', (ev) => {
        if (!drag) return;
        launcher.classList.remove('dragging');
        try { launcher.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        if (drag.moved) {
          Store.saveUi({ x: launcher.offsetLeft, y: launcher.offsetTop });
        } else {
          this.toggle();
        }
        drag = null;
      });
      launcher.addEventListener('pointercancel', () => {
        launcher.classList.remove('dragging');
        drag = null;
      });

      /* 事件委托 */
      this.wrap.addEventListener('click', (ev) => {
        /* 列表行：勾选框与行内下载按钮各自处理，点其它区域 = 把这首歌设为当前对象 */
        const rowDl = ev.target.closest('[data-row-dl]');
        if (rowDl) {
          ev.preventDefault();
          ev.stopPropagation();
          Actions.downloadOne(rowDl.getAttribute('data-row-dl'));
          return;
        }
        const row = ev.target.closest('[data-row]');
        if (row && !ev.target.closest('input[type="checkbox"]')) {
          ev.preventDefault();
          Actions.openSongById(row.getAttribute('data-row'));
          return;
        }
        const el = ev.target.closest('[data-act]');
        if (!el) return;
        const act = el.getAttribute('data-act');
        if (act === 'tab') {
          this.state.tab = el.getAttribute('data-tab');
          Store.saveUi({ tab: this.state.tab });
          this.renderAll();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        Actions.run(act, el, ev);
      });

      this.wrap.addEventListener('change', (ev) => {
        const el = ev.target;
        if (el.id === 'sel-quality') Store.save({ quality: el.value });
        if (el.id === 'cloud-filter') {
          this.state.cloud.filter = el.value.trim();
          this.renderCloudList();
        }
        if (el.id === 'list-size') {
          this.state.listQuery.size = Number(el.value) || 20;
          this.state.listQuery.page = 0;
          Store.save({ listPageSize: this.state.listQuery.size });
          this.renderBody();
        }
        if (el.hasAttribute && el.hasAttribute('data-check')) {
          Actions.listToggle(el.getAttribute('data-check'), el.checked);
        }
      });
      this.wrap.addEventListener('input', (ev) => {
        if (ev.target.id === 'cloud-filter') {
          this.state.cloud.filter = ev.target.value.trim();
          this.renderCloudList();
        }
        if (ev.target.id === 'list-filter') {
          this.state.listQuery.filter = ev.target.value;
          this.state.listQuery.page = 0;
          /* 只重画行与分页，保住输入框焦点 */
          const box = this.wrap.querySelector('#list-rows');
          if (box) box.innerHTML = this.listRowsHtml();
          const pager = this.wrap.querySelector('.pager');
          if (pager) {
            const filtered = this.filteredSongs();
            const q = this.state.listQuery;
            const totalPages = Math.max(1, Math.ceil(filtered.length / q.size));
            pager.innerHTML = `<button class="chip" data-act="list-prev"${q.page <= 0 ? ' disabled' : ''}>‹ 上一页</button>
              <span>${q.page + 1} / ${totalPages}　共 ${filtered.length} 首</span>
              <button class="chip" data-act="list-next"${q.page >= totalPages - 1 ? ' disabled' : ''}>下一页 ›</button>`;
          }
        }
        if (ev.target.id === 'manual-input') this.state.manualText = ev.target.value;
      });

      window.addEventListener('resize', () => {
        this.positionLauncher();
        this.positionPanel();
      });

      /* 站点切换夜间模式时跟随 */
      const mo = new MutationObserver(() => this.applyTheme());
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    },

    /* ---------------- 渲染 ---------------- */

    renderAll() {
      this.applyTheme();
      this.renderSongCard();
      this.renderLoadbar();
      this.renderTabs();
      this.renderBody();
      this.positionPanel();
    },

    renderTabs() {
      const tabs = this.wrap.querySelectorAll('#tabs button');
      tabs.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === this.state.tab);
      });
    },

    /**
     * 顶部卡片 = 播放控制台。
     * 结构：封面 | 曲名/歌手/标签 | [⏮][▶][⏭]
     *       └ 另有别的歌可切时，底部一行细提示（整行可点，不额外占按钮）
     */
    renderSongCard() {
      const box = this.wrap.querySelector('#songcard');
      const s = this.state.song;
      const ctrl = this.ctrlHtml();
      const alt = this.altTarget();
      const altHtml = alt
        ? `<div class="altchip" data-act="cycle" data-kind="${alt.kind}" title="切到${alt.label}${this.cycleCandidates().length > 1 ? '（再点可在三项间循环）' : ''}">
             <span class="arrow">⇄</span><span>${alt.label}</span><b>${escapeHtml(alt.name || ('id ' + alt.id))}</b>
           </div>`
        : '';
      if (!s) {
        box.innerHTML = `<div class="cover"></div>
          <div class="meta">
            <div class="name">未选中歌曲</div>
            <div class="sub">在上方粘贴链接，或打开一首歌的页面</div>
          </div>${ctrl}${altHtml}`;
        return;
      }
      const cover = coverUrlOf(s, 120);
      const badges = [];
      badges.push(`<span class="badge red">${escapeHtml(pickLevelLabel(s.privilege.plLevel))}</span>`);
      if (s.privilege.cs) badges.push('<span class="badge ok">云盘</span>');
      if (s.fee === 1) badges.push('<span class="badge">VIP</span>');
      if (s.fee === 4) badges.push('<span class="badge">付费</span>');
      if (this.state.songSource) badges.push(`<span class="badge src">${escapeHtml(this.state.songSource)}</span>`);
      box.innerHTML = `
        <img class="cover" id="songcover" src="${cover ? escapeHtml(cover) : ''}" alt="" data-act="preview-cover" />
        <div class="meta">
          <div class="name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
          <div class="sub" title="${escapeHtml(s.artists.map((a) => a.name).join(' / ') + ' · ' + (s.album.name || ''))}">${escapeHtml(s.artists.map((a) => a.name).join(' / ') || '未知歌手')}${s.album.name ? ' · ' + escapeHtml(s.album.name) : ''}</div>
          <div class="tags">${badges.join('')}</div>
        </div>
        ${ctrl}${altHtml}`;
    },

    /** 播放器控制：只有图标，找不到原生按钮就整条不显示；▶/⏸ 跟随网页播放器真实状态 */
    ctrlHtml() {
      if (!this.hasPlayerControls()) return '<div class="ctrl"></div>';
      const playing = (() => {
        try { return Tracker.isPlaying(); } catch (e) { return false; }
      })();
      const playIcon = playing
        ? '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M8 5v14l11-7z"/></svg>';
      return `<div class="ctrl">
        <button class="ibtn" data-act="player-prev" title="上一首">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M7 6h2v12H7zM19 6l-9 6 9 6z"/></svg>
        </button>
        <button class="ibtn play" data-act="player-toggle" title="${playing ? '暂停' : '播放'}">
          ${playIcon}
        </button>
        <button class="ibtn" data-act="player-next" title="下一首">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M15 6h2v12h-2zM5 6l9 6-9 6z"/></svg>
        </button>
      </div>`;
    },

    hasPlayerControls() {
      try {
        return !!(Tracker.findPlayerControl('prev') || Tracker.findPlayerControl('next'));
      } catch (e) {
        return false;
      }
    },

    /**
     * 可切换的来源（三项循环：载入歌曲 / 详情页 / 正在播放）。
     * 顺序按当前对象旋转，保证"每点一次都换到另一个"。
     */
    cycleCandidates() {
      const cur = this.state.song;
      const curId = cur ? String(cur.id) : '';
      const pageId = Tracker.pageSongId();
      const playId = Tracker.playerSongId();
      const pin = this.state.pin;
      const all = [];
      if (pin) all.push({ kind: 'pin', id: String(pin.id), label: '载入歌曲', name: pin.name || '' });
      if (pageId) all.push({ kind: 'page', id: String(pageId), label: '详情页', name: '' });
      if (playId) all.push({ kind: 'playing', id: String(playId), label: '正在播放', name: Tracker.nowPlayingText() });
      const others = all.filter((x) => x.id !== curId);
      if (!others.length) return [];
      /* 当前对象是哪种？从它的下一种开始轮 */
      const curKind = all.find((x) => x.id === curId);
      const order = ['page', 'playing', 'pin'];
      const start = curKind ? (order.indexOf(curKind.kind) + 1) % order.length : 0;
      const rotated = [];
      for (let i = 0; i < order.length; i++) {
        const k = order[(start + i) % order.length];
        const hit = others.find((x) => x.kind === k);
        if (hit) rotated.push(hit);
      }
      others.forEach((x) => {
        if (!rotated.includes(x)) rotated.push(x);
      });
      return rotated;
    },

    /** 细提示条：显示"下一首可切的是谁" */
    altTarget() {
      const list = this.cycleCandidates();
      return list.length ? list[0] : null;
    },

    flashCard() {
      const box = this.wrap && this.wrap.querySelector('#songcard');
      if (!box) return;
      box.classList.remove('flash');
      /* 强制重排后重新加类，保证动画能重复触发 */
      void box.offsetWidth;
      box.classList.add('flash');
      setTimeout(() => box.classList.remove('flash'), 1000);
    },

    /** 载入条：收起=一行提示，展开=textarea（放在标签页之上，不占任何标签页） */
    renderLoadbar() {
      const el = this.wrap && this.wrap.querySelector('#loadbar');
      if (!el) return;
      el.className = 'loadbar' + (this.state.loadOpen ? ' open' : '');
      if (!this.state.loadOpen) {
        el.innerHTML = `<button class="lkbtn" data-act="load-open" title="粘贴歌曲 ID / 歌曲链接 / 歌单链接">＋ 粘贴 ID 或链接载入…</button>`;
        return;
      }
      el.innerHTML = `
        <textarea id="manual-input" placeholder="每行一条，可混贴：&#10;186016&#10;https://music.163.com/#/song?id=186016&#10;https://music.163.com/playlist?id=3778678">${escapeHtml(this.state.manualText || '')}</textarea>
        <div class="lbrow">
          <button class="btn primary" data-act="manual-parse">载入</button>
          <button class="btn" data-act="manual-close">收起</button>
        </div>`;
      const ta = el.querySelector('#manual-input');
      /* 只在"刚刚点开"时抢焦点，并**全选**已有内容：想贴第二首直接覆盖，不用先删 */
      if (ta && this.state.loadFocusPending) {
        this.state.loadFocusPending = false;
        setTimeout(() => {
          ta.focus();
          if (ta.value) ta.select();
        }, 30);
      }
    },

    /** 现在这张卡片是不是"当前页面本身就是它的详情页"——是的话"打开歌曲页"就是废话，直接不显示 */
    needOpenSongBtn() {
      const s = this.state.song;
      if (!s) return false;
      const pageId = Tracker.pageSongId();
      return String(pageId || '') !== String(s.id);
    },

    /** 权威值回显（短）：下拉旁边一行小字，长解释放 title 里，不占两行 */
    qualityHintShort() {
      const parts = [pickLevelLabel(Store.settings.quality)];
      if (Store.settings.targetLevelOnly) parts.push('仅此档');
      else if (Store.settings.autoDowngrade !== false) parts.push('自动降档');
      parts.push(Login.isKnown() ? (Login.isOn() ? '已登录' : '未登录') : '…');
      return parts.join(' · ');
    },

    /** 权威值回显：下拉显示什么、实际用什么，永远对得上 */
    qualityHintText() {
      const q = Store.settings.quality;
      let t = '当前生效：' + pickLevelLabel(q);
      if (Store.settings.targetLevelOnly) t += '（只接受该音质，拿不到就跳过）';
      else if (Store.settings.autoDowngrade !== false) t += '（无权限时自动降档）';
      t += ' · ' + Login.label();
      return t;
    },

    /** 把控件值强制对齐到存储（防止任何渲染时序导致的"显示与实际不一致"） */
    syncControls() {
      const q = this.wrap && this.wrap.querySelector('#sel-quality');
      if (q && Store.settings.quality) q.value = Store.settings.quality;
      const hint = this.wrap && this.wrap.querySelector('#quality-hint');
      if (hint) {
        hint.textContent = this.qualityHintShort();
        hint.setAttribute('title', this.qualityHintText());
      }
      const ls = this.wrap && this.wrap.querySelector('#login-state');
      if (ls) ls.textContent = Login.label() + (Login.vipLabel() ? ' · ' + Login.vipLabel() : '');
      const badge = this.wrap && this.wrap.querySelector('#login-badge');
      if (badge) badge.textContent = Login.label();
    },

    renderBody() {
      const body = this.wrap.querySelector('#body');
      const scrollTop = body.scrollTop;
      if (this.state.tab !== 'song') {
        const inline = this.wrap.querySelector('#lyric-inline');
        if (inline) inline.remove();
      }
      if (this.state.tab === 'song') body.innerHTML = this.songTabHtml();
      else if (this.state.tab === 'list') body.innerHTML = this.listTabHtml();
      else if (this.state.tab === 'cloud') body.innerHTML = this.cloudTabHtml();
      else body.innerHTML = this.toolTabHtml();
      body.scrollTop = scrollTop;
      this.syncControls();
      if (this.state.tab === 'cloud') this.renderCloudList();
    },

    levelSelectHtml(id, value) {
      return `<select id="${id}">` + LEVEL_CHAIN
        .map((l) => `<option value="${l}"${l === value ? ' selected' : ''}>${LEVEL_LABEL[l]}</option>`)
        .join('') + '</select>';
    },

    songTabHtml() {
      const s = this.state.song;
      if (!s) {
        return `<div class="note">面板只能对"当前对象"操作。在上方粘贴链接，或打开任意歌曲页 / 在播放栏播放一首歌。</div>
        <div class="divider"></div>
        <div class="btns"><button class="btn" data-act="open-settings">打开设置页</button>
        <button class="btn" data-act="diag">运行诊断</button></div>`;
      }
      return `
<div class="row"><label>音质</label><div class="grow">${this.levelSelectHtml('sel-quality', Store.settings.quality)}</div>
  <span class="qhint" id="quality-hint" title="${escapeHtml(this.qualityHintText())}">${escapeHtml(this.qualityHintShort())}</span></div>
<div class="btns">
  <button class="btn primary" data-act="dl-song">下载歌曲</button>
  <button class="btn" data-act="dl-lyric">保存歌词</button>
  <button class="btn" data-act="dl-cover">保存封面</button>
  <button class="btn" data-act="cloud-quick">云盘快传</button>
</div>
<div class="linkrow">
  <a data-act="view-lyric">查看歌词</a>
  <a data-act="probe">音源探测</a>
  <a data-act="copy-id">复制 ID</a>
  <a data-act="copy-link">复制链接</a>
  ${this.needOpenSongBtn() ? '<a data-act="open-song">打开歌曲页</a>' : ''}
</div>`;
    },

    listTabHtml() {
      const list = this.state.list;
      const src = ListSource.detect();
      const q = this.state.listQuery;

      const head = list
        ? `<div class="kv"><b>已载入</b><span>${escapeHtml(list.title)}</span></div>
           <div class="kv"><b>曲目数</b><span>${list.total} 首${list.creator ? ' · ' + escapeHtml(list.creator) : ''}${list.manual ? ' · 手动输入' : ''}</span></div>`
        : `<div class="note">${src
          ? '当前页面识别为：<b>' + escapeHtml({ playlist: '歌单', album: '专辑', artist: '歌手', search: '搜索' }[src.type]) + '</b>' + (src.type !== 'search' ? '（ID ' + escapeHtml(src.id) + '）' : '')
          : '当前页面不是歌单/专辑/歌手/搜索页。可以点上方的「读取列表」，或用「手动输入」粘贴链接。'}</div>`;

      const progress = `
<div class="progress"><i id="dl-bar"></i></div>
<div class="progress-text"><span id="dl-text">未开始</span><span id="dl-sub"></span></div>`;

      const selCount = this.selectedSongs().length;
      const filtered = this.filteredSongs();
      const totalPages = Math.max(1, Math.ceil(filtered.length / q.size));
      const page = clamp(q.page, 0, totalPages - 1);

      const toolbar = list
        ? `<div class="list-toolbar">
             <input type="text" id="list-filter" placeholder="搜索歌名/歌手/专辑" value="${escapeHtml(q.filter)}" />
             <select id="list-size" title="每页条数">
               ${[20, 50, 100, 500].map((n) => `<option value="${n}"${q.size === n ? ' selected' : ''}>${n}/页</option>`).join('')}
             </select>
           </div>
           <div class="btns" style="margin-bottom:6px">
             <button class="btn mini" data-act="list-sel-all">全选本页</button>
             <button class="btn mini" data-act="list-sel-none">清空选择</button>
             <span class="note" style="margin:0;align-self:center">已选 <b>${selCount}</b> / ${filtered.length} 首（筛选后）</span>
           </div>`
        : '';

      const rows = list ? `<div class="list-rows" id="list-rows">${this.listRowsHtml()}</div>` : '';

      const pager = list && filtered.length > q.size
        ? `<div class="pager">
             <button class="chip" data-act="list-prev"${page <= 0 ? ' disabled' : ''}>‹ 上一页</button>
             <span>${page + 1} / ${totalPages}　共 ${filtered.length} 首</span>
             <button class="chip" data-act="list-next"${page >= totalPages - 1 ? ' disabled' : ''}>下一页 ›</button>
           </div>`
        : '';

      const actions = list
        ? `<div class="btns">
             <button class="btn primary" data-act="list-dl">${selCount ? '下载选中(' + selCount + ')' : '批量下载全部'}</button>
             <button class="btn" data-act="list-cloud">${selCount ? '快传选中(' + selCount + ')' : '批量快传全部'}</button>
             <button class="btn" data-act="list-play" title="用这些歌替换网页播放器的播放列表并开始播放">${selCount ? '播放选中(' + selCount + ')' : '播放这个列表'}</button>
             <button class="btn" data-act="list-cancel">停止</button>
           </div>
           <div class="row"><label>导出</label><div class="btns" style="margin:0">
             <button class="btn mini" data-act="export-txt">TXT</button>
             <button class="btn mini" data-act="export-csv">CSV</button>
             <button class="btn mini" data-act="export-json">JSON</button>
           </div></div>`
        : `<div class="btns"><button class="btn primary" data-act="list-fetch">读取当前页面列表</button></div>`;

      return `${head}<div class="divider"></div>${actions}${progress}${toolbar}${rows}${pager}
<div id="listlog" class="minilog">${escapeHtml(this.state.listError || this.state.log.slice(-6).join('\n'))}</div>`;
    },

    /** 筛选后的曲目（搜索作用在全量，不只是当前页） */
    filteredSongs() {
      const list = this.state.list;
      if (!list || !list.songs) return [];
      const f = (this.state.listQuery.filter || '').trim().toLowerCase();
      if (!f) return list.songs;
      return list.songs.filter((s) => {
        const hay = (s.name + ' ' + s.artists.map((a) => a.name).join(' ') + ' ' + s.album.name + (s.alias || []).join(' ')).toLowerCase();
        return hay.includes(f);
      });
    },

    pageSongs() {
      const q = this.state.listQuery;
      const filtered = this.filteredSongs();
      const totalPages = Math.max(1, Math.ceil(filtered.length / q.size));
      const page = clamp(q.page, 0, totalPages - 1);
      return filtered.slice(page * q.size, page * q.size + q.size);
    },

    /** 选中集合（跨页保持）；空集合 = 未选择 */
    selectedSongs() {
      const list = this.state.list;
      if (!list || !list.songs) return [];
      const sel = this.state.selected || {};
      return list.songs.filter((s) => sel[String(s.id)]);
    },

    /** 批量操作的目标：有勾选就用勾选，否则用筛选后的全部 */
    targetSongs() {
      const sel = this.selectedSongs();
      if (sel.length) return { songs: sel, fromSelection: true };
      return { songs: this.filteredSongs(), fromSelection: false };
    },

    listRowsHtml() {
      const rows = this.pageSongs();
      const sel = this.state.selected || {};
      const start = clamp(this.state.listQuery.page, 0, 9999) * this.state.listQuery.size;
      if (!rows.length) return '<div class="note" style="padding:8px">没有匹配的曲目</div>';
      return rows
        .map((s, i) => {
          const id = String(s.id);
          return `<div class="lrow${sel[id] ? ' sel' : ''}" data-row="${id}">
            <input type="checkbox" data-check="${id}"${sel[id] ? ' checked' : ''} />
            <span class="idx">${start + i + 1}</span>
            <span class="nm" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}${s.privilege.cs ? ' <span style="color:var(--ok)">云盘</span>' : ''}</span>
            <span class="ar" title="${escapeHtml(s.artists.map((a) => a.name).join(' / '))}">${escapeHtml(s.artists.map((a) => a.name).join(' / '))}</span>
            <span class="tag">${escapeHtml(pickLevelLabel(s.privilege.plLevel))}</span>
            <button class="mini-act" data-row-dl="${id}" title="下载这一首">⤓</button>
          </div>`;
        })
        .join('');
    },

    /** 只重画行与计数，避免每次勾选都整块 innerHTML（会丢滚动位置与焦点） */
    renderListRows() {
      const box = this.wrap.querySelector('#list-rows');
      if (box) box.innerHTML = this.listRowsHtml();
      const pager = this.wrap.querySelector('.pager');
      if (pager) {
        const filtered = this.filteredSongs();
        const q = this.state.listQuery;
        const totalPages = Math.max(1, Math.ceil(filtered.length / q.size));
        const page = clamp(q.page, 0, totalPages - 1);
        pager.innerHTML = `<button class="chip" data-act="list-prev"${page <= 0 ? ' disabled' : ''}>‹ 上一页</button>
          <span>${page + 1} / ${totalPages}　共 ${filtered.length} 首</span>
          <button class="chip" data-act="list-next"${page >= totalPages - 1 ? ' disabled' : ''}>下一页 ›</button>`;
      }
      const btns = this.wrap.querySelectorAll('[data-act="list-dl"], [data-act="list-cloud"], [data-act="list-play"]');
      const n = this.selectedSongs().length;
      btns.forEach((b) => {
        const act = b.getAttribute('data-act');
        if (act === 'list-dl') b.textContent = n ? '下载选中(' + n + ')' : '批量下载全部';
        else if (act === 'list-cloud') b.textContent = n ? '快传选中(' + n + ')' : '批量快传全部';
        else b.textContent = n ? '播放选中(' + n + ')' : '播放这个列表';
      });
      const counter = this.wrap.querySelector('[data-act="list-sel-all"]');
      if (counter && counter.nextElementSibling && counter.nextElementSibling.nextElementSibling) {
        counter.nextElementSibling.nextElementSibling.innerHTML = '已选 <b>' + n + '</b> / ' + this.filteredSongs().length + ' 首（筛选后）';
      }
    },

    cloudTabHtml() {
      return `
<div class="btns">
  <button class="btn primary" data-act="cloud-refresh">读取云盘</button>
  <button class="btn" data-act="cloud-export">导出 JSON</button>
  <button class="btn" data-act="cloud-more">加载更多</button>
</div>
<div class="row"><label>过滤</label><div class="grow"><input type="text" id="cloud-filter" placeholder="歌名 / 歌手" value="${escapeHtml(this.state.cloud.filter)}" /></div></div>
<div class="progress-text"><span id="cloud-count">${this.state.cloud.loading ? '读取中…' : this.state.cloud.items.length + ' 首已载入'}</span><span></span></div>
<div class="list" id="cloud-list" style="max-height:300px"></div>
<div class="btns" style="margin-top:8px">
  <button class="btn mini" data-act="cloud-select-all">全选</button>
  <button class="btn mini" data-act="cloud-select-none">取消选择</button>
  <button class="btn mini" data-act="cloud-del">删除所选</button>
</div>`;
    },

    toolTabHtml() {
      return `
<div class="sect-title">账号</div>
<div class="kv"><b>登录状态</b><span id="login-state">${escapeHtml(Login.label())}${Login.vipLabel() ? ' · ' + Login.vipLabel() : ''}</span></div>
<div class="btns">
  <button class="btn" data-act="relogin">重新检测登录</button>
</div>
<div class="note">登录态按 <b>接口</b>判定（浏览器读不到 HttpOnly 的登录 cookie，所以不猜 cookie）。云盘相关功能需要登录。</div>
<div class="divider"></div>
<div class="sect-title">诊断</div>
<div class="btns">
  <button class="btn" data-act="diag">运行诊断</button>
  <button class="btn" data-act="copy-diag">复制日志</button>
  <button class="btn" data-act="clear-diag">清空日志</button>
</div>
<div class="minilog" id="diagbox" style="max-height:160px">${escapeHtml(DIAG.text().split('\n').slice(-12).join('\n'))}</div>
<div class="note">诊断会逐个探测三路取链、云盘接口与登录态，用来判断"这首歌为什么下不动"。</div>
<div class="divider"></div>
<div class="sect-title">其他</div>
<div class="btns">
  <button class="btn" data-act="open-settings">完整设置页</button>
  <button class="btn" data-act="reset-panel">重置面板位置</button>
  ${DEV_TOOLS ? '<button class="btn" data-act="export-session">导出登录态</button>' : ''}
</div>
${DEV_TOOLS ? '<div class="note">「导出登录态」是开发期排错工具（等同密码，别外传），正式版不含此入口。</div>' : ''}
<div class="note">版本 v${VERSION} · 合并自 RunningCheese「网易云音乐助手」与 cinvin「歌曲下载&转存云盘」（均 MIT）。</div>`;
    },

    renderCloudList() {
      const box = this.wrap.querySelector('#cloud-list');
      if (!box) return;
      const q = (this.state.cloud.filter || '').toLowerCase();
      const items = this.state.cloud.items.filter((it) => {
        if (!q) return true;
        return ((it.songName || '') + ' ' + (it.artist || '') + ' ' + (it.album || '')).toLowerCase().includes(q);
      });
      if (!items.length) {
        box.innerHTML = `<div class="item"><span class="nm">${this.state.cloud.loading ? '读取中…' : '暂无数据，点"读取云盘"'}</span></div>`;
        return;
      }
      box.innerHTML = items.map((it) => `
        <div class="item${it.__checked ? ' owned' : ''}">
          <span class="idx"><input type="checkbox" data-cloud-id="${it.songId}" ${it.__checked ? 'checked' : ''} /></span>
          <span class="nm" title="${escapeHtml(it.songName)}">${escapeHtml(it.songName || '')}</span>
          <span class="tag">${escapeHtml(it.artist || '')}</span>
          <span class="tag">${formatBytes(it.fileSize)}</span>
        </div>`).join('');
      box.querySelectorAll('input[data-cloud-id]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const id = Number(cb.getAttribute('data-cloud-id'));
          const item = this.state.cloud.items.find((x) => x.songId === id);
          if (item) item.__checked = cb.checked;
        });
      });
      const counter = this.wrap.querySelector('#cloud-count');
      if (counter) counter.textContent = `${items.length} / ${this.state.cloud.items.length} 首（总计 ${this.state.cloud.count}）`;
    },

    /* ---------------- 反馈 ---------------- */

    setStatus(text) {
      const el = this.wrap && this.wrap.querySelector('#status');
      if (el) el.textContent = text;
    },

    toast(msg, type) {
      if (!this.wrap) return;
      const host = this.wrap.querySelector('#toasts');
      const node = document.createElement('div');
      node.className = 'toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
      node.textContent = msg;
      host.appendChild(node);
      const r = this.wrap.querySelector('#panel').getBoundingClientRect();
      host.style.left = Math.round(r.left + r.width / 2) + 'px';
      host.style.top = Math.round(r.top + r.height - 56) + 'px';
      host.style.transform = 'translateX(-50%)';
      setTimeout(() => {
        node.style.transition = 'opacity .2s';
        node.style.opacity = '0';
        setTimeout(() => node.remove(), 220);
      }, 2600);
    },

    addLog(text) {
      this.state.log.push(text);
      if (this.state.log.length > 60) this.state.log.shift();
      const box = this.wrap.querySelector(this.state.tab === 'list' ? '#listlog' : '#sololog');
      if (box) {
        box.textContent = this.state.log.slice(-6).join('\n');
        box.scrollTop = box.scrollHeight;
      }
      const diag = this.wrap.querySelector('#diagbox');
      if (diag) {
        diag.textContent = DIAG.text().split('\n').slice(-12).join('\n');
        diag.scrollTop = diag.scrollHeight;
      }
    },

    setProgress(done, total, sub) {
      const bar = this.wrap.querySelector('#dl-bar');
      const text = this.wrap.querySelector('#dl-text');
      const s = this.wrap.querySelector('#dl-sub');
      const pct = total ? Math.round((done / total) * 100) : 0;
      if (bar) bar.style.width = pct + '%';
      if (text) text.textContent = total ? `进度 ${done}/${total}` : '未开始';
      if (s) s.textContent = sub || '';
      /* 底部极简进度条跟着走；任务结束（100%）后 1.2s 自动收起 */
      this.slim(total ? pct : null);
      if (total && done >= total) setTimeout(() => this.slim(null), 1200);
    },

    /**
     * 底部进度条（空闲时高度 0，完全不占视觉；有任务才展开）
     * @param {number|'indet'|null} v 百分比 / 不确定动画 / null=收起
     */
    slim(v) {
      const bar = this.wrap && this.wrap.querySelector('#slimbar');
      const fill = bar && bar.querySelector('i');
      const pct = this.wrap && this.wrap.querySelector('#pfpct');
      if (!bar || !fill) return;
      if (v == null) {
        bar.className = 'slimbar';
        fill.style.width = '0%';
        if (pct) pct.textContent = '';
        return;
      }
      if (v === 'indet') {
        bar.className = 'slimbar indet';
        if (pct) pct.textContent = '···';
        return;
      }
      const n = clamp(Number(v) || 0, 0, 100);
      bar.className = 'slimbar on';
      fill.style.width = n + '%';
      if (pct) pct.textContent = Math.round(n) + '%';
    },

    /** 通用弹窗 */
    modal(title, bodyHtml, buttons) {
      const old = this.wrap.querySelector('.modal-mask');
      if (old) old.remove();
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = `
        <div class="modal">
          <div class="mh">${escapeHtml(title)}</div>
          <div class="mb">${bodyHtml}</div>
          <div class="mf">${(buttons || [{ text: '关闭', primary: true }])
            .map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}" data-mbtn="${i}">${escapeHtml(b.text)}</button>`)
            .join('')}</div>
        </div>`;
      this.wrap.appendChild(mask);
      const close = () => mask.remove();
      mask.addEventListener('click', (ev) => {
        if (ev.target === mask) close();
        const btn = ev.target.closest('[data-mbtn]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-mbtn'));
        const def = (buttons || [{ text: '关闭', primary: true }])[idx];
        if (def && typeof def.onClick === 'function') def.onClick(close);
        else close();
      });
      return { close, node: mask };
    },

    confirm(title, text) {
      return new Promise((resolve) => {
        const m = this.modal(title, escapeHtml(text), [
          { text: '取消', onClick: (close) => { close(); resolve(false); } },
          { text: '确定', primary: true, onClick: (close) => { close(); resolve(true); } }
        ]);
        m.node.addEventListener('click', (ev) => {
          if (ev.target === m.node) resolve(false);
        });
      });
    },

    /** 歌词/诊断等长文本预览 */
    preview(title, text) {
      this.modal(title, `<div style="max-height:56vh;overflow:auto;white-space:pre-wrap;font-size:12px;line-height:1.8">${escapeHtml(text || '（空）')}</div>`, [
        { text: '关闭' }
      ]);
    },

    /** 封面大图预览（浮层，不跳转） */
    previewCover(url) {
      if (!url) {
        this.toast('没有封面', 'err');
        return;
      }
      const old = this.wrap.querySelector('.cover-mask');
      if (old) { old.remove(); return; }
      const mask = document.createElement('div');
      mask.className = 'modal-mask cover-mask';
      mask.innerHTML = `<img src="${escapeHtml(url)}" style="max-width:76vw;max-height:76vh;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.4)" />`;
      mask.addEventListener('click', () => mask.remove());
      this.wrap.appendChild(mask);
    }
  };

/* ===== part: 45-actions.js ===== */
  /* ==========================================================================
   * 45-actions · 面板按钮 → 业务动作
   * ======================================================================== */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  const Actions = {
    cloudCancel: false,

    async run(act, el) {
      try {
        if (act === 'open-settings') return SettingsPage.open();
        if (act === 'close-panel') return UI.close();
        if (act === 'toggle-panel') return UI.toggle();
        if (act === 'preview-cover') {
          const s = UI.state.song;
          return UI.previewCover(s ? coverUrlOf(s, 700) : '');
        }
        if (act === 'dl-song') return this.downloadCurrentSong();
        if (act === 'dl-lyric') return this.downloadLyric();
        if (act === 'dl-cover') return this.downloadCover();
        if (act === 'view-lyric') return this.viewLyric();
        if (act === 'cloud-quick') return this.cloudQuick();
        if (act === 'probe') return this.probe();
        if (act === 'relogin') return this.relogin();
        if (act === 'copy-id') return this.copyId();
        if (act === 'copy-link') return this.copyLink();
        if (act === 'open-song') return this.openSongPage();
        if (act === 'list-fetch') return this.listFetch();
        if (act === 'list-dl') return this.listDownload();
        if (act === 'list-cloud') return this.listCloud();
        if (act === 'list-play') return this.playList();
        if (act === 'list-cancel') {
          Job.cancelled = true;
          this.cloudCancel = true;
          UI.toast('已请求停止');
          return;
        }
        if (act === 'export-txt') return this.exportList('txt');
        if (act === 'export-csv') return this.exportList('csv');
        if (act === 'export-json') return this.exportList('json');
        if (act === 'load-open') {
          UI.state.loadOpen = true;
          UI.state.loadFocusPending = true;
          UI.renderLoadbar();
          return;
        }
        if (act === 'manual-close') {
          UI.state.loadOpen = false;
          UI.renderLoadbar();
          return;
        }
        if (act === 'manual-parse') return this.manualParse();
        if (act === 'manual-clear') return this.manualClear();
        if (act === 'list-sel-all') return this.listSelectAll();
        if (act === 'list-sel-none') return this.listSelectNone();
        if (act === 'list-prev') return this.listPage(-1);
        if (act === 'list-next') return this.listPage(1);
        if (act === 'target-auto') return this.setTargetMode('auto');
        if (act === 'target-page') return this.setTargetMode('page');
        if (act === 'target-playing') return this.setTargetMode('playing');
        if (act === 'cycle') return this.cycleTarget(el.getAttribute('data-kind'));
        if (act === 'follow-playing') return this.setTargetMode('playing');
        if (act === 'player-prev') return this.playerPrev();
        if (act === 'player-next') return this.playerNext();
        if (act === 'player-toggle') return this.playerToggle();
        if (act === 'cloud-refresh') return this.cloudLoad(true);
        if (act === 'cloud-more') return this.cloudLoad(false);
        if (act === 'cloud-export') return this.cloudExport();
        if (act === 'cloud-select-all') return this.cloudSelectAll(true);
        if (act === 'cloud-select-none') return this.cloudSelectAll(false);
        if (act === 'cloud-del') return this.cloudDelete();
        if (act === 'diag') return this.diagnose();
        if (act === 'copy-diag') return this.copyDiag();
        if (act === 'clear-diag') {
          DIAG.clear();
          UI.toast('日志已清空');
          UI.renderBody();
          return;
        }
        if (act === 'reset-panel') {
          Store.saveUi({ x: null, y: null });
          UI.positionLauncher();
          UI.toast('面板位置已重置');
          return;
        }
        if (act === 'select-trial') return;
        warn('未知动作', act);
      } catch (e) {
        logError('动作执行失败', act, e);
        UI.toast('操作失败：' + ((e && e.message) || e), 'err');
        UI.setStatus('出错：' + ((e && e.message) || e));
      }
    },

    /* ---------------- 单曲 ---------------- */

    currentSong() {
      const s = UI.state.song;
      if (!s) {
        UI.toast('没有可操作的歌曲', 'err');
        return null;
      }
      return s;
    },

    async downloadCurrentSong() {
      const s = this.currentSong();
      if (!s) return;
      UI.setStatus('正在下载：' + s.name);
      UI.addLog(`开始下载 ${s.name}`);
      UI.slim('indet');
      const r = await downloadSong(s);
      if (r.ok) {
        const bits = [];
        bits.push(pickLevelLabel(r.level));
        if (METHOD_META[r.method]) bits.push(METHOD_META[r.method].name);
        if (r.downgraded) bits.push('已降档');
        if (r.degraded) bits.push('未写标签');
        UI.toast('已保存 · ' + bits.join(' · '), r.degraded ? 'err' : 'ok');
        UI.addLog(`成功 ${r.file || ''} ${bits.join(' ')}`);
        UI.setStatus('下载完成：' + (r.file || '') + (r.degraded ? '（未写标签）' : ''));
      } else {
        UI.toast('下载失败：' + r.reason, 'err');
        UI.addLog('失败 ' + r.reason);
        UI.setStatus('下载失败：' + r.reason);
      }
      UI.slim(r.ok ? 100 : null);
      if (r.ok) setTimeout(() => UI.slim(null), 1200);
      UI.renderBody();
    },

    async downloadLyric() {
      const s = this.currentSong();
      if (!s) return;
      const ly = await getLyric(s.id, { merge: Store.settings.lyricMerge, roma: Store.settings.lyricRoma });
      if (!ly.merged) {
        UI.toast('这首歌没有歌词', 'err');
        return;
      }
      const fmt = Store.settings.lyricFormat === 'txt' ? 'txt' : 'lrc';
      const text = fmt === 'txt' ? lyricToPlain(ly.merged) : ly.merged;
      const base = buildFileName(s, { template: Store.settings.nameTemplate });
      await saveBytes(textEncoder.encode(text), base + '.' + fmt, 'text/plain;charset=utf-8');
      UI.toast('歌词已保存' + (ly.hasTrans ? '（含翻译）' : ''), 'ok');
    },

    async downloadCover() {
      const s = this.currentSong();
      if (!s) return;
      const url = coverUrlOf(s, 0);
      if (!url) {
        UI.toast('这首歌没有封面', 'err');
        return;
      }
      const got = await fetchBinary(url);
      if (!got.bytes || !got.size) {
        UI.toast('封面下载失败', 'err');
        return;
      }
      const mime = mimeOfImage(got.bytes);
      const base = buildFileName(s, { template: Store.settings.nameTemplate });
      await saveBytes(got.bytes, base + (mime === 'image/png' ? '.png' : '.jpg'), mime);
      UI.toast('封面已保存', 'ok');
    },

    async viewLyric() {
      const s = this.currentSong();
      if (!s) return;
      UI.setStatus('读取歌词…');
      const ly = await getLyric(s.id, { merge: Store.settings.lyricMerge, roma: Store.settings.lyricRoma });
      UI.state.lyric = ly;
      const box = UI.wrap.querySelector('#sololog');
      const body = UI.wrap.querySelector('#body');
      if (UI.state.tab !== 'song') {
        UI.state.tab = 'song';
        UI.renderAll();
      }
      const host = UI.wrap.querySelector('#songcard');
      const exist = UI.wrap.querySelector('#lyric-inline');
      if (exist) exist.remove();
      const div = document.createElement('div');
      div.id = 'lyric-inline';
      div.className = 'lyricbox';
      div.style.margin = '0 12px 10px';
      div.textContent = ly.merged || '（纯音乐 / 无歌词）';
      host.insertAdjacentElement('afterend', div);
      UI.setStatus(`歌词 ${ly.lineCount} 行${ly.hasTrans ? ' · 含翻译' : ''}`);
      if (!ly.merged) UI.toast('这首歌没有歌词', 'err');
      if (box) box.scrollTop = 0;
      if (body) body.scrollTop = 0;
    },

    async cloudQuick() {
      const s = this.currentSong();
      if (!s) return;
      if (!(await Login.ensure())) {
        UI.toast('云盘属于账号，请先在网页版登录网易云', 'err');
        return;
      }
      UI.setStatus('快传中：' + s.name);
      const r = await cloudQuickUpload(s, {
        onStep: (n, text) => {
          UI.setStatus(`快传(${n}/4) ${text}`);
          UI.addLog(`快传 ${s.name} → ${text}`);
        }
      });
      if (r.ok) {
        UI.toast(r.message || '已入云盘', 'ok');
        UI.addLog(`快传成功 ${s.name} ${r.message || ''}`);
      } else {
        UI.toast('快传失败：' + r.reason, 'err');
        UI.addLog(`快传失败 ${s.name} ${r.reason || ''}`);
      }
      UI.renderBody();
    },

    /** 音源探测：不下载、不播放，只把三路取链的实际结果摊开（替代原来的"试听器"） */
    async probe() {
      const s = this.currentSong();
      if (!s) return;
      UI.setStatus('探测音源中…');
      UI.addLog(`探测音源 ${s.name}`);
      const r = await resolveSongUrl(s, { level: Store.settings.quality });
      if (r.ok) {
        const bits = [
          '可用：' + pickLevelLabel(r.level),
          METHOD_META[r.method] ? METHOD_META[r.method].name : r.method,
          r.size ? formatBytes(r.size) : '',
          r.downgraded ? '已降档' : ''
        ].filter(Boolean);
        UI.toast(bits.join(' · '), 'ok');
        UI.setStatus('音源可用：' + pickLevelLabel(r.level));
        UI.addLog('探测结果 ' + bits.join(' ') + ' ' + String(r.url || '').slice(0, 60));
        UI.modal(
          '音源探测结果',
          `<div class="kv"><b>状态</b><span>可用</span></div>
           <div class="kv"><b>实际音质</b><span>${escapeHtml(pickLevelLabel(r.level))}${r.downgraded ? '（已降档）' : ''}</span></div>
           <div class="kv"><b>取到地址的通道</b><span>${escapeHtml(METHOD_META[r.method] ? METHOD_META[r.method].name : String(r.method))}</span></div>
           <div class="kv"><b>文件大小</b><span>${escapeHtml(r.size ? formatBytes(r.size) : '未知')}</span></div>
           <div class="note" style="margin-top:8px">逐路明细已写入日志；点"复制日志"可以发给我排错。</div>`,
          [{ text: '好', primary: true }]
        );
      } else {
        const tried = (r.tried || []).map((t) => `${METHOD_META[t.method] ? METHOD_META[t.method].name : t.method}/${t.level}:${t.hit ? '有' : '无'}`).join('  ');
        UI.toast('不可用：' + (r.reason || '无地址'), 'err');
        UI.setStatus('音源不可用');
        UI.addLog('探测失败 ' + (r.reason || '') + ' ' + tried);
        UI.modal(
          '音源探测结果',
          `<div class="kv"><b>状态</b><span>不可用</span></div>
           <div class="note" style="margin:6px 0"><b>原因</b>：${escapeHtml(r.reason || '所有取链方式均未取到地址')}</div>
           ${tried ? `<div class="note">逐路：${escapeHtml(tried)}</div>` : ''}
           <div class="note" style="margin-top:8px">常见原因：该曲目需要会员/已下架/地区限制。点"工具 → 运行诊断"可进一步定位。</div>`,
          [{ text: '好', primary: true }]
        );
      }
      UI.renderBody();
    },

    async relogin() {
      UI.setStatus('重新检测登录…');
      const on = await Login.ensure(true);
      UI.toast(on ? '已登录：' + (Login.profile && Login.profile.nickname || '') : '未登录' + (Login.lastError ? '（' + Login.lastError + '）' : ''), on ? 'ok' : 'err');
      UI.addLog('登录检测 → ' + Login.state + (Login.lastError ? ' ' + Login.lastError : ''));
      UI.renderBody();
    },

    async copyId() {
      const s = this.currentSong();
      if (!s) return;
      const ok = await copyText(String(s.id));
      UI.toast(ok ? '歌曲 ID 已复制：' + s.id : '复制失败', ok ? 'ok' : 'err');
    },

    async copyLink() {
      const s = this.currentSong();
      if (!s) return;
      const ok = await copyText(ORIGIN + '/song?id=' + s.id);
      UI.toast(ok ? '链接已复制' : '复制失败', ok ? 'ok' : 'err');
    },

    openSongPage() {
      const s = this.currentSong();
      if (!s) return;
      location.href = ORIGIN + '/song?id=' + s.id;
    },

    /* ---------------- 列表 ---------------- */

    async listFetch() {
      const src = ListSource.detect();
      if (!src) {
        UI.toast('当前页面不是歌单/专辑/歌手/搜索页', 'err');
        return;
      }
      UI.state.listError = '';
      UI.setStatus('读取列表中…');
      UI.slim('indet');
      try {
        const list = await ListSource.fetch(src, (msg) => {
          UI.setStatus(msg);
          UI.addLog(msg);
        });
        UI.state.list = list;
        UI.setStatus(`已读取 ${list.total} 首：${list.title}`);
        UI.addLog(`列表就绪 ${list.title} / ${list.total} 首`);
        UI.slim(null);
        UI.renderBody();
      } catch (e) {
        UI.state.listError = '读取失败：' + ((e && e.message) || e);
        UI.toast(UI.state.listError, 'err');
        UI.slim(null);
        UI.renderBody();
      }
    },

    async listDownload() {
      const list = UI.state.list;
      if (!list || !list.songs.length) {
        UI.toast('请先载入列表', 'err');
        return;
      }
      if (Job.running) {
        UI.toast('已有任务在运行', 'err');
        return;
      }
      const t = UI.targetSongs();
      if (!t.songs.length) {
        UI.toast('没有可下载的曲目（筛选后为空）', 'err');
        return;
      }
      const scope = t.fromSelection ? `已选中的 ${t.songs.length} 首` : `《${list.title}》全部 ${t.songs.length} 首`;
      const ok = await UI.confirm(
        '批量下载',
        `将下载${scope}。\n音质：${pickLevelLabel(Store.settings.quality)}（自动降档：${Store.settings.autoDowngrade ? '开' : '关'}）\n并发：${Store.settings.concurrent}\n\n浏览器可能会弹一次"是否允许下载多个文件"，选择允许即可。`
      );
      if (!ok) return;
      UI.setStatus('批量下载中…');
      UI.setProgress(0, t.songs.length, '');
      const res = await downloadBatch(t.songs, {
        onProgress: (snap) => {
          UI.setProgress(snap.done, snap.total, `${snap.ok} 成功 / ${snap.fail} 失败 · ${snap.speed.toFixed(1)} 首/秒`);
          UI.setStatus(`下载 ${snap.done}/${snap.total}`);
        }
      });
      UI.setProgress(res.success || 0, res.total || t.songs.length, '完成');
      const msg = `完成：成功 ${res.success}，失败 ${res.fail}，跳过 ${res.skip}`;
      UI.toast(msg, res.fail ? 'err' : 'ok');
      UI.addLog(msg);
      if (res.failures && res.failures.length) {
        UI.modal('部分失败', res.failures.map((f) => `· ${escapeHtml(f.name)}：${escapeHtml(f.reason || '')}`).join('<br>'), [{ text: '关闭' }]);
      }
      UI.renderBody();
    },

    async listCloud() {
      const list = UI.state.list;
      if (!list || !list.songs.length) {
        UI.toast('请先载入列表', 'err');
        return;
      }
      if (!(await Login.ensure())) {
        UI.toast('云盘属于账号，请先在网页版登录网易云', 'err');
        return;
      }
      const t = UI.targetSongs();
      if (!t.songs.length) {
        UI.toast('没有可快传的曲目', 'err');
        return;
      }
      const scope = t.fromSelection ? `已选中的 ${t.songs.length} 首` : `《${list.title}》全部 ${t.songs.length} 首`;
      const ok = await UI.confirm('批量快传', `将把${scope}尝试快传到你的音乐云盘。\n已有同文件的会自动跳过。是否继续？`);
      if (!ok) return;
      this.cloudCancel = false;
      let done = 0;
      let okCount = 0;
      let failCount = 0;
      const failures = [];
      for (const song of t.songs) {
        if (this.cloudCancel) break;
        done += 1;
        UI.setProgress(done, t.songs.length, `${okCount} 成功 / ${failCount} 失败`);
        UI.setStatus(`快传 ${done}/${t.songs.length}：${song.name}`);
        const r = await cloudQuickUpload(song).catch((e) => ({ ok: false, reason: (e && e.message) || '异常' }));
        if (r.ok) okCount += 1;
        else {
          failCount += 1;
          failures.push({ name: song.name, reason: r.reason });
        }
        await sleep(clamp(Number(Store.settings.requestGapMs) || 120, 60, 1000));
      }
      const msg = `快传完成：成功 ${okCount}，失败 ${failCount}`;
      UI.toast(msg, failCount ? 'err' : 'ok');
      UI.addLog(msg);
      UI.setStatus(msg);
      if (failures.length) {
        UI.modal('快传失败明细', failures.slice(0, 30).map((f) => `· ${escapeHtml(f.name)}：${escapeHtml(f.reason || '')}`).join('<br>'), [{ text: '关闭' }]);
      }
    },

    async exportList(format) {
      const list = UI.state.list;
      if (!list || !list.songs.length) {
        UI.toast('请先载入列表', 'err');
        return;
      }
      const t = UI.targetSongs();
      const file = buildListExport(Object.assign({}, list, { songs: t.songs, total: t.songs.length }), format);
      await saveBytes(textEncoder.encode(file.text), file.name, file.mime);
      UI.toast('已导出 ' + file.name, 'ok');
    },

    /* ---------------- 手动输入 ---------------- */

    async manualParse() {
      const box = UI.wrap.querySelector('#manual-input');
      const text = box ? box.value.trim() : (UI.state.manualText || '');
      if (!text) {
        UI.toast('先粘贴 ID 或链接', 'err');
        return;
      }
      UI.state.manualText = text;
      const refs = parseRefs(text);
      if (!refs.songs.length && !refs.lists.length) {
        UI.toast('没识别到 ID 或链接（示例：186016 或 https://music.163.com/#/song?id=186016）', 'err');
        return;
      }
      UI.setStatus('解析中…');
      UI.slim('indet');
      UI.addLog(`载入：${refs.songs.length} 个单曲、${refs.lists.length} 个列表`);
      const collected = [];
      let title = '';

      /* 列表引用 → 抓完整曲目 */
      for (const ref of refs.lists) {
        try {
          UI.setStatus(`读取${ref.type === 'playlist' ? '歌单' : ref.type === 'album' ? '专辑' : '歌手'} ${ref.id}…`);
          const got = await ListSource.fetch(ref);
          (got.songs || []).forEach((s) => collected.push(s));
          title = title || got.title;
        } catch (e) {
          UI.addLog(`列表 ${ref.id} 读取失败：${(e && e.message) || e}`);
        }
      }

      /* 单曲 id → 补详情 */
      if (refs.songs.length) {
        const detail = await Api.songDetail(refs.songs);
        normalizeSongs(detail.songs, detail.privileges).forEach((s) => collected.push(s));
      }

      /* 去重（同一首在多处出现只留一份） */
      const seen = new Set();
      const songs = collected.filter((s) => {
        const k = String(s.id);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      if (!songs.length) {
        UI.toast('解析到了，但没取到曲目（可能已下架或链接无效）', 'err');
        return;
      }

      /* 收起输入条：解析完就没必要再占屏幕 */
      UI.state.loadOpen = false;
      UI.state.manualText = '';
      UI.renderLoadbar();
      UI.slim(null);

      /* 单首：直接进卡片 + pin 住（否则会被"页面歌曲"顶掉），并给出明确反馈 */
      if (songs.length === 1) {
          UI.state.song = songs[0];
        UI.state.songSource = '链接载入';
        UI.state.pin = {
          id: songs[0].id,
          name: songs[0].name,
          source: '链接载入',
          pageAt: Tracker.pageSongId()
        };
        UI.state.targetMode = 'pinned';
        Store.saveUi({ targetMode: 'pinned' });
        Tracker.lastKey = songs[0].id + '@链接载入';
        UI.state.manualText = '';
        UI.state.tab = 'song';
        Store.saveUi({ tab: 'song' });
        UI.renderSongCard();
        UI.renderTabs();
        UI.renderBody();
        UI.flashCard();
        UI.toast(`已载入《${songs[0].name}》`, 'ok');
        UI.setStatus(`已载入：${songs[0].name} · ${pickLevelLabel(songs[0].privilege.plLevel)}`);
        UI.addLog(`载入单曲 ${songs[0].name}（${songs[0].id}）`);
        return;
      }

      /* 多首：变成"手动列表"，复用列表的翻页/搜索/勾选/批量 */
      UI.state.list = {
        type: 'manual',
        id: 'manual-' + Date.now(),
        manual: true,
        title: title || '手动输入',
        creator: '',
        total: songs.length,
        songs
      };
      UI.state.listQuery = { page: 0, size: Store.settings.listPageSize || 20, filter: '' };
      UI.state.selected = {};
      UI.state.listError = '';
      UI.state.tab = 'list';
      Store.saveUi({ tab: 'list' });
      UI.renderTabs();
      UI.renderBody();
      UI.toast(`已载入 ${songs.length} 首` + (title ? `（${title}）` : '') + '，可勾选或直接批量下载', 'ok');
      UI.setStatus(`列表就绪：${songs.length} 首` + (title ? ' · ' + title : ''));
      UI.addLog(`载入列表 ${songs.length} 首`);
    },

    manualClear() {
      UI.state.manualText = '';
      const box = UI.wrap.querySelector('#manual-input');
      if (box) box.value = '';
      UI.renderBody();
    },

    /* ---------------- 列表交互 ---------------- */

    listToggle(id, on) {
      const sel = UI.state.selected || (UI.state.selected = {});
      if (on) sel[String(id)] = true;
      else delete sel[String(id)];
      UI.renderListRows();
    },

    listSelectAll() {
      const sel = UI.state.selected || (UI.state.selected = {});
      UI.pageSongs().forEach((s) => { sel[String(s.id)] = true; });
      UI.renderListRows();
    },

    listSelectNone() {
      UI.state.selected = {};
      UI.renderListRows();
    },

    listPage(delta) {
      const q = UI.state.listQuery;
      const totalPages = Math.max(1, Math.ceil(UI.filteredSongs().length / q.size));
      q.page = clamp(q.page + delta, 0, totalPages - 1);
      UI.renderBody();
    },

    /** 点行 = 把这首歌设为当前对象（可以立刻下载/快传/看歌词） */
    async openSongById(id) {
      UI.setStatus('读取歌曲…');
      try {
        const detail = await Api.songDetail([id]);
        const songs = normalizeSongs(detail.songs, detail.privileges);
        if (!songs.length) {
          UI.toast('读取失败（id ' + id + '）', 'err');
          return;
        }
        UI.state.song = songs[0];
        UI.state.songSource = '列表选择';
        UI.state.pin = { id: songs[0].id, name: songs[0].name, source: '列表选择', pageAt: Tracker.pageSongId() };
        UI.state.targetMode = 'pinned';
        Tracker.lastKey = songs[0].id + '@列表选择';
        UI.state.tab = 'song';
        Store.saveUi({ tab: 'song' });
        UI.renderSongCard();
        UI.renderTabs();
        UI.renderBody();
        UI.setStatus('当前：' + songs[0].name);
      } catch (e) {
        UI.toast('读取失败：' + ((e && e.message) || e), 'err');
      }
    },

    async downloadOne(id) {
      const list = UI.state.list;
      const song = list && list.songs.find((s) => String(s.id) === String(id));
      if (!song) return;
      UI.setStatus('正在下载：' + song.name + '（id ' + id + '）');
      const r = await downloadSong(song);
      if (r.ok) {
        UI.toast('已保存 · ' + pickLevelLabel(r.level) + (r.degraded ? ' · 未写标签' : ''), r.degraded ? 'err' : 'ok');
      } else {
        UI.toast('下载失败：' + r.reason, 'err');
      }
      UI.renderBody();
    },

    /* ---------------- 当前对象 / 播放控制 ---------------- */

    setTargetMode(mode) {
      UI.state.targetMode = mode;
      Store.saveUi({ targetMode: mode });
      Tracker.refresh(true);
      UI.renderSongCard();
      const label = { playing: '正在播放', page: '页面歌曲', pinned: '载入歌曲', auto: '自动' }[mode] || mode;
      UI.toast('已切换到「' + label + '」', 'ok');
    },

    /** ⇄ 细提示：在「载入歌曲 / 详情页 / 正在播放」三项之间循环 */
    async cycleTarget(kind) {
      const cands = UI.cycleCandidates();
      if (!cands.length) {
        UI.toast('没有其它可切换的歌曲', 'err');
        return;
      }
      const pick = (kind && cands.find((c) => c.kind === kind)) || cands[0];
      const mode = pick.kind === 'pin' ? 'pinned' : pick.kind === 'playing' ? 'playing' : 'page';
      UI.state.targetMode = mode;
      Store.saveUi({ targetMode: mode });
      await Tracker.refresh(true);
      UI.renderSongCard();
      UI.renderBody();
      UI.toast('已切到「' + pick.label + '」' + (UI.state.song ? '：' + UI.state.song.name : ''), 'ok');
      UI.setStatus('当前：' + (UI.state.song ? UI.state.song.name : pick.label));
    },

    followPlaying() {
      this.setTargetMode('playing');
    },

    /** 播放当前卡片这首歌（不是正在播放的那首时，▶ 走这里） */
    async playLoaded() {
      const s = this.currentSong();
      if (!s) return;
      if (!(await Login.ensure())) {
        UI.toast('播放需要登录（网易云播放器要求登录态）', 'err');
        return;
      }
      UI.setStatus('准备播放：' + s.name);
      UI.slim('indet');
      const r = await playInPage(s, { replace: true, play: true });
      UI.slim(null);
      if (r.ok) {
        const via = r.via === 'audio' ? '直连播放（网页播放条可能不跟随）' : '已替换播放列表并播放';
        UI.toast('▶ ' + s.name + ' · ' + via, 'ok');
        UI.setStatus('正在播放：' + s.name);
        UI.addLog('播放 ' + s.name + ' via ' + r.via);
        setTimeout(() => Tracker.refresh(true), 500);
      } else {
        UI.toast('播放失败：' + r.reason, 'err');
        UI.addLog('播放失败 ' + r.reason + ' 尝试：' + (r.attempts || []).join(' | '));
        UI.setStatus('播放失败：' + r.reason);
      }
    },

    /** 用当前列表（或选中项）替换网页播放器的播放列表并播放 */
    async playList() {
      const list = UI.state.list;
      if (!list || !list.songs.length) {
        UI.toast('请先载入列表', 'err');
        return;
      }
      if (!(await Login.ensure())) {
        UI.toast('播放需要登录（网易云播放器要求登录态）', 'err');
        return;
      }
      const t = UI.targetSongs();
      if (!t.songs.length) {
        UI.toast('没有可播放的曲目', 'err');
        return;
      }
      UI.setStatus(`替换播放列表（${t.songs.length} 首）…`);
      UI.slim('indet');
      const r = await playInPage(t.songs, { replace: true, play: true });
      UI.slim(r.ok ? 100 : null);
      if (r.ok) setTimeout(() => UI.slim(null), 1000);
      if (r.ok) {
        UI.toast(`已用 ${t.songs.length} 首替换播放列表并开始播放`, 'ok');
        UI.setStatus(`播放列表已替换：${t.songs.length} 首`);
        UI.addLog(`替换播放列表 ${t.songs.length} 首 via ${r.via}`);
        setTimeout(() => Tracker.refresh(true), 600);
      } else {
        UI.toast('替换失败：' + r.reason, 'err');
        UI.addLog('替换播放列表失败 ' + r.reason + ' ' + (r.attempts || []).join(' | '));
      }
    },

    playerPrev() {
      const ok = Tracker.pressPlayer('.m-playbar .btns .prv, .m-playbar .prv', ['prev', 'getPrevious']);
      if (!ok) UI.toast('找不到播放器上一首按钮', 'err');
      else setTimeout(() => Tracker.refresh(true), 600);
    },

    playerNext() {
      const ok = Tracker.pressPlayer('.m-playbar .btns .nxt, .m-playbar .nxt', ['next', 'getNext']);
      if (!ok) UI.toast('找不到播放器下一首按钮', 'err');
      else setTimeout(() => Tracker.refresh(true), 600);
    },

    /**
     * ▶ 的语义随上下文变：
     *   卡片 ≠ 正在播放  → 播放这首（把这首歌交给网页播放器 / 直连播放）
     *   卡片 = 正在播放  → 控制网页播放器的播放/暂停
     */
    async playerToggle() {
      const la = UI.state.localAudio;
      if (la && !la.paused) {
        try { la.pause(); } catch (e) { /* ignore */ }
        UI.toast('已暂停');
        return;
      }
      const cur = UI.state.song;
      const playId = Tracker.playerSongId();
      if (cur && String(cur.id) !== String(playId || '')) {
        return this.playLoaded();
      }
      /* 卡片就是正在播放的那首 → 播放/暂停 */
      if (Tracker.isPlaying()) {
        const r = pauseInPage();
        if (r.ok) {
          UI.toast('已暂停');
          return;
        }
      } else {
        const ok = Tracker.pressPlayer('.m-playbar .btns .ply, .m-playbar .ply', ['toggle', 'play']);
        if (ok) return;
      }
      const ok2 = Tracker.pressPlayer('.m-playbar .btns .ply, .m-playbar .ply', ['toggle', 'play']);
      if (!ok2) UI.toast('找不到播放/暂停按钮', 'err');
    },

    /* ---------------- 云盘 ---------------- */

    async cloudLoad(reset) {
      const c = UI.state.cloud;
      if (c.loading) return;
      c.loading = true;
      if (reset) {
        c.items = [];
        c.offset = 0;
      }
      UI.renderBody();
      try {
        const res = await Api.cloudList(c.offset, 200);
        if (res.code === 301 || res.code === 250) {
          UI.toast('需要登录网易云后才能读取云盘', 'err');
          return;
        }
        const rows = res.data || [];
        c.count = res.count || rows.length;
        rows.forEach((r) => c.items.push(r));
        c.offset += rows.length;
        UI.toast(`云盘已载入 ${c.items.length} / ${c.count} 首`, 'ok');
      } catch (e) {
        UI.toast('读取云盘失败：' + ((e && e.message) || e), 'err');
      } finally {
        c.loading = false;
        UI.renderBody();
        UI.renderCloudList();
      }
    },

    async cloudExport() {
      const c = UI.state.cloud;
      if (!c.items.length) {
        UI.toast('云盘列表为空', 'err');
        return;
      }
      const data = c.items.map((it) => ({
        songId: it.songId,
        name: it.songName,
        artist: it.artist,
        album: it.album,
        fileSize: it.fileSize,
        bitrate: it.bitrate,
        addTime: it.addTime
      }));
      const text = JSON.stringify({ total: c.count, exportedAt: new Date().toISOString(), songs: data }, null, 2);
      await saveBytes(textEncoder.encode(text), `我的云盘-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      UI.toast('已导出云盘清单', 'ok');
    },

    cloudSelectAll(on) {
      UI.state.cloud.items.forEach((it) => { it.__checked = !!on; });
      UI.renderCloudList();
      UI.toast(on ? '已全选' : '已取消选择');
    },

    async cloudDelete() {
      const ids = UI.state.cloud.items.filter((it) => it.__checked).map((it) => it.songId);
      if (!ids.length) {
        UI.toast('请先勾选要删除的云盘文件', 'err');
        return;
      }
      const ok = await UI.confirm('删除云盘文件', `将从云盘删除 ${ids.length} 个文件。此操作在网易云侧不可撤销。`);
      if (!ok) return;
      try {
        const res = await Api.cloudDelete(ids);
        /* 服务端返回 {code, succIds:[], failIds:[]}；部分成功也可能 code!=200，所以按 succIds 判定 */
        const okIds = (res && res.succIds && res.succIds.length) ? res.succIds : (res && res.code === 200 ? ids : []);
        const badIds = (res && res.failIds) || [];
        if (okIds.length) {
          const okSet = new Set(okIds.map(Number));
          UI.state.cloud.items = UI.state.cloud.items.filter((it) => !okSet.has(Number(it.songId)));
          const msg = `已删除 ${okIds.length} 个文件` + (badIds.length ? `，${badIds.length} 个未删（服务端返回失败）` : '');
          UI.toast(msg, badIds.length ? 'err' : 'ok');
          UI.addLog(`云盘删除成功 ${okIds.length} 个：${okIds.join(',')}`);
        } else {
          UI.toast('删除失败：' + (res && res.code) + ((res && res.message) ? ' ' + res.message : ''), 'err');
          UI.addLog('云盘删除失败 code=' + (res && res.code) + ' fail=' + JSON.stringify(badIds));
        }
      } catch (e) {
        UI.toast('删除失败：' + ((e && e.message) || e), 'err');
        UI.addLog('云盘删除异常 ' + ((e && e.message) || e));
      }
      UI.renderBody();
    },

    /* ---------------- 诊断 ---------------- */

    async diagnose() {
      UI.setStatus('诊断中…');
      const lines = [];
      const push = (k, v) => lines.push(`${k}：${v}`);
      push('脚本版本', VERSION);
      push('脚本管理器', managerName());
      push('登录状态', (await Login.ensure(true))
        ? '已登录' + (Login.profile && Login.profile.nickname ? '（' + Login.profile.nickname + '）' : '') + (Login.vipLabel() ? ' ' + Login.vipLabel() : '')
        : '未登录' + (Login.lastError ? '（' + Login.lastError + '）' : ''));
      push('当前对象', UI.state.song ? `${UI.state.song.name}（id ${UI.state.song.id}，来源 ${UI.state.songSource}）` : '无');
      push('请求身份', Store.settings.identity);
      push('请求间隔', Store.settings.requestGapMs + ' ms');
      push('启用方法', METHOD_ORDER.filter((m) => Store.settings.methods[m]).map((m) => METHOD_META[m].name).join(' / ') || '无');

      if (UI.state.song) {
        for (const m of METHOD_ORDER) {
          if (!Store.settings.methods[m]) {
            push('  ' + METHOD_META[m].name, '已禁用');
            continue;
          }
          try {
            let hit = '无地址';
            if (m === 'download') {
              const r = await Api.downloadUrl(UI.state.song.id, Store.settings.quality);
              hit = r.data && r.data.url ? `可用（${pickLevelLabel(r.data.level)}）` : '无地址（code ' + r.code + '）';
            } else if (m === 'player') {
              const r = await Api.playerUrl([UI.state.song.id], Store.settings.quality);
              const d = (r.data || [])[0];
              hit = d && d.url ? `可用（${pickLevelLabel(d.level)}）` : '无地址（code ' + r.code + '）';
            } else {
              const probe = await probeUrl(Api.outerUrl(UI.state.song.id));
              hit = probe.status ? `探测 HTTP ${probe.status}` : '探测失败';
            }
            push('  ' + METHOD_META[m].name, hit);
          } catch (e) {
            push('  ' + METHOD_META[m].name, '异常：' + ((e && e.message) || e));
          }
        }
      }

      try {
        const res = await Api.cloudList(0, 1);
        push('云盘接口', res.code === 200 ? `正常（共 ${res.count} 首）` : 'code ' + res.code);
      } catch (e) {
        push('云盘接口', '异常：' + ((e && e.message) || e));
      }

      push('面板设置', Store.ui.open ? '已展开' : '已收起');
      push('最近日志', '');
      lines.push(DIAG.text().split('\n').slice(-14).join('\n'));

      UI.modal('运行诊断', `<div style="white-space:pre-wrap;font-size:11.5px;line-height:1.8">${escapeHtml(lines.join('\n'))}</div>`, [
        { text: '关闭' }
      ]);
      UI.setStatus('诊断完成');
      UI.renderBody();
    },

    async copyDiag() {
      const ok = await copyText(`# NCMH v${VERSION}\n` + DIAG.text());
      UI.toast(ok ? '日志已复制到剪贴板' : '复制失败', ok ? 'ok' : 'err');
    },

  };

/* ===== part: 50-settings-page.js ===== */
  /* ==========================================================================
   * 50-settings · 独立设置页（新标签页，postMessage 双向同步）
   * ======================================================================== */

  const SettingsPage = {
    win: null,
    bound: false,

    open() {
      if (this.win && !this.win.closed) {
        try {
          this.win.focus();
        } catch (e) { /* ignore */ }
        UI.toast('设置页已打开');
        this.push();
        return;
      }
      let w = null;
      try {
        w = window.open('', 'ncmh-settings');
      } catch (e) {
        w = null;
      }
      if (!w) {
        UI.toast('浏览器拦截了新标签页，请允许 music.163.com 弹出窗口', 'err');
        return;
      }
      try {
        w.document.open();
        w.document.write(this.html());
        w.document.close();
      } catch (e) {
        UI.toast('打开设置页失败：' + ((e && e.message) || e), 'err');
        return;
      }
      this.win = w;
      this.bind();
      UI.toast('设置页已打开');
    },

    bind() {
      if (this.bound) return;
      this.bound = true;
      window.addEventListener('message', (ev) => {
        const d = ev.data;
        if (!d || d.__ncmh !== 1) return;
        if (this.win && ev.source !== this.win) return;
        if (d.type === 'ready') {
          this.push();
        } else if (d.type === 'save') {
          Store.save(d.patch, { source: 'settings-page' });
          UI.renderAll();
          this.flashSaved();
        } else if (d.type === 'reset') {
          Store.reset();
          UI.renderAll();
          this.push();
          UI.toast('已恢复默认设置', 'ok');
        } else if (d.type === 'export') {
          const text = JSON.stringify(Store.settings, null, 2);
          try {
            this.win.postMessage({ __ncmh: 1, type: 'exported', text, name: 'ncmh-settings.json' }, '*');
          } catch (e) { /* ignore */ }
        } else if (d.type === 'import') {
          try {
            const obj = JSON.parse(d.text);
            Store.save(obj, { source: 'settings-import' });
            UI.renderAll();
            this.push();
            UI.toast('设置已导入', 'ok');
          } catch (e) {
            UI.toast('导入失败：不是合法 JSON', 'err');
          }
        } else if (d.type === 'close') {
          if (this.win) this.win.close();
        } else if (d.type === 'diag') {
          Actions.diagnose();
        }
      });
      settingsBus.on(() => this.push());
    },

    push() {
      if (!this.win || this.win.closed) return;
      try {
        this.win.postMessage({ __ncmh: 1, type: 'settings', data: Store.settings, meta: this.meta() }, '*');
      } catch (e) { /* ignore */ }
    },

    flashSaved() {
      if (!this.win || this.win.closed) return;
      try {
        this.win.postMessage({ __ncmh: 1, type: 'saved' }, '*');
      } catch (e) { /* ignore */ }
    },

    meta() {
      const s = UI.state.song;
      return {
        version: VERSION,
        loggedIn: Login.label(),
        dark: UI.isDark(),
        song: s ? s.name + '（id ' + s.id + '）' : '未识别',
        manager: managerName()
      };
    },

    html() {
      const themeVars = `
      --bg:#f5f5f7; --card:#ffffff; --text:#1f1f1f; --text2:#6b6b6b; --text3:#9b9b9b;
      --border:#e6e6ea; --accent:#ec4141; --accent2:#c62f2f; --accent-soft:rgba(236,65,65,.10); --bg2:#f2f2f5;`;
      const themeDark = `
      --bg:#1b1b1b; --card:#252525; --text:#ededed; --text2:#a6a6a6; --text3:#7c7c7c;
      --border:#363636; --accent:#ec4141; --accent2:#c62f2f; --accent-soft:rgba(236,65,65,.18); --bg2:#2f2f2f;`;
      const page = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>网易云音乐 · 合一助手 · 设置</title>
<style>
  :root{${themeVars}}
  html[data-theme="dark"]{${themeDark}}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",Roboto,sans-serif;
       background:var(--bg);color:var(--text);font-size:13.5px;line-height:1.6;-webkit-font-smoothing:antialiased}
  header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:0 22px;height:58px;
         background:var(--card);border-bottom:1px solid var(--border)}
  .logo{width:26px;height:26px;border-radius:50%;background:linear-gradient(150deg,#f25f5f,#e03232);display:flex;align-items:center;justify-content:center}
  .logo svg{width:15px;height:15px}
  h1{font-size:14px;margin:0;font-weight:600;letter-spacing:.2px}
  .ver{font-size:11.5px;color:var(--text3)}
  .spacer{flex:1}
  .chip{font-size:11.5px;padding:3px 9px;border-radius:20px;background:var(--bg2);color:var(--text2);border:1px solid var(--border)}
  .chip.ok{color:#2ea44f;border-color:rgba(46,164,79,.4);background:rgba(46,164,79,.08)}
  .chip.err{color:var(--accent);border-color:var(--accent-soft);background:var(--accent-soft)}
  .layout{display:flex;max-width:1080px;margin:0 auto;padding:22px;gap:22px;align-items:flex-start}
  nav{width:170px;flex:0 0 auto;position:sticky;top:80px;display:flex;flex-direction:column;gap:2px}
  nav button{all:unset;cursor:pointer;padding:9px 12px;border-radius:8px;font-size:13px;color:var(--text2)}
  nav button:hover{background:var(--bg2);color:var(--text)}
  nav button.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
  main{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px}
  section{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
  section > .hd{padding:14px 18px;border-bottom:1px solid var(--border)}
  section > .hd b{font-size:13.5px;font-weight:600}
  section > .hd p{margin:3px 0 0;font-size:12px;color:var(--text3)}
  .rows{padding:6px 18px 14px}
  .row{display:flex;align-items:center;gap:16px;padding:11px 0;border-bottom:1px dashed var(--border)}
  .row:last-child{border-bottom:none}
  .row .lab{flex:1;min-width:0}
  .row .lab b{font-weight:500;font-size:13px}
  .row .lab p{margin:2px 0 0;font-size:11.5px;color:var(--text3)}
  .row .ctl{flex:0 0 auto;min-width:200px;display:flex;justify-content:flex-end}
  input[type=text],input[type=number],select{
    width:220px;font-family:inherit;font-size:12.5px;color:var(--text);background:var(--bg2);
    border:1px solid var(--border);border-radius:7px;padding:7px 10px;outline:none}
  input:focus,select:focus{border-color:var(--accent);background:var(--card)}
  input[type=number]{width:110px}
  .sw{position:relative;display:inline-block;width:42px;height:23px;flex:0 0 auto}
  .sw input{position:absolute;opacity:0;width:0;height:0}
  .sw i{position:absolute;inset:0;background:var(--bg2);border:1px solid var(--border);border-radius:20px;transition:.16s}
  .sw i:before{content:"";position:absolute;left:2px;top:2px;width:17px;height:17px;border-radius:50%;background:#fff;
               box-shadow:0 1px 3px rgba(0,0,0,.25);transition:.16s}
  .sw input:checked + i{background:var(--accent);border-color:var(--accent)}
  .sw input:checked + i:before{transform:translateX(19px)}
  .actions{display:flex;gap:10px;flex-wrap:wrap;padding:14px 18px}
  button.btn{font-family:inherit;font-size:12.5px;padding:8px 14px;border-radius:8px;border:1px solid var(--border);
             background:var(--card);color:var(--text);cursor:pointer}
  button.btn:hover{border-color:var(--accent);color:var(--accent)}
  button.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  button.btn.primary:hover{background:var(--accent2);border-color:var(--accent2);color:#fff}
  .hint{font-size:11.5px;color:var(--text3)}
  .foot{max-width:1080px;margin:0 auto;padding:0 22px 40px;font-size:11.5px;color:var(--text3);line-height:1.9}
  .flash{position:fixed;right:22px;bottom:22px;background:rgba(30,30,30,.94);color:#fff;padding:9px 14px;border-radius:9px;
         font-size:12.5px;opacity:0;transform:translateY(8px);transition:.18s;pointer-events:none;z-index:9}
  .flash.on{opacity:1;transform:none}
  .status{display:flex;gap:18px;flex-wrap:wrap;padding:14px 18px;font-size:12px;color:var(--text2)}
  .status div b{color:var(--text);font-weight:500}
  textarea{width:100%;height:120px;font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--bg2);
           color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;outline:none;resize:vertical}
  @media (max-width:820px){ .layout{flex-direction:column} nav{width:100%;position:static;flex-direction:row;flex-wrap:wrap}
    .row{flex-wrap:wrap} .row .ctl{min-width:0;width:100%;justify-content:flex-start} input[type=text],select{width:100%} }
</style>
</head>
<body>
<header>
  <span class="logo"><svg viewBox="0 0 24 24" fill="none"><path d="M16.5 4.2v11.1a3.1 3.1 0 11-2-2.9V6.6l-5 1.1v9.3a3.1 3.1 0 11-2-2.9V6.1l9-1.9z" fill="#fff"/></svg></span>
  <h1>网易云音乐 · 合一助手</h1><span class="ver" id="ver"></span>
  <span class="spacer"></span>
  <span class="chip" id="chip-login">状态读取中…</span>
  <span class="chip" id="chip-saved">已同步</span>
</header>
<div class="layout">
  <nav id="nav"></nav>
  <main id="main"></main>
</div>
<div class="foot" id="foot"></div>
<div class="flash" id="flash">已保存</div>
<script>
(function(){
  var CHAIN = [["jymaster","超清母带"],["dolby","杜比全景声"],["sky","沉浸环绕声"],["jyeffect","高清臻音"],
               ["hires","高解析度无损"],["lossless","无损"],["exhigh","极高"],["higher","较高"],["standard","标准"]];
  var SCHEMA = [
    { id:"general", title:"通用", desc:"面板外观、列表与状态", items:[
      { k:"theme", type:"select", label:"主题", hint:"auto = 跟随网易云的夜间模式", opts:[["auto","跟随网易云"],["light","浅色"],["dark","深色"]] },
      { k:"listPageSize", type:"select", label:"列表每页条数", hint:"列表页里也能改，改完记住", opts:[["20","20 条"],["50","50 条"],["100","100 条"],["500","500 条"]] }
    ]},
    { id:"download", title:"下载", desc:"音质、命名、目录与取链方式（三路自动降级）", items:[
      { k:"quality", type:"select", label:"默认音质", opts: CHAIN },
      { k:"autoDowngrade", type:"bool", label:"自动降档", hint:"所选音质取不到地址时，自动尝试更低音质，保证能下到东西" },
      { k:"targetLevelOnly", type:"bool", label:"仅目标音质", hint:"只接受与所选音质完全一致的地址，否则跳过（与自动降档互斥）" },
      { k:"nameTemplate", type:"text", label:"文件名模板", hint:"占位符：{artist} {title} {album} {index} {id} {alias}" },
      { k:"folderMode", type:"select", label:"目录结构", opts:[["none","不建目录"],["artist","歌手/" ],["artist-album","歌手/专辑/"]] },
      { k:"concurrent", type:"number", label:"批量并发", hint:"1~8，建议 4；过高容易被风控", min:1, max:8 },
      { k:"applyTag", type:"bool", label:"写入 MP3 标签", hint:"标题/歌手/专辑/内嵌封面与歌词（仅 mp3；flac 走旁挂文件）" },
      { k:"coverSidecar", type:"bool", label:"另存封面文件" },
      { k:"lyricSidecar", type:"bool", label:"另存歌词文件" },
      { k:"skipCloudOwned", type:"bool", label:"跳过云盘已有", hint:"已在云盘的曲目不再下载" },
      { k:"methods.download", type:"bool", label:"方法① 增强下载接口", hint:"/song/enhance/download/url/v1 —— 带完整 md5，最适合快传" },
      { k:"methods.player", type:"bool", label:"方法② 试听播放接口", hint:"/song/enhance/player/url/v1 —— 部分曲目只有这条路" },
      { k:"methods.outer", type:"bool", label:"方法③ 外链直取", hint:"/song/media/outer/url —— 302 到 CDN，老牌兜底" }
    ]},
    { id:"lyric", title:"歌词", desc:"合并与保存格式", items:[
      { k:"lyricMerge", type:"bool", label:"合并翻译", hint:"把中文翻译拼在同一行时间轴之后" },
      { k:"lyricRoma", type:"bool", label:"合并罗马音" },
      { k:"lyricFormat", type:"select", label:"保存格式", opts:[["lrc","LRC（带时间轴）"],["txt","纯文本"]] }
    ]},
    { id:"cloud", title:"云盘", desc:"快传行为", items:[
      { k:"cloud.autoMatch", type:"bool", label:"快传后自动关联曲库", hint:"把云盘文件挂到对应歌曲上，播放时显示为已拥有" }
    ]},
    { id:"net", title:"网络", desc:"请求节奏、身份与超时", items:[
      { k:"requestGapMs", type:"number", label:"请求间隔(ms)", hint:"两次接口调用之间的最小间隔，0~2000", min:0, max:2000 },
      { k:"retry", type:"number", label:"失败重试次数", hint:"0~5，网络抖动时有用", min:0, max:5 },
      { k:"identity", type:"select", label:"请求身份", hint:"客户端身份在个别曲目上音质更好，但可能与网页登录态冲突", opts:[["web","网页（推荐）"],["pc","PC 客户端"],["android","安卓客户端"]] },
      { k:"customUA", type:"text", label:"自定义 UA", hint:"留空使用默认" },
      { k:"debug", type:"bool", label:"记录接口日志", hint:"排错时打开，控制台可看到每个接口返回" }
    ]},
    { id:"data", title:"数据", desc:"备份、导入与重置", items:[] }
  ];

  var S = null, META = {}, dirty = false;
  function $(id){ return document.getElementById(id); }

  function send(type, extra){
    var msg = { __ncmh:1, type:type };
    if (extra) for (var k in extra) msg[k] = extra[k];
    if (window.opener) { try { window.opener.postMessage(msg, "*"); } catch(e){} }
  }

  function getPath(obj, path){
    var parts = path.split("."), cur = obj;
    for (var i=0;i<parts.length;i++){ if (cur == null) return undefined; cur = cur[parts[i]]; }
    return cur;
  }
  function setPath(obj, path, val){
    var parts = path.split("."), cur = obj;
    for (var i=0;i<parts.length-1;i++){ if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {}; cur = cur[parts[i]]; }
    cur[parts[parts.length-1]] = val;
  }

  function buildNav(){
    var nav = $("nav");
    nav.innerHTML = "";
    SCHEMA.forEach(function(sec, i){
      var b = document.createElement("button");
      b.textContent = sec.title;
      if (i === 0) b.className = "active";
      b.onclick = function(){
        var all = nav.querySelectorAll("button");
        for (var j=0;j<all.length;j++) all[j].className = "";
        b.className = "active";
        var el = $(("sec-" + sec.id));
        if (el) el.scrollIntoView({ behavior:"smooth", block:"start" });
      };
      nav.appendChild(b);
    });
  }

  function buildForm(){
    var main = $("main");
    main.innerHTML = "";
    SCHEMA.forEach(function(sec){
      var wrap = document.createElement("section");
      wrap.id = "sec-" + sec.id;
      var hd = document.createElement("div");
      hd.className = "hd";
      hd.innerHTML = "<b>" + sec.title + "</b>" + (sec.desc ? "<p>" + sec.desc + "</p>" : "");
      wrap.appendChild(hd);
      var rows = document.createElement("div");
      rows.className = "rows";
      sec.items.forEach(function(it){ rows.appendChild(buildRow(it)); });
      wrap.appendChild(rows);
      if (sec.id === "general") {
        var st = document.createElement("div");
        st.className = "status";
        st.id = "statusbox";
        st.innerHTML = "<div>版本 <b id=\\"s-ver\\">-</b></div><div>登录 <b id=\\"s-login\\">-</b></div>" +
                       "<div>当前对象 <b id=\\"s-song\\">-</b></div><div>脚本管理器 <b id=\\"s-mgr\\">-</b></div>";
        wrap.insertBefore(st, rows);
      }
      if (sec.id === "data") {
        var act = document.createElement("div");
        act.className = "actions";
        act.innerHTML =
          '<button class="btn" id="btn-diag">运行诊断</button>' +
          '<button class="btn" id="btn-export">导出设置</button>' +
          '<button class="btn" id="btn-import">导入设置</button>' +
          '<button class="btn" id="btn-close">关闭设置页</button>' +
          '<button class="btn" id="btn-reset" style="margin-left:auto;color:var(--accent);border-color:var(--accent-soft)">恢复默认</button>' +
          '<div style="width:100%"><p class="hint">导入：把导出的 JSON 粘进下面文本框，再点"应用导入"。</p>' +
          '<textarea id="import-text" placeholder="{ \\"quality\\": \\"lossless\\" }"></textarea>' +
          '<button class="btn" id="btn-import-apply" style="margin-top:8px">应用导入</button></div>';
        wrap.appendChild(act);
      }
      main.appendChild(wrap);
    });
    bindDataButtons();
  }

  function buildRow(it){
    var row = document.createElement("div");
    row.className = "row";
    var lab = document.createElement("div");
    lab.className = "lab";
    lab.innerHTML = "<b>" + it.label + "</b>" + (it.hint ? "<p>" + it.hint + "</p>" : "");
    var ctl = document.createElement("div");
    ctl.className = "ctl";
    var el;
    if (it.type === "bool") {
      el = document.createElement("label");
      el.className = "sw";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-k", it.k);
      cb.setAttribute("data-t", "bool");
      var knob = document.createElement("i");
      el.appendChild(cb); el.appendChild(knob);
      cb.addEventListener("change", scheduleSave);
    } else if (it.type === "select") {
      el = document.createElement("select");
      el.setAttribute("data-k", it.k);
      el.setAttribute("data-t", "select");
      it.opts.forEach(function(o){
        var op = document.createElement("option");
        op.value = o[0]; op.textContent = o[1];
        el.appendChild(op);
      });
      el.addEventListener("change", scheduleSave);
    } else if (it.type === "range") {
      el = document.createElement("span");
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.gap = "8px";
      var rg = document.createElement("input");
      rg.type = "range";
      rg.min = it.min; rg.max = it.max; rg.step = 5;
      rg.style.width = "150px";
      rg.setAttribute("data-k", it.k);
      rg.setAttribute("data-t", "range");
      if (it.scale) rg.setAttribute("data-scale", it.scale);
      var out = document.createElement("b");
      out.style.minWidth = "38px";
      out.style.textAlign = "right";
      out.style.fontWeight = "500";
      rg.addEventListener("input", function(){ out.textContent = rg.value + "%"; });
      rg.addEventListener("change", scheduleSave);
      el.appendChild(rg);
      el.appendChild(out);
    } else {
      el = document.createElement("input");
      el.type = it.type === "number" ? "number" : "text";
      el.setAttribute("data-k", it.k);
      el.setAttribute("data-t", it.type);
      if (it.min != null) el.min = it.min;
      if (it.max != null) el.max = it.max;
      el.addEventListener("change", scheduleSave);
      el.addEventListener("blur", scheduleSave);
    }
    ctl.appendChild(el);
    row.appendChild(lab);
    row.appendChild(ctl);
    return row;
  }

  function fill(s){
    S = s;
    var nodes = document.querySelectorAll("[data-k]");
    for (var i=0;i<nodes.length;i++){
      var n = nodes[i], k = n.getAttribute("data-k"), t = n.getAttribute("data-t");
      var v = getPath(s, k);
      if (t === "bool") n.checked = !!v;
      else if (t === "range") {
        var scale = Number(n.getAttribute("data-scale")) || 1;
        n.value = Math.round((v == null ? 0 : Number(v)) * scale);
        var out = n.parentNode ? n.parentNode.querySelector("b") : null;
        if (out) out.textContent = n.value + "%";
      }
      else if (t === "number") n.value = v == null ? "" : v;
      else n.value = v == null ? "" : v;
    }
    applyTheme(s.theme, META.dark);
  }

  function collect(){
    var out = {};
    var nodes = document.querySelectorAll("[data-k]");
    for (var i=0;i<nodes.length;i++){
      var n = nodes[i], k = n.getAttribute("data-k"), t = n.getAttribute("data-t");
      var v;
      if (t === "bool") v = n.checked;
      else if (t === "range") {
        var scale = Number(n.getAttribute("data-scale")) || 1;
        v = Number(n.value) / scale;
      }
      else if (t === "number") { v = Number(n.value); if (isNaN(v)) v = 0; }
      else v = n.value;
      setPath(out, k, v);
    }
    return out;
  }

  var saveTimer = null;
  function scheduleSave(){
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      send("save", { patch: collect() });
    }, 240);
  }

  function applyTheme(t, openerDark){
    var dark;
    if (t === "dark") dark = true;
    else if (t === "light") dark = false;
    else dark = !!openerDark;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }

  function updateMeta(meta){
    META = meta || {};
    $("ver").textContent = "v" + (META.version || "");
    var chip = $("chip-login");
    if (META.loggedIn) { chip.textContent = "已登录"; chip.className = "chip ok"; }
    else { chip.textContent = "未登录"; chip.className = "chip err"; }
    if ($("s-ver")) $("s-ver").textContent = META.version || "-";
    if ($("s-login")) $("s-login").textContent = META.loggedIn ? "已登录" : "未登录（云盘/高音质受限）";
    if ($("s-song")) $("s-song").textContent = META.song || "-";
    if ($("s-mgr")) $("s-mgr").textContent = META.manager || "-";
    $("foot").innerHTML = "设置会自动保存到 music.163.com 的本地存储，并同步到面板。<br>" +
      "本页只是设置界面，关掉不影响脚本运行。版本 v" + (META.version || "") + " · 合并自 RunningCheese / cinvin 的 MIT 脚本。";
  }

  function flash(text){
    var f = $("flash");
    f.textContent = text || "已保存";
    f.className = "flash on";
    setTimeout(function(){ f.className = "flash"; }, 1400);
  }

  function downloadText(text, name){
    var blob = new Blob([text], { type:"application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
  }

  function bindDataButtons(){
    var diag = $("btn-diag"); if (diag) diag.onclick = function(){ send("diag"); };
    var exp = $("btn-export"); if (exp) exp.onclick = function(){ send("export"); };
    var imp = $("btn-import"); if (imp) imp.onclick = function(){
      var box = $("import-text");
      if (box) { box.focus(); box.select(); }
      flash("把 JSON 粘到下方文本框，再点应用导入");
    };
    var impApply = $("btn-import-apply"); if (impApply) impApply.onclick = function(){
      var box = $("import-text");
      if (!box || !box.value.trim()) { flash("文本框是空的"); return; }
      send("import", { text: box.value.trim() });
      flash("已应用导入");
    };
    var cls = $("btn-close"); if (cls) cls.onclick = function(){ send("close"); };
    var rst = $("btn-reset"); if (rst) rst.onclick = function(){
      if (confirm("恢复默认设置？当前自定义会被覆盖。")) send("reset");
    };
  }

  window.addEventListener("message", function(ev){
    var d = ev.data;
    if (!d || d.__ncmh !== 1) return;
    if (d.type === "settings") {
      /* 用户正在改（有未确认的保存）时不要用回推值覆盖他的输入，否则会出现"我改的设置自己变回去" */
      updateMeta(d.meta);
      if (!dirty) fill(d.data);
    }
    else if (d.type === "saved") {
      dirty = false;
      $("chip-saved").textContent = "已保存 " + new Date().toTimeString().slice(0,8);
      flash("已保存");
    }
    else if (d.type === "exported") { downloadText(d.text, d.name || "ncmh-settings.json"); }
  });

  /* 切回本标签时主动拉一次最新值（面板里改过的设置，这里要跟上） */
  window.addEventListener("focus", function(){ if (!dirty) send("ready"); });
  document.addEventListener("visibilitychange", function(){
    if (!document.hidden && !dirty) send("ready");
  });

  buildNav();
  buildForm();
  send("ready");
  setTimeout(function(){ send("ready"); }, 300);
})();
</script>
</body>
</html>`;
      return page;
    }
  };

/* ===== part: 60-boot.js ===== */
  /* ==========================================================================
   * 60-boot · 当前对象追踪 / 路由监听 / 菜单 / 启动
   * ======================================================================== */

  function pageUrl() {
    return location.href + ' ' + (location.hash || '');
  }

  /** 页面自带的歌曲 ID（仅在歌曲页有效） */
  function getPageSongId() {
    const all = pageUrl();
    if (!/[\/#]song\b/.test(all)) return null;
    const m = all.match(/[?&#]id=(\d+)/);
    return m ? Number(m[1]) : null;
  }

  /** 播放栏里的歌曲 ID（getPlaying() 返回 {track:{...}, playing:bool}，id 在 .track.id） */
  function getPlayerSongId() {
    try {
      const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const pl = w.player || (w.top && w.top.player);
      if (pl && typeof pl.getPlaying === 'function') {
        const cur = pl.getPlaying();
        const t = cur && (cur.track || cur);
        if (t && t.id) return Number(t.id);
      }
    } catch (e) { /* ignore */ }
    try {
      const bar = document.querySelector('.m-playbar');
      if (bar) {
        const link =
          bar.querySelector('.words .name a[href*="/song?id="]') ||
          bar.querySelector('.words a[href*="/song?id="]') ||
          bar.querySelector('a[href*="/song?id="]');
        if (link) {
          const m = link.getAttribute('href').match(/id=(\d+)/);
          if (m) return Number(m[1]);
        }
      }
      const gPlayer = document.querySelector('#g_player iframe, iframe#g_player');
      if (gPlayer && gPlayer.contentDocument) {
        const a = gPlayer.contentDocument.querySelector('a[href*="/song?id="]');
        if (a) {
          const m = a.getAttribute('href').match(/id=(\d+)/);
          if (m) return Number(m[1]);
        }
      }
      /* 最后兜底：任何指向歌曲页的播放中链接 */
      const anyNow = document.querySelector('.m-playbar [href*="/song?id="], .j-flag [href*="/song?id="]');
      if (anyNow) {
        const m = anyNow.getAttribute('href').match(/id=(\d+)/);
        if (m) return Number(m[1]);
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * 当前对象：pin（手动载入的）> 模式指定 > 自动（详情页 > 正在播放）。
   * pin 会在"页面换到另一首歌"时自动失效，避免"我载入的歌被页面顶掉"或反过来的困惑。
   */
  function resolveTarget(mode) {
    const m = mode || (UI.state.targetMode || 'auto');
    const pageId = getPageSongId();
    const playId = getPlayerSongId();
    let pin = UI.state.pin;

    if (pin && String(pageId || '') !== String(pin.pageAt || '')) {
      UI.state.pin = null;
      if (UI.state.targetMode === 'pinned') UI.state.targetMode = 'auto';
      pin = null;
    }

    if (m === 'pinned' && pin) return { id: pin.id, source: pin.source };
    if (m === 'page') {
      if (pageId) return { id: pageId, source: '页面歌曲' };
      if (pin) return { id: pin.id, source: pin.source };
      if (playId) return { id: playId, source: '正在播放' };
      return null;
    }
    if (m === 'playing') {
      if (playId) return { id: playId, source: '正在播放' };
      if (pin) return { id: pin.id, source: pin.source };
      if (pageId) return { id: pageId, source: '页面歌曲' };
      return null;
    }
    /* auto：pin 优先（手动载入的那首不该被页面抢走） */
    if (pin) return { id: pin.id, source: pin.source };
    if (pageId) return { id: pageId, source: '页面歌曲' };
    if (playId) return { id: playId, source: '正在播放' };
    if (UI.state.song) return { id: UI.state.song.id, source: UI.state.songSource };
    return null;
  }

  const Tracker = {
    lastKey: '',
    lastListKey: '',
    lastPlaying: '',
    timer: null,
    refreshing: false,

    pageSongId: getPageSongId,
    playerSongId: getPlayerSongId,

    /** 播放栏当前曲名（拿不到就空） */
    nowPlayingText() {
      try {
        const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const pl = w.player || (w.top && w.top.player);
        if (pl && typeof pl.getPlaying === 'function') {
          const cur = pl.getPlaying();
          const t = cur && (cur.track || cur);
          if (t && t.name) return t.name;
        }
      } catch (e) { /* ignore */ }
      try {
        const bar = document.querySelector('.m-playbar');
        if (bar) {
          const nm = bar.querySelector('.words .name a');
          if (nm && nm.textContent.trim()) return nm.textContent.trim();
        }
      } catch (e) { /* ignore */ }
      return '';
    },

    /** 网页播放器当前是否在播（getPlaying().playing） */
    isPlaying() {
      try {
        const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const pl = w.player || (w.top && w.top.player);
        if (pl && typeof pl.getPlaying === 'function') {
          const cur = pl.getPlaying();
          if (cur && typeof cur.playing === 'boolean') return cur.playing;
        }
      } catch (e) { /* ignore */ }
      try {
        const ply = document.querySelector('.m-playbar .btns .ply');
        if (ply) return /\bpause\b|pause/.test(ply.className);
      } catch (e) { /* ignore */ }
      return false;
    },

    /** 在页面或 #g_player 里找播放控制元素（新版/旧版播放器都试） */
    findPlayerControl(kind) {
      const map = {
        prev: ['.m-playbar .btns .prv', '.m-playbar .prv', '.m-playbar [data-action="prev"]'],
        next: ['.m-playbar .btns .nxt', '.m-playbar .nxt', '.m-playbar [data-action="next"]'],
        toggle: ['.m-playbar .btns .ply', '.m-playbar .ply', '.m-playbar [data-action="play"]']
      };
      const sels = map[kind] || [];
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          if (el) return el;
        } catch (e) { /* ignore */ }
      }
      /* 旧版播放器在 iframe 里 */
      try {
        const fr = document.querySelector('#g_player iframe, iframe#g_player');
        const doc = fr && fr.contentDocument;
        if (doc) {
          for (const s of sels) {
            const el = doc.querySelector(s);
            if (el) return el;
          }
        }
      } catch (e) { /* ignore */ }
      return null;
    },

    /** 点页面原生控制条按钮（最稳，不依赖播放器内部 API） */
    pressPlayer(sel, fallbackNames) {
      const kind = /prv/.test(sel) ? 'prev' : /nxt/.test(sel) ? 'next' : 'toggle';
      const el = this.findPlayerControl(kind);
      if (el) {
        try {
          el.click();
          return true;
        } catch (e) { /* ignore */ }
      }
      try {
        const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (w.player && fallbackNames) {
          for (const fn of fallbackNames) {
            if (typeof w.player[fn] === 'function') {
              w.player[fn]();
              return true;
            }
          }
        }
      } catch (e) { /* ignore */ }
      return false;
    },

    async refresh(force) {
      if (this.refreshing) return;
      const target = resolveTarget();
      /* 播放栏换了歌：即使当前目标是详情页，也要让卡片上的"跟着它"提示更新 */
      const nowId = getPlayerSongId();
      if (String(nowId || '') !== this.lastPlaying) {
        this.lastPlaying = String(nowId || '');
        UI.renderSongCard();
      }
      if (!target) {
        if (UI.state.song && force) {
          UI.state.song = null;
          UI.state.songSource = '';
          UI.renderSongCard();
        }
        return;
      }
      const key = target.id + '@' + target.source;
      if (!force && key === this.lastKey) return;
      this.lastKey = key;
      this.refreshing = true;
      try {
        const detail = await Api.songDetail([target.id]);
        const songs = normalizeSongs(detail.songs, detail.privileges);
        if (!songs.length) {
          UI.setStatus('读取歌曲信息失败（id ' + target.id + '）');
          return;
        }
        UI.state.song = songs[0];
        UI.state.songSource = target.source;
        UI.renderSongCard();
        if (UI.state.tab === 'song') UI.renderBody();
        UI.setStatus(`当前：${songs[0].name} · ${pickLevelLabel(songs[0].privilege.plLevel)}`);
      } catch (e) {
        warn('读取歌曲详情失败', e);
        UI.setStatus('读取歌曲信息失败：' + ((e && e.message) || e));
      } finally {
        this.refreshing = false;
      }
    },

    checkListContext() {
      const src = ListSource.detect();
      const key = src ? src.type + ':' + src.id : '';
      if (key === this.lastListKey) return;
      this.lastListKey = key;
      /* 换了列表页 → 旧列表作废，避免"以为在下 A 歌单其实下 B" */
      if (UI.state.list && UI.state.list.id !== (src && src.id)) {
        UI.state.list = null;
        UI.state.listError = '';
      }
      if (UI.state.tab === 'list') UI.renderBody();
    },

    start() {
      const tick = () => {
        this.checkRoute();
        this.checkListContext();
        this.refresh(false);
      };
      tick();
      this.timer = setInterval(tick, 1500);
      window.addEventListener('hashchange', () => setTimeout(tick, 120));
      window.addEventListener('popstate', () => setTimeout(tick, 120));
      /* 播放栏变化立刻刷新 */
      try {
        const bar = document.querySelector('.m-playbar');
        if (bar) {
          const mo = new MutationObserver(() => {
            clearTimeout(this._moTimer);
            this._moTimer = setTimeout(() => this.refresh(false), 350);
          });
          mo.observe(bar, { childList: true, subtree: true, characterData: true });
        }
      } catch (e) { /* ignore */ }
    },

    checkRoute() {
      const key = location.href;
      if (key === this._routeKey) return;
      this._routeKey = key;
      setTimeout(() => {
        this.refresh(true);
        UI.renderBody();
      }, 260);
    }
  };

  /* ---------------- 菜单 / 快捷键 ---------------- */

  function registerMenus() {
    if (!GM_AVAILABLE.menu) return;
    try {
      GM_registerMenuCommand('打开/收起 面板', () => UI.toggle());
      GM_registerMenuCommand('打开设置页', () => SettingsPage.open());
      GM_registerMenuCommand('下载当前歌曲', () => Actions.run('dl-song'));
      GM_registerMenuCommand('运行诊断', () => Actions.run('diag'));
    } catch (e) {
      warn('注册菜单失败', e);
    }
  }

  function bindHotkey() {
    document.addEventListener(
      'keydown',
      (ev) => {
        if (ev.altKey && ev.shiftKey && (ev.key === 'M' || ev.key === 'm')) {
          ev.preventDefault();
          UI.toggle();
        }
      },
      true
    );
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    /* 只在顶层文档挂面板，iframe 里运行会得到一堆重复入口 */
    try {
      if (window.top !== window.self) return;
    } catch (e) {
      return;
    }
    if (document.getElementById('ncmh-host')) return;

    Store.load();
    watchSettings();
    UI.state.tab = ['song', 'list', 'cloud', 'tool'].includes(Store.ui.tab) ? Store.ui.tab : 'song';
    UI.state.targetMode = ['auto', 'page', 'playing'].includes(Store.ui.targetMode) ? Store.ui.targetMode : 'auto';
    if (Store.settings.listPageSize) UI.state.listQuery.size = Number(Store.settings.listPageSize) || 20;

    try {
      UI.mount();
    } catch (e) {
      logError('面板挂载失败', e);
      return;
    }

    registerMenus();
    bindHotkey();
    Tracker.start();

    settingsBus.on((s) => {
      UI.applyTheme();
      UI.renderAll();
    });

    /* 暴露一个外部抓手，便于在控制台排错 */
    try {
      const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      w.__NCMH__ = {
        version: VERSION,
        kernel: KERNEL,
        settings: () => Store.settings,
        open: () => UI.open(),
        close: () => UI.close(),
        diag: () => DIAG.text(),
        clearDiag: () => DIAG.clear(),
        resolve: (id, level) => resolveSongUrl({ id }, { level }),
        openSettings: () => SettingsPage.open()
      };
    } catch (e) { /* ignore */ }

    /* 登录态：接口判定（read 不到 HttpOnly cookie，所以不猜 cookie） */
    Login.ensure().then((on) => {
      log('已启动 v' + VERSION, '登录：' + (on ? '是' + (Login.profile && Login.profile.nickname ? '（' + Login.profile.nickname + '）' : '') : '否'));
      UI.syncControls();
    });
  }

  /* 导出纯函数内核（浏览器里无副作用，供单元测试与诊断使用） */
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.__NCMH_KERNEL__ = Object.assign({}, KERNEL, {
        buildId3Tag,
        stripId3,
        detectAudioFormat,
        parseLrc,
        mergeLyric,
        lyricToPlain,
        buildListExport,
        normalizeSong,
        parseRefs,
        /* 内部件：供端到端脚本直接驱动（浏览器里也无副作用） */
        internals: {
          Store,
          Api,
          Login,
          DEV_TOOLS,
          weapi,
          weapiBody,
          resolveSongUrl,
          getLyric,
          downloadSong,
          cloudQuickUpload,
          ListSource,
          normalizeSongs,
          coverUrlOf,
          fetchBinary,
          probeUrl,
          playInPage,
          pauseInPage,
          findPageAudio,
          METHOD_META,
          METHOD_ORDER,
          settingsHtml: () => SettingsPage.html(),
          DEFAULT_SETTINGS,
          /* 与"设置页 postMessage → Store.save"完全同一条路径，供回归测试驱动 */
          applySettingsPatch: (patch) => {
            Store.save(patch, { source: 'settings-page' });
            UI.renderAll();
          },
          UI,
          Actions,
          layoutPanel: UI.layoutPanel.bind(UI)
        }
      });
    }
  } catch (e) { /* ignore */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();


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

  const VERSION = '1.4.0';
  const LOG_PREFIX = '[NCMH]';
  const ORIGIN = 'https://music.163.com';
  /**
   * 开发期工具开关（导出登录态等"只给排错用"的入口）。
   * 构建正式版时用 `python scripts\01-build.py --release` 会把它改成 false，
   * 并把标记了 `#region dev-only` 的实现整段剥掉。
   */
  const DEV_TOOLS = true;

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

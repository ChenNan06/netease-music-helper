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

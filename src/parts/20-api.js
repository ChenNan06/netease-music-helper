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

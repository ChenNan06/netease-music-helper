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

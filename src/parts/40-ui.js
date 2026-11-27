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
/* 3px 极简进度条：单曲取字节/批量整体进度都用它，比在正文里堆文字安静得多 */
.slimbar { height: 3px; background: var(--bg3); overflow: hidden; position: relative; }
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
    <div class="pfrow"><span class="status" id="status">就绪</span></div>
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
     * 底部 2px 进度条
     * @param {number|'indet'|null} v 百分比 / 不确定动画 / null=隐藏
     */
    slim(v) {
      const bar = this.wrap && this.wrap.querySelector('#slimbar');
      const fill = bar && bar.querySelector('i');
      if (!bar || !fill) return;
      if (v == null) {
        bar.className = 'slimbar';
        fill.style.width = '0%';
        return;
      }
      if (v === 'indet') {
        bar.className = 'slimbar indet';
        return;
      }
      bar.className = 'slimbar on';
      fill.style.width = clamp(Number(v) || 0, 0, 100) + '%';
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

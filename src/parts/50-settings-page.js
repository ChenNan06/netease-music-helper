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

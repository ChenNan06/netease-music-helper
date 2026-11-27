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
        // #region dev-only
        if (act === 'export-session') return this.exportSession();
        // #endregion dev-only
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

    // #region dev-only
    /**
     * 导出登录态（**开发期工具**，正式版构建会整段剥离）。
     * 关键：登录 cookie 多为 HttpOnly，`document.cookie` 读不到 →
     *       优先用 GM_cookie（脚本管理器能读到 HttpOnly），读不到再退 document.cookie，
     *       两条都不行就给出 DevTools 手动复制的路径，而不是一句"检测不到登录态"。
     */
    async exportSession() {
      const wanted = ['MUSIC_U', 'MUSIC_A', 'MUSIC_R_U', '__csrf', 'NMTID', 'deviceId', 'os', 'appver', 'channel', 'MUSIC_SNS'];
      const pick = (list) => {
        const map = {};
        list.forEach((c) => {
          const k = c && (c.name || c.key);
          const v = c && (c.value || '');
          if (!k) return;
          if (wanted.indexOf(k) >= 0 || /^MUSIC_/.test(k)) map[k] = v;
        });
        return map;
      };

      /* ① GM_cookie：唯一能拿到 HttpOnly cookie 的通道 */
      let map = {};
      let via = '';
      if (typeof GM_cookie !== 'undefined' && GM_cookie && typeof GM_cookie.list === 'function') {
        map = await new Promise((resolve) => {
          let done = false;
          const finish = (v) => { if (!done) { done = true; resolve(v || {}); } };
          try {
            GM_cookie.list({ domain: '.music.163.com', path: '/' }, (cookies, err) => {
              if (err || !cookies || !cookies.length) {
                GM_cookie.list({ domain: 'music.163.com' }, (c2, e2) => finish(e2 ? {} : pick(c2 || [])));
              } else {
                finish(pick(cookies));
              }
            });
          } catch (e) {
            finish({});
          }
          setTimeout(() => finish({}), 3000);
        });
        if (map.MUSIC_U) via = 'GM_cookie';
      }

      /* ② document.cookie（非 HttpOnly 的部分能读到） */
      if (!map.MUSIC_U) {
        const fromDoc = pick(String(document.cookie || '').split(';').map((part) => {
          const i = part.indexOf('=');
          if (i < 0) return null;
          return { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
        }).filter(Boolean));
        if (fromDoc.MUSIC_U) {
          map = fromDoc;
          via = 'document.cookie';
        } else if (Object.keys(fromDoc).length) {
          map = Object.assign({}, fromDoc, map);
        }
      }

      if (!map.MUSIC_U) {
        const on = await Login.ensure(true);
        UI.modal(
          '读不到登录 cookie',
          `<div class="note">当前<b>${on ? '已登录' : '未登录'}</b>（按接口判定${on && Login.profile ? '：' + escapeHtml(Login.profile.nickname) : ''}），
           但浏览器不允许脚本读取 <code>MUSIC_U</code>（它是 HttpOnly）。</div>
           <div class="note" style="margin-top:8px">手动取法（一次性）：<br>
           1. 按 F12 打开开发者工具 → <b>Application / 应用</b> → <b>Cookies</b> → <code>https://music.163.com</code>；<br>
           2. 找到 <code>MUSIC_U</code> 和 <code>__csrf</code>，把值复制给我（或自己填进 session JSON）；<br>
           3. 想作废：网页版点退出登录。</div>`,
          [{ text: '知道了', primary: true }]
        );
        return;
      }

      const payload = {
        version: 1,
        origin: ORIGIN,
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        via,
        cookies: map
      };
      const text = JSON.stringify(payload, null, 2);
      await saveBytes(textEncoder.encode(text), 'ncmh-session.json', 'application/json');
      const ok = await copyText(text);
      UI.modal(
        '登录态已导出',
        '通道：<b>' + escapeHtml(via) + '</b>，字段：' + escapeHtml(Object.keys(map).join(', ')) + '。<br><br>' +
          '已保存为 <b>ncmh-session.json</b>' + (ok ? '，并复制到剪贴板' : '') + '。<br><br>' +
          '这个文件等同于一次性登录凭据（含 MUSIC_U），<b>只放在本机 tools\\session.json 用于排错</b>，' +
          '不要发给别人、不要提交到仓库。想让它立即失效：在网易云网页版退出登录即可。',
        [{ text: '知道了', primary: true }]
      );
    }
    // #endregion dev-only
  };

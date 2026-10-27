/**
 * Part 8: 准应用层（标签页系统 / 主题系统 / 存档管理）
 * 依赖：wiki-core.js、wiki-storage.js（app 与 app.storageManager）
 *  - 标签页：词条详情/编辑以"浏览器式标签页"呈现，可拖拽排序、可关闭；
 *            有词条标签时"首页"固定置前且不可拖拽/关闭。
 *  - 主题：浅色/深色/自定义三种模式，自定义背景图片（保存到本地存档/OPFS）与文字颜色。
 *  - 存档：桌面模式下 新建/导入/切换/删除 存档，可更换数据根目录。
 */
(function() {
  if (typeof app === 'undefined') {
    console.error('wiki-features-app.js: app 对象未定义');
    return;
  }

  // ============================================================
  // 1. 标签页系统
  // ============================================================
  app.tabsSystem = {
    list: [],          // [{id, kind:'entry'|'edit', entryId, versionId, title}]
    activeTabId: null,
    _sortable: null,
    _initialized: false,

    init() {
      if (this._initialized) return;
      this._initialized = true;
      this.list = [];
      this.activeTabId = null;
      this.renderTabBar();

      const bar = document.getElementById('tab-bar');
      if (bar && typeof Sortable !== 'undefined' && !this._sortable) {
        this._sortable = new Sortable(bar, {
          animation: 150,
          filter: '.tab-home',          // 首页固定标签不可拖拽
          draggable: '.tab-item:not(.tab-home)',
          ghostClass: 'sortable-ghost',
          onEnd: () => {
            // 按 DOM 顺序同步 tabs.list
            const order = [];
            bar.querySelectorAll('.tab-item[data-tab-id]').forEach(el => {
              const tab = this.list.find(t => t.id === el.dataset.tabId);
              if (tab) order.push(tab);
            });
            if (order.length === this.list.length) this.list = order;
          }
        });
      }
    },

    /** 是否有激活的词条（非首页）标签 */
    hasActiveEntryTab() {
      return !!this.list.find(t => t.id === this.activeTabId);
    },

    /** 当前激活标签的内容容器（pane） */
    getActivePane() {
      return document.querySelector('.tab-pane[data-pane-id="' + this.activeTabId + '"]');
    },

    /** 词条标题（标签显示名） */
    getEntryTitle(entry, versionId) {
      if (!entry) return '词条';
      if (versionId) {
        const v = entry.versions.find(x => x.vid === versionId);
        if (v && v.title) return v.title;
      }
      try {
        const vv = app.getVisibleVersion ? app.getVisibleVersion(entry) : null;
        if (vv && vv.title) return vv.title;
      } catch (e) {}
      return entry.code || entry.id;
    },

    /**
     * 打开/激活词条标签（核心入口）
     * 唯一键 = 词条id + 版本id：同一词条的【不同版本】可同时打开为独立标签；
     * 同一词条同一版本重复打开则激活已有标签。
     * entryId 为空 → 新建词条（"新词条"编辑标签）。
     */
    ensureEntryTab(entryId, versionId, editMode) {
      // ---- 新建词条：创建/复用"新词条"编辑标签 ----
      if (!entryId) {
        let tab = this.list.find(t => t.kind === 'edit' && !t.entryId);
        if (!tab) {
          tab = {
            id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            kind: 'edit',
            entryId: null,
            versionId: null,
            title: '新词条',
            entryTitle: '新词条',
            code: ''
          };
          this.list.push(tab);
        }
        this.activeTabId = tab.id;
        app.data.editingId = null;
        app.data.editingVersionId = null;
        app.data.viewingVersionId = null;
        this.renderTabBar();
        this.activateTab(tab.id, { render: true, editMode: true });
        return;
      }

      const entry = (app.data.entries || []).find(e => e.id === entryId);
      const targetVid = versionId || (entry && entry.versions[0] && entry.versions[0].vid) || null;

      // 同词条同版本：复用标签（含编辑/详情形态切换）
      let tab = this.list.find(t =>
        t.entryId === entryId &&
        t.versionId === targetVid &&
        t.kind === (editMode ? 'edit' : 'entry')
      );
      if (!tab) {
        // 同词条同版本但形态不同 → 转换形态
        const existing = this.list.find(t => t.entryId === entryId && t.versionId === targetVid);
        if (existing) {
          tab = existing;
          tab.kind = editMode ? 'edit' : 'entry';
        } else {
          // "新词条"标签（未保存）可被保存后的词条接管；否则新开标签
          const newTab = this.list.find(t => t.kind === 'edit' && !t.entryId);
          if (newTab) {
            tab = newTab;
            tab.entryId = entryId;
            tab.versionId = targetVid;
            tab.kind = editMode ? 'edit' : 'entry';
          } else {
            // 不同版本 → 新开标签
            tab = {
              id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
              kind: editMode ? 'edit' : 'entry',
              entryId: entryId,
              versionId: targetVid,
              title: this.getEntryTitle(entry, targetVid),
              entryTitle: this.getEntryTitle(entry, null),
              code: entry ? (entry.code || '') : ''
            };
            this.list.push(tab);
          }
        }
      } else {
        if (targetVid) tab.versionId = targetVid;
      }
      if (targetVid) {
        tab.title = this.getEntryTitle(entry, targetVid);
        tab.entryTitle = this.getEntryTitle(entry, null);
        if (entry) tab.code = entry.code || '';
      }
      this.activeTabId = tab.id;
      app.data.editingId = entryId;
      if (targetVid) app.data.viewingVersionId = targetVid;
      this.renderTabBar();
      this.activateTab(tab.id, { render: true, editMode: editMode });
    },

    /** 激活指定标签（显示 pane 并渲染） */
    activateTab(tabId, opts) {
      opts = opts || {};
      const tab = this.list.find(t => t.id === tabId);
      if (!tab) return;
      this.activeTabId = tabId;
      app.data.currentView = (tab.kind === 'edit') ? 'edit' : 'detail';

      // 容器显隐：主容器隐藏，标签容器显示
      const mainContainer = document.getElementById('main-container');
      const tabContainer = document.getElementById('tab-container');
      const tabBarWrapper = document.getElementById('tab-bar-wrapper');
      if (mainContainer) mainContainer.classList.add('hidden');
      if (tabContainer) { tabContainer.classList.remove('hidden'); tabContainer.style.display = 'block'; }
      if (tabBarWrapper) tabBarWrapper.classList.remove('hidden');

      // 获取/创建 pane
      let pane = document.querySelector('.tab-pane[data-pane-id="' + tabId + '"]');
      if (!pane) {
        pane = document.createElement('div');
        pane.className = 'tab-pane h-full overflow-hidden';
        pane.dataset.paneId = tabId;
        if (tabContainer) tabContainer.appendChild(pane);
      }
      tabContainer.querySelectorAll('.tab-pane').forEach(p => {
        p.style.display = (p.dataset.paneId === tabId) ? 'block' : 'none';
      });

      this.renderTabBar();
      if (typeof app.updateUI === 'function') app.updateUI();

      // 渲染内容（先清空 pane，防止反复切换时模板累积堆叠）
      try {
        if (pane) pane.innerHTML = '';
        if (tab.kind === 'edit') {
          app.data.editingId = tab.entryId;
          app.data.editingVersionId = tab.versionId;
          app.data.viewingVersionId = tab.versionId;
          if (typeof app.renderEdit === 'function') app.renderEdit(pane);
          else pane.innerHTML = '<div class="p-8 text-center text-gray-400">编辑模块未加载</div>';
        } else {
          // 【关键修复】详情标签必须同步 editingId，否则点击标签时 editingId 残留上一个词条，
          // renderDetail 会渲染错误的词条并触发残留隐藏词条的密码弹窗
          app.data.editingId = tab.entryId;
          app.data.viewingVersionId = tab.versionId || app.data.viewingVersionId;
          if (typeof app.renderDetail === 'function') app.renderDetail(pane);
          else pane.innerHTML = '<div class="p-8 text-center text-gray-400">详情模块未加载</div>';
        }
      } catch (e) {
        console.error('[Tabs] 渲染标签内容失败:', e);
        pane.innerHTML = '<div class="p-8 text-center text-red-500">渲染失败: ' + (e.message || e) + '</div>';
      }

      // 同步 hash（便于刷新后恢复）
      try {
        history.replaceState({ view: tab.kind === 'edit' ? 'edit' : 'detail' }, '', '#' + (tab.kind === 'edit' ? 'edit' : 'detail'));
      } catch (e) {}
    },

    /** 首页固定标签：显示主容器并进入首页 */
    activateHomeTab() {
      this.activeTabId = 'home';
      const mainContainer = document.getElementById('main-container');
      const tabContainer = document.getElementById('tab-container');
      const tabBarWrapper = document.getElementById('tab-bar-wrapper');
      if (mainContainer) mainContainer.classList.remove('hidden');
      if (tabContainer) { tabContainer.classList.add('hidden'); tabContainer.style.display = 'none'; }
      if (tabBarWrapper && this.list.length === 0) tabBarWrapper.classList.add('hidden');
      this.renderTabBar();
      if (typeof app.router === 'function') app.router('home');
    },

    /** 关闭标签 */
    closeTab(tabId) {
      const idx = this.list.findIndex(t => t.id === tabId);
      if (idx === -1) return;
      const wasActive = this.activeTabId === tabId;
      this.list.splice(idx, 1);
      const pane = document.querySelector('.tab-pane[data-pane-id="' + tabId + '"]');
      if (pane) pane.remove();

      if (this.list.length === 0) {
        // 全部关闭 → 隐藏标签栏，回首页
        this.activeTabId = null;
        const tabContainer = document.getElementById('tab-container');
        const mainContainer = document.getElementById('main-container');
        if (tabContainer) { tabContainer.classList.add('hidden'); tabContainer.style.display = 'none'; }
        if (mainContainer) mainContainer.classList.remove('hidden');
        this.renderTabBar();
        if (typeof app.router === 'function') app.router('home');
        return;
      }
      this.renderTabBar();
      if (wasActive) {
        const next = this.list[Math.min(idx, this.list.length - 1)];
        this.activateTab(next.id, { render: true });
      }
    },

    /** 关闭所有标签页（切换存档时使用）：移除全部词条标签与对应 pane，隐藏标签栏，回首页 */
    closeAllTabs() {
      this.list = [];
      this.activeTabId = null;
      // 移除所有词条 pane
      const tabContainer = document.getElementById('tab-container');
      if (tabContainer) {
        tabContainer.querySelectorAll('.tab-pane').forEach(p => p.remove());
        tabContainer.classList.add('hidden');
        tabContainer.style.display = 'none';
      }
      const tabBarWrapper = document.getElementById('tab-bar-wrapper');
      if (tabBarWrapper) tabBarWrapper.classList.add('hidden');
      const mainContainer = document.getElementById('main-container');
      if (mainContainer) mainContainer.classList.remove('hidden');
      this.renderTabBar();
    },

    /** 更新标签标题（词条名/版本名变化后刷新） */
    updateTabTitle(entryId, title) {
      const entry = (app.data.entries || []).find(e => e.id === entryId);
      this.list.forEach(t => {
        if (t.entryId === entryId) {
          if (title) {
            // title 是"版本标题"（保存后由当前版本传入）
            const v = entry && entry.versions.find(x => x.vid === t.versionId);
            if (v && v.title) t.title = v.title;
            else if (t.versionId && title) t.title = title;
          }
          t.entryTitle = entry ? this.getEntryTitle(entry, null) : t.entryTitle;
        }
      });
      this.renderTabBar();
    },

    /** 渲染标签栏（首页固定 + 词条标签） */
    renderTabBar() {
      const wrapper = document.getElementById('tab-bar-wrapper');
      const bar = document.getElementById('tab-bar');
      if (!bar || !wrapper) return;
      if (this.list.length === 0) {
        wrapper.classList.add('hidden');
        bar.innerHTML = '';
        return;
      }
      wrapper.classList.remove('hidden');
      bar.innerHTML = '';

      // 首页固定标签（不可拖拽、不可关闭，始终第一位）
      const homeTab = document.createElement('div');
      homeTab.className = 'tab-item tab-home' + (this.activeTabId === 'home' ? ' active' : '');
      homeTab.title = '首页';
      homeTab.innerHTML = '<i class="fa-solid fa-house"></i><span>首页</span>';
      homeTab.onclick = (e) => { e.stopPropagation(); this.activateHomeTab(); };
      bar.appendChild(homeTab);

      // 词条标签
      this.list.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'tab-item' + (tab.id === this.activeTabId ? ' active' : '');
        el.dataset.tabId = tab.id;
        // 主标题（词条名/版本名），版本不同时用灰字追加标注
        let titleHtml = app.escapeHtml ? app.escapeHtml(tab.title) : String(tab.title);
        const showVersion = tab.title && tab.entryTitle && tab.title !== tab.entryTitle;
        if (showVersion) {
          titleHtml = '<span class="tab-main-title">' + (app.escapeHtml ? app.escapeHtml(tab.entryTitle) : String(tab.entryTitle)) + '</span>' +
            '<span class="tab-version-title">·' + (app.escapeHtml ? app.escapeHtml(tab.title) : String(tab.title)) + '</span>';
        }
        el.innerHTML =
          '<span class="tab-icon"><i class="fa-solid ' + (tab.kind === 'edit' ? 'fa-pen' : 'fa-file-lines') + '"></i></span>' +
          '<span class="tab-title">' + titleHtml + '</span>' +
          '<span class="tab-close" title="关闭标签"><i class="fa-solid fa-xmark"></i></span>';
        el.onclick = (e) => {
          if (e.target.closest('.tab-close')) return;
          this.activateTab(tab.id, { render: true });
        };
        el.querySelector('.tab-close').onclick = (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        };
        bar.appendChild(el);
      });
    }
  };

  // 词条视图容器选择器（标签模式 → 当前 pane；否则主容器）
  app.getEntryContainer = function() {
    if (this.tabsSystem && this.tabsSystem.hasActiveEntryTab()) {
      const pane = this.tabsSystem.getActivePane();
      if (pane) return pane;
    }
    return document.getElementById('main-container');
  };

  // ============================================================
  // 2. 主题系统（预设色 / 背景模式 / 文字模式 / 浅色微调 / 背景图片）
  app.theme = {
    preset: 'blue',          // 预设色 blue/sakura/brown/green/purple/orange/red/teal
    bgMode: 'white',         // 背景模式 white/light/dark/black
    lightTone: 50,           // 浅色模式深浅微调 0-100
    textMode: 'black-white', // 文字模式 black-white / deep-light
    bgImage: null,           // 自定义背景图 {{IMG:...}} 或 dataURL
    _applyTimer: null,

    PRESETS: {
      blue:   { label: '蓝色', accent: '#4f46e5', accentDark: '#4338ca', light: '#eef2ff', lightText: '#3730a3', darkText: '#e0e7ff' },
      sakura: { label: '樱花', accent: '#ec4899', accentDark: '#db2777', light: '#fdf2f8', lightText: '#be185d', darkText: '#fbcfe8' },
      brown:  { label: '棕色', accent: '#8b5e3c', accentDark: '#6b4423', light: '#f7f1ea', lightText: '#5c3a1e', darkText: '#e8d5c4' },
      green:  { label: '绿色', accent: '#10b981', accentDark: '#059669', light: '#ecfdf5', lightText: '#047857', darkText: '#a7f3d0' },
      purple: { label: '紫色', accent: '#8b5cf6', accentDark: '#7c3aed', light: '#f5f3ff', lightText: '#6d28d9', darkText: '#ddd6fe' },
      orange: { label: '橙色', accent: '#f97316', accentDark: '#ea580c', light: '#fff7ed', lightText: '#c2410c', darkText: '#fed7aa' },
      red:    { label: '红色', accent: '#ef4444', accentDark: '#dc2626', light: '#fef2f2', lightText: '#b91c1c', darkText: '#fecaca' },
      teal:   { label: '青绿', accent: '#14b8a6', accentDark: '#0d9488', light: '#f0fdfa', lightText: '#0f766e', darkText: '#99f6e4' }
    },

    restore() {
      const t = (app.data && app.data.settings && app.data.settings.theme) || {};
      // 兼容旧字段迁移
      this.preset = (t.preset && this.PRESETS[t.preset]) ? t.preset : 'blue';
      if (t.bgMode) this.bgMode = t.bgMode;
      else if (t.mode === 'dark') this.bgMode = 'dark';
      else if (t.mode === 'custom') this.bgMode = 'light';
      else this.bgMode = 'white';
      this.lightTone = (typeof t.lightTone === 'number') ? Math.max(5, Math.min(95, t.lightTone)) : 50;
      this.textMode = (t.textMode === 'deep-light') ? 'deep-light' : 'black-white';
      this.bgImage = t.bgImage || null;
      this.apply();
    },

    getPreset() { return this.PRESETS[this.preset] || this.PRESETS.blue; },

    apply() {
      const body = document.body;
      if (!body) return;
      const root = document.documentElement;
      const p = this.getPreset();
      const isDarkBg = (this.bgMode === 'dark' || this.bgMode === 'black');

      body.classList.remove('theme-white', 'theme-light', 'theme-dark', 'theme-black', 'theme-custom', 'theme-bg-image');
      body.classList.add('theme-' + this.bgMode);
      body.setAttribute('data-accent', this.preset);

      // ---- 背景/卡片/边框（浅色/深色均基于预设色动态调整） ----
      let bg, card, border;
      if (this.bgMode === 'white') { bg = '#ffffff'; card = '#ffffff'; border = '#e5e7eb'; }
      else if (this.bgMode === 'light') {
        const t = this.lightTone / 100;
        // 浅色背景：白底 + 预设重点色晕染（可清晰感知的浅蓝/浅棕/浅粉…）
        bg = this.mixColor('#ffffff', p.accent, 0.06 + t * 0.14);
        card = this.mixColor(bg, '#ffffff', 0.62);
        border = this.mixColor(bg, '#000000', 0.06 + t * 0.06);
      } else if (this.bgMode === 'dark') {
        // 深色背景：深底 #18212f + 明显预设色倾向（如蓝色→深蓝、棕色→深棕）
        bg = this.mixColor('#18212f', p.accent, 0.18);
        card = this.mixColor(bg, '#ffffff', 0.10);
        border = this.mixColor(bg, '#ffffff', 0.18);
      } else {
        // 黑色背景：固定 #18212f，文字一律白/浅色
        bg = '#18212f';
        card = this.mixColor(bg, '#ffffff', 0.07);
        border = this.mixColor(bg, '#ffffff', 0.14);
      }

      // ---- 文字（"深色+浅色"跟随预设色：深蓝+浅蓝 / 深棕+浅棕 等） ----
      let text, muted;
      if (this.textMode === 'black-white') {
        text = isDarkBg ? '#f5f5f5' : '#1a1a1a';
        muted = isDarkBg ? '#9ca3af' : '#6b7280';
      } else {
        // 主文字 = 预设的深/浅色调；次要文字 = 主文字向白混合（浅蓝/浅棕…）
        text = isDarkBg ? p.darkText : p.lightText;
        muted = this.mixColor(text, '#ffffff', 0.35);
      }

      // ---- 重点色（联动全局 indigo 元素） ----
      let accentLight;
      if (this.bgMode === 'light') accentLight = this.mixColor('#ffffff', p.accent, 0.10 + (this.lightTone / 100) * 0.10);
      else if (isDarkBg) accentLight = this.mixColor(bg, p.accent, 0.28);
      else accentLight = p.light;

      root.style.setProperty('--app-bg', bg);
      root.style.setProperty('--app-card', card);
      root.style.setProperty('--app-border', border);
      root.style.setProperty('--app-text', text);
      root.style.setProperty('--app-muted', muted);
      root.style.setProperty('--app-accent', p.accent);
      root.style.setProperty('--app-accent-light', accentLight);

      // ---- 背景图片 ----
      if (this.bgImage) {
        const showBg = () => {
          if (!this.bgImage) return;
          let url = this.bgImage;
          if (url.startsWith('{{IMG:')) {
            const m = url.match(/\{\{IMG:(.+?)\}\}/);
            if (m && app.storageManager && app.storageManager.memoryCache.has(m[1])) {
              url = app.storageManager.memoryCache.get(m[1]);
            } else if (m && app.storageManager && app.storageManager.loadImage) {
              app.storageManager.loadImage(m[1]).then(u => {
                if (u && this.bgImage) {
                  document.documentElement.style.setProperty('--app-bg-image', 'url("' + u + '")');
                  document.body.classList.add('theme-bg-image');
                }
              }).catch(() => {});
              return;
            } else {
              return;
            }
          }
          document.documentElement.style.setProperty('--app-bg-image', 'url("' + url + '")');
          document.body.classList.add('theme-bg-image');
        };
        showBg();
      } else {
        document.documentElement.style.removeProperty('--app-bg-image');
        document.body.classList.remove('theme-bg-image');
      }

      this.syncUI();
      this.save();
    },

    mixColor(hex, mixHex, ratio) {
      try {
        const parse = (h) => {
          h = String(h || '').replace('#', '');
          if (h.length === 3) h = h.split('').map(c => c + c).join('');
          return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
        };
        const a = parse(hex), b = parse(mixHex);
        const r = Math.round(a[0]*(1-ratio)+b[0]*ratio);
        const g = Math.round(a[1]*(1-ratio)+b[1]*ratio);
        const bl = Math.round(a[2]*(1-ratio)+b[2]*ratio);
        return '#' + [r,g,bl].map(v => v.toString(16).padStart(2,'0')).join('');
      } catch (e) { return hex; }
    },

    save() {
      if (!app.data || !app.data.settings) return;
      if (!app.data.settings.theme) app.data.settings.theme = {};
      app.data.settings.theme.preset = this.preset;
      app.data.settings.theme.bgMode = this.bgMode;
      app.data.settings.theme.lightTone = this.lightTone;
      app.data.settings.theme.textMode = this.textMode;
      app.data.settings.theme.bgImage = this.bgImage;
      if (typeof app.saveData === 'function') {
        clearTimeout(this._applyTimer);
        this._applyTimer = setTimeout(() => app.saveData(), 400);
      }
    },

    syncUI() {
      // 预设色块
      Object.keys(this.PRESETS).forEach(key => {
        const el = document.getElementById('theme-preset-' + key);
        if (!el) return;
        el.classList.toggle('preset-active', this.preset === key);
        if (el.querySelector('.preset-dot')) el.querySelector('.preset-dot').style.background = this.PRESETS[key].accent;
      });
      // 背景模式
      ['white', 'light', 'dark', 'black'].forEach(m => {
        const el = document.getElementById('theme-bgmode-' + m);
        if (el) {
          el.classList.toggle('border-indigo-500', this.bgMode === m);
          el.classList.toggle('bg-indigo-50', this.bgMode === m);
          el.classList.toggle('font-bold', this.bgMode === m);
        }
      });
      // 浅色微调行显示
      const toneRow = document.getElementById('light-tone-row');
      if (toneRow) toneRow.classList.toggle('hidden', this.bgMode !== 'light');
      const toneSlider = document.getElementById('theme-light-tone');
      if (toneSlider) toneSlider.value = this.lightTone;
      const toneVal = document.getElementById('light-tone-value');
      if (toneVal) toneVal.textContent = this.lightTone;
      // 文字模式
      const bw = document.getElementById('theme-textmode-bw');
      const dl = document.getElementById('theme-textmode-dl');
      if (bw) bw.classList.toggle('border-indigo-500', this.textMode === 'black-white');
      if (dl) dl.classList.toggle('border-indigo-500', this.textMode === 'deep-light');
      if (bw) bw.classList.toggle('bg-indigo-50', this.textMode === 'black-white');
      if (dl) dl.classList.toggle('bg-indigo-50', this.textMode === 'deep-light');
      // 背景图预览
      const preview = document.getElementById('theme-bg-preview');
      const previewImg = document.getElementById('theme-bg-preview-img');
      if (preview && previewImg) {
        if (this.bgImage) {
          let url = this.bgImage;
          if (url.startsWith('{{IMG:')) {
            const m = url.match(/\{\{IMG:(.+?)\}\}/);
            const cache = (m && app.storageManager && app.storageManager.memoryCache && app.storageManager.memoryCache.get(m[1])) || null;
            if (cache) url = cache; else url = '';
          }
          if (url) { previewImg.src = url; preview.classList.remove('hidden'); }
          else preview.classList.add('hidden');
        } else {
          preview.classList.add('hidden');
        }
      }
    }
  };

  app.setThemePreset = function(preset) {
    this.theme.preset = preset;
    this.theme.apply();
  },

  app.setThemeBgMode = function(mode) {
    this.theme.bgMode = mode;
    this.theme.apply();
  },

  app.setThemeLightTone = function(val) {
    this.theme.lightTone = Math.max(5, Math.min(95, parseInt(val) || 50));
    this.theme.apply();
  },

  app.setThemeTextMode = function(mode) {
    this.theme.textMode = mode;
    this.theme.apply();
  },

  app.toggleThemeMode = function() {
    const order = ['white', 'light', 'dark', 'black'];
    const next = order[(order.indexOf(this.theme.bgMode) + 1) % order.length];
    this.setThemeBgMode(next);
    if (this.showToast) this.showToast('背景模式：' + (next === 'white' ? '白色' : next === 'light' ? '浅色' : next === 'dark' ? '深色' : '黑色'), 'info', 1500);
  },

  app.setThemeBgImage = async function(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { if (this.showToast) this.showToast('请选择图片文件', 'error'); input.value = ''; return; }
    try {
      const dataUrl = await this.resizeImageFile(file, 1920);
      const filename = 'theme-bg.' + (dataUrl.includes('image/png') ? 'png' : 'jpg');
      if (this.storageManager) {
        try { await this.storageManager.saveImage(filename, dataUrl); } catch (e) {}
      }
      this.theme.bgImage = '{{IMG:' + filename + '}}';
      if (this.storageManager && !this.storageManager.memoryCache.has(filename)) {
        this.storageManager.memoryCache.set(filename, dataUrl);
      }
      this.theme.apply();
      if (this.showToast) this.showToast('自定义背景已保存', 'success');
    } catch (e) {
      console.error('[Theme] 背景图片处理失败:', e);
      if (this.showToast) this.showToast('背景图片处理失败', 'error');
    }
    input.value = '';
  },

  app.clearThemeBgImage = function() {
    this.theme.bgImage = null;
    this.theme.apply();
    if (this.showToast) this.showToast('自定义背景已清除', 'info');
  },

  // ============================================================
  // 存档管理（桌面版多存档：新建 / 导入 / 切换 / 删除 / 更换数据根目录）
  // 依赖：app.storageManager（wiki-storage.js）、app.showPromptDialog
  // ============================================================

  /** 存档切换后的统一重载：重新读取 data.json → 应用设置 → 关闭所有标签页 → 清空主页历史 → 回首页 → 刷新 UI */
  app._reloadAfterSaveSwitch = async function() {
    try { await this.loadDataFromDesktop(); } catch (e) { console.warn('[SaveManager] 重新加载失败:', e); }
    // 切换存档 → 关闭所有历史打开的标签页（避免跨存档残留词条）
    if (this.tabsSystem) this.tabsSystem.closeAllTabs();
    // 切换存档 → 清空主页浏览历史（避免把上一存档的浏览记录带过来）
    if (this.data) this.data.history = [];
    if (typeof this.applySettings === 'function') this.applySettings();
    if (typeof this.initTimelineSelector === 'function') this.initTimelineSelector();
    if (typeof this.router === 'function') this.router('home');
    if (typeof this.updateSaveStatusUI === 'function') this.updateSaveStatusUI();
    // 切换存档 → 重新加载目标存档自己的辅助模型缓存/上下文/灵感历史
    if (this.assistant && typeof this.assistant.reloadAfterSaveSwitch === 'function') {
      this.assistant.reloadAfterSaveSwitch();
    }
    // 切换存档 → 重新设置文件变更监听（监听新的存档文件夹）
    if (typeof this.setupSaveFileWatcher === 'function') this.setupSaveFileWatcher();
  },

  /** 设置当前存档的文件变更监听（外部修改 data.json / 图片 / 缓存时，同步回页面） */
  app.setupSaveFileWatcher = function() {
    const sm = this.storageManager;
    if (!sm || sm.mode !== 'desktop' || !sm.bridge || !sm.currentSave) return;
    // 事件只需在首次绑定一次；watchSave 每次调用都会让主进程切换到当前存档文件夹
    if (sm.bridge.onFileChanged && !this._saveFileChangedBound) {
      sm.bridge.onFileChanged((info) => {
        this.handleExternalFileChange(info);
      });
      this._saveFileChangedBound = true;
    }
    sm.bridge.watchSave(sm.currentSave).catch(() => {});
  },

  /** 处理外部对存档文件的修改（data.json / 图片 / 辅助模型缓存） */
  app.handleExternalFileChange = async function(info) {
    const sm = this.storageManager;
    if (!sm || sm.mode !== 'desktop') return;
    const rel = info && info.rel ? String(info.rel) : '';
    const lower = rel.toLowerCase();
    // 辅助模型缓存被外部修改 → 重载该存档的缓存/上下文（避免错误数据）
    if (lower.indexOf('assistant-cache.json') >= 0 || lower.indexOf('assistant-context.json') >= 0) {
      if (this.assistant && typeof this.assistant.reloadAfterSaveSwitch === 'function') {
        this.assistant.reloadAfterSaveSwitch();
      }
      return;
    }
    if (lower.indexOf('data.json') >= 0) {
      // 数据文件被外部修改 → 立即重新读取并刷新（不询问）
      if (this._fileSyncTimer) clearTimeout(this._fileSyncTimer);
      this._fileSyncTimer = setTimeout(async () => {
        try {
          await this.loadDataFromDesktop();
          if (typeof this.applySettings === 'function') this.applySettings();
          if (typeof this.updateSaveStatusUI === 'function') this.updateSaveStatusUI();
          if (typeof this.updateUI === 'function') this.updateUI();
          // 关闭所有标签页并回首页，避免展示已过期的词条内容
          if (this.tabsSystem) this.tabsSystem.closeAllTabs();
          if (typeof this.router === 'function') this.router('home');
          if (this.showToast) this.showToast('检测到存档文件已在外部更新，已同步', 'info', 2500);
        } catch (e) {
          console.error('[SaveManager] 外部文件同步失败:', e);
        }
      }, 250);
    }
  },

  /** 刷新存档状态 UI：工具栏绿框徽章、设置页存档列表、数据根目录提示、模式徽章 */
  app.updateSaveStatusUI = function() {
    const sm = this.storageManager;
    if (!sm) return;
    const isDesktop = sm.mode === 'desktop';

    // 工具栏存档徽章（绿色边框，显示当前存档名）
    const badge = document.getElementById('save-badge');
    const nameEl = document.getElementById('save-name-display');
    if (badge && nameEl) {
      if (isDesktop && sm.currentSave) {
        nameEl.textContent = sm.currentSave;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    // 设置页模式徽章
    const modeBadge = document.getElementById('save-mode-badge');
    if (modeBadge) modeBadge.textContent = isDesktop ? '桌面版 · 文件系统' : '浏览器演示模式';

    // 数据根目录提示
    const rootDesc = document.getElementById('save-data-root-desc');
    if (rootDesc) {
      rootDesc.textContent = isDesktop
        ? '数据根目录：' + (sm.dataRoot || '(未设置)')
        : '浏览器演示模式：数据保存在浏览器内部，无数据根目录';
    }

    // 面板切换（桌面 / 浏览器）
    const desktopPanel = document.getElementById('save-desktop-panel');
    const browserPanel = document.getElementById('save-browser-panel');
    if (desktopPanel) desktopPanel.classList.toggle('hidden', !isDesktop);
    if (browserPanel) browserPanel.classList.toggle('hidden', isDesktop);

    // 存档列表渲染
    const listEl = document.getElementById('save-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const saves = (sm.saves || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!isDesktop || saves.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-xs text-gray-500 py-2';
      empty.textContent = isDesktop ? '暂无存档，点击"新建存档"创建。' : '浏览器演示模式不适用多存档。';
      listEl.appendChild(empty);
      return;
    }
    saves.forEach(save => {
      const item = document.createElement('div');
      const isCurrent = save.name === sm.currentSave;
      item.className = 'flex justify-between items-center p-2 rounded-lg border transition ' +
        (isCurrent ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100');

      const info = document.createElement('div');
      info.className = 'flex items-center gap-2 min-w-0 flex-1';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'text-sm font-medium truncate ' + (isCurrent ? 'text-indigo-700' : 'text-gray-700');
      nameSpan.textContent = save.name;
      info.appendChild(nameSpan);
      if (isCurrent) {
        const cur = document.createElement('span');
        cur.className = 'text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 shrink-0';
        cur.textContent = '当前';
        info.appendChild(cur);
      }
      if (save.updatedAt) {
        const time = document.createElement('span');
        time.className = 'text-[10px] text-gray-400 shrink-0';
        const d = new Date(save.updatedAt);
        time.textContent = isNaN(d.getTime()) ? '' : d.toLocaleString();
        info.appendChild(time);
      }
      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'flex gap-1 shrink-0';
      if (!isCurrent) {
        const btnSwitch = document.createElement('button');
        btnSwitch.className = 'text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition';
        btnSwitch.textContent = '切换';
        btnSwitch.onclick = () => this.switchSave(save.name);
        actions.appendChild(btnSwitch);
      }
      const btnDel = document.createElement('button');
      btnDel.className = 'text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition';
      btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
      btnDel.title = '删除存档';
      btnDel.onclick = () => this.deleteSave(save.name);
      actions.appendChild(btnDel);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  },

  /** 打开设置页并定位到"存档管理"区块（工具栏按钮 / 存档徽章） */
  app.showSaveManager = function() {
    if (this.router) this.router('settings');
    else if (this.renderSettings) this.renderSettings(document.getElementById('main-container'));
    setTimeout(() => {
      const panel = document.getElementById('save-desktop-panel') || document.getElementById('save-browser-panel');
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  },

  /** 新建存档（返回是否成功，供快速设置流程 selectWikiFolder 判断） */
  app.createNewSaveDialog = async function() {
    const sm = this.storageManager;
    if (!sm) { if (this.showToast) this.showToast('存储管理器未初始化', 'error'); return false; }
    if (sm.mode !== 'desktop') {
      if (this.showToast) this.showToast('浏览器演示模式不支持多存档，请使用桌面版', 'warning', 4000);
      return false;
    }
    let name = null;
    if (this.showPromptDialog) {
      name = await this.showPromptDialog({ title: '新建存档', placeholder: '输入存档名称', confirmText: '创建' });
    } else {
      try { name = window.prompt('输入存档名称：'); } catch (e) {}
    }
    if (!name || !String(name).trim()) return false;
    name = String(name).trim();
    if (sm.saves.some(s => s.name === name)) {
      if (this.showToast) this.showToast('已存在同名存档「' + name + '」', 'error');
      return false;
    }
    try {
      const ok = await sm.createSave(name);
      if (!ok) { if (this.showToast) this.showToast('创建存档失败', 'error'); return false; }
      if (this.showSaveToast) this.showSaveToast('已创建并切换到存档：' + name);
      await this._reloadAfterSaveSwitch(name);
      return true;
    } catch (e) {
      console.error('[SaveManager] 新建存档失败:', e);
      if (this.showToast) this.showToast('创建存档失败', 'error');
      return false;
    }
  },

  /** 导入 ZIP 存档为新存档（设置页"导入存档(ZIP)"） */
  app.importSaveAsNew = async function(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    const sm = this.storageManager;
    if (!sm || sm.mode !== 'desktop') {
      if (this.showToast) this.showToast('浏览器演示模式不支持多存档导入', 'warning', 4000);
      input.value = '';
      return;
    }
    try {
      if (this.showSaveToast) this.showSaveToast('正在导入存档...');
      const { data, aboutInfo } = await sm.importZipPackage(file);
      if (aboutInfo) this.aboutInfoCache = aboutInfo;
      if (this.showSaveToast) this.showSaveToast('导入完成，正在加载...');
      await this._reloadAfterSaveSwitch(sm.currentSave);
      if (this.showToast) this.showToast('存档已导入并切换到：「' + sm.currentSave + '」', 'success', 5000);
    } catch (e) {
      console.error('[SaveManager] 导入失败:', e);
      if (this.showToast) this.showToast('导入失败：' + ((e && e.message) ? e.message : '未知错误'), 'error', 5000);
    } finally {
      input.value = '';
    }
  },

  /** 切换存档（存档列表"切换"按钮） */
  app.switchSave = async function(name) {
    const sm = this.storageManager;
    if (!sm || sm.mode !== 'desktop') return;
    if (name === sm.currentSave) return;
    if (!sm.saves.some(s => s.name === name)) return;
    const prevSave = sm.currentSave;
    const ok = await sm.switchSave(name);
    if (!ok) { if (this.showToast) this.showToast('切换存档失败', 'error'); return; }
    if (this.showSaveToast) this.showSaveToast('已切换到存档：' + name);
    await this._reloadAfterSaveSwitch(name);
    // 切换后重新设置文件变更监听（监听新的存档文件夹）
    if (typeof this.setupSaveFileWatcher === 'function') this.setupSaveFileWatcher();
    // 思考缓存迁移询问（目标存档无缓存、上一存档有缓存时才询问）
    if (this.assistant && typeof this.assistant.maybeMigrateCache === 'function') {
      if (prevSave && prevSave !== name) this.assistant.maybeMigrateCache(prevSave);
    }
  },

  /** 删除存档（存档列表删除按钮） */
  app.deleteSave = async function(name) {
    const sm = this.storageManager;
    if (!sm || sm.mode !== 'desktop') return;
    if (!confirm('确定删除存档「' + name + '」？此操作不可恢复！')) return;
    const ok = await sm.deleteSave(name);
    if (!ok) {
      if (this.showToast) this.showToast('删除失败（当前存档且仅有一个存档时不可删除）', 'error');
      return;
    }
    if (this.showSaveToast) this.showSaveToast('已删除存档：' + name);
    // 若删除的是当前存档，自动切换到列表第一个
    if (!sm.currentSave || !sm.saves.some(s => s.name === sm.currentSave)) {
      if (sm.saves.length > 0) {
        await sm.switchSave(sm.saves[0].name);
        await this._reloadAfterSaveSwitch(sm.saves[0].name);
      } else {
        if (this.data) this.data.entries = [];
        if (typeof this.applySettings === 'function') this.applySettings();
        if (typeof this.router === 'function') this.router('home');
      }
    }
    this.updateSaveStatusUI();
  },

  /** 指定存储位置（更换数据根目录） */
  app.changeDataRoot = async function() {
    const sm = this.storageManager;
    if (!sm || sm.mode !== 'desktop' || !sm.bridge) {
      if (this.showToast) this.showToast('浏览器演示模式不支持更换存储位置', 'warning', 4000);
      return;
    }
    let dir = null;
    try { dir = await sm.bridge.pickDirectory(); } catch (e) {}
    if (!dir) return;
    try {
      await sm.bridge.savePrefs({ dataRoot: dir });
      // 主进程 getDataRoot 实时读取 prefs，重新获取 appInfo 即可刷新数据根目录
      try {
        sm.appInfo = await sm.bridge.getAppInfo();
        sm.dataRoot = sm.appInfo.dataRoot;
      } catch (e) {}
      await sm.refreshSaves();
      // 当前存档不在新根目录时清除选择并回空数据
      if (!sm.currentSave || !sm.saves.some(s => s.name === sm.currentSave)) {
        sm.currentSave = null;
        localStorage.removeItem('glight_current_save');
        sm.memoryCache.clear();
        if (this.data) this.data.entries = [];
        if (typeof this.applySettings === 'function') this.applySettings();
        if (typeof this.router === 'function') this.router('home');
      }
      this.updateSaveStatusUI();
      if (this.showToast) this.showToast('已切换存储位置：' + sm.dataRoot, 'success', 4000);
    } catch (e) {
      console.error('[SaveManager] 更换存储位置失败:', e);
      if (this.showToast) this.showToast('更换存储位置失败', 'error');
    }
  },

  app.resizeImageFile = function(file, maxSize) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (Math.max(w, h) > maxSize) {
            const ratio = maxSize / Math.max(w, h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  },

  // 7. 编辑工具栏 收起/展开
  // ============================================================

  /**
   * 编辑元素查询：优先"当前激活的词条标签 pane"，避免多标签并存时
   * 全局 getElementById 命中非激活编辑 pane 导致数据串扰。
   */
  app.editEl = function(id) {
    if (this.tabsSystem) {
      const pane = this.tabsSystem.getActivePane();
      if (pane) {
        try {
          const el = pane.querySelector('#' + String(id).replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
          if (el) return el;
        } catch (e) {}
      }
    }
    return document.getElementById(id);
  };
  // 短别名（edit.js/media.js 中的编辑元素查询统一走 app.$e）
  app.$e = app.editEl;

  app.toggleEditToolbar = function() {
    const toolbar = document.querySelector('.fixed-edit-toolbar');
    if (!toolbar) return;
    if (toolbar.classList.contains('collapsed')) {
      toolbar.classList.remove('collapsed');
      this._hideToolbarFloater();
    } else {
      toolbar.classList.add('collapsed');
      this._showToolbarFloater();
    }
  };

  app._showToolbarFloater = function() {
    this._hideToolbarFloater();
    const btn = document.createElement('button');
    btn.id = 'toolbar-floater-btn';
    btn.className = 'fixed bottom-16 right-5 z-[200] w-10 h-10 rounded-full bg-indigo-600 text-white shadow-lg flex items-center justify-center cursor-pointer hover:bg-indigo-700 transition';
    btn.title = '展开编辑工具栏';
    btn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
    btn.onclick = () => { if (app && app.toggleEditToolbar) app.toggleEditToolbar(); };
    document.body.appendChild(btn);
  };

  app._hideToolbarFloater = function() {
    const el = document.getElementById('toolbar-floater-btn');
    if (el) el.remove();
  };

  // ============================================================
  // 8. 初始化钩子
  // ============================================================
  // 包装 renderSettings：渲染后同步主题 UI、存档状态与存储提示文本
  const origRenderSettings = app.renderSettings;
  app.renderSettings = function(container) {
    if (origRenderSettings) origRenderSettings.call(this, container);
    if (this.theme && typeof this.theme.syncUI === 'function') this.theme.syncUI();
    if (typeof this.updateSaveStatusUI === 'function') this.updateSaveStatusUI();
    // 模型辅助设置同步
    if (this.assistant && typeof this.assistant.applyCfgToUI === 'function') this.assistant.applyCfgToUI();
    // 数据管理提示：桌面版数据在本地存档文件夹（文件系统），不受浏览器缓存限制
    const hint = document.getElementById('data-storage-hint');
    if (hint) {
      if (this.storageManager && this.storageManager.mode === 'desktop') {
        hint.textContent = '数据保存在本地存档文件夹（WikiData/存档名），不受浏览器缓存限制；仍建议定期导出 ZIP 备份（含图片）以防误删。';
        hint.className = 'text-xs text-green-800';
      } else {
        hint.textContent = '数据保存在浏览器本地。建议定期导出 ZIP 备份（含图片）。';
        hint.className = 'text-xs text-yellow-800';
      }
    }
  };

  const origInit = app.init;
  app.init = async function() {
    if (origInit) await origInit.call(this);
    // 标签页系统
    if (this.tabsSystem && typeof this.tabsSystem.init === 'function') this.tabsSystem.init();
    // 主题
    if (this.theme && typeof this.theme.restore === 'function') this.theme.restore();
    // 存档状态 UI
    if (typeof this.updateSaveStatusUI === 'function') this.updateSaveStatusUI();
    // 模型辅助（云云酱）恢复配置并启用编辑监听
    if (this.assistant && typeof this.assistant.restore === 'function') this.assistant.restore();
    this._initAssistantListeners();
    // 桌面版：设置当前存档文件夹的变更监听（外部修改 → 同步回页面）
    if (this.storageManager && this.storageManager.mode === 'desktop') {
      if (typeof this.setupSaveFileWatcher === 'function') this.setupSaveFileWatcher();
    }
    // 关闭窗口前：把未落盘的数据（含主题色设置）写回存档，保证"关闭前设置不丢失"
    if (window.desktopBridge && window.desktopBridge.onBeforeClose) {
      window.desktopBridge.onBeforeClose(async () => {
        try {
          if (typeof this.saveData === 'function') await this.saveData();
        } catch (e) {}
        // 保存完成后通知主进程，可安全关闭窗口
        if (window.desktopBridge && typeof window.desktopBridge.saveDone === 'function') {
          window.desktopBridge.saveDone();
        }
      });
    }
    // 浏览器返回键 → 关闭当前标签
    window.addEventListener('popstate', () => {
      if (this.tabsSystem && this.tabsSystem.list.length > 0 && this.tabsSystem.hasActiveEntryTab()) {
        this.tabsSystem.closeTab(this.tabsSystem.activeTabId);
      }
    });
  };

  // ============ 模型辅助全局监听 ============
  app._initAssistantListeners = function() {
    if (this._assistantListenersInited) return;
    this._assistantListenersInited = true;
    const as = () => this.assistant;
    // 编辑输入 → 嗅探
    document.addEventListener('input', (e) => {
      const t = e.target;
      const inBlocks = t && t.closest && t.closest('#edit-blocks-container');
      const isSubtitle = t && t.id === 'edit-subtitle';
      const isEntryInput = inBlocks || isSubtitle;
      if (isEntryInput && as() && as().enabled) as().onEditActivity();
    });
    // 焦点切换输入位置 → 展开时自动收起（排除在面板内的焦点）
    document.addEventListener('focusin', (e) => {
      if (!as() || !as().enabled || !as().expanded) return;
      if (e.target && e.target.closest && e.target.closest('#assistant-panel')) return;
      const inBlocks = e.target && e.target.closest && e.target.closest('#edit-blocks-container');
      const isSubtitle = e.target && e.target.id === 'edit-subtitle';
      if (inBlocks || isSubtitle) as().setExpanded(false);
    });
    // 鼠标移动 → 记录最近编辑位置（题记/正文块），供"按鼠标位置给灵感"使用
    document.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const a = as();
      if (!a || !a.enabled) return;
      const sub = (t.id === 'edit-subtitle') ? t : t.closest('#edit-subtitle');
      if (sub) { a._mouseLoc = { target: 'subtitle', type: 'subtitle', label: '题记', blockIndex: -1, contextText: '题记区域' }; return; }
      const blockInput = t.closest('#edit-blocks-container .block-input');
      if (blockInput) { a._mouseLoc = a._locFromElement(blockInput); return; }
      // 内联悬浮提示随鼠标所在编辑位置刷新
      if (a._inlineItem && typeof a._positionInlineNote === 'function') a._positionInlineNote(a._inlineItem);
    });
    // 滚动时刷新内联悬浮提示位置与角标
    document.addEventListener('scroll', (e) => {
      const a = as();
      if (!a) return;
      const inEdit = (e.target && e.target.closest && (e.target.closest('#edit-blocks-container') || e.target.id === 'edit-subtitle')) || e.target === document;
      if (!inEdit) return;
      if (a._inlineItem && typeof a._positionInlineNote === 'function') a._positionInlineNote(a._inlineItem);
      if (typeof a._updateInlineBadge === 'function') a._updateInlineBadge();
    }, true);
  };

  // 打开/渲染词条编辑界面后，若已启用则触发一次嗅探（进入编辑即让云云酱先看看）
  const origRenderEdit = app.renderEdit;
  app.renderEdit = function(container) {
    if (origRenderEdit) origRenderEdit.call(this, container);
    const a = this.assistant;
    if (a && typeof a.onEditActivity === 'function') { a._mouseLoc = null; setTimeout(() => a.onEditActivity(), 800); }
  };

  console.log('Part 8 (App Layer) 加载完成 - 标签页/主题/存档管理');
})();

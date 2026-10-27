/**
 * Part 9: "云云酱" 语言模型辅助助手（模型嵌入）
 * 依赖：app（wiki-core.js）、app.storageManager（wiki-storage.js）、window.desktopBridge（preload.js）
 *
 * 功能：
 *  - 设置页启用模型辅助、选择服务商/模型、填入 API（自动拉取可用模型）
 *  - 读取 Wiki 全量内容（时间轴章节、剧情梗概、正文词条、角色/设定词条）作为上下文
 *  - 嗅探（sniffer）/ 介入（intervention）双状态
 *  - 编辑界面右侧浮动窗口（云云酱形象 + 泡泡框动画提示）
 *  - 按鼠标/焦点位置（题记/正文某段落/标题）针对性给灵感
 *  - "灵感"与"建议写入的内容"一键复制、一键替换（仅替换目标文本，绝不影响其他）
 *  - 围绕 Wiki 提问获取灵感，对话上下文保存在本地存档文件夹
 */
(function() {
  if (typeof app === 'undefined') {
    console.error('wiki-assistant.js: app 对象未定义');
    return;
  }

  // 服务商预设（OpenAI 兼容 /chat/completions 与 /models）
  const PROVIDERS = {
    openai:   { label: 'OpenAI',        baseURL: 'https://api.openai.com/v1' },
    deepseek: { label: 'DeepSeek',      baseURL: 'https://api.deepseek.com/v1' },
    kimi:     { label: 'Moonshot(月之暗面)', baseURL: 'https://api.moonshot.cn/v1' },
    glm:      { label: '智谱 GLM',      baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
    qwen:     { label: '通义千问',      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    silicon:  { label: '硅基流动',      baseURL: 'https://api.siliconflow.cn/v1' },
    ollama:   { label: 'Ollama(本地)',  baseURL: 'http://127.0.0.1:11434/v1' },
    custom:   { label: '自定义',        baseURL: '' }
  };

  // 系统提示词（参照 prompt_config.py 简化：人设 + 任务 + 输出规范）
  const SYSTEM_PROMPT = [
    '你是"云云酱"，一个活泼可爱、可靠贴心的 Wiki 创作辅助助手。',
    '【你熟悉的Wiki架构】你熟悉当前 Wiki 的整体结构：',
    ' - 时间轴：由若干章节组成，每章下挂剧情梗概；',
    ' - 词条：分正文词条、角色词条、设定词条等，可有多个版本（不同时间线/阶段），版本间内容会演变；',
    ' - 词条正文由若干内容块组成：正文段落(p)、二级标题(h2)、小标题(h3)、图片(img)、表格(table)。',
    '【你的任务】辅助用户创作与维护词条：',
    ' 1. 根据用户正在编辑的词条与Wiki其他内容，寻找相关/呼应/矛盾的信息并给出"灵感"；',
    ' 2. 发现内容疑似错误（矛盾、漏写、与上下文不符）时指出"华点"；',
    ' 3. 若内容较完备，给出与上下文连贯、可直接写入的"建议写入的内容"。',
    '【输出规范】',
    ' - 灵感：简短紧扣当前上下文的一句话或多个选项；可用 "灵感：" 开头；',
    ' - 指出问题：用 "我发现了华点：" 开头，指出疑似错误及原因；',
    ' - 建议写入内容：用 "建议写入的内容：" 开头，后接可直接替换目标文本的完整段落；',
    ' - 主动修改词条内容必须取得用户确认，只针对用户指定的位置，绝不改动无关文本；',
    ' - 语气轻松活泼，适当使用表情符号，不编造 Wiki 中不存在的信息。'
  ].join('\n');

  app.assistant = {
    enabled: false,
    provider: 'openai',
    baseURL: '',
    apiKey: '',
    model: '',
    modelList: [],
    state: 'sniffer',      // 'sniffer'(嗅探) | 'intervention'(介入)
    expanded: false,       // 辅助窗口是否展开
    context: [],           // 对话历史 [{role,content}]
    _sniffTimer: null,
    _bubbleTimer: null,
    _bubbleEl: null,
    _panelEl: null,

    // ============ 配置 ============
    restore() {
      const cfg = (app.data && app.data.settings && app.data.settings.assistant) || {};
      this.enabled = !!cfg.enabled;
      this.provider = (cfg.provider && PROVIDERS[cfg.provider]) ? cfg.provider : 'openai';
      this.baseURL = cfg.baseURL || PROVIDERS[this.provider].baseURL || '';
      this.apiKey = cfg.apiKey || '';
      this.model = cfg.model || '';
      this.modelList = Array.isArray(cfg.modelList) ? cfg.modelList : [];
      this.avatarSize = cfg.avatarSize || 'medium';
      this.state = 'sniffer';
      this.expanded = false;
      this._applyAvatarSize();
      // 灵感历史（华点去重/置前、可忽略、可删）
      const hist = (app.data.settings && app.data.settings.assistantHistory) || {};
      this._history = Array.isArray(hist.items) ? hist.items : [];
      this._ignoredKeys = Array.isArray(hist.ignored) ? hist.ignored : [];
      this._initDrag();
      this._initInlineNoteDrag();
      this._cache = {};
      this.loadCache();
      this.loadContextFromFile().catch(() => {});
      this.applyCfgToUI();
    },

    persistCfg() {
      if (!app.data || !app.data.settings) return;
      app.data.settings.assistant = {
        enabled: this.enabled,
        provider: this.provider,
        baseURL: this.baseURL,
        apiKey: this.apiKey,
        model: this.model,
        modelList: this.modelList,
        avatarSize: this.avatarSize || 'medium'
      };
      if (typeof app.saveData === 'function') app.saveData();
    },

    /** 应用云云酱按钮大小（并可选持久化） */
    _applyAvatarSize() {
      const m = { small: [64, 88], medium: [96, 128], large: [132, 178] };
      const wh = m[this.avatarSize] || m.medium;
      const root = document.documentElement;
      root.style.setProperty('--assist-avatar-w', wh[0] + 'px');
      root.style.setProperty('--assist-avatar-h', wh[1] + 'px');
    },
    setAvatarSize(size) {
      if (!['small', 'medium', 'large'].includes(size)) return;
      this.avatarSize = size;
      this._applyAvatarSize();
      this.persistCfg();
      this.applyCfgToUI();
    },

    applyCfgToUI() {
      // 填充服务商下拉
      const provSel = document.getElementById('assistant-provider');
      if (provSel) {
        provSel.innerHTML = '';
        Object.keys(PROVIDERS).forEach(k => {
          const opt = document.createElement('option');
          opt.value = k; opt.textContent = PROVIDERS[k].label;
          if (k === this.provider) opt.selected = true;
          provSel.appendChild(opt);
        });
      }
      // 同步设置页控件
      const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
      chk('assistant-enabled', this.enabled);
      setV('assistant-provider', this.provider);
      setV('assistant-baseurl', this.baseURL);
      setV('assistant-apikey', this.apiKey);
      setV('assistant-avatarsize', this.avatarSize);
      const modelSel = document.getElementById('assistant-model');
      if (modelSel) {
        modelSel.innerHTML = '';
        (this.modelList.length ? this.modelList : []).forEach(m => {
          const opt = document.createElement('option');
          opt.value = m; opt.textContent = m;
          if (m === this.model) opt.selected = true;
          modelSel.appendChild(opt);
        });
        if (this.model && !this.modelList.includes(this.model)) {
          const opt = document.createElement('option');
          opt.value = this.model; opt.textContent = this.model; opt.selected = true;
          modelSel.appendChild(opt);
        }
      }
      // 面板开关显示（启用才显示浮动窗口与首页悬浮按钮）
      const panel = document.getElementById('assistant-panel');
      if (panel) panel.classList.toggle('hidden', !this.enabled);
    },

    // ---- 配置操作 ----
    setEnabled(v) {
      this.enabled = !!v;
      this.persistCfg();
      this.applyCfgToUI();
      if (this.enabled) { this.ensurePanel(); this.setExpanded(false); }
      else { this.hideBubble(); this.hidePanel(); }
      if (app.showToast) app.showToast(this.enabled ? '模型辅助已启用' : '模型辅助已关闭', 'info');
    },
    setProvider(p) {
      if (!PROVIDERS[p]) return;
      this.provider = p;
      this.baseURL = PROVIDERS[p].baseURL || '';
      const el = document.getElementById('assistant-baseurl');
      if (el) el.value = this.baseURL;
      this.persistCfg();
      // 更换服务商后清空模型并尝试拉取
      if (this.apiKey && this.baseURL) this.refreshModels();
    },
    setBaseURL(url) { this.baseURL = (url || '').trim(); this.persistCfg(); },
    setApiKey(k) { this.apiKey = (k || '').trim(); this.persistCfg(); },
    setModel(m) { this.model = m; this.persistCfg(); },

    async refreshModels() {
      if (!this.baseURL) { if (app.showToast) app.showToast('请先填写 API 地址', 'error'); return; }
      if (app.showToast) app.showToast('正在获取模型列表...', 'info', 2000);
      let r;
      if (window.desktopBridge && window.desktopBridge.assistantModels) {
        r = await window.desktopBridge.assistantModels({ baseURL: this.baseURL, apiKey: this.apiKey });
      } else {
        const resp = await fetch(this.baseURL.replace(/\/+$/, '') + '/models', {
          headers: this.apiKey ? { 'Authorization': 'Bearer ' + this.apiKey } : {}
        });
        r = resp.ok ? { ok: true, models: ((await resp.json()).data || []).map(m => m.id).filter(Boolean) } : { ok: false, error: 'HTTP ' + resp.status };
      }
      if (r && r.ok) {
        this.modelList = r.models || [];
        if (!this.model && this.modelList.length) this.model = this.modelList[0];
        this.persistCfg();
        this.applyCfgToUI();
        if (app.showToast) app.showToast('获取到 ' + this.modelList.length + ' 个模型', 'success');
      } else {
        if (app.showToast) app.showToast('获取模型失败：' + ((r && r.error) || '未知错误'), 'error', 5000);
      }
      return r;
    },

    async testConnection() {
      if (!this.baseURL || !this.model) { if (app.showToast) app.showToast('请填写 API 地址并选择模型', 'error'); return false; }
      if (app.showToast) app.showToast('正在测试连接...', 'info', 2000);
      const r = await this._request([{ role: 'user', content: '你好，请回复"连接成功"四个字，不要多言。' }], 0.1);
      if (r && r.ok) {
        if (app.showToast) app.showToast('连接成功：' + (r.content || '').slice(0, 30), 'success');
        return true;
      } else {
        if (app.showToast) app.showToast('连接失败：' + ((r && r.error) || '未知错误'), 'error', 6000);
        return false;
      }
    },

    // ============ LLM 调用 ============
    async _request(messages, temperature) {
      if (!this.baseURL) return { ok: false, error: '缺少 API 地址' };
      if (!this.model) return { ok: false, error: '未选择模型' };
      if (window.desktopBridge && window.desktopBridge.assistantChat) {
        return await window.desktopBridge.assistantChat({
          baseURL: this.baseURL, apiKey: this.apiKey, model: this.model, messages, temperature
        });
      }
      // 浏览器降级：直接 fetch
      try {
        const resp = await fetch(this.baseURL.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { 'Authorization': 'Bearer ' + this.apiKey } : {})
          },
          body: JSON.stringify({ model: this.model, messages, temperature: temperature != null ? temperature : 0.7, stream: false })
        });
        if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
        const data = await resp.json();
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        return { ok: true, content: typeof content === 'string' ? content : '' };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    },

    // ============ Wiki 上下文 ============
    blocksToText(blocks) {
      if (!Array.isArray(blocks)) return '';
      return blocks.map(b => {
        const t = b.text != null ? String(b.text) : '';
        if (b.type === 'h2') return '## ' + t;
        if (b.type === 'h3') return '### ' + t;
        if (b.type === 'img') return '[图片]';
        if (b.type === 'table') return '[表格 ' + (b.rows ? b.rows.length : 0) + 'x' + ((b.rows && b.rows[0]) ? b.rows[0].length : 0) + ']';
        return t;
      }).filter(s => s && s.trim() !== '').join('\n');
    },

    entryToText(e) {
      if (!e) return '';
      const parts = [];
      parts.push('【' + (e.code || '') + (e.type === 'character' ? ' 角色' : '') + (e.type === 'non-character' ? ' 设定' : '') + (e.type === 'event' ? ' 事件' : '') + '】' + e.id);
      (e.versions || []).forEach((v, i) => {
        const title = v.title || '(无标题)';
        const sub = v.subtitle ? ('题记: ' + v.subtitle) : '';
        const blocks = this.blocksToText(v.blocks);
        parts.push((e.versions.length > 1 ? '[版本' + (i + 1) + '] ' : '') + title + (sub ? '\n' + sub : '') + (blocks ? '\n' + blocks : ''));
      });
      return parts.join('\n');
    },

    /** 构建全量 Wiki 上下文（章节/梗概/正文/角色/设定） */
    buildWikiContext() {
      const d = app.data || {};
      const out = [];
      // 时间轴章节
      const chapters = (d.chapters || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      if (chapters.length) {
        out.push('【时间轴章节】');
        chapters.forEach(c => out.push(' - ' + (c.order || '') + '. ' + (c.title || c.name || c.id)));
        // 剧情梗概
        const syn = (d.synopsis || []).map(s => {
          const ch = chapters.find(c => c.id === s.chapterId);
          return ' - ' + (ch ? ch.title : s.chapterId) + '：' + this.blocksToText(s.blocks || s.contentBlocks);
        }).filter(s => s.length > 0);
        if (syn.length) { out.push('【剧情梗概】'); syn.forEach(s => out.push(s)); }
      }
      // 正文词条
      const bodies = (d.entries || []).filter(e => e.type === 'body');
      if (bodies.length) { out.push('【正文词条】'); bodies.forEach(e => out.push(this.entryToText(e))); }
      // 角色词条
      const chars = (d.entries || []).filter(e => e.type === 'character');
      if (chars.length) { out.push('【角色词条】'); chars.forEach(e => out.push(this.entryToText(e))); }
      // 设定词条
      const sets = (d.entries || []).filter(e => e.type === 'non-character');
      if (sets.length) { out.push('【设定词条】'); sets.forEach(e => out.push(this.entryToText(e))); }
      return out.join('\n\n');
    },

    /** 当前编辑词条上下文 */
    buildEntryContext() {
      const entry = app.tempEntry || (app.data && app.data.entries && app.data.entries.find(e => e.id === app.data.editingId));
      const version = app.tempVersion || (entry && entry.versions && (entry.versions.find(v => v.vid === app.data.editingVersionId) || entry.versions[entry.versions.length - 1]));
      if (!entry) return '【当前编辑】新词条（尚未保存）';
      const lines = ['【当前编辑词条】' + (entry.code || '') + ' ' + (entry.type || '')];
      if (version) {
        if (version.title) lines.push('版本名称: ' + version.title);
        if (version.subtitle) lines.push('题记: ' + version.subtitle);
        const blocks = this.blocksToText(version.blocks);
        if (blocks) lines.push(blocks);
      }
      return lines.join('\n');
    },

    buildChatContext() {
      const wiki = this.buildWikiContext();
      const entry = this.buildEntryContext();
      return '【当前 Wiki 内容】\n' + wiki + '\n\n' + entry;
    },

    // ============ 对话（围绕Wiki提问，多会话） ============
    _ensureSession() {
      if (!Array.isArray(this.sessions)) this.sessions = [];
      if (!this.sessions.length) this.sessions.push({ id: 's-' + Date.now() + Math.random().toString(36).slice(2, 6), title: '会话 1', messages: [] });
      if (!this.activeSessionId || !this.sessions.some(s => s.id === this.activeSessionId)) this.activeSessionId = this.sessions[0].id;
      return this.sessions.find(s => s.id === this.activeSessionId) || this.sessions[0];
    },
    activeMessages() { const s = this._ensureSession(); return s.messages; },

    async ask(question) {
      if (!this.enabled) { if (app.showToast) app.showToast('请先在设置页启用模型辅助', 'error'); return null; }
      if (!this.model) { if (app.showToast) app.showToast('请先选择模型', 'error'); return null; }
      const sess = this._ensureSession();
      const sys = SYSTEM_PROMPT + '\n\n' + this.buildChatContext();
      const recent = sess.messages.slice(-12);
      const messages = [{ role: 'system', content: sys }, ...recent, { role: 'user', content: question }];
      const r = await this._request(messages, 0.7);
      if (r && r.ok) {
        sess.messages.push({ role: 'user', content: question });
        sess.messages.push({ role: 'assistant', content: r.content });
        if (sess.messages.length > 50) sess.messages = sess.messages.slice(-50);
        this.saveContextToFile().catch(() => {});
        // 首次对话后自动拟定会话主题
        if (!sess._autoTitled && sess.messages.filter(m => m.role === 'assistant').length === 1 && (!sess.title || /^会话\s*\d+$/.test(sess.title))) {
          sess._autoTitled = true;
          this._autoTitle(sess);
        }
        return r.content;
      } else {
        if (app.showToast) app.showToast('请求失败：' + ((r && r.error) || '未知错误'), 'error', 5000);
        return null;
      }
    },

    // 对话历史本地保存（多会话，当前存档目录下 assistant-context.json）
    async saveContextToFile() {
      const sm = app.storageManager;
      if (!sm) return;
      try {
        const data = JSON.stringify({ updatedAt: Date.now(), sessions: this.sessions || [], activeSessionId: this.activeSessionId });
        if (sm.mode === 'desktop') await sm.writeText(sm.rel('assistant-context.json'), data);
        else localStorage.setItem('glight_assistant_context', data);
      } catch (e) {}
    },
    async loadContextFromFile() {
      const sm = app.storageManager;
      if (!sm) return;
      try {
        let data = null;
        if (sm.mode === 'desktop') { const t = await sm.readText(sm.rel('assistant-context.json')); if (t) data = JSON.parse(t); }
        else { const t = localStorage.getItem('glight_assistant_context'); if (t) data = JSON.parse(t); }
        if (data && Array.isArray(data.sessions)) { this.sessions = data.sessions; this.activeSessionId = data.activeSessionId || (data.sessions[0] && data.sessions[0].id); }
        else if (data && Array.isArray(data.messages)) { this.sessions = [{ id: 's-' + Date.now(), title: '会话 1', messages: data.messages }]; this.activeSessionId = this.sessions[0].id; }
        else if (!data) this._ensureSession();
      } catch (e) {}
    },
    clearContext() {
      const sess = this._ensureSession();
      sess.messages = [];
      this.saveContextToFile().catch(() => {});
      this.renderContext();
      this.renderSuggestions(null);
      if (app.showToast) app.showToast('当前会话已清空', 'info');
    },

    // ---- 会话管理 ----
    renderSessionSelect() {
      const sel = document.getElementById('assistant-session-select');
      if (!sel) return;
      sel.innerHTML = '';
      (this.sessions || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.title || '会话';
        if (s.id === this.activeSessionId) opt.selected = true;
        sel.appendChild(opt);
      });
    },
    newSession() {
      const id = 's-' + Date.now() + Math.random().toString(36).slice(2, 6);
      this.sessions.push({ id, title: '会话 ' + (this.sessions.length + 1), messages: [] });
      this.activeSessionId = id;
      this.saveContextToFile().catch(() => {});
      this.renderSessionSelect();
      this.renderContext();
      this.renderSuggestions(null);
    },
    deleteSession() {
      if ((this.sessions || []).length <= 1) { if (app.showToast) app.showToast('至少保留一个会话', 'warning'); return; }
      if (!confirm('确定删除当前会话？')) return;
      this.sessions = this.sessions.filter(s => s.id !== this.activeSessionId);
      if (!this.sessions.length) this.sessions.push({ id: 's-' + Date.now(), title: '会话 1', messages: [] });
      this.activeSessionId = this.sessions[0].id;
      this.saveContextToFile().catch(() => {});
      this.renderSessionSelect();
      this.renderContext();
      this.renderSuggestions(null);
      if (app.showToast) app.showToast('会话已删除', 'info');
    },
    /** 手动重命名当前会话 */
    async renameSession() {
      const sess = this._ensureSession();
      let name = null;
      if (this.showPromptDialog) {
        name = await this.showPromptDialog({ title: '重命名会话', defaultValue: sess.title || '', placeholder: '输入会话名称', confirmText: '确定' });
      } else {
        try { name = window.prompt('输入会话名称', sess.title || ''); } catch (e) {}
      }
      if (!name || !String(name).trim()) return;
      sess.title = String(name).trim().slice(0, 20);
      this.renderSessionSelect();
      this.saveContextToFile().catch(() => {});
      if (app.showToast) app.showToast('会话已重命名', 'success');
    },
    /** 首次对话后自动拟定会话主题（简短） */
    async _autoTitle(sess) {
      if (this._autoTitling) return;
      this._autoTitling = true;
      try {
        const q = String(sess.messages[0] && sess.messages[0].content || '').slice(0, 40);
        const r = await this._request([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '请根据以下对话开头的提问，给这个会话起一个简短贴切的中文标题，不超过8个字，直接回复标题本身，不要任何符号。对话开头：' + q }
        ], 0.3);
        if (r && r.ok) {
          const t = String(r.content).trim().replace(/[。.！!""]/g, '').slice(0, 12);
          if (t) { sess.title = t; this.renderSessionSelect(); this.saveContextToFile().catch(() => {}); }
        }
      } catch (e) {}
      this._autoTitling = false;
    },
    switchSession(id) {
      if (!this.sessions.some(s => s.id === id)) return;
      this.activeSessionId = id;
      this.saveContextToFile().catch(() => {});
      this.renderSessionSelect();
      this.renderContext();
      // 会话有上一轮回答 → 为其生成备选项；否则空态
      const sess = this._ensureSession();
      this.renderSuggestions(this._hasLastAnswer(sess) ? null : null);
      this.refreshSuggestions();
    },
    _hasLastAnswer(sess) { return sess && sess.messages && sess.messages.some(m => m.role === 'assistant'); },

    // ---- 备选项 ----
    async refreshSuggestions() {
      const list = await this.getSuggestions();
      if (this._suppressSuggestions) return;
      this.renderSuggestions(list);
    },
    async getSuggestions() {
      const sess = this._ensureSession();
      const lastAssistant = [...(sess.messages || [])].reverse().find(m => m.role === 'assistant');
      if (!lastAssistant) return this._localSuggestions(3);
      // 有上一轮回答 → 让模型给出 3 个可继续提问的简短问题
      const r = await this._request([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: '基于用户在Wiki创作对话的背景，围绕我上一轮的以下回答，给出3个用户可能接着问的简短问题，每行一个，不要序号，不要超过40字。\n\n我的回答：' + String(lastAssistant.content || '').slice(0, 1500) }
      ], 0.8);
      if (r && r.ok) {
        const list = String(r.content).split(/\r?\n/).map(s => s.trim()).filter(s => s && s.length > 1 && s.length <= 40).slice(0, 3);
        if (list.length) return list;
      }
      return this._localSuggestions(3);
    },
    _localSuggestions(n) {
      const pool = ['你好呀，云云酱！', '这个Wiki的时间轴是怎样的？', '当前有哪些角色？', '剧情梗概里最重要的设定是什么？', '帮我总结主线的主要事件', '有哪些设定词条值得注意？'];
      const copy = pool.slice(), out = [];
      while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
      return out.length ? out : pool.slice(0, n);
    },
    renderSuggestions(list) {
      const box = document.getElementById('assistant-suggestions');
      if (!box) return;
      box.innerHTML = '';
      const items = list || [];
      if (!items.length) { box.innerHTML = '<div class="assistant-sugg-hint">围绕对话的推荐提问会显示在此</div>'; return; }
      items.forEach(q => {
        const b = document.createElement('button');
        b.className = 'assistant-suggestion-chip';
        b.textContent = q;
        b.onclick = () => {
          const input = document.getElementById('assistant-question');
          if (input) input.value = q;
          if (typeof this.submitQuestion === 'function') this.submitQuestion();
        };
        box.appendChild(b);
      });
    },

    // ============ 状态机 ============
    setState(s) {
      this.state = (s === 'intervention') ? 'intervention' : 'sniffer';
      if (this._panelEl) this._panelEl.dataset.state = this.state;
    },

    // ============ 位置感知 ============
    /** 从元素计算编辑位置（题记 / 正文某块 / 无） */
    _locFromElement(el) {
      if (!el) return { target: 'none', type: 'none', label: '', blockIndex: -1, contextText: '' };
      if (el.id === 'edit-subtitle') {
        return { target: 'subtitle', type: 'subtitle', label: '题记', blockIndex: -1, contextText: '题记区域' };
      }
      const editor = el.closest ? (el.closest('.block-input') || el) : el;
      if (editor && editor.parentNode) {
        const container = app.$e && app.$e('edit-blocks-container');
        if (container) {
          const divs = Array.from(container.children);
          const idx = divs.findIndex(div => div.contains(editor) || div === editor);
          if (idx >= 0) {
            const type = divs[idx].dataset.type || 'p';
            // 找到最近的上一级标题作为上下文
            let ctxTitle = '';
            for (let i = idx - 1; i >= 0; i--) {
              const t = divs[i].dataset.type;
              if (t === 'h2' || t === 'h3') { ctxTitle = (divs[i].querySelector('.block-input') || {}).innerText || ''; break; }
            }
            return {
              target: 'block', type: type, label: ctxTitle ? ('「' + ctxTitle + '」下') : ('第' + (idx + 1) + '段'),
              blockIndex: idx, contextText: ctxTitle || '', hasCtx: idx > 0
            };
          }
        }
      }
      return { target: 'none', type: 'none', label: '', blockIndex: -1, contextText: '' };
    },

    /** 获取当前编辑目标位置：优先鼠标停留位置（用户强调按鼠标位置），否则用焦点 */
    getCurrentLocation() {
      // 鼠标位置优先（嗅探时更贴合"鼠标此刻在哪"）
      if (this._mouseLoc && this._mouseLoc.target !== 'none') return this._mouseLoc;
      const active = document.activeElement;
      return this._locFromElement(active);
    },

    /** 根据位置获取针对性灵感 */
    async suggestAtLocation() {
      const key = this._cacheKey('suggest');
      if (this._cache && this._cache[key] && this._cache[key].result) return this._cache[key].result; // 思考缓存命中，不重复调模型
      const loc = this.getCurrentLocation();
      const blockMsg = (loc.target === 'block')
        ? '我正在编辑"正文"中的' + (loc.label || ('第' + (loc.blockIndex + 1) + '段')) + '。'
        : (loc.target === 'subtitle' ? '我正在编辑"题记"。' : '我正在编辑此词条。');
      const prompt = '请根据当前Wiki上下文，针对我正在编辑的位置提供灵感。' + blockMsg +
        '\n如果是正文某段，请结合该段上下文及Wiki中该角色/设定在其他词条的信息，给出1-3条具体、可直接参考的灵感；若有可衔接的写法想法，以"灵感："开头；若发现与你正在编辑内容矛盾或缺失的信息，用"我发现了华点："开头指出；若内容已较完备，给出"建议写入的内容："。';
      const r = await this._request([
        { role: 'system', content: SYSTEM_PROMPT + '\n\n' + this.buildChatContext() },
        { role: 'user', content: prompt }
      ], 0.8);
      const result = (r && r.ok) ? r.content : null;
      if (result && this._cache) { this._cache[key] = { result, at: Date.now(), kind: 'suggest' }; this.saveCache(); }
      return result;
    },

    // ============ 思考缓存（减少重复思考计费） ============
    _cacheKey(prefix) {
      const entry = app.tempEntry || (app.data && app.data.entries && app.data.entries.find(e => e.id === app.data.editingId));
      const version = app.tempVersion || (entry && entry.versions && (entry.versions.find(v => v.vid === app.data.editingVersionId) || entry.versions[0]));
      const content = (version ? ((version.subtitle || '') + (this.blocksToText(version.blocks))) : '') + (entry ? (entry.code || '') : '');
      const loc = this.getCurrentLocation();
      let h = 0; for (let i = 0; i < content.length; i++) { h = ((h << 5) - h + content.charCodeAt(i)) | 0; }
      return prefix + '_' + (entry ? entry.id : 'new') + '_' + (loc.target || 'none') + (typeof loc.blockIndex === 'number' ? '_' + loc.blockIndex : '') + '_' + h;
    },
    loadCache() {
      const sm = app.storageManager;
      if (!sm) { this._cache = {}; return; }
      this._cache = {};
      const load = () => {
        return new Promise((resolve) => {
          setTimeout(async () => {
            try {
              let data = null;
              if (sm.mode === 'desktop') { const t = await sm.readText(sm.rel('assistant-cache.json')); if (t) data = JSON.parse(t); }
              else { const t = localStorage.getItem('glight_assistant_cache'); if (t) data = JSON.parse(t); }
              if (data && data.cache) this._cache = data.cache;
            } catch (e) {}
            resolve();
          }, 0);
        });
      };
      return load();
    },
    async saveCache() {
      const sm = app.storageManager;
      if (!sm) return;
      try {
        const data = JSON.stringify({ updatedAt: Date.now(), cache: this._cache || {} });
        if (sm.mode === 'desktop') await sm.writeText(sm.rel('assistant-cache.json'), data);
        else localStorage.setItem('glight_assistant_cache', data);
      } catch (e) {}
    },
    resetCache() {
      this._cache = {};
      this.saveCache();
      if (app.showToast) app.showToast('思考缓存已重置', 'info');
    },
    async syncCache() {
      if (!this.enabled || !this.model) { if (app.showToast) app.showToast('请先启用并选择模型', 'error'); return; }
      if (!confirm('确认当前的改动完全正确吗？')) return;
      if (app.showToast) app.showToast('正在同步缓存...', 'info');
      const keys = Object.keys(this._cache || {});
      if (!keys.length) { if (app.showToast) app.showToast('缓存为空，暂无需要同步的条目', 'info'); return; }
      const brief = keys.slice(0, 25).map((k, i) => (i + 1) + '. ' + k + ' -> ' + String(this._cache[k].result || '').slice(0, 80)).join('\n');
      const r = await this._request([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: '以下是我Wiki的思考缓存条目摘要与当前内容。请指出哪些缓存条目已与当前Wiki内容不符（过时），只需返回这些条目的编号（逗号分隔），若无则返回"无"。\n缓存摘要：\n' + brief + '\n\n当前Wiki：\n' + this.buildWikiContext().slice(0, 2500) }
      ], 0.4);
      if (r && r.ok) {
        const resp = String(r.content || '');
        const nums = (resp.match(/\d+/g) || []).map(Number);
        if (resp.indexOf('无') >= 0 && nums.length === 0) { if (app.showToast) app.showToast('缓存与现状一致，无需修改', 'success'); return; }
        let removed = 0;
        nums.forEach(n => { const key = keys[n - 1]; if (key && this._cache[key]) { delete this._cache[key]; removed++; } });
        this.saveCache();
        if (app.showToast) app.showToast('已同步缓存，' + (removed ? '标记 ' + removed + ' 条需重思考' : '无需重思考'), 'success');
      } else {
        if (app.showToast) app.showToast('同步失败：' + ((r && r.error) || '未知错误'), 'error');
      }
    },
    /** 切换存档后：沿用以目标存档自身的辅助模型缓存（各存档独立），仅在没有缓存时才询问迁移 */
    async maybeMigrateCache(prevSave) {
      const sm = app.storageManager;
      if (!sm || !prevSave) return;
      // 目标存档已有自己的缓存（reloadAfterSaveSwitch 已加载）→ 直接沿用原有缓存，不提示、不重新整理
      const hasNew = await sm.exists(sm.rel('assistant-cache.json'));
      if (hasNew) return;
      const oldHas = prevSave ? await sm.bridge.exists(prevSave + '/assistant-cache.json') : false;
      if (oldHas) {
        if (confirm('是否将上一个存档的思考缓存迁移到当前存档？')) {
          const t = await sm.bridge.readText(prevSave + '/assistant-cache.json');
          if (t) {
            await sm.writeText(sm.rel('assistant-cache.json'), t);
            try { this._cache = (JSON.parse(t).cache) || {}; } catch (e) {}
            if (app.showToast) app.showToast('思考缓存已迁移', 'success');
            return;
          }
        }
        if (app.showToast) app.showToast('未迁移缓存，可能需要一段时间整理全文信息，该功能可能导致额外计费', 'warning', 6000);
      } else {
        if (app.showToast) app.showToast('可能需要一段时间整理全文信息，该功能可能导致额外计费', 'warning', 6000);
      }
    },

    /**
     * 切换存档后：重新加载【当前存档】的辅助模型全部状态（思考缓存、对话上下文、灵感历史）。
     * 各存档的 assistant-cache.json / assistant-context.json / assistantHistory 彼此独立，
     * 切换后应回到目标存档自己的数据，避免跨存档串数据或重复整理。
     */
    async reloadAfterSaveSwitch(prevSave) {
      // 1. 重新加载目标存档的思考缓存（先清空再读，避免残留上一存档的思考结果）
      this._cache = {};
      await this.loadCache();
      // 2. 重新加载目标存档的对话上下文（多会话）
      this.sessions = null;
      this.activeSessionId = null;
      await this.loadContextFromFile().catch(() => {});
      // 3. 重新加载目标存档的灵感历史（华点/建议，保存在 data.json settings.assistantHistory）
      const hist = (app.data.settings && app.data.settings.assistantHistory) || {};
      this._history = Array.isArray(hist.items) ? hist.items : [];
      this._ignoredKeys = Array.isArray(hist.ignored) ? hist.ignored : [];
      // 4. 刷新界面（若面板存在）
      if (typeof this.renderSessionSelect === 'function') this.renderSessionSelect();
      if (typeof this.renderContext === 'function') this.renderContext();
      if (typeof this.renderHistory === 'function') this.renderHistory();
      if (typeof this.renderSuggestions === 'function') this.renderSuggestions(null);
    },

    // ============ 嗅探 ============
    /** 编辑活动节流触发嗅探 */
    onEditActivity() {
      if (!this.enabled || this.expanded) return;
      clearTimeout(this._sniffTimer);
      this._sniffTimer = setTimeout(() => this.detectInsights(), 2500);
    },

    /** 嗅探：向模型询问是否有有利发现 / 疑似问题 */
    async detectInsights() {
      if (!this.enabled || this.expanded || this.state === 'intervention') return;
      let loc = this.getCurrentLocation();
      // 无特定位置时也允许嗅探整词条（用户要求"添加/修改词条时自动寻找相关信息"）
      if (loc.target === 'none') loc = { target: 'entry', type: 'entry', label: '当前词条', blockIndex: -1, contextText: '' };
      const key = this._cacheKey('sniff');
      const cached = this._cache && this._cache[key];
      if (cached && cached.result) { this._sniffResult = cached.result; this.appendSuggestionMarkdown(cached.result); this.showBubbleFromContent(cached.result); return; } // 缓存的思考结果命中
      const prompt = '请嗅探当前编辑内容，判断是否有值得提醒用户的发现。' +
        '若在Wiki其他词条/正文/梗概中发现了与当前编辑相关的信息、可呼应的写法、或疑似矛盾/漏写，请简要说明并以一行短句返回，格式为：' +
        '[发现类型]...，其中发现类型是「关于xx，我有一些想法！」或「我发现了华点！」或「我想可以这样写…」。' +
        '若无有价值发现，请仅返回"无"。' +
        '正在编辑的位置：' + (loc.label || '词条') + ';\n当前词条：\n' + this.buildEntryContext();
      let r;
      try { r = await this._request([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }], 0.6); }
      catch (e) { return; }
      if (!r || !r.ok) return;
      let content = (r.content || '').trim();
      if (!content || content === '无') { this.hideBubble(); return; }
      // 解析发现类型
      let bubbleText = content;
      let type = 'idea';
      if (content.indexOf('华点') >= 0) { bubbleText = '我发现了华点！'; type = 'dot'; }
      else if (content.indexOf('我想可以这样写') >= 0) { bubbleText = '我想可以这样写…'; type = 'write'; }
      else if (content.indexOf('我有一些想法') >= 0) { bubbleText = content.split('，')[0] || '关于xx，我有一些想法！'; type = 'idea'; }
      // 记录嗅探结果、写入思考缓存、摄入灵感历史（华点去重/置前、忽略跳过）
      this._sniffResult = content;
      if (this._cache) { this._cache[key] = { result: content, at: Date.now(), kind: 'sniff' }; this.saveCache(); }
      this.appendSuggestionMarkdown(content);
      this.showBubble(bubbleText, type);
    },

    /** 根据缓存的思考结果内容直接显示泡泡框（复用嗅探解析） */
    showBubbleFromContent(content) {
      let bt = content, type = 'idea';
      if (content.indexOf('华点') >= 0) { bt = '我发现了华点！'; type = 'dot'; }
      else if (content.indexOf('我想可以这样写') >= 0) { bt = '我想可以这样写…'; type = 'write'; }
      else if (content.indexOf('我有一些想法') >= 0) { bt = content.split('，')[0] || '关于xx，我有一些想法！'; type = 'idea'; }
      this.showBubble(bt, type);
    },

    /** 显示泡泡框（位于云云酱左上角） */
    showBubble(text, type) {
      const wrap = document.getElementById('assistant-bubble-wrap');
      if (!wrap) return;
      clearTimeout(this._bubbleTimer);
      const txt = document.getElementById('assistant-bubble-text');
      if (txt) { txt.textContent = text; txt.dataset.type = type || 'idea'; }
      wrap.classList.remove('hidden');
      // 重新触发动画
      wrap.classList.remove('bubble-pop');
      void wrap.offsetWidth;
      wrap.classList.add('bubble-pop');
      // 停留足够时长（12s）后自动隐藏，确保能被注意到
      this._bubbleTimer = setTimeout(() => { if (!this.expanded) this.hideBubble(); }, 12000);
    },
    hideBubble() {
      const wrap = document.getElementById('assistant-bubble-wrap');
      if (wrap) wrap.classList.add('hidden');
    },

    // ============ 浮动面板 ============
    ensurePanel() {
      const panel = document.getElementById('assistant-panel');
      if (panel) { this._panelEl = panel; }
    },

    setExpanded(v) {
      this.expanded = !!v;
      const panel = document.getElementById('assistant-panel');
      if (panel) panel.classList.toggle('assistant-expanded', this.expanded);
      // 展开/收起都让按钮与窗口一起归位到固定位置（右侧中央），避免窗口掉入死角、按钮移出屏幕
      this._resetPanelPos(panel);
      // 打开面板时隐藏泡泡框
      if (this.expanded) { this.hideBubble(); this.setState('intervention'); }
      else this.setState('sniffer');
      const stateLabel = document.getElementById('assistant-state-label');
      if (stateLabel) stateLabel.textContent = this.expanded ? '介入中' : '嗅探中';
      // 编辑主体左移/恢复
      document.body.classList.toggle('assist-panel-open', this.expanded);
      if (this.expanded) {
        this.renderSessionSelect();
        this.renderContext();
        this.renderHistory();
        this.renderSuggestions(null);
      }
    },
    /** 将面板复位到默认固定位置（右侧中央） */
    _resetPanelPos(panel) {
      if (!panel) panel = document.getElementById('assistant-panel');
      if (!panel) return;
      panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.transform = '';
    },
    togglePanel() { this.setExpanded(!this.expanded); },

    /** 初始化悬浮按钮拖拽（事件委托，限制在可视区内；展开/收起时归位） */
    _initDrag() {
      if (this._dragBound) return;
      this._dragBound = true;
      this._dragData = null;
      this._suppressClick = false;
      document.addEventListener('mousedown', (e) => {
        const av = e.target && e.target.closest && e.target.closest('.assistant-avatar');
        if (!av) return;
        const p = document.getElementById('assistant-panel');
        if (!p) return;
        const rect = p.getBoundingClientRect();
        this._dragData = { startX: e.clientX, startY: e.clientY, originLeft: rect.left, originTop: rect.top, moved: false };
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!this._dragData) return;
        const p = document.getElementById('assistant-panel');
        if (!p) return;
        const dx = e.clientX - this._dragData.startX;
        const dy = e.clientY - this._dragData.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._dragData.moved = true;
        if (this._dragData.moved) {
          // 限制在可视区内，防止按钮被拖出屏幕消失
          const pad = 8;
          const maxX = window.innerWidth - 110 - pad;
          const maxY = window.innerHeight - 140 - pad;
          const x = Math.max(pad, Math.min(this._dragData.originLeft + dx, maxX));
          const y = Math.max(pad, Math.min(this._dragData.originTop + dy, maxY));
          p.style.left = x + 'px';
          p.style.top = y + 'px';
          p.style.right = 'auto';
          p.style.transform = 'none';
        }
      });
      document.addEventListener('mouseup', () => {
        if (!this._dragData) return;
        const wasMoved = this._dragData.moved;
        this._dragData = null;
        if (wasMoved) {
          // 拖拽后抑制下一次点击，避免误触展开/收起
          this._suppressClick = true;
          setTimeout(() => { this._suppressClick = false; }, 120);
        }
      });
      // 点击悬浮按钮（未拖动）→ 展开/收起
      document.addEventListener('click', (e) => {
        if (this._suppressClick) return;
        if (e.target && e.target.closest && e.target.closest('.assistant-avatar')) {
          if (typeof this.togglePanel === 'function') this.togglePanel();
        }
      }, true);
    },
    /** 点击泡泡框 → 展开面板进入介入模式 */
    /** 点击泡泡框 → 展开面板进入介入模式，并拉取更完整的建议 */
    onBubbleClick() {
      this.setExpanded(true);
      if (this._sniffResult) this._refreshSuggestionAsync();
    },
    /** 展开后异步拉取按当前鼠标位置的完整灵感/建议 */
    async _refreshSuggestionAsync() {
      if (this._refreshLoading) return;
      this._refreshLoading = true;
      try {
        const s = await this.suggestAtLocation();
        if (s) this.appendSuggestionMarkdown(s);
      } catch (e) {}
      this._refreshLoading = false;
    },
    /** 切换灵感/对话标签 */
    switchTab(tab) {
      const iTab = document.getElementById('assistant-tab-inspiration');
      const cTab = document.getElementById('assistant-tab-chat');
      const iBox = document.getElementById('assistant-inspiration');
      const cBox = document.getElementById('assistant-chat');
      const isChat = tab === 'chat';
      if (iTab) iTab.classList.toggle('active', !isChat);
      if (cTab) cTab.classList.toggle('active', isChat);
      if (iBox) iBox.style.display = isChat ? 'none' : 'block';
      // 关键：对话区须用 'flex' 而非 'block'，否则覆盖 .assistant-chat 的 display:flex，
      // 消息区 flex:1 失效、高度=内容，导致对话无法滚动
      if (cBox) cBox.style.display = isChat ? 'flex' : 'none';
      if (isChat) { this.renderContext(); this.refreshSuggestions(); }
    },

    hidePanel() {
      this.setExpanded(false);
      const panel = document.getElementById('assistant-panel');
      if (panel) panel.classList.add('hidden');
    },

    _panelVisible() { return !!(document.getElementById('assistant-panel')); },

    /** 简易 Markdown 转 HTML（对话文本，覆盖模型常用样式） */
    _mdToHtml(text) {
      let s = String(text || '');
      s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // 代码块（含语言标注）
      s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, (m, code) => '<pre><code>' + code + '</code></pre>');
      // 行内代码
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      // 表格
      s = s.replace(/(^\|.+?\|[^\n]*(?:\n\|[\s:|-]+\|[^\n]*)?)/gm, (m) => {
        const lines = m.trim().split('\n').filter(l => l.trim().indexOf('|') >= 0);
        let html = '<table>';
        lines.forEach((row, i) => {
          const trimmed = row.trim();
          if (/^\|[\s:|-]+\|$/.test(trimmed)) return; // 分隔行跳过
          const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          html += '<tr>' + cells.map(c => (i === 0 ? '<th>' : '<td>') + c + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>';
        });
        return html + '</table>';
      });
      // 任务列表 - [ ] / - [x]
      s = s.replace(/(^|\n)- \[ \] (.*)/g, '$1<ul class="task-list"><li><input type="checkbox" disabled> $2</li></ul>');
      s = s.replace(/(^|\n)- \[x\] (.*)/g, '$1<ul class="task-list"><li><input type="checkbox" disabled checked> $2</li></ul>');
      // 无序列表
      s = s.replace(/(^|\n)- (?!\[)(.*)/g, '$1<ul><li>$2</li></ul>');
      s = s.replace(/<\/ul>\n<ul>/g, '');
      // 有序列表
      s = s.replace(/(^|\n)\d+\. (.*)/g, '$1<ol><li>$2</li></ol>');
      s = s.replace(/<\/ol>\n<ol>/g, '');
      // 删除线
      s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      // 链接
      s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
      // 粗体/斜体
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      // 标题
      s = s.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
      s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
      s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
      s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
      // 引用
      s = s.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
      // 换行
      s = s.replace(/\n/g, '<br>');
      return s;
    },

    renderContext() {
      const box = document.getElementById('assistant-context');
      if (!box) return;
      box.innerHTML = '';
      const msgs = this.activeMessages();
      if (!msgs.length) {
        box.innerHTML = '<div class="text-xs text-gray-400">开始一个新会话吧，问云云酱关于Wiki的任何问题。</div>';
        return;
      }
      msgs.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'assistant-msg assistant-msg-' + (msg.role === 'user' ? 'user' : 'ai');
        div.innerHTML = this._mdToHtml(msg.content);
        box.appendChild(div);
      });
      box.scrollTop = box.scrollHeight;
    },

    renderHistory() {
      const box = document.getElementById('assistant-inspiration');
      if (!box) return;
      box.innerHTML = '';
      const items0 = (this._history || []).filter(h => !h.ignored);
      // 来源于对话的建议优先显示
      const chatSug = items0.filter(h => h.type === 'suggestion' && h.source === 'chat');
      const rest = items0.filter(h => !(h.type === 'suggestion' && h.source === 'chat'));
      const items = [...chatSug, ...rest];
      if (!items.length) {
        box.innerHTML = '<div class="text-xs text-gray-400">云云酱会在此给出灵感、华点与"建议写入的内容"。你可以在下方与我对话。</div>';
        return;
      }
      items.forEach(h => {
        const card = document.createElement('div');
        card.className = 'assistant-history-card assistant-history-card-' + h.type;
        const typeLabel = h.type === 'dot' ? '我发现了华点' : h.type === 'suggestion' ? '建议写入的内容' : '灵感';
        const head = document.createElement('div');
        head.className = 'assistant-history-head';
        head.innerHTML = '<span class="assistant-history-type">' + typeLabel + '</span>' + (h.source === 'chat' ? '<span class="assistant-source-tag">来源于对话</span>' : '');
        if (h.type === 'dot') {
          const ig = document.createElement('button');
          ig.className = 'assistant-mini-btn assistant-ignore-btn';
          ig.title = '忽略此问题，不再出现';
          ig.textContent = '忽略';
          ig.onclick = (ev) => { ev.stopPropagation(); this.ignoreDot(h.id); };
          head.appendChild(ig);
        }
        const del = document.createElement('button');
        del.className = 'assistant-mini-btn assistant-del-btn';
        del.title = '删除';
        del.textContent = '删除';
        del.onclick = (ev) => { ev.stopPropagation(); this.deleteHistoryItem(h.id); };
        head.appendChild(del);
        card.appendChild(head);
        const txt = document.createElement('div');
        txt.className = 'assistant-history-text';
        txt.textContent = h.text;
        card.appendChild(txt);
        const actions = document.createElement('div');
        actions.className = 'assistant-history-actions';
        const copy = document.createElement('button');
        copy.className = 'assistant-mini-btn';
        copy.textContent = '复制';
        copy.onclick = (ev) => { ev.stopPropagation(); this.copyText(h.text); };
        actions.appendChild(copy);
        if (h.type === 'suggestion') {
          const apply = document.createElement('button');
          apply.className = 'assistant-mini-btn assistant-apply-btn';
          apply.textContent = '写入当前编辑位置';
          apply.onclick = (ev) => { ev.stopPropagation(); this._lastSuggestion = h.text; this.applySuggestion(); };
          actions.appendChild(apply);
        }
        card.appendChild(actions);
        // 点击卡片体 → 在编辑界面定位到对应位置并显示内联悬浮提示
        card.onclick = (ev) => { if (ev.target.closest('button')) return; this._showInlineNote(h); };
        card.title = '点击定位到编辑位置';
        box.appendChild(card);
      });
      box.scrollTop = box.scrollHeight;
    },

    /** 把模型返回内容按标记拆解为灵感/华点/建议段（更全面的华点识别） */
    _parseInsight(content) {
      const src = String(content || '').trim();
      if (!src) return [];
      const parts = [];
      const re = /(建议写入的内容|我发现了华点|发现(?:一个|了)?华点|有个(?:华点|问题|矛盾)|疑似(?:矛盾|错误|问题)|这里(?:有)?(?:矛盾|错误|问题|不对劲)|灵感|我想可以这样写|§)[：:]?/g;
      let lastIndex = 0, m, lastType = 'idea';
      while ((m = re.exec(src)) !== null) {
        const before = src.slice(lastIndex, m.index).trim();
        if (before) parts.push({ type: lastType, text: before });
        lastType = (/华点|问题|矛盾|疑似|错误|不对劲/.test(m[0])) ? 'dot'
          : (m[0].indexOf('建议写入') >= 0 ? 'suggestion' : 'idea');
        lastIndex = re.lastIndex;
      }
      const tail = src.slice(lastIndex).trim();
      if (tail) parts.push({ type: lastType, text: tail });
      if (parts.length === 0) return [{ type: 'idea', text: src }];
      // 二次筛查：疑似华点的内容（含矛盾/疑似/错误等词）从"灵感"纠正为"华点"
      parts.forEach(p => { if (p.type === 'idea' && this._isDotText(p.text)) p.type = 'dot'; });
      return parts.filter(p => p.text && p.text.trim());
    },
    _isDotText(t) {
      return /(华点|矛盾|疑似|不一致|漏写|错误|对不上|前后不符|有问题|问题：|不对劲)/.test(String(t));
    },

    /** 摄入模型返回，拆解为历史项（华点去重/置前、忽略跳过） */
    appendSuggestionMarkdown(content, source) {
      if (!content) return;
      const loc = (typeof this.getCurrentLocation === 'function') ? this.getCurrentLocation() : null;
      const items = this._parseInsight(content);
      items.forEach(it => this.addHistoryItem(it.type, it.text, loc, source));
      const sug = items.find(i => i.type === 'suggestion');
      if (sug) this._lastSuggestion = sug.text;
      this.renderHistory();
    },

    /** 清洗"建议写入的内容"：硬性边界——只保留可直接填入的文段，剥离一切边界外提示 */
    _cleanSug(t) {
      let s = String(t || '').trim();
      // 硬性边界1：优先取 ``` 代码块内的实际文本（边界外是提示）
      const codeM = s.match(/```([\s\S]*?)```/);
      if (codeM) { const c = codeM[1].trim(); if (c) return c; }
      // 硬性边界2：去掉【...】注释段（如"【后续的内容】【示例】【注意】"）
      s = s.replace(/【[^】]*】/g, '');
      // 硬性边界3：去掉前置说明句（"以下是...可直接替换原第N段："等，以冒号或句号界定，避免误吞正文）
      s = s.replace(/^(?:以下是|这是|这里|如下|为方便|为了方便|补充|我整理了|给你|建议用|把|可以直接替换|可直接替换)[^。\n:：]{0,50}(?:[：:]|。{1,2})\s*/g, '');
      // 去掉末尾的括号注释（…）
      s = s.replace(/[（(][^）)]{0,40}[）)]\s*$/g, '');
      // 拆成句子，去掉末尾以说明性词语开头的句子
      let sentences = s.split(/(?<=[。！？!?])\s*/).filter(Boolean);
      while (sentences.length && /^\s*(希望|以上|仅供|仅供参考|希望对|建议你|你可以参考|祝你|祝|另外|其实我|供你参考|(?:以上|供你)\s*参考)/.test(sentences[sentences.length - 1])) sentences.pop();
      s = sentences.join('').trim();
      // 去掉行末的客套语
      if (s.length > 3) s = s.replace(/(?:以上|仅供参考|希望对你有帮助|希望有帮助|欢迎参考)[。.!！]?$/, '');
      return s;
    },

    addHistoryItem(type, text, loc, source) {
      text = String(text || '').trim();
      if (!text) return;
      type = (type === 'suggestion') ? 'suggestion' : (type === 'dot') ? 'dot' : 'idea';
      if (type === 'suggestion') { const c = this._cleanSug(text); if (c) text = c; }
      if (!text) return;
      if (type === 'dot') {
        if (this._ignoredKeys.indexOf(text) >= 0) return; // 忽略过的问题不再出现
        const existing = (this._history || []).find(h => h.type === 'dot' && h.text === text);
        if (existing) { this._history = [existing].concat(this._history.filter(h => h !== existing)); return; } // 已有 → 置前
      }
      const id = 'h' + Date.now() + Math.random().toString(36).slice(2, 6);
      this._history = [{ id, type, text, ignored: false, loc: loc || null, source: source || null }].concat(this._history || []);
      if (this._history.length > 40) this._history = this._history.slice(0, 40);
      this.persistHistory();
      // 建议/华点 → 编辑区内联悬浮提示 + 定位
      if (!this.expanded && (type === 'suggestion' || type === 'dot')) this._showInlineNote(this._history[0]);
    },

    deleteHistoryItem(id) {
      this._history = (this._history || []).filter(h => h.id !== id);
      this.persistHistory();
      this.renderHistory();
    },

    // ============ 编辑区内联悬浮提示（建议/华点悬浮在相关位置） ============
    _showInlineNote(item) {
      const note = document.getElementById('assistant-inline-note');
      if (!note || !item) return;
      this._inlineItem = item;
      this._noteDragged = false; // 新提示 → 重新定位
      const label = document.getElementById('assistant-inline-note-label');
      if (label) label.textContent = item.type === 'dot' ? '云云酱 · 发现问题' : item.type === 'suggestion' ? '云云酱 · 建议写入' : '云云酱 · 灵感';
      const txt = document.getElementById('assistant-inline-note-text');
      if (txt) txt.textContent = item.text;
      note.classList.remove('hidden');
      const isSug = item.type === 'suggestion';
      const isDot = item.type === 'dot';
      const copyB = document.getElementById('assistant-inline-copy');
      const applyB = document.getElementById('assistant-inline-apply');
      const ignoreB = document.getElementById('assistant-inline-ignore');
      if (copyB) { copyB.style.display = 'inline-block'; copyB.onclick = () => this.copyText(item.text); }
      if (applyB) { applyB.style.display = isSug ? 'inline-block' : 'none'; applyB.onclick = () => { this._lastSuggestion = item.text; this.applySuggestion(); }; }
      if (ignoreB) { ignoreB.style.display = isDot ? 'inline-block' : 'none'; ignoreB.onclick = () => { this.ignoreDot(item.id); this.hideInlineNote(); }; }
      this._positionInlineNote(item);
      this._updateInlineBadge();
    },
    hideInlineNote() {
      const note = document.getElementById('assistant-inline-note');
      if (note) { note.classList.add('hidden'); this._inlineItem = null; }
    },
    _positionInlineNote(item) {
      const note = document.getElementById('assistant-inline-note');
      if (!note) return;
      if (this._noteDragged) return; // 用户已拖动小窗 → 不覆盖位置
      const loc = item && item.loc;
      let targetEl = null;
      if (loc && loc.target === 'block' && typeof loc.blockIndex === 'number' && loc.blockIndex >= 0) {
        const container = app.$e && app.$e('edit-blocks-container');
        if (container && container.children[loc.blockIndex]) targetEl = container.children[loc.blockIndex];
      } else if (loc && loc.target === 'subtitle') {
        targetEl = document.getElementById('edit-subtitle');
      }
      let left, top;
      if (targetEl) {
        const r = targetEl.getBoundingClientRect();
        left = Math.min(r.right + 12, window.innerWidth - 336);
        top = r.top;
      } else {
        // 整体问题/无位置 → 编辑区右上方
        const main = document.getElementById('main-container') || document.body;
        const mr = main.getBoundingClientRect();
        left = Math.min(mr.right - 336, window.innerWidth - 336);
        top = Math.max(70, mr.top + 20);
      }
      note.style.left = Math.max(8, left) + 'px';
      note.style.top = Math.max(8, top) + 'px';
    },

    // ============ 编辑位置角标：提示"此处有云云酱的建议"，点击定位 ============
    _updateInlineBadge() {
      const badge = document.getElementById('assistant-inline-badge');
      if (!badge) return;
      const item = (this._history || []).find(h => !h.ignored && (h.type === 'suggestion' || h.type === 'dot') && h.loc && h.loc.target === 'block' && typeof h.loc.blockIndex === 'number' && h.loc.blockIndex >= 0);
      if (!item) { badge.classList.add('hidden'); this._inlineBadgeId = null; return; }
      const container = app.$e && app.$e('edit-blocks-container');
      const el = container && container.children[item.loc.blockIndex];
      if (!el) { badge.classList.add('hidden'); this._inlineBadgeId = null; return; }
      const r = el.getBoundingClientRect();
      badge.style.left = (r.right + 4) + 'px';
      badge.style.top = (r.top + 12) + 'px';
      badge.classList.remove('hidden');
      this._inlineBadgeId = item.id;
    },
    onInlineBadge() {
      const item = (this._history || []).find(h => h.id === this._inlineBadgeId);
      if (!item) return;
      const container = app.$e && app.$e('edit-blocks-container');
      const el = container && container.children[item.loc.blockIndex];
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this._noteDragged = false;
      this._showInlineNote(item);
    },

    // 内联小窗拖动
    _initInlineNoteDrag() {
      if (this._noteDragBound) return;
      this._noteDragBound = true;
      let drag = null;
      const note = () => document.getElementById('assistant-inline-note');
      document.addEventListener('mousedown', (e) => {
        const head = e.target && e.target.closest && e.target.closest('.assistant-inline-note-head');
        if (!head) return;
        const n = note(); if (!n) return;
        const rect = n.getBoundingClientRect();
        drag = { sx: e.clientX, sy: e.clientY, ol: rect.left, ot: rect.top, moved: false };
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const n = note(); if (!n) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          n.style.left = Math.max(0, Math.min(drag.ol + dx, window.innerWidth - 120)) + 'px';
          n.style.top = Math.max(0, Math.min(drag.ot + dy, window.innerHeight - 60)) + 'px';
          this._noteDragged = true;
        }
      });
      document.addEventListener('mouseup', () => { drag = null; });
    },

    ignoreDot(id) {
      const h = (this._history || []).find(x => x.id === id);
      if (h) { h.ignored = true; if (this._ignoredKeys.indexOf(h.text) < 0) this._ignoredKeys.push(h.text); }
      this.persistHistory();
      this.renderHistory();
    },

    persistHistory() {
      try { app.data.settings.assistantHistory = { items: this._history || [], ignored: this._ignoredKeys || [] }; } catch (e) {}
    },

    /** 复制文本 */
    copyText(text) {
      navigator.clipboard.writeText(text).then(() => {
        if (app.showToast) app.showToast('已复制', 'success');
      }).catch(() => {});
    },

    /** 复制当前"建议写入的内容"或灵感文本 */
    copySuggestion() {
      const text = this._lastSuggestion || (document.getElementById('assistant-inspiration') || {}).innerText || '';
      this.copyText(text);
    },

    /** 一键替换：把"建议写入的内容"写入当前编辑位置（题记/正文某段）——仅替换目标，不动其他 */
    applySuggestion() {
      const text = this._lastSuggestion;
      if (!text) { if (app.showToast) app.showToast('暂无建议可写入', 'error'); return; }
      const loc = this.getCurrentLocation();
      if (loc.target === 'subtitle') {
        const el = document.getElementById('edit-subtitle');
        if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); if (app.showToast) app.showToast('已写入题记', 'success'); }
      } else if (loc.target === 'block') {
        const container = app.$e && app.$e('edit-blocks-container');
        if (container && loc.blockIndex >= 0) {
          const div = container.children[loc.blockIndex];
          const editor = div && div.querySelector('.block-input[contenteditable="true"]');
          if (editor) { editor.innerText = text; editor.dispatchEvent(new Event('input', { bubbles: true })); if (app.showToast) app.showToast('已写入该段', 'success'); }
          else if (app.showToast) app.showToast('无法定位该段编辑器', 'error');
        }
      } else {
        // 当前无明确位置：仅复制，不自动写入
        if (app.showToast) app.showToast('请先定位到题记或正文某段，再点击写入', 'warning');
        this.copySuggestion();
      }
    },

    // 对话提交（面板输入框）
    async submitQuestion() {
      const input = document.getElementById('assistant-question');
      if (!input) return;
      const q = (input.value || '').trim();
      if (!q) return;
      input.value = '';
      const box = document.getElementById('assistant-context');
      // 先追加用户提问
      if (box) {
        const mine = document.createElement('div');
        mine.className = 'assistant-msg assistant-msg-user';
        mine.textContent = q;
        box.appendChild(mine);
        box.scrollTop = box.scrollHeight;
      }
      // 追加"等待模型对话中"占位提示
      let placeholder = null;
      if (box) {
        placeholder = document.createElement('div');
        placeholder.className = 'assistant-msg assistant-msg-ai assistant-waiting';
        placeholder.textContent = '等待模型对话中…';
        box.appendChild(placeholder);
        box.scrollTop = box.scrollHeight;
      }
      const ans = await this.ask(q);
      // 移除等待占位
      if (placeholder && placeholder.isConnected) placeholder.remove();
      if (ans) {
        const box2 = document.getElementById('assistant-context');
        if (box2) {
          const ai = document.createElement('div');
          ai.className = 'assistant-msg assistant-msg-ai';
          ai.textContent = ans;
          box2.appendChild(ai);
          box2.scrollTop = box2.scrollHeight;
        }
        // 摄入灵感/华点/建议到历史，并刷新对话备选项
        this.appendSuggestionMarkdown(ans, 'chat');
        this.refreshSuggestions();
      } else if (box && placeholder && placeholder.isConnected) {
        // 模型未返回：把占位改为错误提示
        placeholder.textContent = '（模型未返回结果，请检查模型配置）';
      }
    },

    destroy() {
      this.hideBubble();
      this.setExpanded(false);
      this._sniffResult = null;
    }
  };

  function segmentsLengthMinus1(arr) { return arr.length - 1; }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  console.log('Part 9 (Assistant/云云酱) 加载完成');
})();

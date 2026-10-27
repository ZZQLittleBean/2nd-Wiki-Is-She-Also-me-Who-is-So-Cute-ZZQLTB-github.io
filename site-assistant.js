/**
 * 站点版云云酱（与当前本地桌面版对齐）。
 *
 * 为什么要自己写：旧版自带那个助手是"灵感/华点/建议写入"的编辑器辅助，
 * 与现在的云云酱不是同一套界面。这里用原生 JS 重建：
 *   · 右下圆形悬浮球（本地同款 logo）
 *   · 面板：标题栏（新建会话 / 清空 / 关闭）+ 消息区 + 输入框 + 发送
 *   · 回答支持 Markdown、词条跳转按钮
 *   · 桌面为右侧浮层，移动端为底部抽屉
 * 全部样式走站点已有的暖色 token，不引入新依赖。
 */
(() => {
  const LOGO = 'assistant.png';
  const ENTRIES = [];

  /* ---------- 数据 ---------- */
  let siteData = null;
  const loadSite = async () => {
    if (siteData !== null) return siteData;
    const res = await fetch('data/site.json', { cache: 'no-store' });
    siteData = res.ok ? await res.json() : {};
    for (const entry of siteData.entries ?? []) {
      const title = String(entry?.versions?.[0]?.title ?? entry?.code ?? entry?.id ?? '').trim();
      if (title !== '') ENTRIES.push({ id: String(entry.id ?? ''), title });
    }
    return siteData;
  };

  /* ---------- 检索（省流用，不命中也继续聊） ---------- */
  /** 疑问词/口头语：不参与匹配，否则"张可云是谁"会当成一整个词去搜 */
  const STOPWORDS = [
    '是谁', '是什么', '叫什么', '做什么', '干什么', '怎么样', '为什么', '多少',
    '哪里', '哪个', '哪些', '如何', '请问', '帮我', '一句话', '简单', '说说', '介绍',
    '一下', '大概', '相关', '内容', '什么', '怎么',
  ];

  const normalize = (text) => {
    let out = String(text ?? '');
    for (const word of STOPWORDS) out = out.split(word).join(' ');
    return out;
  };

  const tokensOf = (question) => {
    const cleaned = normalize(question);
    const parts = cleaned.split(/[\s，。？！、,.?!：:；;“”"'（）()\[\]]+/).filter((part) => part !== '');
    const tokens = new Set();
    for (const part of parts) {
      if (part.length >= 2) tokens.add(part);
      /* 中文没有空格：再切 2~4 字的窗口，避免整句当一个词 */
      for (let size = 2; size <= 4; size += 1) {
        for (let i = 0; i + size <= part.length; i += 1) tokens.add(part.slice(i, i + size));
      }
    }
    return [...tokens].filter((token) => token.length >= 2);
  };

  const searchSnippets = (question) => {
    const q = String(question ?? '').trim();
    if (q === '' || siteData === null) return [];
    const tokens = tokensOf(q);
    if (tokens.length === 0) return [];

    const hits = [];
    for (const entry of siteData.entries ?? []) {
      const version = entry?.versions?.[0];
      const title = String(version?.title ?? '');
      const text = (version?.blocks ?? []).map((b) => String(b.text ?? '')).join(' ').slice(0, 2000);
      let score = 0;
      for (const token of tokens) {
        if (title.includes(token)) score += 12;      /* 标题命中权重最高 */
        else if (text.includes(token)) score += token.length;
      }
      if (score > 0) hits.push({ kind: 'entry', id: String(entry.id ?? ''), title, text, score });
    }
    for (const item of siteData.synopsis ?? []) {
      const title = String(item?.title ?? '');
      const text = String(item?.content ?? '').slice(0, 2000);
      let score = 0;
      for (const token of tokens) {
        if (title.includes(token)) score += 10;
        else if (text.includes(token)) score += token.length;
      }
      if (score > 0) hits.push({ kind: 'synopsis', id: String(item?.chapterId ?? item?.id ?? ''), title, text, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 6);
  };

  /* ---------- Markdown-lite ---------- */
  const escapeHtml = (text) =>
    String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  const renderMarkdown = (text) => {
    const inline = (line) =>
      escapeHtml(line)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code class="site-md-code">$1</code>');

    const out = [];
    for (const raw of String(text ?? '').split('\n')) {
      const line = raw.trimEnd();
      if (line.trim() === '') {
        out.push('<div class="site-md-gap"></div>');
        continue;
      }
      const list = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
      if (list !== null) {
        out.push(`<div class="site-md-li">• ${inline(list[1])}</div>`);
        continue;
      }
      out.push(`<p class="site-md-p">${inline(line)}</p>`);
    }
    return out.join('');
  };

  /* ---------- 面板 DOM ---------- */
  const css = `
    /* 悬浮按钮：直接显示云云酱原图，不做圆形容器（用户明确要求） */
    .site-ai-ball { position: fixed; right: 14px; bottom: 12px; width: auto; height: auto;
      border: none; border-radius: 0; background: transparent; box-shadow: none;
      cursor: pointer; z-index: 99990; padding: 0; }
    .site-ai-ball img { width: 96px; height: auto; display: block; object-fit: contain;
      filter: drop-shadow(0 6px 16px rgb(0 0 0 / .22)); }
    .site-ai { position: fixed; right: 16px; bottom: 16px; width: 380px; height: min(720px, 82vh);
      display: none; flex-direction: column; z-index: 99991; background: var(--surface-0, #fffdfa);
      border: 1px solid var(--line-strong, #c8bfb2); border-radius: 10px;
      box-shadow: -8px 0 28px rgb(0 0 0 / .14); overflow: hidden;
      font-family: var(--design-body-family, 'Noto Sans SC', sans-serif); color: var(--ink-0, #2b2724); }
    .site-ai.open { display: flex; }
    .site-ai-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid var(--line, #ded7cd); background: var(--surface-1, #fffdfa); }
    .site-ai-title { flex: 1; font-weight: 600; font-size: 14px; }
    .site-ai-head button { border: 1px solid var(--line, #ded7cd); background: transparent; color: inherit;
      border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
    .site-ai-head button:hover { background: var(--surface-2, #f2ede5); }
    .site-ai-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px;
      background: var(--surface-2, #f2ede5); }
    .site-ai-msg { max-width: 92%; padding: 8px 10px; border-radius: 10px; font-size: 13.5px; line-height: 1.7;
      white-space: normal; word-break: break-word; }
    .site-ai-msg.user { align-self: flex-end; background: var(--accent, #a8382a); color: #fff; }
    .site-ai-msg.bot { align-self: flex-start; background: var(--surface-0, #fffdfa);
      border: 1px solid var(--line, #ded7cd); }
    .site-md-p { margin: 0 0 .5em; }
    .site-md-li { margin: 0 0 .3em; padding-left: .2em; }
    .site-md-gap { height: .4em; }
    .site-md-code { background: var(--surface-2, #f2ede5); border-radius: 4px; padding: 0 .3em;
      font-family: ui-monospace, Consolas, monospace; font-size: .92em; }
    .site-ai-jumps { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .site-ai-jump { border: 1px solid var(--line-strong, #c8bfb2); background: var(--surface-1, #fffdfa);
      color: inherit; border-radius: 999px; padding: 2px 8px; font-size: 12px; cursor: pointer; }
    .site-ai-foot { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--line, #ded7cd);
      background: var(--surface-1, #fffdfa); }
    .site-ai-input { flex: 1; border: 1px solid var(--line, #ded7cd); border-radius: 6px; padding: 8px;
      font-size: 13px; background: #fff; color: inherit; }
    .site-ai-send { border: none; border-radius: 6px; padding: 8px 14px; background: var(--accent, #a8382a);
      color: #fff; font-size: 13px; cursor: pointer; }
    .site-ai-send[disabled] { opacity: .6; cursor: default; }
    @media (max-width: 720px) {
      .site-ai { right: 0; left: 0; bottom: 0; width: 100%; height: min(76vh, 640px);
        border-radius: 12px 12px 0 0; }
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const ball = document.createElement('button');
  ball.type = 'button';
  ball.className = 'site-ai-ball';
  ball.setAttribute('aria-label', '云云酱');
  ball.innerHTML = `<img src="${LOGO}" alt="云云酱" />`;

  const panel = document.createElement('section');
  panel.className = 'site-ai';
  panel.setAttribute('data-site-ai', '');
  panel.innerHTML = `
    <div class="site-ai-head">
      <span class="site-ai-title">云云酱</span>
      <button type="button" data-site-ai-new>新建会话</button>
      <button type="button" data-site-ai-clear>清空</button>
      <button type="button" data-site-ai-close aria-label="关闭">×</button>
    </div>
    <div class="site-ai-body" data-site-ai-body></div>
    <div class="site-ai-foot">
      <input class="site-ai-input" data-site-ai-input placeholder="问点什么…" />
      <button class="site-ai-send" type="button" data-site-ai-send>发送</button>
    </div>
  `;

  document.body.appendChild(ball);
  document.body.appendChild(panel);

  const body = panel.querySelector('[data-site-ai-body]');
  const input = panel.querySelector('[data-site-ai-input]');
  const sendBtn = panel.querySelector('[data-site-ai-send]');

  const history = [];
  let busy = false;

  const pushMessage = (role, text, jumps) => {
    const el = document.createElement('div');
    el.className = `site-ai-msg ${role}`;
    el.innerHTML = renderMarkdown(text);
    if (Array.isArray(jumps) && jumps.length > 0) {
      const row = document.createElement('div');
      row.className = 'site-ai-jumps';
      for (const jump of jumps) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'site-ai-jump';
        link.textContent = `查看「${jump.title}」`;
        link.addEventListener('click', () => {
          if (window.app && typeof window.app.openEntry === 'function') window.app.openEntry(jump.id);
          else if (window.app && typeof window.app.router === 'function') window.app.router('entries');
        });
        row.appendChild(link);
      }
      el.appendChild(row);
    }
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  };

  /** 组装提示词：当前本地版同款（人格 + 风格 + 绑定 + 检索约束） */
  const buildSystem = (cfg) => {
    const parts = [cfg.persona, cfg.binding, cfg.retrieval, cfg.style].filter(
      (part) => typeof part === 'string' && part.trim() !== '',
    );
    return parts.join('\n\n');
  };

  const ask = async () => {
    const question = (input.value ?? '').trim();
    if (question === '' || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    pushMessage('user', question);

    try {
      const crypto = window.__siteAi;
      const cfg = await crypto.aiConfig();
      const snippets = searchSnippets(question);
      const context = snippets
        .map((hit) => `【${hit.title}】${hit.text.replace(/\s+/g, ' ').slice(0, 600)}`)
        .join('\n\n');

      const user = snippets.length === 0
        ? question
        : `【用户问题】${question}\n\n【检索片段】\n${context}`;

      const messages = [
        { role: 'system', content: buildSystem(cfg) },
        ...history.slice(-6),
        { role: 'user', content: user },
      ];

      const res = await window.desktopBridge.assistantChat({ messages, temperature: 0.6 });
      const text = res.ok === true ? res.text : `（模型没接通：${res.error ?? ''}）`;
      pushMessage('bot', text, snippets.filter((h) => h.kind === 'entry').slice(0, 2));
      history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
    } catch (cause) {
      pushMessage('bot', `（出错了：${String(cause?.message ?? cause)}）`);
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  };

  ball.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && body.childElementCount === 0) {
      pushMessage('bot', '我是云云酱。想问哪个人物、哪段剧情，直接说就好。');
    }
  });
  panel.querySelector('[data-site-ai-close]').addEventListener('click', () => panel.classList.remove('open'));
  panel.querySelector('[data-site-ai-clear]').addEventListener('click', () => {
    body.innerHTML = '';
    history.length = 0;
  });
  panel.querySelector('[data-site-ai-new]').addEventListener('click', () => {
    body.innerHTML = '';
    history.length = 0;
    pushMessage('bot', '新会话开始啦，想问什么？');
  });
  sendBtn.addEventListener('click', () => {
    void ask();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void ask();
  });

  /* 旧版那个编辑器助手不要再出现 */
  const hideLegacy = () => {
    document.querySelectorAll('.assistant-panel').forEach((el) => {
      el.style.display = 'none';
    });
  };
  window.addEventListener('DOMContentLoaded', () => {
    hideLegacy();
    void loadSite();
  });
  window.setInterval(hideLegacy, 800);
  void loadSite();
})();

/**
 * 只读站点的 bridge 适配层。
 *
 * 旧版（wiki-local）所有存储都走 `window.desktopBridge`；没有它就退化成
 * "浏览器演示模式"（OPFS 本地库），发布到 GitHub 后读者看到的会是空站。
 *
 * 这里用 fetch 实现同一套接口：
 *  · 存档只有一个，名字固定 `site`，数据来自 `/data/site.json`
 *  · 图片来自 `/data/wiki-images/*`（按 manifest 列目录）
 *  · 写操作一律拒绝（静态站点没有写入权限）
 */
(() => {
  const ARCHIVE = 'site';
  const files = new Map(); // 相对路径 → Blob/文本，供 exists/read 使用

  /*
   * 旧版在"没有选中存档"时会直接读写根级文件名，所以两种写法都要认：
   *   · `data.json`            → 根级
   *   · `site/data.json`       → 带存档名的相对路径
   */
  const TEXT_FILES = {
    'data.json': '/data/site.json',
    'about.json': '/data/about.json',
    'wiki-manifest.json': '/data/wiki-manifest.json',
    [`${ARCHIVE}/data.json`]: '/data/site.json',
    [`${ARCHIVE}/about.json`]: '/data/about.json',
    [`${ARCHIVE}/wiki-manifest.json`]: '/data/wiki-manifest.json',
  };

  /** 把 `site/wiki-images/x.jpg` 与 `wiki-images/x.jpg` 统一成后一种 */
  const imageNameOf = (path) => {
    const prefix = path.startsWith(`${ARCHIVE}/`) ? `${ARCHIVE}/wiki-images/` : 'wiki-images/';
    return path.startsWith(prefix) ? path.slice(prefix.length) : null;
  };

  let manifestCache = null;

  /** 归一化相对路径：去掉前导 ./ 与多余斜杠 */
  const norm = (rel) => String(rel ?? '').replace(/^\.\//, '').replace(/\\/g, '/');

  const loadManifest = async () => {
    if (manifestCache !== null) return manifestCache;
    try {
      const res = await fetch('/data/wiki-manifest.json', { cache: 'no-store' });
      manifestCache = res.ok ? await res.json() : [];
    } catch {
      manifestCache = [];
    }
    return manifestCache;
  };

  /** manifest 里登记的图片名（结构在不同版本里略有差异，做兼容） */
  const imageNames = (manifest) => {
    if (Array.isArray(manifest)) {
      return manifest.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean);
    }
    const list = manifest?.images ?? manifest?.files ?? [];
    return list.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean);
  };

  const bridge = {
    async getAppInfo() {
      return { name: 'Glight微光Wiki', version: '2.8', dataRoot: '/data', platform: 'web', readOnly: true };
    },

    async list(rel) {
      const path = norm(rel);
      if (path === '' || path === '.') return [{ name: ARCHIVE, isDirectory: true }];
      if (path === ARCHIVE) {
        return [
          { name: 'data.json', isDirectory: false },
          { name: 'about.json', isDirectory: false },
          { name: 'wiki-manifest.json', isDirectory: false },
          { name: 'wiki-images', isDirectory: true },
        ];
      }
      if (path === `${ARCHIVE}/wiki-images` || path === 'wiki-images') {
        const manifest = await loadManifest();
        return imageNames(manifest).map((name) => ({ name, isDirectory: false }));
      }
      return [];
    },

    async exists(rel) {
      const path = norm(rel);
      if (TEXT_FILES[path] !== undefined) return true;
      if (path === ARCHIVE || path === `${ARCHIVE}/wiki-images`) return true;
      const imageName = imageNameOf(path);
      if (imageName !== null) {
        const manifest = await loadManifest();
        return imageNames(manifest).includes(imageName);
      }
      return false;
    },

    async readText(rel) {
      const path = norm(rel);
      const url = TEXT_FILES[path];
      if (url === undefined) throw new Error(`静态站点没有这个文件：${path}`);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`读取失败：${url}`);
      return res.text();
    },

    async readBinary(rel) {
      const path = norm(rel);
      const imageName = imageNameOf(path);
      if (imageName === null) throw new Error(`静态站点没有这个文件：${path}`);
      const name = imageName;
      const res = await fetch(`/data/wiki-images/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`读取失败：${name}`);
      return res.arrayBuffer();
    },

    async openExternal(url) {
      window.open(String(url), '_blank', 'noopener');
    },

    /* 只读站点：写操作明确失败，避免界面以为"保存成功" */
    async writeText() {
      throw new Error('这是只读展示站点，不能保存修改');
    },
    async writeBinary() {
      throw new Error('这是只读展示站点，不能保存修改');
    },
    async mkdir() {
      throw new Error('这是只读展示站点，不能创建目录');
    },
    async delete() {
      throw new Error('这是只读展示站点，不能删除文件');
    },

    onBeforeClose() {},
    saveDone() {},

    /* 云云酱：静态站点直接用解密出来的配置连模型 */
    async assistantModels({ baseURL, apiKey } = {}) {
      try {
        const cfg = await aiConfig();
        const endpoint = String(baseURL || cfg.endpoint).replace(/\/+$/, '');
        const key = apiKey || cfg.apiKey;
        const res = await fetch(`${endpoint}/models`, { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
        const body = await res.json();
        return { models: (body?.data ?? []).map((m) => m.id).filter(Boolean) };
      } catch (cause) {
        return { models: [], error: String(cause?.message ?? cause).slice(0, 120) };
      }
    },

    async assistantChat({ baseURL, apiKey, model, messages, temperature } = {}) {
      try {
        const cfg = await aiConfig();
        /*
         * 沿用**旧版助手自己的系统提示**（云云酱 + Wiki 结构 + 灵感/华点/建议写入），
         * 只在其后追加两段：人格绑定（有绑定时）与检索约束。
         * 这是按用户要求"以旧版配置为基准，叠加绑定与检索"。
         */
        const incoming = Array.isArray(messages) ? messages : [];
        const appended = [cfg.binding, cfg.retrieval].filter(
          (part) => typeof part === 'string' && part.trim() !== '',
        );
        const suffix = appended.join('\n\n');

        const merged = incoming.map((m) => ({ ...m }));
        if (suffix !== '') {
          const sysIndex = merged.findIndex((m) => m && m.role === 'system');
          if (sysIndex >= 0) {
            merged[sysIndex] = { role: 'system', content: `${merged[sysIndex].content}\n\n${suffix}` };
          } else {
            merged.unshift({ role: 'system', content: suffix });
          }
        }

        window.__siteLastRequest = {
          endpoint: baseURL || cfg.endpoint,
          model: model || cfg.model,
          keptSystem: merged.filter((m) => m.role === 'system').length,
          appendedLen: suffix.length,
          messages: merged.map((m) => ({ role: m.role, len: String(m.content ?? '').length })),
        };

        return await chatCompletions({
          endpoint: baseURL || cfg.endpoint,
          apiKey: apiKey || cfg.apiKey,
          model: model || cfg.model,
          messages: merged,
          temperature,
        });
      } catch (cause) {
        return { ok: false, error: String(cause?.message ?? cause).slice(0, 160) };
      }
    },
  };

  /*
   * 只读站点不需要"新建存档"流程：旧版在数据加载后仍会弹引导
   * （它的判断是"首次访问 或 没记过 welcome 标志"）。
   * 这里持续压制这些引导层 —— 页面脚本随时可能把它们显示出来。
   */
  const hideOnboarding = () => {
    for (const id of ['welcome-modal', 'welcome-page', 'quick-setup-page']) {
      const el = document.getElementById(id);
      if (el !== null && !el.classList.contains('hidden')) el.classList.add('hidden');
    }
  };
  try { localStorage.setItem('novelWiki_welcomeShown', '1'); } catch {}


  // ===== 云云酱：静态站点直连模型（密钥来自 site.json 的密文） =====

  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

  /** 用口令解密存档里的 apiKey（AES-256-GCM + PBKDF2-SHA256，与本地版同一套） */
  const decryptKeyBlob = async (blob, passphrase) => {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
      'deriveKey',
    ]);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(blob.salt), iterations: blob.iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(blob.iv) },
      key,
      b64ToBytes(blob.data),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  };

  let siteJsonCache = null;
  const loadSiteJson = async () => {
    if (siteJsonCache !== null) return siteJsonCache;
    const res = await fetch('/data/site.json', { cache: 'no-store' });
    siteJsonCache = res.ok ? await res.json() : {};
    return siteJsonCache;
  };

  const PASS_KEY = 'glight.site.passphrase';

  /** 取得可用的模型配置：解密 apiKey（口令问一次，存在 sessionStorage） */
  const aiConfig = async (passphraseOverride) => {
    const data = await loadSiteJson();
    const ai = data.ai;
    if (!ai || !ai.keyBlob) throw new Error('这个站点没有配置云云酱');
    let pass = passphraseOverride ?? sessionStorage.getItem(PASS_KEY) ?? '';
    if (!pass) {
      pass = window.prompt('输入访问口令（用于解锁云云酱的模型配置）') ?? '';
      if (!pass) throw new Error('未输入口令');
      sessionStorage.setItem(PASS_KEY, pass);
    }
    const secret = await decryptKeyBlob(ai.keyBlob, pass);
    return {
      endpoint: String(ai.endpoint ?? '').replace(/\/+$/, ''),
      model: String(ai.model ?? ''),
      apiKey: String(secret.apiKey ?? ''),
      persona: String(ai.persona ?? ''),
      style: String(ai.style ?? ''),
      binding: String(ai.binding ?? ''),
      retrieval: String(ai.retrieval ?? ''),
      prompt: ai.prompt ?? { system: '', user: '' },
    };
  };


  /** 直连 OpenAI 兼容接口（浏览器里跑，不走主进程） */
  const chatCompletions = async ({ endpoint, apiKey, model, messages, temperature }) => {
    const res = await fetch(`${String(endpoint).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: temperature ?? 0.6 }),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 非 JSON 响应 */
    }
    if (!res.ok) {
      const detail = parsed?.error?.message ?? parsed?.message ?? text.slice(0, 160);
      return { ok: false, error: `HTTP ${res.status}：${detail}` };
    }
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      return { ok: false, error: '模型没有返回内容' };
    }
    return { ok: true, text: stripSameNameDigressions(content.trim()) };
  };

  window.__siteAi = { aiConfig, decryptKeyBlob, loadSiteJson, chatCompletions };

  window.desktopBridge = bridge;
  window.__GLIGHT_STATIC__ = true;
  window.__GLIGHT_STATIC_FILES__ = files;

  window.addEventListener('DOMContentLoaded', hideOnboarding);
  window.setInterval(hideOnboarding, 300);
})();

/**
 * 把站点数据里的设计设置应用到页面。
 *
 * 用户要求：字体等页面自定义设置要能影响 GitHub 版。
 * 旧版 UI 用 `--custom-font` 控制正文字体，其余排版靠旧样式；
 * 这里把 `settings.design` 翻译成 CSS 变量写到 :root，
 * 并把正文/标题/小字三种角色都映射到旧版能吃到的地方。
 */
(() => {
  const SYSTEM_STACKS = {
    serif: 'Georgia, "Songti SC", "SimSun", "Noto Serif CJK SC", serif',
    sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif',
    kai: '"Kaiti SC", "KaiTi", "Noto Serif CJK SC", serif',
    mono: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  };

  /** `system:xxx` / `sysfont:名称` / `font:文件.woff2` → font-family 字符串 */
  const fontStack = (font) => {
    if (typeof font !== 'string' || font === '') return '';
    if (font.startsWith('system:')) {
      const key = font.slice('system:'.length);
      return SYSTEM_STACKS[key] ?? SYSTEM_STACKS.serif;
    }
    if (font.startsWith('sysfont:')) {
      const family = font.slice('sysfont:'.length);
      return `"${family}", ${SYSTEM_STACKS.sans}`;
    }
    if (font.startsWith('font:')) {
      const file = font.slice('font:'.length);
      return `"Glight ${file}", ${SYSTEM_STACKS.serif}`;
    }
    return '';
  };

  const apply = (data) => {
    const design = data?.settings?.design;
    if (design === null || typeof design !== 'object') return;

    const root = document.documentElement;
    const typography = design.typography ?? {};

    for (const role of ['heading', 'body', 'small']) {
      const typo = typography[role];
      if (typo === undefined || typo === null) continue;
      const cjk = fontStack(typo.font);
      const latin = fontStack(typo.latin);
      const family = [latin, cjk].filter((part) => part !== '').join(', ');
      if (family !== '') root.style.setProperty(`--design-${role}-family`, family);
      if (typeof typo.scale === 'number') root.style.setProperty(`--design-${role}-scale`, String(typo.scale));
      if (typeof typo.lineHeight === 'number') {
        root.style.setProperty(`--design-${role}-line-height`, String(typo.lineHeight));
      }
      if (typeof typo.weight === 'number') root.style.setProperty(`--design-${role}-weight`, String(typo.weight));
    }

    if (typeof design.letterSpacing === 'number') {
      root.style.setProperty('--design-letter-spacing', `${design.letterSpacing}em`);
    }
    if (typeof design.indent === 'number') {
      root.style.setProperty('--design-indent', `${design.indent}em`);
    }

    /* 旧版真正吃的是这个变量：把它指到正文字体栈 */
    const bodyFamily = fontStack(typography.body?.font);
    if (bodyFamily !== '') root.style.setProperty('--custom-font', bodyFamily);

    /* 旧版没有对应 token 的地方，用注入样式补齐（只影响正文阅读区） */
    if (document.getElementById('glight-design-style') === null) {
      const style = document.createElement('style');
      style.id = 'glight-design-style';
      style.textContent = `
        .detail-body, .detail-content, .reading, .entry-content {
          font-family: var(--design-body-family, inherit);
          letter-spacing: var(--design-letter-spacing, normal);
        }
      `;
      document.head.appendChild(style);
    }
  };

  const boot = async () => {
    try {
      const res = await fetch('data/site.json', { cache: 'no-store' });
      if (!res.ok) return;
      apply(await res.json());
    } catch {
      /* 读不到就不改样式 */
    }
  };

  window.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();

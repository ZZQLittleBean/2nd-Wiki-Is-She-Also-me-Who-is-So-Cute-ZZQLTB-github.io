/**
 * 只读站点：隐藏所有编辑入口。
 *
 * 发布出去的站点是**给读者看的**，不该出现「编辑」「新建词条」这类按钮，
 * 也不该能进入编辑路由。旧版界面默认把"查看/编辑"两个开关都摆在顶栏，
 * 这里统一收掉，并把模式锁在查看。
 */
(() => {
  const HIDE_TEXTS = ['编辑', '新建', '导入', '导出', '保存', '删除', '管理'];
  const HIDE_SELECTORS = [
    '[data-edit-toggle]',
    '#btn-edit-entry',
    '#btn-add-entry',
    '.edit-entry-btn',
    '.entry-edit-btn',
  ];

  const hide = () => {
    for (const selector of HIDE_SELECTORS) {
      document.querySelectorAll(selector).forEach((el) => {
        el.style.display = 'none';
      });
    }
    /* 顶栏的"编辑"开关、侧栏的编辑入口：按文案精准隐藏，避免误伤 */
    document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      const text = (el.textContent ?? '').trim();
      if (text === '') return;
      if (!HIDE_TEXTS.includes(text)) return;
      /* 只隐藏"纯按钮"，不隐藏正文里出现的这些词 */
      if (el.querySelector('*') !== null && (el.textContent ?? '').trim() !== text) return;
      if (el.closest('.detail-body, .entry-content, .reading') !== null) return;
      el.style.display = 'none';
    });
  };

  /** 阻止进入编辑路由：把 window.app 的编辑入口替换成提示 */
  const lockRoute = () => {
    const app = window.app;
    if (app === undefined || app === null || app.__readOnlyLocked === true) return;
    app.__readOnlyLocked = true;
    for (const method of ['renderEdit', 'renderDetailEdit', 'showEditForm', 'editEntry']) {
      if (typeof app[method] === 'function') {
        app[method] = () => {
          /* 只读站点：静默忽略编辑请求 */
        };
      }
    }
  };

  const boot = () => {
    hide();
    lockRoute();
    window.setInterval(() => {
      hide();
      lockRoute();
    }, 500);
  };

  window.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();

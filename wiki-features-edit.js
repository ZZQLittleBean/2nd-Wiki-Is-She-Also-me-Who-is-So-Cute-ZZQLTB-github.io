/**
 * Part 6-1-Enhanced: 词条编辑核心模块 (Edit Core) - 完整分层实现版 v4.0
 * 修复与增强内容：
 * 1. 【修复】变量名拼写错误 timeSettingsDir → timeSettingsDiv
 * 2. 【修复】levelSelect.onchange 空引用保护
 * 3. 【新增】失踪区间置顶版本设置（Layer 5）
 * 4. 【新增】并行区间"默认置顶"快速设置功能
 * 5. 【新增】默认置顶版本全局设置（影响并行区间和失踪区间）
 * 6. 【优化】置顶时间设置UI增强（角色级别）
 */

// 依赖检查
if (typeof app === 'undefined') {
    console.error('wiki-features-edit.js: app 对象未定义，请先加载 wiki-core.js');
    throw new Error('Missing dependency: wiki-core.js must be loaded before wiki-features-edit.js');
}

// ========== 编辑状态追踪 ==========
if (!app.editState) {
    app.editState = {
        originalEntry: null,
        originalVersion: null,
        hasChanges: false,
        undoStack: [],
        redoStack: [],
        maxUndoSize: 20
    };
}

// ========== Layer 1: 词条编辑主渲染（防御包装：任何异常显示可读错误，避免白屏/工具栏孤悬） ==========
app.renderEdit = function(container) {
    try {
        this._renderEditInternal(container);
    } catch (e) {
        console.error('[Edit] 编辑界面渲染失败:', e);
        if (container) {
            const msg = String(e && e.message ? e.message : e).replace(/</g, '&lt;');
            container.innerHTML =
                '<div class="p-6 text-center">' +
                    '<div class="text-red-500 font-bold mb-2">编辑界面渲染失败</div>' +
                    '<div class="text-xs text-gray-500 mb-4" style="word-break:break-all">' + msg + '</div>' +
                    '<div class="flex justify-center gap-2">' +
                        '<button onclick="app.closeActiveTab && app.closeActiveTab()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">关闭标签</button>' +
                        '<button onclick="app.router(\'home\')" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">返回首页</button>' +
                    '</div>' +
                '</div>';
        }
    }
};

// 编辑界面内部渲染（原 renderEdit 函数体）
app._renderEditInternal = function(container) {
    // 【关键】清空容器，防止标签页反复切换时模板累积堆叠
    if (container) container.innerHTML = '';
    const isNew = !this.data.editingId;
    let entry, version;

    if (isNew) {
        // 【关键修复】如果已有 tempEntry（如导入后），保留内容，不重新创建
        if (this.tempEntry && this.tempEntry.versions && this.tempEntry.versions.length > 0) {
            entry = JSON.parse(JSON.stringify(this.tempEntry));
            version = entry.versions[0];
            // 确保编辑版本ID同步
            this.editingVersionId = version.vid;
            this.tempVersion = JSON.parse(JSON.stringify(version));
            this.editState.hasChanges = true;
        } else {
            const type = this.data.editingType || 'character';
            const code = this.generateCode(type);

            entry = {
                id: (type === 'character' ? 'char-' : type === 'event' ? 'evt-' : 'non-') + Date.now(),
                type: type,
                code: code,
                camp: type === 'character' ? '' : '',
                settingType: type === 'non-character' ? 'world' : null,
                // Layer 4: 置顶设置（角色级别）
                pinned: false,
                pinStartChapter: null,
                pinEndChapter: null,
                // Layer 5: 并行与失踪区间置顶设置
                pinnedVersions: {}, // 章节ID -> 版本ID 映射
                missingIntervalVersion: null, // 失踪区间置顶版本
                defaultPinnedVersion: null, // 默认置顶版本（用于快速设置）
                // 【新增】活动页词条字段
                headerImage: type === 'event' ? null : undefined,
                duration: type === 'event' ? { type: 'permanent' } : undefined,
                createdAt: Date.now(),
                versions: []
            };

            version = {
                vid: 'v-' + Date.now(),
                title: '',
                subtitle: type === 'event' ? null : '', // 活动词条无题记
                level: type === 'event' ? null : 5, // 活动词条无重要程度
                image: null,
                images: type === 'event' ? null : { avatar: null, card: null, cover: null },
                chapterFrom: null,
                chapterTo: null,
                blocks: [],
                relatedVersions: type === 'event' ? null : [],
                relatedCharacters: type === 'event' ? null : [],
                createdAt: Date.now()
            };

            entry.versions.push(version);
            this.editingVersionId = version.vid;
            this.tempVersion = JSON.parse(JSON.stringify(version));
            // 初始化编辑状态（新词条默认有修改）
            this.editState.originalEntry = null;
            this.editState.originalVersion = null;
            this.editState.hasChanges = true;
        }
        this.tempEntry = entry;
    } else {
        // 【关键】优先使用 tempEntry（如果存在且ID匹配），保留版本切换时积累的修改
        if (this.tempEntry && this.tempEntry.id === this.data.editingId) {
            entry = JSON.parse(JSON.stringify(this.tempEntry));
        } else {
            entry = JSON.parse(JSON.stringify(this.data.entries.find(e => e.id === this.data.editingId)));
        }
        this.tempEntry = entry;

        // 数据迁移：确保旧数据有完整结构
        if (entry.level !== undefined && entry.versions && entry.versions.length > 0) {
            entry.versions[0].level = entry.level;
            delete entry.level;
        }

        // 初始化Layer 5字段
        if (entry.pinned === undefined) entry.pinned = false;
        if (entry.pinStartChapter === undefined) entry.pinStartChapter = null;
        if (entry.pinEndChapter === undefined) entry.pinEndChapter = null;
        if (entry.pinnedVersions === undefined) entry.pinnedVersions = {};
        if (entry.missingIntervalVersion === undefined) entry.missingIntervalVersion = null;
        if (entry.defaultPinnedVersion === undefined) entry.defaultPinnedVersion = null;

        let targetVid = this.data.viewingVersionId || entry.versions[entry.versions.length - 1].vid;
        version = entry.versions.find(v => v.vid === targetVid);

        if (!version) {
            version = entry.versions[entry.versions.length - 1];
            targetVid = version.vid;
        }

        if (version.level === undefined) version.level = 5;
        if (!version.images) {
            version.images = { avatar: version.image, card: version.image, cover: version.image };
        }

        this.tempVersion = JSON.parse(JSON.stringify(version));
        this.editingVersionId = targetVid;
        
        // 初始化编辑状态
        this.editState.originalEntry = JSON.parse(JSON.stringify(entry));
        this.editState.originalVersion = JSON.parse(JSON.stringify(version));
        this.editState.hasChanges = false;
    }
    
    // 清空撤销/重做栈
    this.editState.undoStack = [];
    this.editState.redoStack = [];

    const tpl = document.getElementById('tpl-detail-edit');
    if (!tpl) {
        console.error('编辑模板未找到');
        return;
    }
    
    const clone = tpl.content.cloneNode(true);

    clone.getElementById('edit-breadcrumb-title').textContent = isNew ? '新建词条' : this.tempVersion.title;
    clone.getElementById('edit-title').value = this.tempVersion.title;
    clone.getElementById('edit-code').value = this.tempEntry.code;
    clone.getElementById('edit-subtitle').value = this.tempVersion.subtitle || '';

    // 【外源直链模式】正文词条显示外源直链输入并填充
    const srcRow = clone.getElementById('edit-source-link-row');
    if (srcRow) {
        if (this.tempEntry.type === 'body') {
            srcRow.classList.remove('hidden');
            const sl = clone.getElementById('edit-source-link');
            const slName = clone.getElementById('edit-source-link-name');
            if (sl) sl.value = this.tempEntry.sourceLink || '';
            if (slName) slName.value = this.tempEntry.sourceLinkName || '';
        } else {
            srcRow.classList.add('hidden');
        }
    }

    const versionTag = clone.getElementById('edit-version-tag');
    versionTag.classList.remove('hidden');
    versionTag.textContent = `版本 ${entry.versions.findIndex(v => v.vid === this.editingVersionId) + 1}/${entry.versions.length}`;
    clone.getElementById('edit-version-id').textContent = this.editingVersionId;

    // Layer 1: 重要程度设置（版本级别）
    const levelSelect = clone.getElementById('edit-level');
    levelSelect.value = this.tempVersion.level || 5;
    
    levelSelect.onchange = (e) => {
        const val = parseInt(e.target.value);
        const preview = app.$e('level-preview');
        const labels = {1: '主角', 2: '重要', 3: '普通', 4: '次要', 5: '路人'};
        if (preview) {
            preview.textContent = labels[val] || '路人';
            preview.className = `text-xs px-2 py-1 rounded ${val <= 2 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`;
        }
        this.tempVersion.level = val;
    };
    
    setTimeout(() => {
        if (levelSelect) levelSelect.onchange({target: levelSelect});
    }, 0);

    // 阵营/设定类型
    if (this.tempEntry.type === 'character') {
        clone.getElementById('edit-camp-container').classList.remove('hidden');
        const campSelect = clone.getElementById('edit-camp');
        this.data.camps.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            if(this.tempEntry.camp === c) opt.selected = true;
            campSelect.appendChild(opt);
        });
    } else {
        clone.getElementById('edit-setting-type-container').classList.remove('hidden');
        const typeSelect = clone.getElementById('edit-setting-type');
        // 【功能1】动态填充已有自定义目录
        const customOptgroup = clone.getElementById('edit-setting-existing-customs');
        if (customOptgroup) {
            const existingCustoms = [...new Set(this.data.entries
                .filter(e => e.type === 'non-character' && e.settingType === 'custom' && e.customSettingType)
                .map(e => e.customSettingType))];
            if (existingCustoms.length > 0) {
                existingCustoms.forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = 'custom:' + name;
                    opt.textContent = name;
                    customOptgroup.appendChild(opt);
                });
            } else {
                customOptgroup.style.display = 'none';
            }
        }
        // 设置当前值
        if (this.tempEntry.settingType) {
            if (this.tempEntry.settingType === 'custom' && this.tempEntry.customSettingType) {
                // 尝试匹配已有自定义目录
                const customValue = 'custom:' + this.tempEntry.customSettingType;
                const exists = Array.from(typeSelect.options).some(o => o.value === customValue);
                typeSelect.value = exists ? customValue : 'custom';
                if (!exists) {
                    clone.getElementById('edit-setting-type-custom').classList.remove('hidden');
                    clone.getElementById('edit-setting-type-custom').value = this.tempEntry.customSettingType;
                }
            } else if (this.tempEntry.settingType === 'hidden') {
                typeSelect.value = 'hidden';
            } else {
                typeSelect.value = this.tempEntry.settingType;
            }
        }
        
        // 【功能4】加载隐藏目录密码设置（每个词条独立）
        const hiddenCfg = this.data.settings?.hiddenCategory;
        const isHidden = hiddenCfg?.entries?.includes(this.tempEntry.id) || false;
        const pwSection = clone.getElementById('edit-hidden-pw-section');
        const pwHint = clone.getElementById('edit-hidden-pw-hint');
        const pwAnswers = clone.getElementById('edit-hidden-pw-answers');
        const pwAlways = clone.getElementById('edit-hidden-pw-always');
        // 获取当前词条的独立密码配置
        const ep = hiddenCfg?.entryPasswords?.[this.tempEntry.id] || {};
        if (isHidden && pwSection) pwSection.classList.remove('hidden');
        if (pwHint) pwHint.value = ep.hint || '';
        if (pwAnswers) pwAnswers.value = (ep.answers || []).join('\n');
        if (pwAlways) pwAlways.checked = ep.alwaysRequired !== false;
        // 延迟加载错误提醒规则（DOM插入后）
        if (pwSection) {
            const _loadPwRules = () => {
                const container = app.$e('edit-hidden-pw-rules');
                if (!container) return;
                container.innerHTML = '';
                // 通用规则（不可删除）：当不满足所有自定义条件时的回退提醒
                app.addHiddenPwRule('default', '', ep.defaultMessage || '');
                // 自定义条件规则
                (ep.rules || []).forEach(r => app.addHiddenPwRule(r.condition, r.answer, r.message));
                // 【新增】在密码保护标题区域添加"复制其他词条规则"按钮
                const copyBtnContainer = app.$e('edit-hidden-pw-copybtn');
                const otherEntries = (hiddenCfg?.entries || []).filter(id => id !== this.tempEntry.id && hiddenCfg?.entryPasswords?.[id]);
                if (copyBtnContainer && otherEntries.length > 0) {
                    copyBtnContainer.innerHTML = '';
                    const copyBtn = document.createElement('button');
                    copyBtn.className = 'px-2 py-0.5 bg-indigo-700 text-indigo-200 rounded text-[10px] hover:bg-indigo-600 transition';
                    copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> 复制规则';
                    copyBtn.onclick = () => app.showCopyPasswordDialog(otherEntries);
                    copyBtnContainer.appendChild(copyBtn);
                } else if (copyBtnContainer) {
                    copyBtnContainer.innerHTML = '';
                }
            };
            requestAnimationFrame(() => requestAnimationFrame(_loadPwRules));
        }
    }

    // 【新增】活动页词条编辑UI
    if (this.tempEntry.type === 'event') {
        // 显示活动专用区域
        const eventSection = clone.getElementById('edit-event-section');
        if (eventSection) eventSection.classList.remove('hidden');

        // 隐藏不适用的字段
        const subtitleEl = clone.getElementById('edit-subtitle');
        if (subtitleEl) subtitleEl.closest('div').classList.add('hidden');
        const levelEl = clone.getElementById('edit-level');
        if (levelEl) levelEl.closest('.grid').classList.add('hidden');
        
        // 隐藏设定目录
        const settingTypeContainer = clone.getElementById('edit-setting-type-container');
        if (settingTypeContainer) settingTypeContainer.classList.add('hidden');
        
        // 隐藏版本时间设置（chapter from/to）
        const timeSettingWrap = clone.getElementById('edit-chapter-from');
        if (timeSettingWrap) timeSettingWrap.closest('.bg-indigo-50').classList.add('hidden');
        
        // 隐藏相关角色
        const relatedCharSection = clone.getElementById('related-characters-edit');
        if (relatedCharSection) relatedCharSection.classList.add('hidden');
        
        // 隐藏相关版本索引
        const relatedVerSection = clone.getElementById('related-versions-list');
        if (relatedVerSection) relatedVerSection.closest('.bg-gray-50').classList.add('hidden');
        
        // 隐藏图片区域（avatar/card/cover）
        const editImageSection = clone.getElementById('edit-image-section');
        if (editImageSection) editImageSection.classList.add('hidden');

        // 【关键修复】加载头图预览：支持 dataUrl 和 {{IMG:}} 引用的异步加载
        if (this.tempEntry.headerImage) {
            const preview = clone.getElementById('edit-event-header-preview');
            const placeholder = clone.getElementById('edit-event-header-placeholder');
            const removeBtn = clone.getElementById('edit-event-header-remove');
            const imgRef = this.tempEntry.headerImage;

            // 统一加载函数
            const showPreview = (url) => {
                if (preview && url) {
                    preview.src = url;
                    preview.dataset.originalSrc = imgRef;
                    preview.classList.remove('hidden');
                    if (placeholder) placeholder.classList.add('hidden');
                    if (removeBtn) removeBtn.classList.remove('hidden');
                }
            };

            if (imgRef.startsWith('data:') || imgRef.startsWith('http')) {
                showPreview(imgRef);
            } else if (imgRef.startsWith('{{IMG:') && this.storageManager) {
                const match = imgRef.match(/\{\{IMG:(.+?)\}\}/);
                if (match) {
                    const filename = match[1];
                    // 1. 先尝试 memoryCache
                    if (this.storageManager.memoryCache.has(filename)) {
                        showPreview(this.storageManager.memoryCache.get(filename));
                    } else {
                        // 2. memoryCache缺失（被LRU卸载），异步从OPFS/本地文件夹加载
                        // 先显示占位符的加载状态
                        if (placeholder) {
                            placeholder.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xl text-rose-400 mb-1"></i><p class="text-xs text-rose-500">加载中...</p>';
                        }
                        this.storageManager.loadImage(filename).then(url => {
                            showPreview(url);
                        }).catch(e => {
                            console.warn('[Edit] 头图加载失败:', filename, e.message);
                            if (placeholder) {
                                placeholder.innerHTML = '<i class="fa-solid fa-image text-xl text-rose-400 mb-1"></i><p class="text-xs text-rose-500">点击上传头图</p>';
                            }
                        });
                    }
                }
            }
        }

        // 加载持续时间设置
        const dur = this.tempEntry.duration || { type: 'permanent' };
        const permRadio = clone.getElementById('event-duration-permanent');
        const periodRadio = clone.getElementById('event-duration-period');
        const dateContainer = clone.getElementById('event-duration-dates');
        const startDate = clone.getElementById('event-start-date');
        const endDate = clone.getElementById('event-end-date');

        if (dur.type === 'permanent') {
            if (permRadio) permRadio.checked = true;
            if (dateContainer) dateContainer.classList.add('hidden');
        } else {
            if (periodRadio) periodRadio.checked = true;
            if (dateContainer) dateContainer.classList.remove('hidden');
            if (startDate && dur.startDate) {
                const d = new Date(dur.startDate);
                startDate.value = d.toISOString().slice(0, 16);
            }
            if (endDate && dur.endDate) {
                const d = new Date(dur.endDate);
                endDate.value = d.toISOString().slice(0, 16);
            }
        }
    }

    // 【所有词条类型均显示图片元件和表格按钮】
    const imgBlockBtn = clone.getElementById('btn-add-img-block');
    if (imgBlockBtn) imgBlockBtn.classList.remove('hidden');
    const tableBlockBtn = clone.getElementById('btn-add-table-block');
    if (tableBlockBtn) tableBlockBtn.classList.remove('hidden');

    // 时间轴设置
    const fromSelect = clone.getElementById('edit-chapter-from');
    const toSelect = clone.getElementById('edit-chapter-to');
    const hasEndCheck = clone.getElementById('edit-has-end');

    const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);

    fromSelect.innerHTML = '<option value="">从序章开始显示</option>';
    sortedChapters.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.textContent = `${this.formatChapterNum(ch.num)} ${ch.title || ''}`;
        if(this.tempVersion.chapterFrom === ch.id) opt.selected = true;
        fromSelect.appendChild(opt);
    });

    toSelect.innerHTML = '<option value="">选择结束章节</option>';
    sortedChapters.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.textContent = `${this.formatChapterNum(ch.num)} ${ch.title || ''}`;
        if(this.tempVersion.chapterTo === ch.id) opt.selected = true;
        toSelect.appendChild(opt);
    });

    if(this.tempVersion.chapterTo) {
        hasEndCheck.checked = true;
        toSelect.classList.remove('hidden');
    }

    hasEndCheck.onchange = (e) => {
        toSelect.classList.toggle('hidden', !e.target.checked);
        if(!e.target.checked) toSelect.value = '';
    };

    // ========== Layer 4: 置顶时间设置（角色级别） ==========
    if (this.tempEntry.type === 'character') {
        const pinContainer = document.createElement('div');
        pinContainer.className = 'bg-red-50 p-3 rounded-lg border border-red-100 mt-4';
        pinContainer.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <label class="text-xs font-bold text-red-700 uppercase flex items-center gap-1">
                    <i class="fa-solid fa-thumbtack"></i> 置顶设置
                </label>
                <div class="flex items-center">
                    <input type="checkbox" id="edit-pinned" ${this.tempEntry.pinned ? 'checked' : ''} 
                        class="rounded text-red-600 focus:ring-red-500"
                        onchange="app.togglePinSettings(this.checked)">
                    <label for="edit-pinned" class="text-xs text-red-700 ml-1">启用置顶</label>
                </div>
            </div>
            
            <div id="pin-time-settings" class="${this.tempEntry.pinned ? '' : 'hidden'} space-y-2 mt-2 pt-2 border-t border-red-200">
                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block text-[10px] text-red-600 mb-1">置顶起始章节</label>
                        <select id="edit-pin-start" class="w-full p-2 border border-red-200 rounded-lg bg-white text-sm">
                            <option value="">从第一章开始</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] text-red-600 mb-1">置顶终止章节</label>
                        <select id="edit-pin-end" class="w-full p-2 border border-red-200 rounded-lg bg-white text-sm">
                            <option value="">永久置顶</option>
                        </select>
                    </div>
                </div>
                <p class="text-[10px] text-red-600 mt-1">
                    <i class="fa-solid fa-info-circle mr-1"></i>
                    置顶角色将在列表中优先显示（仅在指定时间段内生效）
                </p>
            </div>
        `;
        
        // 填充章节选项
        const pinStartSelect = pinContainer.querySelector('#edit-pin-start');
        const pinEndSelect = pinContainer.querySelector('#edit-pin-end');
        
        sortedChapters.forEach(ch => {
            const startOpt = document.createElement('option');
            startOpt.value = ch.id;
            startOpt.textContent = `${this.formatChapterNum(ch.num)} ${ch.title || ''}`;
            if (this.tempEntry.pinStartChapter === ch.id) startOpt.selected = true;
            pinStartSelect.appendChild(startOpt);
            
            const endOpt = document.createElement('option');
            endOpt.value = ch.id;
            endOpt.textContent = `${this.formatChapterNum(ch.num)} ${ch.title || ''}`;
            if (this.tempEntry.pinEndChapter === ch.id) endOpt.selected = true;
            pinEndSelect.appendChild(endOpt);
        });
        
        // 插入到时间轴设置之后
        const timeSettingsDiv = clone.querySelector('.bg-indigo-50');
        if (timeSettingsDiv && timeSettingsDiv.parentNode) {
            timeSettingsDiv.parentNode.insertBefore(pinContainer, timeSettingsDiv.nextSibling);
        }
    }

    // ========== Layer 5: 并行版本与失踪区间设置 ==========
    if (this.tempEntry.versions && this.tempEntry.versions.length >= 2 && this.tempEntry.type === 'character') {
        const parallelIntervals = this.getParallelIntervals(this.tempEntry);
        const missingIntervals = this.getMissingIntervals(this.tempEntry);
        
        if (parallelIntervals.length > 0 || missingIntervals.length > 0) {
            const specialContainer = document.createElement('div');
            specialContainer.className = 'bg-purple-50 p-3 rounded-lg border border-purple-100 mt-4';
            
            let html = `
                <div class="flex justify-between items-center mb-2">
                    <label class="text-xs font-bold text-purple-700 uppercase flex items-center gap-1">
                        <i class="fa-solid fa-code-branch"></i> 版本区间设置
                    </label>
                </div>
            `;
            
            // 默认置顶版本快速设置（影响所有区间）
            html += `
                <div class="mb-3 p-2 bg-white rounded border border-purple-200">
                    <label class="block text-[10px] text-purple-600 mb-1 font-bold">默认置顶版本（全局）</label>
                    <select id="edit-default-pinned-version" class="w-full p-1.5 border border-purple-200 rounded text-xs mb-1"
                        onchange="app.updateDefaultPinnedVersion(this.value)">
                        <option value="">系统默认（按时间最新）</option>
                        ${this.tempEntry.versions.map(v => `
                            <option value="${v.vid}" ${this.tempEntry.defaultPinnedVersion === v.vid ? 'selected' : ''}>
                                ${v.title} ${v.level <= 2 ? '★' : ''} (${this.getChapterRangeText(v)})
                            </option>
                        `).join('')}
                    </select>
                    <p class="text-[10px] text-gray-500">
                        <i class="fa-solid fa-info-circle mr-1"></i>
                        默认置顶将自动应用到所有并行区间和失踪区间（除非单独设置）
                    </p>
                </div>
            `;
            
            // 并行区间设置
            if (parallelIntervals.length > 0) {
                html += `<div class="mb-3">
                    <div class="text-[10px] text-purple-600 font-bold mb-1">并行区间（多版本同时活跃）</div>`;
                
                parallelIntervals.forEach((interval, idx) => {
                    const currentPinned = this.tempEntry.pinnedVersions[interval.startChapter.id] || 
                                         this.tempEntry.defaultPinnedVersion || '';
                    
                    html += `
                        <div class="bg-white rounded p-2 mb-2 border border-purple-200">
                            <div class="text-xs text-gray-600 mb-1 flex justify-between">
                                <span>
                                    ${this.formatChapterNum(interval.startChapter.num)} 至 
                                    ${this.formatChapterNum(interval.endChapter.num)}
                                </span>
                                <span class="text-[10px] text-purple-500">(${interval.versions.length}个版本)</span>
                            </div>
                            <div class="text-[10px] text-gray-500 mb-2">选择置顶版本：</div>
                            <select class="w-full p-1.5 border border-purple-200 rounded text-xs parallel-version-select mb-2" 
                                data-interval-idx="${idx}"
                                data-start-chapter="${interval.startChapter.id}"
                                onchange="app.updateParallelPinVersion('${this.tempEntry.id}', '${interval.startChapter.id}', this.value)">
                                <option value="">使用默认设置</option>
                                ${interval.versions.map(v => `
                                    <option value="${v.vid}" ${currentPinned === v.vid ? 'selected' : ''}>
                                        ${v.title} ${v.level <= 2 ? '★' : ''}
                                    </option>
                                `).join('')}
                            </select>
                            <div class="flex gap-1">
                                <button onclick="app.applyDefaultToInterval('${interval.startChapter.id}')" 
                                    class="text-[10px] px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition flex-1">
                                    应用默认置顶
                                </button>
                                <button onclick="app.clearIntervalPin('${interval.startChapter.id}')" 
                                    class="text-[10px] px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition">
                                    清除
                                </button>
                            </div>
                        </div>
                    `;
                });
                
                html += `</div>`;
            }
            
            // 失踪区间设置
            if (missingIntervals.length > 0) {
                html += `<div>
                    <div class="text-[10px] text-gray-600 font-bold mb-1">失踪区间（无活跃版本）</div>`;
                
                missingIntervals.forEach((interval, idx) => {
                    const versionsBefore = interval.previousVersion ? [interval.previousVersion] : [];
                    // 也可能有多个版本结束于失踪前，这里简化处理，显示失踪前的所有版本
                    const allVersionsBefore = this.tempEntry.versions.filter(v => {
                        const vToOrder = this.getChapterOrder(v.chapterTo);
                        const gapStartOrder = this.getChapterOrder(interval.startChapter.id);
                        return vToOrder < gapStartOrder;
                    }).sort((a, b) => this.getChapterOrder(b.chapterTo) - this.getChapterOrder(a.chapterTo));
                    
                    const selectedVersion = this.tempEntry.missingIntervalVersion || 
                                           this.tempEntry.defaultPinnedVersion || '';
                    
                    html += `
                        <div class="bg-white rounded p-2 mb-2 border border-gray-200 opacity-75">
                            <div class="text-xs text-gray-600 mb-1">
                                ${interval.startChapter ? this.formatChapterNum(interval.startChapter.num) : ''} 
                                ${interval.endChapter ? '至 ' + this.formatChapterNum(interval.endChapter.num) : '至今'}
                                <span class="text-[10px] text-gray-400 ml-1">(失踪区间)</span>
                            </div>
                            <div class="text-[10px] text-gray-500 mb-2">失踪前置顶版本：</div>
                            <select class="w-full p-1.5 border border-gray-200 rounded text-xs missing-version-select" 
                                onchange="app.updateMissingIntervalVersion(this.value)">
                                <option value="">使用默认设置</option>
                                ${allVersionsBefore.map(v => `
                                    <option value="${v.vid}" ${selectedVersion === v.vid ? 'selected' : ''}>
                                        ${v.title} ${v.level <= 2 ? '★' : ''} (至${this.formatChapterNum(v.chapterTo)})
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                    `;
                });
                
                html += `</div>`;
            }
            
            // 详细设置按钮
            html += `
                <div class="mt-2 pt-2 border-t border-purple-200">
                    <button onclick="app.showParallelSettingsDetail('${this.tempEntry.id}')" 
                        class="w-full py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded text-xs transition">
                        <i class="fa-solid fa-gear mr-1"></i>详细设置（按章节指定置顶版本）
                    </button>
                </div>
            `;
            
            specialContainer.innerHTML = html;
            
            // 插入到置顶设置之后
            const pinSettings = clone.querySelector('.bg-red-50');
            if (pinSettings && pinSettings.parentNode) {
                pinSettings.parentNode.insertBefore(specialContainer, pinSettings.nextSibling);
            }
        }
    }

    // 渲染关联数据
    this.renderRelatedCharactersEdit(clone.getElementById('related-characters-edit-list'));
    this.renderRelatedVersionsList(clone.getElementById('related-versions-list'));

    // 渲染内容块
    const blocksContainer = clone.getElementById('edit-blocks-container');
    if(this.tempVersion.blocks) {
        this.tempVersion.blocks.forEach((block, idx) => {
            const div = this.createEditBlock(blocksContainer, block, idx);
            blocksContainer.appendChild(div);
        });
    }

    container.appendChild(clone);
    
    // 【关键修复】DOM插入后异步加载图片元件中的{{IMG:}}引用
    if (this.tempVersion.blocks && this.storageManager) {
        requestAnimationFrame(() => {
            const bc = app.$e('edit-blocks-container');
            if (bc) {
                bc.querySelectorAll('img[data-img-ref^="{{IMG:"]').forEach(async (img) => {
                    const ref = img.dataset.imgRef;
                    const match = ref.match(/\{\{IMG:(.+?)\}\}/);
                    if (match) {
                        try {
                            const url = await this.storageManager.loadImage(match[1]);
                            if (url) {
                                img.src = url;
                                img.classList.remove('hidden');
                                const phId = img.id.replace('preview', 'placeholder');
                                const ph = document.getElementById(phId);
                                if (ph) ph.classList.add('hidden');
                            }
                        } catch (e) { console.warn('[Edit] 图片元件加载失败:', match[1]); }
                    }
                });
            }
        });
    }
    
    // 绑定键盘快捷键
    this.bindEditKeyboardShortcuts();
    
    // 【新增】在头部按钮区插入删除按钮（仅编辑已有词条时显示）
    if (!isNew) {
        // 精确定位：选择头部右侧的按钮容器（flex gap-2）
        const btnContainer = clone.querySelector('.bg-white.border-b .flex.gap-2');
        if (btnContainer) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition text-sm flex items-center gap-1.5 border border-red-200';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 删除';
            deleteBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                app.deleteEntry(app.tempEntry.id);
            };
            
            // 插入到"保存"按钮之前（或之后，根据偏好）
            // 由于保存按钮没有特定 class，我们通过其背景色特征选择
            const saveBtn = btnContainer.querySelector('button.bg-indigo-600');
            if (saveBtn) {
                btnContainer.insertBefore(deleteBtn, saveBtn);
            } else {
                // 备选：直接追加到容器末尾
                btnContainer.appendChild(deleteBtn);
            }
        }
    }
    // 【修复】在编辑页面头部插入删除按钮
    if (!isNew && this.tempEntry) {
        setTimeout(() => {
            // 等待 DOM 渲染完成后插入
            const header = document.querySelector('#main-container > div > .bg-white.border-b');
            if (header) {
                // 检查是否已存在删除按钮（防止重复）
                if (!header.querySelector('.btn-delete-entry')) {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn-delete-entry px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition text-sm flex items-center gap-1.5 border border-red-200 ml-auto mr-2';
                    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 删除词条';
                    deleteBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirm(`确定删除词条 "${this.tempVersion.title || this.tempEntry.code}"？\n\n⚠️ 警告：\n• ${this.tempEntry.versions.length} 个历史版本将全部删除\n• 编号 ${this.tempEntry.code} 将被回收\n• 此操作不可撤销`)) {
                            this.deleteEntry(this.tempEntry.id);
                        }
                    };
                    
                    // 插入到头部左侧（面包屑旁边）或右侧（按钮区）
                    const btnContainer = header.querySelector('.flex.gap-2');
                    if (btnContainer) {
                        btnContainer.insertBefore(deleteBtn, btnContainer.firstChild);
                    } else {
                        header.appendChild(deleteBtn);
                    }
                }
            }
        }, 100);
    }
    // 【补充】词条编辑页面头部添加删除按钮
    if (!isNew) {
        setTimeout(() => {
            const header = document.querySelector('#main-container .bg-white.border-b');
            if (header && !header.querySelector('.btn-delete-entry')) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete-entry px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition text-sm flex items-center gap-1.5 border border-red-200';
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 删除词条';
                deleteBtn.onclick = () => {
                    if(confirm(`确定删除词条【${this.tempVersion.title}】(${this.tempEntry.code})？\n\n⚠️ 警告：\n• ${this.tempEntry.versions.length} 个历史版本将全部删除\n• 编号 ${this.tempEntry.code} 将被回收\n• 此操作不可撤销`)) {
                        this.deleteEntry(this.tempEntry.id);
                    }
                };
                
                // 插入到"取消"和"保存"按钮区域
                const btnContainer = header.querySelector('.flex.gap-2') || header.querySelector('.flex.items-center.gap-2');
                if (btnContainer) {
                    btnContainer.insertBefore(deleteBtn, btnContainer.firstChild);
                }
            }
        }, 50);
    }
    requestAnimationFrame(() => {
        this.updateEditVersionSelector();
        if (this.safeInitImagePreview) {
            this.safeInitImagePreview();
        }
    });
};

// 【修复】切换置顶设置显示
app.togglePinSettings = function(checked) {
    const container = document.getElementById('pin-time-settings');
    if (container) {
        container.classList.toggle('hidden', !checked);
    }
};

// ========== Layer 5: 并行版本与失踪区间管理器 ==========

// 获取章节范围文本
app.getChapterRangeText = function(version) {
    const fromCh = this.data.chapters.find(c => c.id === version.chapterFrom);
    const toCh = this.data.chapters.find(c => c.id === version.chapterTo);
    const fromText = fromCh ? this.formatChapterNum(fromCh.num) : '开始';
    const toText = toCh ? this.formatChapterNum(toCh.num) : '至今';
    return `${fromText}~${toText}`;
};

// 【关键】获取并行区间（多个版本同时活跃的时间段）
app.getParallelIntervals = function(entry) {
    if (!entry || !entry.versions || entry.versions.length < 2) return [];
    
    const intervals = [];
    const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
    let currentInterval = null;
    
    for (const chapter of sortedChapters) {
        const activeVersions = entry.versions.filter(v => {
            const fromOrder = this.getChapterOrder(v.chapterFrom);
            const toOrder = this.getChapterOrder(v.chapterTo);
            return chapter.order >= fromOrder && chapter.order <= toOrder;
        });
        
        if (activeVersions.length >= 2) {
            if (!currentInterval) {
                currentInterval = {
                    startChapter: chapter,
                    endChapter: chapter,
                    chapters: [chapter],
                    versions: activeVersions
                };
            } else {
                currentInterval.endChapter = chapter;
                currentInterval.chapters.push(chapter);
                // 合并版本列表（去重）
                activeVersions.forEach(v => {
                    if (!currentInterval.versions.find(cv => cv.vid === v.vid)) {
                        currentInterval.versions.push(v);
                    }
                });
            }
        } else {
            if (currentInterval) {
                intervals.push(currentInterval);
                currentInterval = null;
            }
        }
    }
    
    if (currentInterval) intervals.push(currentInterval);
    return intervals;
};

// 【关键】获取失踪区间（版本之间的间隙）
app.getMissingIntervals = function(entry) {
    if (!entry || !entry.versions || entry.versions.length === 0) return [];
    
    const intervals = [];
    const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
    
    // 按起始时间排序版本
    const sortedVersions = [...entry.versions].map(v => ({
        ...v,
        fromOrder: this.getChapterOrder(v.chapterFrom),
        toOrder: this.getChapterOrder(v.chapterTo)
    })).sort((a, b) => a.fromOrder - b.fromOrder);
    
    // 检查版本之间的间隙
    for (let i = 0; i < sortedVersions.length - 1; i++) {
        const current = sortedVersions[i];
        const next = sortedVersions[i + 1];
        
        if (current.toOrder < next.fromOrder) {
            const gapChapters = sortedChapters.filter(ch => 
                ch.order > current.toOrder && ch.order < next.fromOrder
            );
            
            if (gapChapters.length > 0) {
                intervals.push({
                    type: 'gap',
                    startChapter: gapChapters[0],
                    endChapter: gapChapters[gapChapters.length - 1],
                    chapters: gapChapters,
                    previousVersion: current,
                    nextVersion: next
                });
            }
        }
    }
    
    // 检查最后一个版本之后（如果结束时间不是Infinity）
    const lastVersion = sortedVersions[sortedVersions.length - 1];
    if (lastVersion.toOrder < Infinity) {
        const laterChapters = sortedChapters.filter(ch => ch.order > lastVersion.toOrder);
        if (laterChapters.length > 0) {
            intervals.push({
                type: 'missing',
                startChapter: laterChapters[0],
                endChapter: laterChapters[laterChapters.length - 1],
                chapters: laterChapters,
                previousVersion: lastVersion,
                nextVersion: null
            });
        }
    }
    
    return intervals;
};

// 更新默认置顶版本
app.updateDefaultPinnedVersion = function(versionId) {
    this.tempEntry.defaultPinnedVersion = versionId || null;
    this.showSaveToast('已更新默认置顶版本（尚未保存）');
};

// 更新并行区间的置顶版本
app.updateParallelPinVersion = function(entryId, intervalStartChapterId, versionId) {
    const entry = this.tempEntry || this.data.entries.find(e => e.id === entryId);
    if (!entry) return;
    
    if (!entry.pinnedVersions) entry.pinnedVersions = {};
    
    if (versionId) {
        entry.pinnedVersions[intervalStartChapterId] = versionId;
    } else {
        delete entry.pinnedVersions[intervalStartChapterId];
    }
    
    this.showSaveToast('已更新置顶版本设置（尚未保存）');
};

// 应用默认置顶到特定区间
app.applyDefaultToInterval = function(intervalStartChapterId) {
    if (!this.tempEntry.defaultPinnedVersion) {
        alert('请先设置"默认置顶版本"');
        return;
    }
    this.updateParallelPinVersion(this.tempEntry.id, intervalStartChapterId, this.tempEntry.defaultPinnedVersion);
    // 刷新UI
    this.renderEdit(this.getEntryContainer ? this.getEntryContainer() : document.getElementById('main-container'));
};

// 清除区间置顶设置
app.clearIntervalPin = function(intervalStartChapterId) {
    this.updateParallelPinVersion(this.tempEntry.id, intervalStartChapterId, '');
    this.renderEdit(this.getEntryContainer ? this.getEntryContainer() : document.getElementById('main-container'));
};

// 更新失踪区间置顶版本
app.updateMissingIntervalVersion = function(versionId) {
    this.tempEntry.missingIntervalVersion = versionId || null;
    this.showSaveToast('已更新失踪区间置顶版本（尚未保存）');
};

// Layer 5: 显示并行版本详细设置弹窗
app.showParallelSettingsDetail = function(entryId) {
    const entry = this.data.entries.find(e => e.id === entryId) || this.tempEntry;
    if (!entry) return;
    
    const parallelIntervals = this.getParallelIntervals(entry);
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 fade-in overflow-y-auto';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col my-4">
            <div class="p-4 border-b bg-purple-50 rounded-t-xl flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-lg text-purple-800">并行版本详细设置 - ${entry.code}</h3>
                    <p class="text-xs text-gray-600 mt-1">为每个并行区间内的章节指定显示的置顶版本</p>
                </div>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-4 overflow-y-auto flex-1">
                <div class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div class="flex items-center gap-2 mb-2">
                        <i class="fa-solid fa-wand-magic-sparkles text-blue-600"></i>
                        <span class="text-sm font-bold text-blue-800">快速设置</span>
                    </div>
                    <div class="flex gap-2">
                        <select id="quick-set-version" class="flex-1 p-2 border border-blue-200 rounded text-sm">
                            <option value="">选择默认版本...</option>
                            ${entry.versions.map(v => `
                                <option value="${v.vid}">${v.title} ${v.level <= 2 ? '★' : ''}</option>
                            `).join('')}
                        </select>
                        <button onclick="app.quickApplyToAllParallel()" 
                            class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition">
                            应用到全部区间
                        </button>
                    </div>
                    <p class="text-[10px] text-blue-600 mt-1">
                        * 只会应用到包含该版本活跃时间的区间，不影响其他区间
                    </p>
                </div>
                
                <div id="parallel-detail-list" class="space-y-4"></div>
            </div>
            <div class="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
                <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">
                    完成设置
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const list = modal.querySelector('#parallel-detail-list');
    
    parallelIntervals.forEach((interval, idx) => {
        const section = document.createElement('div');
        section.className = 'border border-purple-200 rounded-lg p-3 bg-purple-50/50';
        
        // 获取该区间当前的所有设置
        let chaptersHtml = '';
        interval.chapters.forEach(ch => {
            const currentPinnedVid = entry.pinnedVersions ? entry.pinnedVersions[ch.id] : null;
            // 检查该章节活跃的版本
            const activeVersions = interval.versions.filter(v => {
                const fromOrder = this.getChapterOrder(v.chapterFrom);
                const toOrder = this.getChapterOrder(v.chapterTo);
                return ch.order >= fromOrder && ch.order <= toOrder;
            });
            
            chaptersHtml += `
                <div class="flex items-center justify-between py-1.5 border-b border-purple-100 last:border-0">
                    <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-600 w-20">${this.formatChapterNum(ch.num)}</span>
                        ${activeVersions.length > 1 ? `
                            <span class="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                                ${activeVersions.length}版本
                            </span>
                        ` : ''}
                    </div>
                    <select class="flex-1 p-1.5 border border-gray-200 rounded text-xs ml-2 chapter-pin-select" 
                        data-chapter-id="${ch.id}"
                        onchange="app.updateChapterPinVersion('${ch.id}', this.value)">
                        <option value="">系统默认</option>
                        ${interval.versions.map(v => `
                            <option value="${v.vid}" ${currentPinnedVid === v.vid ? 'selected' : ''}>
                                ${v.title} ${v.level <= 2 ? '★' : ''}
                            </option>
                        `).join('')}
                    </select>
                </div>
            `;
        });
        
        // 区间级别的快速设置
        const intervalDefault = entry.pinnedVersions[interval.startChapter.id] || '';
        
        section.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div class="text-sm font-bold text-purple-700">
                    区间 ${idx + 1}：${this.formatChapterNum(interval.chapters[0].num)} 至 
                    ${this.formatChapterNum(interval.chapters[interval.chapters.length - 1].num)}
                    <span class="text-[10px] font-normal text-purple-500 ml-1">(${interval.versions.length}个版本)</span>
                </div>
                <div class="flex gap-1">
                    <select class="text-xs p-1 border border-purple-200 rounded" 
                        onchange="app.applyToIntervalChapters('${interval.startChapter.id}', '${interval.endChapter.id}', this.value)">
                        <option value="">批量设置...</option>
                        ${interval.versions.map(v => `
                            <option value="${v.vid}">设为 ${v.title}</option>
                        `).join('')}
                    </select>
                </div>
            </div>
            <div class="bg-white rounded p-2 max-h-60 overflow-y-auto border border-purple-100">
                ${chaptersHtml}
            </div>
        `;
        
        list.appendChild(section);
    });
    
    // 如果没有并行区间，显示提示
    if (parallelIntervals.length === 0) {
        list.innerHTML = `
            <div class="text-center text-gray-500 py-8">
                <i class="fa-solid fa-check-circle text-green-500 text-2xl mb-2"></i>
                <p>该角色没有并行版本区间</p>
            </div>
        `;
    }
};

// 快速应用到所有并行区间
app.quickApplyToAllParallel = function() {
    const select = document.getElementById('quick-set-version');
    const versionId = select.value;
    if (!versionId) return;
    
    const entry = this.tempEntry;
    const parallelIntervals = this.getParallelIntervals(entry);
    
    let appliedCount = 0;
    parallelIntervals.forEach(interval => {
        // 检查该版本是否在此区间活跃
        const isActive = interval.versions.some(v => v.vid === versionId);
        if (isActive) {
            // 应用到区间起始章节（作为该区间标识）
            this.updateParallelPinVersion(entry.id, interval.startChapter.id, versionId);
            appliedCount++;
        }
    });
    
    alert(`已应用到 ${appliedCount} 个并行区间`);
    this.showParallelSettingsDetail(entry.id); // 刷新弹窗
};

// 应用到区间内的所有章节
app.applyToIntervalChapters = function(startChapterId, endChapterId, versionId) {
    if (!versionId) return;
    
    const entry = this.tempEntry;
    const startOrder = this.getChapterOrder(startChapterId);
    const endOrder = this.getChapterOrder(endChapterId);
    
    // 获取该区间内所有章节
    const chaptersInInterval = this.data.chapters.filter(ch => 
        ch.order >= startOrder && ch.order <= endOrder
    );
    
    // 为每个章节设置置顶版本
    chaptersInInterval.forEach(ch => {
        this.updateParallelPinVersion(entry.id, ch.id, versionId);
    });
    
    this.showSaveToast(`已应用到区间内 ${chaptersInInterval.length} 个章节`);
    
    // 刷新显示
    const selects = document.querySelectorAll(`.chapter-pin-select[data-chapter-id]`);
    selects.forEach(select => {
        const chId = select.dataset.chapterId;
        const ch = chaptersInInterval.find(c => c.id === chId);
        if (ch) select.value = versionId;
    });
};

// 更新单个章节的置顶版本
app.updateChapterPinVersion = function(chapterId, versionId) {
    this.updateParallelPinVersion(this.tempEntry.id, chapterId, versionId);
};

// ========== 版本管理（增强版） ==========
app.showVersionManager = function() {
    // 【关键修复】编辑模式用 tempEntry，查看模式用 data.entries
    const isEditing = this.data.currentView === 'edit';
    let entry;
    if (isEditing) {
        entry = this.tempEntry;
    } else {
        entry = this.data.entries.find(e => e.id === this.data.editingId);
    }
    if (!entry) return;

    this.closeVersionManager();

    const tpl = document.getElementById('tpl-version-manager');
    if (!tpl) {
        console.error('版本管理模板未找到');
        return;
    }

    const clone = tpl.content.cloneNode(true);

    clone.getElementById('version-manager-title').textContent = entry.code;
    clone.getElementById('version-manager-code').textContent = entry.code;

    const list = clone.getElementById('version-timeline-list');

    const sortedVersions = [...entry.versions].sort((a, b) => {
        const aOrder = a.chapterFrom ? (this.data.chapters.find(c => c.id === a.chapterFrom)?.order || 0) : -1;
        const bOrder = b.chapterFrom ? (this.data.chapters.find(c => c.id === b.chapterFrom)?.order || 0) : -1;
        return aOrder - bOrder;
    });

    sortedVersions.forEach((v, idx) => {
        const fromCh = v.chapterFrom ? this.data.chapters.find(c => c.id === v.chapterFrom) : null;
        const toCh = v.chapterTo ? this.data.chapters.find(c => c.id === v.chapterTo) : null;

        const card = document.createElement('div');
        // 【关键】编辑模式用 editingVersionId，查看模式用 viewingVersionId
        const activeVid = isEditing ? this.editingVersionId : this.data.viewingVersionId;
        card.className = `version-card relative p-4 bg-white rounded-lg border-2 ${v.vid === activeVid ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`;

        const timeRange = fromCh || toCh ?
            `${fromCh ? this.formatChapterNum(fromCh.num) : '开始'} ~ ${toCh ? this.formatChapterNum(toCh.num) : '至今'}` :
            '全时间有效';

        const levelLabels = {1: '主角', 2: '重要', 3: '普通', 4: '次要', 5: '路人'};
        const levelText = v.level !== undefined ? levelLabels[v.level] : '未设置';
        const levelClass = (v.level || 5) <= 2 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500';

        // 检查是否是置顶版本（用于并行区间或失踪区间）
        let pinIndicator = '';
        if (entry.pinnedVersions) {
            const pinnedInInterval = Object.values(entry.pinnedVersions).includes(v.vid);
            const isDefault = entry.defaultPinnedVersion === v.vid;
            const isMissingPinned = entry.missingIntervalVersion === v.vid;

            if (isDefault) {
                pinIndicator = '<span class="ml-1 text-[10px] px-1.5 bg-red-100 text-red-700 rounded" title="默认置顶">默认</span>';
            } else if (pinnedInInterval) {
                pinIndicator = '<span class="ml-1 text-[10px] px-1.5 bg-purple-100 text-purple-700 rounded" title="区间置顶">区间置顶</span>';
            } else if (isMissingPinned) {
                pinIndicator = '<span class="ml-1 text-[10px] px-1.5 bg-gray-100 text-gray-600 rounded" title="失踪区间置顶">失踪置顶</span>';
            }
        }

        card.innerHTML = `
            <div class="version-dot ${v.vid === activeVid ? 'active' : ''} ${v.chapterTo ? 'hidden' : ''}"></div>
            <div class="flex justify-between items-start mb-2">
                <div>
                    <div class="font-bold text-gray-800 flex items-center gap-1 flex-wrap">
                        ${v.title}
                        <span class="text-[10px] px-1.5 py-0.5 rounded ${levelClass}">${levelText}</span>
                        ${pinIndicator}
                        ${v.vid === activeVid ? '<span class="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded">当前查看</span>' : ''}
                    </div>
                    <div class="text-xs text-gray-500">${v.subtitle || ''}</div>
                </div>
                <div class="flex gap-1">
                    <button onclick="app.editVersionFromManager('${v.vid}')" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded" title="编辑">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    ${entry.versions.length > 1 ? `
                    <button onclick="app.deleteVersion('${v.vid}')" class="p-1.5 text-red-500 hover:bg-red-50 rounded" title="删除">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
            <div class="text-xs text-indigo-600 mb-2 font-mono bg-indigo-50 inline-block px-2 py-1 rounded">
                <i class="fa-regular fa-clock mr-1"></i>${timeRange}
            </div>
            <div class="text-xs text-gray-600 line-clamp-2">${v.blocks ? v.blocks.map(b => b.text).join(' · ') : ''}</div>
        `;
        list.appendChild(card);
    });

    document.body.appendChild(clone);

    const modal = document.querySelector('.fixed.inset-0.bg-black\\/50');
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) this.closeVersionManager();
        };
    }
};

app.closeVersionManager = function() {
    const modals = document.querySelectorAll('.fixed.inset-0.bg-black\\/50');
    modals.forEach(modal => {
        if (modal.querySelector('#version-timeline-list') || 
            modal.querySelector('#version-manager-title')) {
            modal.remove();
        }
    });
    
    // 【修复】关闭弹窗回到编辑页面时，强制刷新快捷版本管理栏
    if (this.data.currentView === 'edit' && this.updateEditVersionSelector) {
        setTimeout(() => this.updateEditVersionSelector(), 0);
    }
};

app.editVersionFromManager = function(vid) {
    this.closeVersionManager();
    this.data.viewingVersionId = vid;

    const isEditing = this.data.currentView === 'edit';
    if (isEditing) {
        // 【关键】编辑模式：直接从 tempEntry 切换版本，不从 data.entries 读取
        if (this.tempEntry) {
            const targetVersion = this.tempEntry.versions.find(v => v.vid === vid);
            if (targetVersion) {
                this.editingVersionId = vid;
                this.tempVersion = JSON.parse(JSON.stringify(targetVersion));
                // 【关键】同步 viewingVersionId，确保 renderEdit 渲染正确版本
                this.data.viewingVersionId = vid;
                this.editState.hasChanges = true;
                this.renderEdit(this.getEntryContainer ? this.getEntryContainer() : document.getElementById('main-container'));
                return;
            }
        }
    }

    // 查看模式：保持原有逻辑
    const entry = this.data.entries.find(e => e.id === this.data.editingId);
    if (entry && this.tempEntry && this.tempEntry.id === entry.id) {
        this.tempEntry.versions = JSON.parse(JSON.stringify(entry.versions));
        this.tempEntry.pinned = entry.pinned;
        this.tempEntry.pinStartChapter = entry.pinStartChapter;
        this.tempEntry.pinEndChapter = entry.pinEndChapter;
        this.tempEntry.pinnedVersions = entry.pinnedVersions ? {...entry.pinnedVersions} : {};
        this.tempEntry.defaultPinnedVersion = entry.defaultPinnedVersion;
        this.tempEntry.missingIntervalVersion = entry.missingIntervalVersion;
    }

    this.router('edit');
};

app.createNewVersionFromManager = function() {
    this.closeVersionManager();

    // 【关键修复】编辑模式下从 tempEntry 读取（包含未保存的导入版本）
    const isEditing = this.data.currentView === 'edit';
    let entry;
    if (isEditing && this.tempEntry) {
        entry = this.tempEntry;
    } else {
        entry = this.data.entries.find(e => e.id === this.data.editingId);
    }
    if (!entry) return;

    const activeVid = isEditing ? this.editingVersionId : this.data.viewingVersionId;
    let baseVersion = entry.versions.find(v => v.vid === activeVid);
    if (!baseVersion) {
        console.warn('[CreateVersion] 未找到vid=' + activeVid + '的版本，回退到最后一个');
        baseVersion = entry.versions[entry.versions.length - 1];
    }
    // 【关键】深拷贝baseVersion，避免后续修改污染原始数据
    baseVersion = JSON.parse(JSON.stringify(baseVersion));

    this.showChapterSelectDialog((selectedChapter, isParallel) => {
        if (!selectedChapter && !isParallel) return;

        let newChapterFrom = isParallel ? baseVersion.chapterFrom : selectedChapter.id;

        const hasOverlap = entry.versions.some(v => {
            if (v.vid === baseVersion.vid) return false;
            const vFromOrder = this.getChapterOrder(v.chapterFrom);
            const currentFromOrder = this.getChapterOrder(newChapterFrom);
            const vToOrder = this.getChapterOrder(v.chapterTo);
            return currentFromOrder >= vFromOrder && (vToOrder === null || currentFromOrder < vToOrder);
        });

        if (hasOverlap && !isParallel) {
            if (confirm('所选时间点与现有版本重合，是否创建并行版本？')) {
                isParallel = true;
            } else {
                return;
            }
        }

        if (!isParallel && !baseVersion.chapterTo && newChapterFrom !== baseVersion.chapterFrom) {
            baseVersion.chapterTo = newChapterFrom;
        }

        this.doCreateNewVersion(baseVersion, newChapterFrom, isParallel, entry);
    });
};

app.doCreateNewVersion = function(baseVersion, newChapterFrom, isParallel, entry) {
    // 【核心】创建真正的空白版本：标题空、blocks空、图片空
    const newVersion = {
        vid: 'v-' + Date.now(),
        title: '',  // 空白标题
        subtitle: '',
        level: 5,   // 默认重要程度
        image: null,
        images: { avatar: null, card: null, cover: null },
        chapterFrom: newChapterFrom,
        chapterTo: null,
        blocks: [], // 空白 blocks
        relatedVersions: isParallel ? [baseVersion.vid] : [],
        relatedCharacters: [],
        createdAt: Date.now()
    };

    if (isParallel) {
        if (!baseVersion.relatedVersions) baseVersion.relatedVersions = [];
        baseVersion.relatedVersions.push(newVersion.vid);
    }

    entry.versions.push(newVersion);
    
    // 【关键修复】如果 entry 是 tempEntry，同步到 data.entries（saveData 保存的是 data.entries）
    if (entry === this.tempEntry) {
        const dataEntry = this.data.entries.find(e => e.id === entry.id);
        if (dataEntry && !dataEntry.versions.find(v => v.vid === newVersion.vid)) {
            dataEntry.versions.push(JSON.parse(JSON.stringify(newVersion)));
        }
    }
    
    // 【关键修复】同步更新 tempEntry（仅在 entry 不是 tempEntry 本身时）
    // 避免编辑模式下同一个版本被 push 两次
    if (this.tempEntry && this.tempEntry.id === entry.id && this.tempEntry !== entry) {
        if (!this.tempEntry.versions.find(v => v.vid === newVersion.vid)) {
            this.tempEntry.versions.push(JSON.parse(JSON.stringify(newVersion)));
        }
        // 同步 Layer 5 相关字段
        if (entry.pinnedVersions) this.tempEntry.pinnedVersions = {...entry.pinnedVersions};
        if (entry.defaultPinnedVersion) this.tempEntry.defaultPinnedVersion = entry.defaultPinnedVersion;
        if (entry.missingIntervalVersion) this.tempEntry.missingIntervalVersion = entry.missingIntervalVersion;
    }

    this.saveData();
    this.data.viewingVersionId = newVersion.vid;

    // 【关键】编辑模式下：切换到新创建的空白版本并重新渲染编辑界面
    if (this.data.currentView === 'edit') {
        this.tempVersion = JSON.parse(JSON.stringify(newVersion));
        this.editingVersionId = newVersion.vid;
        this.editState.hasChanges = true;
        this.renderEdit(this.getEntryContainer ? this.getEntryContainer() : document.getElementById('main-container'));
    }

    this.showVersionManager();
    
    // 【修复】如果编辑页面可见，立即刷新快捷版本管理栏
    if (this.data.currentView === 'edit' && this.updateEditVersionSelector) {
        setTimeout(() => this.updateEditVersionSelector(), 50);
    }
};

app.deleteVersion = function(vid) {
    if(!confirm('确定删除此版本？')) return;

    // 【关键修复】编辑模式下操作 tempEntry，查看模式下操作 data.entries
    const isEditing = this.data.currentView === 'edit';
    const entry = isEditing ? this.tempEntry : this.data.entries.find(e => e.id === this.data.editingId);

    if(!entry || entry.versions.length <= 1) {
        alert('至少保留一个版本');
        return;
    }

    entry.versions.forEach(v => {
        if(v.relatedVersions) {
            v.relatedVersions = v.relatedVersions.filter(rv => rv !== vid);
        }
    });

    entry.versions = entry.versions.filter(v => v.vid !== vid);

    // 清理置顶设置中对此版本的引用
    if (entry.pinnedVersions) {
        Object.keys(entry.pinnedVersions).forEach(key => {
            if (entry.pinnedVersions[key] === vid) delete entry.pinnedVersions[key];
        });
    }
    if (entry.defaultPinnedVersion === vid) entry.defaultPinnedVersion = null;
    if (entry.missingIntervalVersion === vid) entry.missingIntervalVersion = null;

    if (isEditing) {
        // 编辑模式：同步更新 tempVersion 和 editingVersionId
        const remaining = entry.versions[entry.versions.length - 1];
        if (remaining) {
            this.tempVersion = JSON.parse(JSON.stringify(remaining));
            this.editingVersionId = remaining.vid;
            this.data.viewingVersionId = remaining.vid;
        }
        this.editState.hasChanges = true;
        this.renderEdit(this.getEntryContainer ? this.getEntryContainer() : document.getElementById('main-container'));
        this.showToast('版本已删除', 'success');
        // 【关键】如果版本管理弹窗当前打开，刷新它
        const vmModal = document.querySelector('#version-timeline-list');
        if (vmModal) this.showVersionManager();
    } else {
        // 查看模式：更新 viewingVersionId 并保存
        if (this.data.viewingVersionId === vid) {
            this.data.viewingVersionId = entry.versions[entry.versions.length - 1]?.vid;
        }
        this.saveData();
        this.showVersionManager();
    }
};

app.mergeVersions = function() {
    alert('版本合并功能：将选中的版本合并为一个版本\n（此功能可用于简化时间线）');
};

// ========== 章节管理（保持原有） ==========
app.renderTimelineSettings = function(container) {
    const tpl = document.getElementById('tpl-timeline-settings');
    if (!tpl) return;
    
    const clone = tpl.content.cloneNode(true);

    const list = clone.getElementById('chapter-list');
    const sorted = [...this.data.chapters].sort((a, b) => a.order - b.order);

    sorted.forEach((ch) => {
        const item = document.createElement('div');
        item.className = 'chapter-item flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200';
        item.dataset.id = ch.id;
        item.innerHTML = `
            <div class="text-gray-400 cursor-move handle">
                <i class="fa-solid fa-grip-vertical"></i>
            </div>
            <div class="flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold font-mono min-w-[60px] text-center" 
                        title="章节标识：${ch.num}">
                        ${this.formatChapterNum(ch.num)}
                    </span>
                    <div class="flex items-center gap-1 flex-1 min-w-0 group">
                        <span class="text-sm text-gray-700 font-medium truncate" id="chapter-title-${ch.id}">${ch.title || '(无标题)'}</span>
                        <button onclick="app.editChapterTitle('${ch.id}')" 
                                class="opacity-0 group-hover:opacity-100 text-indigo-600 hover:bg-indigo-50 p-1 rounded transition"
                                title="编辑名称">
                            <i class="fa-solid fa-pen text-xs"></i>
                        </button>
                    </div>
                </div>
            </div>
            <button onclick="app.deleteChapter('${ch.id}')" class="text-gray-400 hover:text-red-500 p-1.5 transition">
                <i class="fa-solid fa-times"></i>
            </button>
        `;
        list.appendChild(item);
    });

    container.appendChild(clone);

    if (typeof Sortable !== 'undefined') {
        new Sortable(list, {
            animation: 150,
            handle: '.handle',
            ghostClass: 'sortable-ghost',
            onEnd: () => this.reorderChapters()
        });
    }
};

app.addChapter = function() {
    const numInput = document.getElementById('new-chapter-input').value.trim();
    const title = document.getElementById('new-chapter-title').value.trim();

    if(!numInput) return alert('请输入章节号/标识');
    if(this.data.chapters.some(c => c.num === numInput)) {
        return alert('该章节标识已存在');
    }

    const id = 'ch-' + Date.now();
    const maxOrder = Math.max(...this.data.chapters.map(c => c.order), -1);

    this.data.chapters.push({ 
        id, 
        num: numInput,
        title, 
        order: maxOrder + 1 
    });

    const newSynopsis = {
        id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        chapterId: id,
        num: numInput,
        title: title || `第${numInput}章`,
        content: '',
        image: null
    };
    this.data.synopsis.push(newSynopsis);

    this.saveData();
    this.initTimelineSelector();
    this.router('timeline-settings', false);

    setTimeout(() => {
        const inp = document.getElementById('new-chapter-input');
        const tit = document.getElementById('new-chapter-title');
        if(inp) inp.value = '';
        if(tit) tit.value = '';
    }, 0);

    this.initTimelineSelector();

    // 【新增】自动检测并修复并行区间置顶设置
    setTimeout(() => {
        this.autoFixParallelIntervalsForNewChapter(id); // id 是新章节的ID
        this.showSaveToast('已同步创建对应的剧情梗概章节');
    }, 100);
};

app.editChapterTitle = async function(id) {
    const ch = this.data.chapters.find(c => c.id === id);
    if(!ch) return;

    // 使用网页内输入弹窗（Electron 不支持 window.prompt）
    let newTitle = null;
    if (this.showPromptDialog) {
        newTitle = await this.showPromptDialog({ title: '修改章节名称', defaultValue: ch.title || '', confirmText: '确定' });
    } else {
        newTitle = prompt('修改章节名称：', ch.title);
    }
    if(newTitle !== null) { 
        const trimmedTitle = newTitle.trim();
        ch.title = trimmedTitle;
        
        const synopsisItem = this.data.synopsis.find(s => s.chapterId === id);
        if (synopsisItem) {
            synopsisItem.title = trimmedTitle;
        }
        
        this.saveData();
        this.renderTimelineSettings(document.getElementById('main-container'));
        
        if (this.data.currentView === 'synopsis-edit' && this.renderSynopsisEdit) {
            this.renderSynopsisEdit(document.getElementById('main-container'));
        }
    }
};

app.batchImportChapters = function(input) {
    const file = input.files[0];
    if(!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);

        let added = 0;
        let skipped = 0;
        let invalid = 0;

        lines.forEach((line, idx) => {
            const separator = '&&';
            const sepIndex = line.indexOf(separator);

            let num, title;
            if(sepIndex > -1) {
                num = line.substring(0, sepIndex).trim();
                title = line.substring(sepIndex + separator.length).trim();
            } else {
                num = line;
                title = '';
            }

            if(!num) {
                invalid++;
                return;
            }

            if(this.data.chapters.some(c => c.num === num)) {
                skipped++;
                return;
            }

            const id = 'ch-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
            const maxOrder = Math.max(...this.data.chapters.map(c => c.order), -1);

            this.data.chapters.push({
                id,
                num,
                title,
                order: maxOrder + 1 + idx
            });
            
            this.data.synopsis.push({
                id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5) + '-' + idx,
                chapterId: id,
                num: num,
                title: title || `第${num}章`,
                content: '',
                image: null
            });
            
            added++;
        });

        if(added > 0) {
            this.saveData();
            this.initTimelineSelector();
            this.renderTimelineSettings(document.getElementById('main-container'));
            
            if (this.data.currentView === 'synopsis-edit' && this.renderSynopsisEdit) {
                this.renderSynopsisEdit(document.getElementById('main-container'));
            }
        }

        alert(`导入完成！\n成功添加：${added} 个章节（已同步创建剧情梗概）\n跳过重复：${skipped} 个\n格式错误：${invalid} 个`);
        input.value = '';
    };
    reader.readAsText(file);
};

app.deleteChapter = function(id) {
    if(!confirm('确定删除此章节？\n\n注意：引用此章节的词条显示设置将被自动调整，对应的剧情梗概内容也将被删除。')) return;

    const affectedEntries = new Set();
    this.data.entries.forEach(entry => {
        entry.versions.forEach(v => {
            if(v.chapterFrom === id || v.chapterTo === id) {
                affectedEntries.add(entry.code || entry.id);
            }
        });
    });

    const deletedSynopsis = this.data.synopsis.filter(s => s.chapterId === id);
    this.data.synopsis = this.data.synopsis.filter(s => s.chapterId !== id);

    this.data.chapters = this.data.chapters.filter(c => c.id !== id);

    if(this.data.chapters.length > 0) {
        const firstChapter = [...this.data.chapters].sort((a, b) => a.order - b.order)[0];

        let fixedCount = 0;
        this.data.entries.forEach(entry => {
            entry.versions.forEach(v => {
                let changed = false;
                if(v.chapterFrom === id) {
                    v.chapterFrom = firstChapter.id;
                    changed = true;
                }
                if(v.chapterTo === id) {
                    v.chapterTo = null;
                    changed = true;
                }
                if(changed) fixedCount++;
            });
        });
    } else {
        this.data.entries.forEach(entry => {
            entry.versions.forEach(v => {
                if(v.chapterFrom === id) v.chapterFrom = null;
                if(v.chapterTo === id) v.chapterTo = null;
            });
        });
    }

    this.saveData();
    this.initTimelineSelector();
    this.router('timeline-settings', false);

    if(deletedSynopsis.length > 0) {
        setTimeout(() => {
            this.showSaveToast(`已删除 ${deletedSynopsis.length} 个对应的剧情梗概章节`);
        }, 100);
    }
    
    if(affectedEntries.size > 0) {
        setTimeout(() => {
            this.showSaveToast(`已自动调整 ${affectedEntries.size} 个词条的时间轴`);
        }, 300);
    }
};

app.reorderChapters = function() {
    const list = document.getElementById('chapter-list');
    if (!list) return;
    
    const items = list.querySelectorAll('.chapter-item');
    items.forEach((item, index) => {
        const chId = item.dataset.id;
        const ch = this.data.chapters.find(c => c.id === chId);
        if(ch) ch.order = index;
    });
    
    const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
    const newSynopsisOrder = [];
    
    sortedChapters.forEach(ch => {
        const existingSynopsis = this.data.synopsis.find(s => s.chapterId === ch.id);
        if (existingSynopsis) {
            existingSynopsis.num = ch.num;
            newSynopsisOrder.push(existingSynopsis);
        } else {
            newSynopsisOrder.push({
                id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                chapterId: ch.id,
                num: ch.num,
                title: ch.title || `第${ch.num}章`,
                content: '',
                image: null
            });
        }
    });
    
    const orphanedSynopsis = this.data.synopsis.filter(s => 
        !sortedChapters.some(ch => ch.id === s.chapterId)
    );
    
    this.data.synopsis = [...newSynopsisOrder, ...orphanedSynopsis];
    
    this.saveData();
    this.initTimelineSelector();
    
    if (this.data.currentView === 'synopsis-edit' && this.renderSynopsisEdit) {
        this.renderSynopsisEdit(document.getElementById('main-container'));
    }
};

// ========== 相关角色/版本管理（保持原有） ==========
app.renderRelatedCharactersEdit = function(container) {
    if (!container) return;
    container.innerHTML = '';
    if (!this.tempVersion.relatedCharacters || this.tempVersion.relatedCharacters.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 italic">暂无相关角色</div>';
        return;
    }

    this.tempVersion.relatedCharacters.forEach((rc, idx) => {
        const charEntry = this.data.entries.find(e => e.id === rc.charId);
        if (!charEntry) return;

        const charVersion = this.getVisibleVersion(charEntry);
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 p-2 bg-white rounded border border-gray-200';
        div.innerHTML = `
            <span class="text-sm flex-1">${charVersion ? charVersion.title : charEntry.code}</span>
            <input type="text" value="${rc.relationName}" placeholder="关系名称" 
                class="text-xs border border-gray-200 rounded px-2 py-1 w-24"
                onchange="app.updateRelatedCharacterRelation(${idx}, this.value)">
            <button onclick="app.removeRelatedCharacter(${idx})" class="text-red-500 hover:text-red-700 w-6 h-6 flex items-center justify-center">
                <i class="fa-solid fa-times text-xs"></i>
            </button>
        `;
        container.appendChild(div);
    });
};

app.addRelatedCharacter = function() {
    this.showCharacterSelectDialog((entry, relationName) => {
        if (!entry) return;

        if (!this.tempVersion.relatedCharacters) {
            this.tempVersion.relatedCharacters = [];
        }

        if (this.tempVersion.relatedCharacters.some(rc => rc.charId === entry.id)) {
            alert('该角色已添加');
            return;
        }

        this.tempVersion.relatedCharacters.push({
            charId: entry.id,
            relationName: relationName || '相关'
        });

        this.renderRelatedCharactersEdit(document.getElementById('related-characters-edit-list'));
    });
};

app.updateRelatedCharacterRelation = function(idx, value) {
    if (this.tempVersion.relatedCharacters[idx]) {
        this.tempVersion.relatedCharacters[idx].relationName = value;
    }
};

app.removeRelatedCharacter = function(idx) {
    this.tempVersion.relatedCharacters.splice(idx, 1);
    this.renderRelatedCharactersEdit(document.getElementById('related-characters-edit-list'));
};

app.renderRelatedVersionsList = function(container) {
    if (!container) return;
    container.innerHTML = '';
    if(!this.tempVersion.relatedVersions || this.tempVersion.relatedVersions.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 italic">暂无相关版本</div>';
        return;
    }

    this.tempVersion.relatedVersions.forEach((rvid, idx) => {
        const rv = this.tempEntry.versions.find(v => v.vid === rvid);
        if(rv) {
            const div = document.createElement('div');
            div.className = 'flex justify-between items-center p-2 bg-indigo-50 rounded text-xs';
            div.innerHTML = `
                <span class="text-indigo-700">${rv.title}</span>
                <button onclick="app.removeRelatedVersion(${idx})" class="text-red-500 hover:text-red-700">
                    <i class="fa-solid fa-times"></i>
                </button>
            `;
            container.appendChild(div);
        }
    });
};

app.addRelatedVersion = function() {
    const availableVersions = this.tempEntry.versions
        .filter(v => v.vid !== this.editingVersionId && !this.tempVersion.relatedVersions.includes(v.vid));

    if(availableVersions.length === 0) {
        alert('没有其他可关联的版本');
        return;
    }

    this.showVersionSelectDialog(availableVersions, (selectedVersion) => {
        if(!selectedVersion) return;
        
        if(!this.tempVersion.relatedVersions.includes(selectedVersion.vid)) {
            this.tempVersion.relatedVersions.push(selectedVersion.vid);
            this.renderRelatedVersionsList(document.getElementById('related-versions-list'));
        }
    });
};

app.removeRelatedVersion = function(idx) {
    this.tempVersion.relatedVersions.splice(idx, 1);
    this.renderRelatedVersionsList(document.getElementById('related-versions-list'));
};

// ========== 弹窗辅助（保持原有） ==========
app.showChapterSelectDialog = function(callback) {
    const existingModal = document.getElementById('chapter-select-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'chapter-select-modal';
    modal.className = 'fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div class="p-4 border-b bg-gray-50 rounded-t-xl flex justify-between items-center">
                <h3 class="font-bold text-lg">选择章节</h3>
                <button onclick="this.closest('#chapter-select-modal').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-4">
                <input type="text" id="chapter-search-input" placeholder="搜索章节..." 
                    class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none">
                <div class="flex gap-2 mb-4">
                    <button id="btn-parallel" class="flex-1 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition">
                        <i class="fa-solid fa-code-branch mr-1"></i>创建并行版本
                    </button>
                </div>
                <div id="chapter-select-list" class="space-y-1 max-h-[40vh] overflow-y-auto">
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const list = modal.querySelector('#chapter-select-list');
    const searchInput = modal.querySelector('#chapter-search-input');
    const parallelBtn = modal.querySelector('#btn-parallel');

    const renderChapters = (filter = '') => {
        list.innerHTML = '';
        const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
        
        sortedChapters.forEach(ch => {
            if (filter && !ch.title.toLowerCase().includes(filter.toLowerCase()) && 
                !this.formatChapterNum(ch.num).includes(filter)) return;

            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
            item.innerHTML = `
                <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${this.formatChapterNum(ch.num)}</span>
                <span class="text-sm text-gray-700">${ch.title || '无标题'}</span>
            `;
            item.onclick = () => {
                modal.remove();
                callback(ch, false);
            };
            list.appendChild(item);
        });
    };

    renderChapters();

    searchInput.oninput = (e) => renderChapters(e.target.value);

    parallelBtn.onclick = () => {
        modal.remove();
        callback(null, true);
    };

    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
};

app.showVersionSelectDialog = function(versions, callback) {
    const existingModal = document.getElementById('version-select-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'version-select-modal';
    modal.className = 'fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div class="p-4 border-b bg-gray-50 rounded-t-xl flex justify-between items-center">
                <h3 class="font-bold text-lg">选择要关联的版本</h3>
                <button onclick="this.closest('#version-select-modal').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-4">
                <input type="text" id="version-search-input" placeholder="搜索版本名称..." 
                    class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none">
                <div id="version-select-list" class="space-y-1 max-h-[50vh] overflow-y-auto">
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const list = modal.querySelector('#version-select-list');
    const searchInput = modal.querySelector('#version-search-input');

    const renderVersions = (filter = '') => {
        list.innerHTML = '';
        
        versions.forEach(v => {
            if (filter && !v.title.toLowerCase().includes(filter.toLowerCase())) return;

            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
            item.innerHTML = `
                <span class="text-sm text-gray-700">${v.title}</span>
                <span class="text-xs text-gray-400 ml-auto">${v.level <= 2 ? '★' : ''}</span>
            `;
            item.onclick = () => {
                modal.remove();
                callback(v);
            };
            list.appendChild(item);
        });
    };

    renderVersions();

    searchInput.oninput = (e) => renderVersions(e.target.value);
    searchInput.focus();

    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
};

app.showCharacterSelectDialog = function(callback) {
    const existingModal = document.getElementById('character-select-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'character-select-modal';
    modal.className = 'fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div class="p-4 border-b bg-gray-50 rounded-t-xl flex justify-between items-center">
                <h3 class="font-bold text-lg">选择相关角色</h3>
                <button onclick="this.closest('#character-select-modal').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-4">
                <input type="text" id="character-search-input" placeholder="搜索角色名称或编号..." 
                    class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none">
                <div id="character-select-list" class="space-y-1 max-h-[40vh] overflow-y-auto">
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const list = modal.querySelector('#character-select-list');
    const searchInput = modal.querySelector('#character-search-input');

    const renderCharacters = (filter = '') => {
        list.innerHTML = '';
        const characters = this.data.entries.filter(e => e.type === 'character');
        
        characters.forEach(entry => {
            const visibleVersion = this.getVisibleVersion(entry);
            const versionTitle = visibleVersion ? visibleVersion.title : entry.code;
            const level = visibleVersion?.level || 5;
            
            if (filter && !entry.code.toLowerCase().includes(filter.toLowerCase()) && 
                !versionTitle.toLowerCase().includes(filter.toLowerCase())) return;

            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
            item.innerHTML = `
                <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${entry.code}</span>
                <span class="text-sm text-gray-700 flex-1">${versionTitle}</span>
                ${level <= 2 ? '<span class="text-xs text-yellow-600">★</span>' : ''}
            `;
            item.onclick = async () => {
                // 使用网页内输入弹窗（Electron 不支持 window.prompt）
                let relationName = '相关';
                if (app.showPromptDialog) {
                    const r = await app.showPromptDialog({ title: '输入关系名称', placeholder: '如：朋友、敌人、恋人', confirmText: '确定' });
                    if (r) relationName = r;
                } else {
                    relationName = prompt('输入关系名称（如：朋友、敌人、恋人）：') || '相关';
                }
                modal.remove();
                callback(entry, relationName);
            };
            list.appendChild(item);
        });
    };

    renderCharacters();

    searchInput.oninput = (e) => renderCharacters(e.target.value);

    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
};

// ========== 设定类型与阵营（保持原有） ==========
app.onSettingTypeChange = function(value) {
    const customInput = app.$e('edit-setting-type-custom');
    const pwSection = app.$e('edit-hidden-pw-section');
    if (customInput) {
        if (value === 'custom') {
            customInput.classList.remove('hidden');
        } else {
            customInput.classList.add('hidden');
        }
    }
    // 【功能4】选中"隐藏"目录时显示密码设置
    if (pwSection) {
        if (value === 'hidden') {
            pwSection.classList.remove('hidden');
        } else {
            pwSection.classList.add('hidden');
        }
    }
};

/**
 * 【功能4】添加密码错误提醒规则
 */
app.addHiddenPwRule = function(condition, answer, message) {
    const container = app.$e('edit-hidden-pw-rules');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'pw-rule-row flex items-center gap-1';

    if (condition === 'default') {
        // 通用规则（不可删除）：当不满足所有自定义条件时的回退提醒
        div.classList.add('pw-rule-default');
        div.innerHTML = `
            <span class="text-xs text-amber-400 font-medium"><i class="fa-solid fa-star-of-life mr-1"></i>其他情况时</span>
            <input type="text" class="pw-rule-msg flex-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 p-1" placeholder="不设置则使用系统预设提醒" value="${message || ''}">
            <span class="text-xs text-gray-500" title="通用规则不可删除"><i class="fa-solid fa-ban"></i></span>
        `;
    } else {
        // 自定义规则
        div.innerHTML = `
            <span class="text-xs text-gray-400">当输入</span>
            <select class="pw-rule-type text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 p-1">
                <option value="equals" ${condition === 'equals' ? 'selected' : ''}>等于</option>
                <option value="includes" ${condition === 'includes' ? 'selected' : ''}>包括</option>
            </select>
            <input type="text" class="pw-rule-answer flex-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 p-1" placeholder="特定内容" value="${answer || ''}">
            <span class="text-xs text-gray-400">时</span>
            <input type="text" class="pw-rule-msg flex-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 p-1" placeholder="显示提醒" value="${message || ''}">
            <button onclick="this.parentElement.remove()" class="text-gray-500 hover:text-red-400 text-xs px-1"><i class="fa-solid fa-times"></i></button>
        `;
    }
    container.appendChild(div);
};

/**
 * 【功能4】收集密码错误提醒规则
 * 通用规则（condition=default）单独提取为 defaultMessage，不计入 rules 数组
 */
app.collectHiddenPwRules = function() {
    const rules = [];
    let defaultMessage = '';
    document.querySelectorAll('.pw-rule-row').forEach(row => {
        const isDefault = row.classList.contains('pw-rule-default');
        const msg = row.querySelector('.pw-rule-msg')?.value?.trim();
        if (isDefault) {
            defaultMessage = msg || '';
        } else {
            const type = row.querySelector('.pw-rule-type')?.value;
            const answer = row.querySelector('.pw-rule-answer')?.value?.trim();
            if (answer && msg) {
                rules.push({ condition: type || 'equals', answer, message: msg });
            }
        }
    });
    // 返回 { rules, defaultMessage } 格式
    return { rules, defaultMessage };
};

app.quickAddCamp = async function() {
    // 使用网页内输入弹窗（Electron 不支持 window.prompt）
    let name = null;
    if (this.showPromptDialog) {
        name = await this.showPromptDialog({ title: '新建阵营', placeholder: '输入新阵营名称', confirmText: '创建' });
    } else {
        name = prompt('输入新阵营名称：');
    }
    if (!name) return;

    if (this.data.camps.includes(name)) {
        alert('该阵营已存在');
        return;
    }

    this.data.camps.push(name);

    const campEntry = {
        id: 'camp-' + Date.now(),
        type: 'non-character',
        code: this.generateCode('non-character'),
        settingType: 'faction',
        pinned: false,
        pinStartChapter: null,
        pinEndChapter: null,
        pinnedVersions: {},
        missingIntervalVersion: null,
        versions: [{
            vid: 'v-default',
            title: name,
            subtitle: `${name}的详细内容暂缺，请耐心等待情报补全......`,
            level: 3,
            image: null,
            images: { avatar: null, card: null, cover: null },
            chapterFrom: null,
            chapterTo: null,
            blocks: [
                { type: 'h2', text: '阵营简介' },
                { type: 'p', text: `${name}的详细介绍暂缺，请耐心等待情报补全......` }
            ],
            relatedVersions: [],
            relatedCharacters: [],
            createdAt: Date.now()
        }]
    };
    this.data.entries.push(campEntry);

    const campSelect = app.$e('edit-camp');
    if (campSelect) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        opt.selected = true;
        campSelect.appendChild(opt);
        campSelect.value = name;
    }

    this.saveData();
    this.showSaveToast(`已创建阵营 "${name}" 并生成设定词条`);
};

// ========== 内容块编辑 ==========
// ============================================
// 代码块 1: wiki-features-edit.js - createEditBlock 函数修改
// 替换原函数，添加 Enter 键拦截和标准化处理
// ============================================
app.createEditBlock = function(container, block, index) {
    const div = document.createElement('div');
    div.className = 'relative group bg-gray-50 border border-gray-200 rounded-lg p-3 hover:border-indigo-300 transition edit-block-item';
    div.dataset.type = block.type;
    div.dataset.index = index;

    if (block.type === 'p') {
        const editor = document.createElement('div');
        editor.className = 'block-input w-full bg-transparent outline-none text-sm text-gray-600 leading-relaxed min-h-[80px] break-words';
        editor.style.cssText = 'word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap;';
        editor.contentEditable = true;
        editor.innerHTML = this.markdownToHtml(block.text || '');

        // 【修复3】禁用浏览器自动列表格式化（数字序号+空格自动变ol）
        editor.addEventListener('keydown', (e) => {
            // 拦截数字+空格/句点触发自动列表
            if ((e.key === ' ' || e.key === '.') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const node = range.startContainer;
                    if (node.nodeType === Node.TEXT_NODE && range.startOffset >= 2) {
                        const text = node.textContent.substring(0, range.startOffset);
                        // 匹配 "1. " 或 "1 " 在行首
                        if (/^\d+[\.\s]$/.test(text) || /^\n\d+[\.\s]$/.test(text)) {
                            e.preventDefault();
                            // 手动插入空格或句点，不触发自动格式化
                            const textNode = document.createTextNode(e.key);
                            range.insertNode(textNode);
                            range.setStartAfter(textNode);
                            range.collapse(true);
                            sel.removeAllRanges();
                            sel.addRange(range);
                            editor.dispatchEvent(new Event('input', { bubbles: true }));
                            return;
                        }
                    }
                }
            }
            // 拦截回车键在自动列表中的行为
            if (e.key === 'Enter') {
                const parentOl = document.querySelector('ol');
                if (parentOl && editor.contains(parentOl)) {
                    e.preventDefault();
                    document.execCommand('insertParagraph', false, null);
                    return;
                }
            }
        });
        // 也拦截beforeinput事件（更底层）
        editor.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'insertOrderedList' || e.inputType === 'insertUnorderedList') {
                e.preventDefault();
            }
        });

        // 焦点事件：记录当前编辑器
        editor.addEventListener('focus', () => {
            app._currentEditor = editor;
            app._lastFocusedBlock = div;
            // 【修复4】同时保存_savedEditor和_savedRange
            app._savedEditor = editor;
            try {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    app._savedRange = sel.getRangeAt(0).cloneRange();
                }
            } catch(e) {}
        });

        // 点击事件也记录
        editor.addEventListener('click', (e) => {
            app._currentEditor = editor;
            app._lastFocusedBlock = div;
            app._savedEditor = editor;
            // 事件委托处理 entry-index-link 点击
            const link = e.target.closest('.entry-index-link');
            if (link && link.dataset.entryId) {
                e.preventDefault();
                e.stopPropagation();
                app.openEntryWithVersion(link.dataset.entryId, link.dataset.versionId || '');
            }
        });

        // 选择变化时保存范围
        editor.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                app._savedRange = sel.getRangeAt(0).cloneRange();
            }
        });
        editor.addEventListener('mouseup', () => {
            const sel = window.getSelection();
            if (sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                app._currentEditor = editor;
                app._savedRange = sel.getRangeAt(0).cloneRange();
            }
        });
        // 键盘输入后也保存范围
        editor.addEventListener('keyup', () => {
            const sel = window.getSelection();
            if (sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                app._savedRange = sel.getRangeAt(0).cloneRange();
            }
        });

        // 确保点击即聚焦（移动端兼容）
        div.addEventListener('click', (e) => {
            if (e.target === div) editor.focus();
        });

        div.appendChild(editor);
    } else if (block.type === 'h2' || block.type === 'h3') {
        const textarea = document.createElement('textarea');
        textarea.className = 'block-input w-full bg-transparent outline-none resize-none ' + 
            (block.type === 'h2' ? 'text-2xl font-bold text-gray-800 border-l-4 border-indigo-600 bg-indigo-50 pl-3' : 'text-lg font-semibold text-gray-700 border-l-2 border-gray-400 pl-2') + 
            ' rounded-r leading-tight break-words';
        textarea.style.cssText = 'word-break: break-word; overflow-wrap: anywhere;';
        textarea.placeholder = block.type === 'h2' ? '二级标题' : '小标题';
        textarea.rows = 1;
        textarea.value = block.text || '';
        
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
        
        textarea.addEventListener('focus', () => {
            app.lastFocusedTextarea = textarea;
            app._currentEditor = null; // 标记当前是textarea不是contenteditable
            app._lastFocusedBlock = div; // 【修复】保存当前块用于 addBlock 定位
        });
        
        if (block.text) setTimeout(() => textarea.dispatchEvent(new Event('input')), 0);
        div.appendChild(textarea);
    } else if (block.type === 'img') {
        // 【新增】图片元件编辑 - 支持data-img-ref异步加载
        div.className += ' bg-gradient-to-br from-rose-50 to-pink-50 border-rose-200';
        const imgRef = block.src || '';
        let imgSrc = imgRef;
        if (imgSrc.startsWith('{{IMG:') && this.storageManager) {
            const match = imgSrc.match(/\\{\\{IMG:(.+?)\\}\\}/);
            if (match && this.storageManager.memoryCache.has(match[1])) {
                imgSrc = this.storageManager.memoryCache.get(match[1]);
            }
        }
        imgSrc = this.resolveImageUrl(imgSrc);
        const hasDirectSrc = imgSrc && (imgSrc.startsWith('data:') || imgSrc.startsWith('http'));
        const needsAsyncLoad = imgRef.startsWith('{{IMG:') && !hasDirectSrc;
        const safeRef = this.escapeHtml(imgRef).replace(/"/g, '&quot;');
        // 只要有直接或间接图片引用，就显示img标签（data-img-ref供异步加载使用）
        const showImg = hasDirectSrc || needsAsyncLoad;
        
        div.innerHTML = `
            <div class="space-y-2">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-bold text-rose-700"><i class="fa-solid fa-image mr-1"></i>图片元件</span>
                    <div class="flex items-center gap-1">
                        <button onclick="app.moveBlock(${index}, -1)" class="text-gray-400 hover:text-gray-600 p-0.5" title="上移"><i class="fa-solid fa-arrow-up"></i></button>
                        <button onclick="app.moveBlock(${index}, 1)" class="text-gray-400 hover:text-gray-600 p-0.5" title="下移"><i class="fa-solid fa-arrow-down"></i></button>
                        <button onclick="app.deleteBlock(${index})" class="text-red-400 hover:text-red-600 p-0.5" title="删除"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="relative aspect-video bg-white rounded-lg border-2 border-dashed border-rose-300 flex flex-col items-center justify-center overflow-hidden group cursor-pointer"
                     onclick="document.getElementById('img-block-input-${index}').click()">
                    <img id="img-block-preview-${index}" src="${hasDirectSrc ? imgSrc : ''}" data-img-ref="${safeRef}" class="absolute inset-0 w-full h-full object-cover ${showImg ? '' : 'hidden'}" onerror="if(this.dataset.imgRef &amp;&amp; this.dataset.imgRef.startsWith('{{IMG:')){this.classList.add('hidden');document.getElementById('img-block-placeholder-${index}').classList.remove('hidden');}else{this.classList.add('hidden');}">
                    <div id="img-block-placeholder-${index}" class="text-center p-4 ${showImg ? 'hidden' : ''}">
                        <i class="fa-solid fa-cloud-upload-alt text-2xl text-rose-400 mb-1"></i>
                        <p class="text-xs text-rose-500">点击上传图片</p>
                    </div>
                </div>
                <input type="file" id="img-block-input-${index}" class="hidden" accept="image/*" onchange="app.handleImgBlockUpload(this, ${index})">
                <input type="text" class="block-image-caption w-full p-2 border border-rose-200 rounded-lg bg-white text-sm" placeholder="图片说明（可选）" value="${this.escapeHtml(block.caption || '')}">
                <input type="hidden" class="block-image-src" value="${this.escapeHtml(block.src || '')}">
            </div>`;
    } else if (block.type === 'table') {
        // 【新增】表格元件编辑（支持colspan/rowspan合并+对齐+样式）
        div.className += ' bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200';
        const rows = block.rows && block.rows.length > 0 ? block.rows : [['', '']];
        const colspans = block.colspans || [];
        const aligns = block.aligns || [];
        const styles = block.styles || [];
        const tId = 'tbl-' + index + '-' + Date.now();
        // 辅助函数：生成单元格内联样式
        const _cellStyle = (r, c) => {
            const parts = [];
            const a = aligns[r] && aligns[r][c] ? aligns[r][c] : '';
            if (a) parts.push('text-align:' + a);
            const s = styles[r] && styles[r][c] ? styles[r][c] : null;
            if (s) {
                if (s.color) parts.push('color:' + s.color);
                if (s.bg) parts.push('background-color:' + s.bg);
            }
            return parts.length > 0 ? ' style="' + parts.join(';') + '"' : '';
        };
        const _cellData = (r, c) => {
            const a = aligns[r] && aligns[r][c] ? aligns[r][c] : '';
            const s = styles[r] && styles[r][c] ? styles[r][c] : null;
            let d = '';
            if (a) d += ' data-align="' + a + '"';
            if (s && s.color) d += ' data-text-color="' + s.color + '"';
            if (s && s.bg) d += ' data-bg-color="' + s.bg + '"';
            return d;
        };
        let tbHtml = '<div class="space-y-2"><div class="flex items-center justify-between mb-1"><span class="text-xs font-bold text-emerald-700"><i class="fa-solid fa-table mr-1"></i>表格元件</span><div class="flex items-center gap-1"><button onclick="app.moveBlock(' + index + ', -1)" class="text-gray-400 hover:text-gray-600 p-0.5" title="上移"><i class="fa-solid fa-arrow-up"></i></button><button onclick="app.moveBlock(' + index + ', 1)" class="text-gray-400 hover:text-gray-600 p-0.5" title="下移"><i class="fa-solid fa-arrow-down"></i></button><button onclick="app.deleteBlock(' + index + ')" class="text-red-400 hover:text-red-600 p-0.5" title="删除"><i class="fa-solid fa-trash"></i></button></div></div>';
        tbHtml += '<div class="overflow-x-auto"><table id="' + tId + '" class="w-full border-collapse bg-white rounded-lg overflow-hidden shadow-sm" style="table-layout:fixed;" data-block-index="' + index + '"><thead class="bg-emerald-100"><tr>';
        const headerLen = rows[0] ? rows[0].length : 2;
        for (let c = 0; c < headerLen; c++) {
            const cs = colspans[0] && colspans[0][c] > 1 ? ' colspan="' + colspans[0][c] + '"' : '';
            tbHtml += '<th class="border border-emerald-200 p-2 text-xs text-emerald-700 font-semibold min-w-[80px] table-edit-cell cursor-pointer transition" contenteditable="true" data-col="' + c + '"' + cs + _cellStyle(0, c) + _cellData(0, c) + '>' + (rows[0] && rows[0][c] ? this.escapeHtml(rows[0][c]) : '') + '</th>';
        }
        tbHtml += '</tr></thead><tbody>';
        for (let r = 1; r < rows.length; r++) {
            tbHtml += '<tr>';
            const rowLen = rows[r] ? rows[r].length : headerLen;
            for (let c = 0; c < rowLen; c++) {
                const cs = colspans[r] && colspans[r][c] > 1 ? ' colspan="' + colspans[r][c] + '"' : '';
                tbHtml += '<td class="border border-emerald-200 p-2 text-sm text-gray-700 min-w-[80px] table-edit-cell cursor-pointer transition" contenteditable="true" data-row="' + r + '" data-col="' + c + '"' + cs + _cellStyle(r, c) + _cellData(r, c) + '>' + (rows[r] && rows[r][c] ? this.escapeHtml(rows[r][c]) : '') + '</td>';
            }
            tbHtml += '</tr>';
        }
        if (rows.length <= 1) {
            tbHtml += '<tr>';
            for (let c = 0; c < headerLen; c++) {
                tbHtml += '<td class="border border-emerald-200 p-2 text-sm text-gray-700 min-w-[80px] table-edit-cell cursor-pointer transition" contenteditable="true" data-row="1" data-col="' + c + '"></td>';
            }
            tbHtml += '</tr>';
        }
        tbHtml += '</tbody></table></div>';
        tbHtml += '<div class="flex flex-wrap gap-1 mt-1"><button onclick="app._tableAddRow(\'' + tId + '\')" class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs hover:bg-emerald-200 transition"><i class="fa-solid fa-plus mr-1"></i>行</button><button onclick="app._tableRemoveRow(\'' + tId + '\')" class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 transition"><i class="fa-solid fa-minus mr-1"></i>行</button><button onclick="app._tableAddCol(\'' + tId + '\')" class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs hover:bg-emerald-200 transition"><i class="fa-solid fa-plus mr-1"></i>列</button><button onclick="app._tableRemoveCol(\'' + tId + '\')" class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 transition"><i class="fa-solid fa-minus mr-1"></i>列</button><button onclick="app._tableMergeCells(\'' + tId + '\')" class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200 transition"><i class="fa-solid fa-object-group mr-1"></i>合并</button><button onclick="app._tableSplitCell(\'' + tId + '\')" class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs hover:bg-amber-200 transition"><i class="fa-solid fa-object-ungroup mr-1"></i>拆分</button><span class="w-px h-4 bg-gray-300 mx-1 self-center"></span><button onclick="app._tableAlign(\'' + tId + '\', \'left\')" class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 transition" title="左对齐"><i class="fa-solid fa-align-left"></i></button><button onclick="app._tableAlign(\'' + tId + '\', \'center\')" class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 transition" title="居中"><i class="fa-solid fa-align-center"></i></button><button onclick="app._tableAlign(\'' + tId + '\', \'right\')" class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 transition" title="右对齐"><i class="fa-solid fa-align-right"></i></button><button onclick="app._tableStylePicker(\'' + tId + '\')" class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200 transition" title="单元格样式"><i class="fa-solid fa-palette mr-1"></i>样式</button></div>';
        tbHtml += '</div>';
        div.innerHTML = tbHtml;
        // 【修复】通过事件委托绑定单元格选择，避免onmousedown与contenteditable冲突
        const tblEl = div.querySelector('table');
        if (tblEl) {
            tblEl.addEventListener('mousedown', function(e) {
                const cell = e.target.closest('th.table-edit-cell, td.table-edit-cell');
                if (!cell) return;
                app._tableCellClick(e, cell);
            });
        }
    }

    // 删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition shadow-sm z-10';
    deleteBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
    deleteBtn.onclick = () => {
        div.remove();
        this.editState.hasChanges = true;
    };

    div.appendChild(deleteBtn);
    return div;
};

// 辅助：更新 block 索引（用于删除后重新排序）
function updateBlockIndices(container) {
    container.querySelectorAll(':scope > div').forEach((div, idx) => {
        div.dataset.index = idx;
    });
}

app.addBlock = function(type) {
    const container = app.$e('edit-blocks-container');
    if (!container) return;

    // 【修复5】容器为空时，直接追加新块（不依赖_lastFocusedBlock）
    const isEmpty = container.children.length === 0;

    // 使用保存的最后聚焦块来定位
    let insertIndex = container.children.length; // 默认末尾
    let insertBeforeNode = null;
    let currentBlock = app._lastFocusedBlock;

    // 如果保存的块不在当前容器中（可能已被删除），回退到 activeElement
    if (!currentBlock || !container.contains(currentBlock)) {
        const activeEl = document.activeElement;
        if (activeEl && container.contains(activeEl)) {
            currentBlock = activeEl.closest('.edit-block-item');
        }
    }

    if (currentBlock) {
        // 在该块之后插入
        insertBeforeNode = currentBlock.nextElementSibling;
        insertIndex = parseInt(currentBlock.dataset.index) + 1;
    } else if (isEmpty) {
        // 【修复】空容器时，插入到位置0
        insertIndex = 0;
    }

    // 创建新块
    const newBlockData = type === 'table' ? { type, rows: [['', ''], ['', '']] } : { type, text: '' };
    const newDiv = this.createEditBlock(container, newBlockData, insertIndex);

    // 在正确位置插入 DOM
    if (insertBeforeNode && insertBeforeNode.parentNode === container) {
        container.insertBefore(newDiv, insertBeforeNode);
    } else {
        container.appendChild(newDiv);
    }

    // 更新所有块的 data-index
    updateBlockIndices(container);

    // 更新内存中的blocks数据（确保保存时能收集到新块）
    if (!this.tempVersion.blocks) this.tempVersion.blocks = [];
    // 找到正确的插入位置
    const blockInsertIdx = isEmpty ? 0 : (currentBlock ? (parseInt(currentBlock.dataset.index) + 1) : this.tempVersion.blocks.length);
    this.tempVersion.blocks.splice(blockInsertIdx, 0, newBlockData);

    // 自动聚焦新创建的输入元素
    setTimeout(() => {
        const input = newDiv.querySelector('.block-input[contenteditable="true"]') ||
                      newDiv.querySelector('textarea.block-input');
        if (input) {
            input.focus();
            // 将光标移到末尾
            if (input.contentEditable === 'true') {
                const range = document.createRange();
                range.selectNodeContents(input);
                range.collapse(false);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
            // 聚焦后更新定位信息
            app._lastFocusedBlock = newDiv;
            if (input.contentEditable === 'true') {
                app._currentEditor = input;
                app._savedEditor = input;
            } else {
                app.lastFocusedTextarea = input;
                app._currentEditor = null;
            }
        }
    }, 10);

    this.editState.hasChanges = true;
    if (app.scheduleAutoSave) app.scheduleAutoSave(400);
};

// 【修复】deleteBlock 和 moveBlock 函数（被 img/table block HTML 引用但从未定义）
app.deleteBlock = function(index) {
    const container = app.$e('edit-blocks-container');
    if (!container) return;
    const blocks = container.querySelectorAll(':scope > .edit-block-item');
    const target = blocks[index];
    if (target) {
        target.remove();
        updateBlockIndices(container);
        // 同步更新内存数据
        if (this.tempVersion.blocks && this.tempVersion.blocks[index] !== undefined) {
            this.tempVersion.blocks.splice(index, 1);
        }
        this.editState.hasChanges = true;
        if (app.scheduleAutoSave) app.scheduleAutoSave(400);
    }
};
app.moveBlock = function(index, direction) {
    const container = app.$e('edit-blocks-container');
    if (!container) return;
    const blocks = Array.from(container.querySelectorAll(':scope > .edit-block-item'));
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= blocks.length) return;
    // DOM 交换
    const target = blocks[index];
    const sibling = blocks[newIndex];
    if (direction === -1) {
        container.insertBefore(target, sibling);
    } else {
        container.insertBefore(target, sibling.nextElementSibling);
    }
    updateBlockIndices(container);
    // 同步更新内存数据
    if (this.tempVersion.blocks && this.tempVersion.blocks.length > index && this.tempVersion.blocks.length > newIndex) {
        const temp = this.tempVersion.blocks[index];
        this.tempVersion.blocks[index] = this.tempVersion.blocks[newIndex];
        this.tempVersion.blocks[newIndex] = temp;
    }
    this.editState.hasChanges = true;
    if (app.scheduleAutoSave) app.scheduleAutoSave(400);
};

// 【新增】表格元件操作函数
app._tableLastSelectedCell = null;
app._tableCellClick = function(event, cell) {
    const tbl = cell.closest('table');
    if (!tbl) return;
    const isCtrl = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    // 【关键修复】只在多选模式下阻止contenteditable默认行为，普通点击允许聚焦输入
    if (isShift || isCtrl) {
        event.preventDefault();
        event.stopPropagation();
    }
    // 获取所有可见单元格（排除被rowspan/colspan覆盖后已移除的）
    const getAllCells = () => Array.from(tbl.querySelectorAll('th.table-edit-cell, td.table-edit-cell'));
    if (isShift && this._tableLastSelectedCell && this._tableLastSelectedCell.closest('table') === tbl) {
        // Shift+点击：范围选择（仅限同行或同列）
        const lastRow = this._tableLastSelectedCell.parentElement;
        const curRow = cell.parentElement;
        const lastCol = parseInt(this._tableLastSelectedCell.dataset.col);
        const curCol = parseInt(cell.dataset.col);
        getAllCells().forEach(c => c.classList.remove('table-cell-selected'));
        if (lastRow === curRow) {
            // 同行范围选
            const minC = Math.min(lastCol, curCol);
            const maxC = Math.max(lastCol, curCol);
            lastRow.querySelectorAll('th.table-edit-cell, td.table-edit-cell').forEach(c => {
                const cc = parseInt(c.dataset.col);
                if (cc >= minC && cc <= maxC) c.classList.add('table-cell-selected');
            });
        } else if (lastCol === curCol) {
            // 同列范围选
            const rows = Array.from(tbl.querySelectorAll('tbody tr, thead tr'));
            const minR = Math.min(rows.indexOf(lastRow), rows.indexOf(curRow));
            const maxR = Math.max(rows.indexOf(lastRow), rows.indexOf(curRow));
            for (let r = minR; r <= maxR; r++) {
                const c = rows[r].querySelector('th[data-col="' + lastCol + '"], td[data-col="' + lastCol + '"]');
                if (c) c.classList.add('table-cell-selected');
            }
        } else {
            // 不同行不同列：只选这两个
            this._tableLastSelectedCell.classList.add('table-cell-selected');
            cell.classList.add('table-cell-selected');
        }
    } else if (isCtrl) {
        // Ctrl+点击：切换选择
        cell.classList.toggle('table-cell-selected');
        this._tableLastSelectedCell = cell;
    } else {
        // 普通点击：单选
        getAllCells().forEach(c => c.classList.remove('table-cell-selected'));
        cell.classList.add('table-cell-selected');
        this._tableLastSelectedCell = cell;
    }
};
app._tableAddRow = function(tId) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    const tbody = tbl.querySelector('tbody');
    const colCount = tbl.querySelectorAll('thead th').length;
    const newRow = document.createElement('tr');
    const rowIdx = tbody.children.length + 1;
    for (let c = 0; c < colCount; c++) {
        const td = document.createElement('td');
        td.className = 'border border-emerald-200 p-2 text-sm text-gray-700 min-w-[80px] table-edit-cell cursor-pointer transition';
        td.contentEditable = true;
        td.dataset.row = rowIdx;
        td.dataset.col = c;
        newRow.appendChild(td);
    }
    tbody.appendChild(newRow);
    this.editState.hasChanges = true;
};
app._tableRemoveRow = function(tId) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    const tbody = tbl.querySelector('tbody');
    if (tbody.children.length > 1) tbody.removeChild(tbody.lastElementChild);
    else this.showToast('表格至少需要一行', 'info');
    this.editState.hasChanges = true;
};
app._tableAddCol = function(tId) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    const headerRow = tbl.querySelector('thead tr');
    const newTh = document.createElement('th');
    newTh.className = 'border border-emerald-200 p-2 text-xs text-emerald-700 font-semibold min-w-[80px] table-edit-cell cursor-pointer transition';
    newTh.contentEditable = true;
    newTh.dataset.col = headerRow.children.length;
    headerRow.appendChild(newTh);
    tbl.querySelectorAll('tbody tr').forEach((tr, rIdx) => {
        const td = document.createElement('td');
        td.className = 'border border-emerald-200 p-2 text-sm text-gray-700 min-w-[80px] table-edit-cell cursor-pointer transition';
        td.contentEditable = true;
        td.dataset.row = rIdx + 1;
        td.dataset.col = headerRow.children.length - 1;
        tr.appendChild(td);
    });
    this.editState.hasChanges = true;
};
app._tableRemoveCol = function(tId) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    const headerRow = tbl.querySelector('thead tr');
    if (headerRow.children.length > 1) {
        headerRow.removeChild(headerRow.lastElementChild);
        tbl.querySelectorAll('tbody tr').forEach(tr => { if (tr.children.length > 1) tr.removeChild(tr.lastElementChild); });
    } else this.showToast('表格至少需要一列', 'info');
    this.editState.hasChanges = true;
};
app._tableMergeCells = function(tId) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    const selected = Array.from(tbl.querySelectorAll('th.table-cell-selected, td.table-cell-selected'));
    if (selected.length < 2) { this.showToast('请按住 Shift 或 Ctrl 选中至少两个单元格', 'info'); return; }
    const rowSet = new Set(selected.map(c => c.parentElement));
    const colSet = new Set(selected.map(c => parseInt(c.dataset.col)));
    if (rowSet.size > 1 && colSet.size > 1) { this.showToast('仅支持合并同行或同列的单元格', 'info'); selected.forEach(c => c.classList.remove('table-cell-selected')); return; }
    const first = selected[0];
    const mergedText = selected.map(c => c.textContent.trim()).filter(t => t).join(' ');
    if (rowSet.size === 1) {
        // 同行合并：colspan
        first.colSpan = selected.length;
    } else {
        // 同列合并：rowspan
        first.rowSpan = selected.length;
    }
    first.textContent = mergedText;
    first.classList.remove('table-cell-selected');
    // 【修复】被合并单元格标记为data-merged并隐藏，保存时跳过
    selected.slice(1).forEach(c => {
        c.classList.remove('table-cell-selected');
        c.dataset.merged = '1';
        c.style.display = 'none';
        c.contentEditable = false;
    });
    this.editState.hasChanges = true;
};
app._tableAlign = function(tId, align) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    const selected = Array.from(tbl.querySelectorAll('th.table-cell-selected, td.table-cell-selected'));
    if (selected.length === 0) { this.showToast('请先选中单元格', 'info'); return; }
    const ta = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    selected.forEach(c => {
        c.style.textAlign = ta;
        c.dataset.align = ta;
        c.classList.remove('table-cell-selected');
    });
    this.editState.hasChanges = true;
};
app._tableStylePicker = function(tId) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    const selected = Array.from(tbl.querySelectorAll('th.table-cell-selected, td.table-cell-selected'));
    if (selected.length === 0) { this.showToast('请先选中单元格', 'info'); return; }
    // 创建颜色选择弹窗
    const existing = document.getElementById('table-style-picker');
    if (existing) existing.remove();
    const picker = document.createElement('div');
    picker.id = 'table-style-picker';
    picker.className = 'fixed inset-0 bg-black/30 z-[10001] flex items-center justify-center';
    picker.innerHTML = '<div class="bg-white rounded-xl shadow-xl p-6 max-w-xs w-full"><h4 class="text-sm font-bold text-gray-800 mb-4">单元格样式</h4><div class="mb-4"><label class="text-xs text-gray-500 block mb-1">文字颜色</label><div class="flex gap-2 flex-wrap" id="tp-text-colors"></div></div><div class="mb-4"><label class="text-xs text-gray-500 block mb-1">背景颜色</label><div class="flex gap-2 flex-wrap" id="tp-bg-colors"></div></div><div class="flex gap-2"><button id="tp-apply" class="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">应用</button><button id="tp-cancel" class="flex-1 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">取消</button></div></div>';
    document.body.appendChild(picker);
    // 颜色选项
    const colors = [
        { name: '默认', val: '' },
        { name: '红', val: '#ef4444' }, { name: '橙', val: '#f97316' },
        { name: '黄', val: '#eab308' }, { name: '绿', val: '#22c55e' },
        { name: '青', val: '#06b6d4' }, { name: '蓝', val: '#3b82f6' },
        { name: '紫', val: '#a855f7' }, { name: '粉', val: '#ec4899' },
        { name: '灰', val: '#6b7280' }, { name: '黑', val: '#111827' },
    ];
    const bgColors = [
        { name: '默认', val: '' },
        { name: '浅红', val: '#fef2f2' }, { name: '浅橙', val: '#fff7ed' },
        { name: '浅黄', val: '#fefce8' }, { name: '浅绿', val: '#f0fdf4' },
        { name: '浅青', val: '#ecfeff' }, { name: '浅蓝', val: '#eff6ff' },
        { name: '浅紫', val: '#faf5ff' }, { name: '浅粉', val: '#fdf2f8' },
        { name: '浅灰', val: '#f9fafb' }, { name: '白', val: '#ffffff' },
    ];
    const makeDot = (c, containerId, name) => {
        const dot = document.createElement('button');
        dot.className = 'w-6 h-6 rounded-full border border-gray-200 flex-shrink-0 hover:scale-110 transition';
        if (c.val) dot.style.background = c.val;
        else dot.style.background = name === 'bg' ? '#ffffff' : '#374151';
        dot.title = c.name;
        dot.onclick = () => {
            containerId.querySelectorAll('.ring-2').forEach(b => b.classList.remove('ring-2', 'ring-offset-1', 'ring-indigo-500'));
            dot.classList.add('ring-2', 'ring-offset-1', 'ring-indigo-500');
            dot.dataset.selected = c.val;
        };
        return dot;
    };
    const tcContainer = picker.querySelector('#tp-text-colors');
    const bgContainer = picker.querySelector('#tp-bg-colors');
    colors.forEach(c => tcContainer.appendChild(makeDot(c, tcContainer, 'text')));
    bgColors.forEach(c => bgContainer.appendChild(makeDot(c, bgContainer, 'bg')));
    // 默认选中第一个
    picker.querySelector('#tp-text-colors button').classList.add('ring-2', 'ring-offset-1', 'ring-indigo-500');
    picker.querySelector('#tp-bg-colors button').classList.add('ring-2', 'ring-offset-1', 'ring-indigo-500');
    picker.querySelector('#tp-cancel').onclick = () => picker.remove();
    picker.querySelector('#tp-apply').onclick = () => {
        const textColor = (picker.querySelector('#tp-text-colors button.ring-2') || {}).dataset.selected || '';
        const bgColor = (picker.querySelector('#tp-bg-colors button.ring-2') || {}).dataset.selected || '';
        selected.forEach(c => {
            if (textColor) { c.style.color = textColor; c.dataset.textColor = textColor; }
            else { c.style.color = ''; delete c.dataset.textColor; }
            if (bgColor) { c.style.backgroundColor = bgColor; c.dataset.bgColor = bgColor; }
            else { c.style.backgroundColor = ''; delete c.dataset.bgColor; }
            c.classList.remove('table-cell-selected');
        });
        this.editState.hasChanges = true;
        picker.remove();
    };
    picker.onclick = (e) => { if (e.target === picker) picker.remove(); };
};
app._tableSplitCell = function(tId) {
    const tbl = document.getElementById(tId);
    if (!tbl) return;
    // 查找有colspan或rowspan的选中单元格
    let targetCell = Array.from(tbl.querySelectorAll('th.table-cell-selected, td.table-cell-selected')).find(c => c.colSpan > 1 || c.rowSpan > 1);
    if (!targetCell) targetCell = document.activeElement && (document.activeElement.colSpan > 1 || document.activeElement.rowSpan > 1) ? document.activeElement : null;
    if (!targetCell) { this.showToast('请选中一个已合并的单元格', 'info'); return; }
    const originalSpan = targetCell.colSpan > 1 ? targetCell.colSpan : targetCell.rowSpan;
    const isCol = targetCell.colSpan > 1;
    const tagName = targetCell.tagName.toLowerCase();
    // 在被合并单元格之后重新插入被移除的单元格
    for (let i = 1; i < originalSpan; i++) {
        const newCell = document.createElement(tagName);
        newCell.className = targetCell.className.replace('table-cell-selected', '').trim();
        newCell.contentEditable = true;
        newCell.dataset.col = isCol ? (parseInt(targetCell.dataset.col) + i) : targetCell.dataset.col;
        newCell.dataset.row = targetCell.dataset.row;
        targetCell.parentNode.insertBefore(newCell, targetCell.nextSibling);
    }
    if (isCol) targetCell.colSpan = 1; else targetCell.rowSpan = 1;
    targetCell.classList.remove('table-cell-selected');
    // 【修复】恢复被隐藏的合并单元格
    const row = targetCell.parentElement;
    if (row) {
        row.querySelectorAll('[data-merged="1"]').forEach(c => {
            delete c.dataset.merged;
            c.style.display = '';
            c.contentEditable = true;
        });
    }
    this.editState.hasChanges = true;
};

// 【新增】外链输入弹窗 — 完全按照内链 insertLink 的逻辑：保存光标位置 → 弹窗 → 恢复位置插入 a 标签 DOM 节点
app.showExternalLinkDialog = function() {
    const editor = app._currentEditor || document.querySelector('#edit-blocks-container div[contenteditable="true"]');
    if (!editor) {
        app.showToast('请先点击正文编辑框定位光标', 'warning');
        return;
    }

    // 【关键】保存选区到编辑器元素的自定义属性（与内链 insertLink 完全一致）
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const r = sel.getRangeAt(0);
        try {
            editor.dataset.savedStart = r.startOffset;
            editor.dataset.savedEnd = r.endOffset;
            const startNode = r.startContainer;
            if (startNode.nodeType === Node.TEXT_NODE && startNode.parentNode === editor) {
                const idx = Array.from(editor.childNodes).indexOf(startNode);
                editor.dataset.savedNodeIdx = idx;
            } else if (startNode.nodeType === Node.TEXT_NODE) {
                const idx = Array.from(editor.childNodes).indexOf(startNode);
                if (idx === -1) {
                    editor.dataset.savedNodeIdx = Array.from(editor.childNodes).indexOf(startNode.parentNode);
                } else {
                    editor.dataset.savedNodeIdx = idx;
                }
            } else {
                editor.dataset.savedNodeIdx = 0;
            }
        } catch(e) {
            editor.dataset.savedNodeIdx = -1;
        }
    } else {
        editor.dataset.savedNodeIdx = -1;
    }

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[10001] flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl max-w-sm w-full">
            <div class="flex items-center justify-between p-4 border-b">
                <h3 class="font-bold text-gray-800"><i class="fa-solid fa-link text-purple-600 mr-2"></i>添加外链</h3>
                <button class="close-modal text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="p-4 space-y-3">
                <div>
                    <label class="text-xs text-gray-500 mb-1 block">链接地址（URL）</label>
                    <input type="text" id="ext-link-url" placeholder="https://example.com" 
                        class="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none">
                </div>
                <div>
                    <label class="text-xs text-gray-500 mb-1 block">显示文本（可选，留空使用URL）</label>
                    <input type="text" id="ext-link-text" placeholder="点击显示的文本" 
                        class="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none">
                </div>
            </div>
            <div class="p-4 border-t flex gap-2 justify-end">
                <button class="close-modal px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition">取消</button>
                <button id="ext-link-confirm" class="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition font-medium">确定</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const cleanup = () => {
        delete editor.dataset.savedNodeIdx;
        delete editor.dataset.savedStart;
        delete editor.dataset.savedEnd;
        modal.remove();
    };

    modal.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = cleanup;
    });
    modal.onclick = (e) => { if (e.target === modal) cleanup(); };

    modal.querySelector('#ext-link-confirm').onclick = () => {
        const url = modal.querySelector('#ext-link-url').value.trim();
        const text = modal.querySelector('#ext-link-text').value.trim();
        if (!url) { app.showToast('请输入链接地址', 'error'); return; }
        let finalUrl = url;
        if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) {
            finalUrl = 'https://' + url;
        }
        const displayText = text || finalUrl;

        // 【核心】直接创建带样式的 a 标签 DOM 节点（与内链 insertLink 完全一致）
        const a = document.createElement('a');
        a.href = finalUrl;
        a.className = 'entry-external-link';
        a.dataset.externalUrl = finalUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        // 使用 innerHTML 插入图标 + 文本，确保与 markdownToHtml 渲染输出一致
        a.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square text-xs mr-1" style="color:#a855f7;"></i>' + displayText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // 恢复焦点
        editor.focus();

        // 读取保存的插入位置
        const savedIdx = parseInt(editor.dataset.savedNodeIdx || '-1', 10);
        const savedStart = parseInt(editor.dataset.savedStart || '0', 10);

        // 清理保存的数据
        delete editor.dataset.savedNodeIdx;
        delete editor.dataset.savedStart;
        delete editor.dataset.savedEnd;

        let inserted = false;

        if (savedIdx >= 0 && editor.childNodes[savedIdx]) {
            try {
                const targetNode = editor.childNodes[savedIdx];
                if (targetNode.nodeType === Node.TEXT_NODE) {
                    const txt = targetNode.textContent;
                    let beforeText = txt.substring(0, savedStart);
                    let afterText = txt.substring(savedStart);

                    // 【关键修复】检测并修复被分割的 Markdown 标记
                    // 如果 beforeText 末尾有未闭合的标记，且 afterText 开头有对应标记
                    // 则在链接文本中补上标记，确保保存时 Markdown 格式正确
                    const mdMarkers = [
                        { open: '**', close: '**', wrap: '**' },
                        { open: '*', close: '*', wrap: '*' },
                        { open: '~~', close: '~~', wrap: '~~' },
                        { open: '__', close: '__', wrap: '__' }
                    ];
                    let prefix = '', suffix = '';
                    for (const m of mdMarkers) {
                        if (beforeText.endsWith(m.open) && afterText.startsWith(m.close)) {
                            prefix = m.wrap;
                            suffix = m.wrap;
                            // 从 beforeText/afterText 中移除已使用的标记
                            beforeText = beforeText.slice(0, -m.open.length);
                            afterText = afterText.slice(m.close.length);
                            break;
                        }
                    }

                    const fragment = document.createDocumentFragment();
                    if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
                    if (prefix) {
                        // 将标记和链接文本合并为一个文本节点，再跟 a 标签
                        // 这样保存时 htmlToMarkdown 能正确处理
                        const wrapperText = document.createTextNode(prefix);
                        fragment.appendChild(wrapperText);
                    }
                    fragment.appendChild(a);
                    if (suffix) {
                        const wrapperText = document.createTextNode(suffix);
                        fragment.appendChild(wrapperText);
                    }
                    if (afterText) fragment.appendChild(document.createTextNode(afterText));
                    editor.replaceChild(fragment, targetNode);
                    inserted = true;
                } else {
                    if (targetNode.nextSibling) {
                        editor.insertBefore(a, targetNode.nextSibling);
                    } else {
                        editor.appendChild(a);
                    }
                    inserted = true;
                }
            } catch(e) {
                console.warn('[ExternalLink] 精确插入失败，降级:', e);
            }
        }

        if (!inserted) {
            editor.appendChild(a);
        }

        app.editState.hasChanges = true;
        app.showToast('已插入外链', 'success');
        modal.remove();
    };

    modal.querySelector('#ext-link-url').focus();
};

// ==================== 元件排序窗口 ====================

app.showBlockSorter = function() {
    const container = app.$e('edit-blocks-container');
    if (!container || container.children.length === 0) {
        this.showToast('没有可排序的元件', 'info');
        return;
    }

    // 收集当前所有元件数据
    const items = [];
    container.querySelectorAll(':scope > .edit-block-item').forEach((div, idx) => {
        const type = div.dataset.type;
        let preview = '';
        if (type === 'p') {
            const editor = div.querySelector('.block-input[contenteditable="true"]');
            preview = editor ? (editor.innerText || '').substring(0, 60) : '';
        } else if (type === 'h2' || type === 'h3') {
            const textarea = div.querySelector('textarea.block-input');
            preview = textarea ? (textarea.value || '').substring(0, 60) : '';
        } else if (type === 'img') {
            preview = '[图片]';
        } else if (type === 'table') {
            preview = '[表格]';
        }
        if (preview.length > 60) preview += '...';
        if (!preview) preview = '(空)';

        const typeLabel = type === 'h2' ? '二级标题' : type === 'h3' ? '小标题' : type === 'img' ? '图片' : type === 'table' ? '表格' : '正文';
        const typeIcon = type === 'h2' ? 'fa-heading' : type === 'h3' ? 'fa-tag' : type === 'img' ? 'fa-image' : type === 'table' ? 'fa-table' : 'fa-paragraph';
        const typeColor = type === 'h2' ? 'text-indigo-600' : type === 'h3' ? 'text-purple-600' : type === 'img' ? 'text-rose-500' : type === 'table' ? 'text-emerald-600' : 'text-gray-500';

        items.push({ div, type, typeLabel, typeIcon, typeColor, preview, originalIndex: idx });
    });

    // 创建弹窗
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
    modal.id = 'block-sorter-modal';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-lg text-gray-800">排序元件</h3>
                    <p class="text-xs text-gray-500">拖拽或使用上下按钮调整顺序</p>
                </div>
                <button onclick="document.getElementById('block-sorter-modal').remove()" class="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 transition">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div id="sorter-list" class="flex-1 overflow-y-auto p-3 space-y-1"></div>
            <div class="p-4 border-t bg-gray-50 flex justify-end gap-2">
                <button id="sorter-cancel" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition text-sm">取消</button>
                <button id="sorter-confirm" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition text-sm">
                    <i class="fa-solid fa-check mr-1"></i>确认
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const listEl = modal.querySelector('#sorter-list');
    let draggedItem = null;

    // 渲染列表项
    function renderSorterList() {
        listEl.innerHTML = '';
        items.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'sorter-item flex items-center gap-2 p-2 bg-white border border-gray-200 rounded-lg hover:border-indigo-300 transition cursor-move select-none';
            row.draggable = true;
            row.dataset.index = idx;
            row.innerHTML = `
                <span class="text-gray-300 text-xs w-5 text-center font-mono">${idx + 1}</span>
                <i class="fa-solid ${item.typeIcon} ${item.typeColor} text-xs w-4"></i>
                <span class="text-xs font-medium ${item.typeColor} w-14 shrink-0">${item.typeLabel}</span>
                <span class="text-sm text-gray-600 truncate flex-1">${app.escapeHtml ? app.escapeHtml(item.preview) : item.preview}</span>
                <div class="flex flex-col gap-0.5">
                    <button class="sorter-up w-6 h-5 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition" ${idx === 0 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                        <i class="fa-solid fa-chevron-up text-[10px]"></i>
                    </button>
                    <button class="sorter-down w-6 h-5 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition" ${idx === items.length - 1 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
                        <i class="fa-solid fa-chevron-down text-[10px]"></i>
                    </button>
                </div>
            `;

            // 上移按钮
            row.querySelector('.sorter-up').onclick = (e) => {
                e.stopPropagation();
                if (idx > 0) {
                    [items[idx], items[idx - 1]] = [items[idx - 1], items[idx]];
                    renderSorterList();
                }
            };

            // 下移按钮
            row.querySelector('.sorter-down').onclick = (e) => {
                e.stopPropagation();
                if (idx < items.length - 1) {
                    [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
                    renderSorterList();
                }
            };

            // 拖拽事件
            row.addEventListener('dragstart', (e) => {
                draggedItem = idx;
                row.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
            });
            row.addEventListener('dragend', () => {
                draggedItem = null;
                row.style.opacity = '1';
                document.querySelectorAll('.sorter-item').forEach(el => el.classList.remove('border-indigo-500', 'bg-indigo-50'));
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedItem !== null && draggedItem !== idx) {
                    row.classList.add('border-indigo-500', 'bg-indigo-50');
                }
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('border-indigo-500', 'bg-indigo-50');
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedItem !== null && draggedItem !== idx) {
                    const moved = items.splice(draggedItem, 1)[0];
                    items.splice(idx, 0, moved);
                    renderSorterList();
                }
            });

            listEl.appendChild(row);
        });
    }

    renderSorterList();

    // 取消按钮
    modal.querySelector('#sorter-cancel').onclick = () => modal.remove();

    // 确认按钮
    modal.querySelector('#sorter-confirm').onclick = () => {
        // 按照 items 的新顺序重新排列 DOM
        items.forEach(item => {
            container.appendChild(item.div);
        });

        // 更新所有 data-index
        updateBlockIndices(container);

        // 标记有变更
        this.editState.hasChanges = true;

        modal.remove();
        this.showToast('元件顺序已更新', 'success');
    };

    // 点击遮罩关闭
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};

app.insertSynopsisRef = function() {
    const editor = app._savedEditor;
    const savedRange = app._savedRange;
    
    if (!editor) {
        alert('请先点击正文编辑框定位光标位置');
        return;
    }
    
    // 保存选区克隆
    const rangeToRestore = savedRange ? savedRange.cloneRange() : null;
    
    this.showSynopsisChapterSelect((chapter) => {
        if (!chapter) return;
        
        // 恢复焦点和选区
        editor.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        
        if (rangeToRestore) {
            sel.addRange(rangeToRestore);
        }
        
        // 【关键】插入符合悬停逻辑的 HTML 结构
        // 必须包含 class="synopsis-entry-ref" 和 data-chapter-id 属性
        const html = `<span class="synopsis-entry-ref" data-chapter-id="${chapter.id}" contenteditable="false">@${chapter.title}&nbsp;</span>`;
        
        document.execCommand('insertHTML', false, html);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

app.showSynopsisChapterSelect = function(callback) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col">
            <div class="p-4 border-b bg-gray-50 rounded-t-xl flex justify-between items-center">
                <h3 class="font-bold text-lg">引用剧情章节</h3>
                <button class="close-btn text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="p-4">
                <input type="text" id="chapter-search" placeholder="搜索章节标题或编号..." 
                    class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-3 focus:ring-2 focus:ring-indigo-500 outline-none">
                <div id="chapter-list" class="space-y-1 max-h-[40vh] overflow-y-auto"></div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const renderList = (filter = '') => {
        const list = modal.querySelector('#chapter-list');
        list.innerHTML = '';
        
        const sorted = [...this.data.synopsis].sort((a, b) => {
            const orderA = this.data.chapters.find(c => c.id === a.chapterId)?.order || 0;
            const orderB = this.data.chapters.find(c => c.id === b.chapterId)?.order || 0;
            return orderA - orderB;
        });
        
        sorted.forEach(ch => {
            if (filter && !ch.title.includes(filter) && !String(ch.num).includes(filter)) return;
            
            const div = document.createElement('div');
            div.className = 'p-2 hover:bg-indigo-50 cursor-pointer rounded flex items-center gap-2 border-b border-gray-100 last:border-0';
            div.innerHTML = `
                <span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs">${this.formatChapterNum(ch.num)}</span>
                <span class="text-sm">${ch.title}</span>
            `;
            div.onclick = () => {
                callback(ch);
                modal.remove();
            };
            list.appendChild(div);
        });
    };
    
    renderList();
    const searchInput = modal.querySelector('#chapter-search');
    searchInput.oninput = (e) => renderList(e.target.value);
    searchInput.focus();
    
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
};

// ============================================
// 代码块 3: wiki-features-edit.js - insertLink 函数修改
// 简化实现，依赖 execCommand 自动处理选区
// ============================================

// 修改 insertLink 函数
app.insertLink = function() {
    const editor = app._currentEditor || document.querySelector('#edit-blocks-container div[contenteditable="true"]');
    if (!editor) {
        app.showToast('\u8bf7\u5148\u70b9\u51fb\u6b63\u6587\u7f16\u8f91\u6846', 'warning');
        return;
    }

    // 【关键】保存选区到编辑器元素的自定义属性（比 JS 变量更持久）
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const r = sel.getRangeAt(0);
        try {
            editor.dataset.savedStart = r.startOffset;
            editor.dataset.savedEnd = r.endOffset;
            const startNode = r.startContainer;
            // 如果是文本节点，记录其相对于父元素的索引
            if (startNode.nodeType === Node.TEXT_NODE && startNode.parentNode === editor) {
                const idx = Array.from(editor.childNodes).indexOf(startNode);
                editor.dataset.savedNodeIdx = idx;
            } else if (startNode.nodeType === Node.TEXT_NODE) {
                const idx = Array.from(editor.childNodes).indexOf(startNode);
                if (idx === -1) {
                    // 文本节点在更深层，使用简单路径
                    editor.dataset.savedNodeIdx = Array.from(editor.childNodes).indexOf(startNode.parentNode);
                } else {
                    editor.dataset.savedNodeIdx = idx;
                }
            } else {
                editor.dataset.savedNodeIdx = 0;
            }
        } catch(e) {
            editor.dataset.savedNodeIdx = -1; // 标记为使用末尾
        }
    } else {
        editor.dataset.savedNodeIdx = -1; // 标记为使用末尾
    }

    this.showEntrySelectForLink((entry, version, customText) => {
        if (!entry || !version) {
            app.showToast('\u9009\u62e9\u88ab\u53d6\u6d88', 'warning');
            delete editor.dataset.savedNodeIdx;
            delete editor.dataset.savedStart;
            delete editor.dataset.savedEnd;
            return;
        }

        const entryId = String(entry.id || '');
        const versionId = String(version.vid || '');
        const displayText = String(customText || version.title || '\u672a\u547d\u540d');

        if (!entryId || !versionId) {
            app.showToast('\u9519\u8bef\uff1aID\u7f3a\u5931', 'error');
            return;
        }

        // 【核心】直接创建 DOM 节点（a 标签，htmlToMarkdown 可识别保存）
        const a = document.createElement('a');
        a.href = 'javascript:void(0)';
        a.className = 'entry-index-link';
        a.dataset.entryId = entryId;
        a.dataset.versionId = versionId;
        a.textContent = displayText; // 自动处理 HTML 实体转义

        // 直接绑定点击事件
        a.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            app.openEntryWithVersion(entryId, versionId);
        };

        // 恢复焦点
        editor.focus();

        // 读取保存的插入位置
        const savedIdx = parseInt(editor.dataset.savedNodeIdx || '-1', 10);
        const savedStart = parseInt(editor.dataset.savedStart || '0', 10);

        // 清理保存的数据
        delete editor.dataset.savedNodeIdx;
        delete editor.dataset.savedStart;
        delete editor.dataset.savedEnd;

        let inserted = false;

        if (savedIdx >= 0 && editor.childNodes[savedIdx]) {
            // 在保存的节点位置插入
            try {
                const targetNode = editor.childNodes[savedIdx];
                if (targetNode.nodeType === Node.TEXT_NODE) {
                    // 在文本节点的指定偏移处分割并插入
                    const text = targetNode.textContent;
                    const beforeText = text.substring(0, savedStart);
                    const afterText = text.substring(savedStart);

                    // 替换原文本节点为：前文本 + a + 后文本
                    const fragment = document.createDocumentFragment();
                    if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
                    fragment.appendChild(a);
                    if (afterText) fragment.appendChild(document.createTextNode(afterText));

                    editor.replaceChild(fragment, targetNode);
                    inserted = true;
                } else {
                    // 在元素节点后插入
                    if (targetNode.nextSibling) {
                        editor.insertBefore(a, targetNode.nextSibling);
                    } else {
                        editor.appendChild(a);
                    }
                    inserted = true;
                }
            } catch(e) {
                console.warn('\u7cbe\u786e\u63d2\u5165\u5931\u8d25\uff0c\u964d\u7ea7:', e);
            }
        }

        if (!inserted) {
            // 降级：追加到编辑器末尾
            editor.appendChild(a);
        }

        app.editState.hasChanges = true;
        app.showToast(`\u5df2\u63d2\u5165\u94fe\u63a5: ${displayText}`, 'success');
    });
};
app.formatText = function(command) {
    // 【新增】处理 contenteditable 编辑器（正文段落）
    if (app._currentEditor) {
        app._currentEditor.focus();
        const sel = window.getSelection();
        if (!sel.toString()) {
            app.showToast('请先选中要格式化的文字', 'warning');
            return;
        }
        document.execCommand(command, false, null);
        this.editState.hasChanges = true;
        return;
    }
    
    const textarea = app.lastFocusedTextarea;
    if (!textarea) {
        app.showToast('请先点击编辑框聚焦', 'warning');
        return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    
    if (!selectedText && command !== 'link' && command !== 'synopsis-ref') {
        app.showToast('请先选中要格式化的文字', 'warning');
        return;
    }

    let replacement = selectedText;

    switch(command) {
        case 'bold':
            replacement = `**${selectedText}**`;
            break;
        case 'italic':
            replacement = `*${selectedText}*`;
            break;
        case 'underline':
            replacement = `__${selectedText}**`;
            break;
        case 'strikeThrough':
            replacement = `~~${selectedText}~~`;
            break;
        case 'link':
            app.showEntrySelectForLink((entry, version, customText) => {
                if (!entry || !version) return;
                const displayText = customText || selectedText || version.title;
                // 使用新格式 [[entryId|versionId:displayText]] 支持自定义蓝字文本
                const linkMarker = `[[${entry.id}|${version.vid}:${displayText}]]`;

                textarea.setRangeText(linkMarker, start, end, 'end');
                textarea.focus();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            });
            return;
        case 'synopsis-ref':
            app.showSynopsisChapterSelectForLink((chapter) => {
                if (!chapter) return;
                const refMarker = `{{synopsis:${chapter.id}:${chapter.title}}}`;
                
                textarea.setRangeText(refMarker, start, end, 'end');
                textarea.focus();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            });
            return;
    }

    textarea.setRangeText(replacement, start, end, 'select');
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
};

// 插入链接专用弹窗（简化版）
app.showEntrySelectForLink = function(callback) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col">
            <div class="p-4 border-b bg-gray-50 rounded-t-xl flex justify-between items-center">
                <h3 class="font-bold text-lg">选择角色/设定</h3>
                <button class="close-modal text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="p-4">
                <div class="flex gap-2 mb-4">
                    <input type="text" id="link-search" placeholder="搜索角色或设定..." 
                        class="flex-1 p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                    <button id="external-link-btn" class="px-3 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm hover:bg-purple-200 transition flex items-center gap-1">
                        <i class="fa-solid fa-link"></i> 添加外链
                    </button>
                </div>
                <div id="link-list" class="space-y-1 max-h-[40vh] overflow-y-auto"></div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const list = modal.querySelector('#link-list');
    const searchInput = modal.querySelector('#link-search');
    
    const renderEntries = (filter = '') => {
        list.innerHTML = '';
        app.data.entries.forEach(entry => {
            const version = app.getVisibleVersion(entry);
            const title = version ? version.title : entry.code;
            if (filter && !entry.code.toLowerCase().includes(filter.toLowerCase()) && 
                !title.toLowerCase().includes(filter.toLowerCase())) return;
            
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
            item.innerHTML = `
                <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${entry.code}</span>
                <div class="flex-1 min-w-0">
                    <span class="text-sm text-gray-700 block truncate">${title}</span>
                    ${entry.versions.length > 1 ? `<span class="text-xs text-indigo-600">${entry.versions.length}个版本</span>` : ''}
                </div>
                ${entry.versions.length > 1 ? '<i class="fa-solid fa-chevron-right text-gray-400 text-xs"></i>' : ''}
            `;
            item.onclick = () => {
                modal.remove();
                if (entry.versions && entry.versions.length > 1) {
                    app.showVersionSelectForLink(entry, callback);
                } else if (entry.versions && entry.versions.length === 1) {
                    app.showCustomTextDialog(entry, entry.versions[0], callback);
                }
            };
            list.appendChild(item);
        });
    };
    
    renderEntries();
    searchInput.oninput = (e) => renderEntries(e.target.value);
    searchInput.focus();
    
    // 【新增】添加外链按钮
    modal.querySelector('#external-link-btn').onclick = () => {
        modal.remove();
        app.showExternalLinkDialog();
    };
    
    modal.querySelector('.close-modal').onclick = () => { modal.remove(); };
    modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
};

app.showVersionSelectForLink = function(entry, finalCallback) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[10000] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div class="p-4 border-b bg-indigo-50 rounded-t-xl flex justify-between items-center">
                <h3 class="font-bold text-lg text-indigo-800">选择引用版本</h3>
                <button class="close-modal text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="p-4 overflow-y-auto flex-1">
                <div id="version-list" class="space-y-2"></div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const list = modal.querySelector('#version-list');
    const sortedVersions = [...entry.versions].sort((a, b) => {
        const orderA = a.chapterFrom ? app.getChapterOrder(a.chapterFrom) : -1;
        const orderB = b.chapterFrom ? app.getChapterOrder(b.chapterFrom) : -1;
        return orderA - orderB;
    });
    
    sortedVersions.forEach((version, idx) => {
        const fromCh = version.chapterFrom ? app.data.chapters.find(c => c.id === version.chapterFrom) : null;
        const timeRange = fromCh ? app.formatChapterNum(fromCh.num) : '起始';
        const subtitlePreview = version.subtitle ? (version.subtitle.length > 30 ? version.subtitle.substring(0, 30) + '...' : version.subtitle) : '无题记';
        
        const item = document.createElement('div');
        item.className = 'p-3 border border-gray-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer transition';
        item.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-gray-800">${version.title}</span>
                <span class="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">版本${idx + 1}</span>
            </div>
            <div class="text-xs text-gray-500 mb-1">${timeRange}</div>
            <div class="text-xs text-gray-600 italic border-l-2 border-gray-300 pl-2">${subtitlePreview}</div>
        `;
        item.onclick = () => {
            modal.remove();
            app.showCustomTextDialog(entry, version, finalCallback);
        };
        list.appendChild(item);
    });
    
    modal.querySelector('.close-modal').onclick = () => { modal.remove(); };
    modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
};

/**
 * 【新增】选择版本后，允许用户自定义链接显示文本（蓝字文本）
 * 流程：选择词条 → 选择版本 → 自定义文本 → 插入
 */
app.showCustomTextDialog = function(entry, version, finalCallback) {
    const defaultText = version.title || '未命名';
    // 【修复】备份editor.dataset中的光标位置信息
    const editor = app.$e('edit-subtitle') || app.$e('edit-content-textarea');
    let cursorBackup = null;
    if (editor) {
        cursorBackup = {
            savedNodeIdx: editor.dataset.savedNodeIdx,
            savedStart: editor.dataset.savedStart,
            savedEnd: editor.dataset.savedEnd
        };
    }
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[10001] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col">
            <div class="p-4 border-b bg-emerald-50 rounded-t-xl flex justify-between items-center">
                <h3 class="font-bold text-lg text-emerald-800">自定义链接文本</h3>
                <button class="close-modal text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="p-6 space-y-4">
                <div class="text-sm text-gray-500">目标词条：<span class="font-bold text-gray-700">${this.escapeHtml(defaultText)}</span> <span class="text-xs text-gray-400">(${entry.code})</span></div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">链接显示文本</label>
                    <input type="text" id="custom-link-text" value="${this.escapeHtml(defaultText)}"
                        class="w-full p-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        placeholder="输入要显示的文本...">
                    <div class="text-xs text-gray-400 mt-1">可修改为任意文本，如"点击查看"、"详情"等</div>
                </div>
                <div class="flex gap-2 pt-2">
                    <button id="btn-use-default" class="flex-1 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600 transition">使用默认</button>
                    <button id="btn-confirm-text" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm text-white transition font-medium">确认</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('#custom-link-text');
    input.focus();
    input.select();

    const confirm = () => {
        const customText = input.value.trim() || defaultText;
        modal.remove();
        // 【修复】恢复光标位置信息
        if (editor && cursorBackup) {
            editor.dataset.savedNodeIdx = cursorBackup.savedNodeIdx;
            editor.dataset.savedStart = cursorBackup.savedStart;
            editor.dataset.savedEnd = cursorBackup.savedEnd;
        }
        finalCallback(entry, version, customText);
    };

    modal.querySelector('#btn-confirm-text').onclick = confirm;
    modal.querySelector('#btn-use-default').onclick = () => {
        input.value = defaultText;
        confirm();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') confirm(); };
    modal.querySelector('.close-modal').onclick = () => {
        // 取消时也要恢复光标位置
        if (editor && cursorBackup) {
            editor.dataset.savedNodeIdx = cursorBackup.savedNodeIdx;
            editor.dataset.savedStart = cursorBackup.savedStart;
            editor.dataset.savedEnd = cursorBackup.savedEnd;
        }
        modal.remove();
    };
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};
// ========== 词条编辑辅助函数 ==========
app.updateEditVersionSelector = function() {
    const container = document.getElementById('main-container');
    let selectorContainer = app.$e('edit-version-selector-wrapper');
    if (!selectorContainer) {
        selectorContainer = document.createElement('div');
        selectorContainer.id = 'edit-version-selector-wrapper';
        selectorContainer.className = 'bg-white border-b border-indigo-100 px-4 py-3 shrink-0';
        if (container.firstChild) {
            container.insertBefore(selectorContainer, container.firstChild.nextSibling);
        }
    }

    const entry = this.tempEntry;
    if (!entry || !entry.versions) {
        selectorContainer.innerHTML = '';
        return;
    }

    const visibleVersions = this.getAllVisibleVersionsAtCurrentTime(entry);

    if (visibleVersions.length <= 1) {
        selectorContainer.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-xs text-gray-500">当前时间点只有一个版本</span>
                <button onclick="app.showVersionManager()" class="text-xs text-indigo-600 hover:text-indigo-800">
                    <i class="fa-solid fa-code-branch mr-1"></i>管理所有版本
                </button>
            </div>
        `;
        return;
    }

    let html = `
        <div class="flex items-center gap-3">
            <span class="text-xs font-bold text-indigo-700 whitespace-nowrap">
                <i class="fa-solid fa-layer-group mr-1"></i>可编辑版本:
            </span>
            <div class="flex-1 flex flex-wrap gap-2">
    `;

    visibleVersions.forEach(v => {
        const isCurrent = v.vid === this.editingVersionId;
        const fromCh = v.chapterFrom ? this.data.chapters.find(c => c.id === v.chapterFrom) : null;
        const chName = fromCh ? this.formatChapterNum(fromCh.num) : '起始';
        const levelStar = v.level <= 2 ? '★' : '';

        html += `
            <button onclick="app.switchEditVersion('${v.vid}')" 
                class="px-3 py-1.5 rounded-lg text-xs transition flex items-center gap-1.5 ${isCurrent ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}">
                ${isCurrent ? '<i class="fa-solid fa-check"></i>' : ''}
                <span>${v.title}${levelStar ? '<span class="text-yellow-300 ml-0.5">'+levelStar+'</span>' : ''}</span>
                <span class="text-[10px] opacity-70 ml-1">(${chName})</span>
            </button>
        `;
    });

    html += `
            </div>
            <button onclick="app.showVersionManager()" class="text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                <i class="fa-solid fa-gear mr-1"></i>管理
            </button>
        </div>
    `;

    selectorContainer.innerHTML = html;
};

app.getAllVisibleVersionsAtCurrentTime = function(entry) {
    if (!entry.versions) return [];
    if (this.data.currentTimeline === 'latest') return entry.versions;
    
    const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
    if (!currentCh) return entry.versions;
    
    return entry.versions.filter(v => {
        const fromOrder = this.getChapterOrder(v.chapterFrom);
        const toOrder = this.getChapterOrder(v.chapterTo);
        return currentCh.order >= fromOrder && currentCh.order <= toOrder;
    });
};

app.switchEditVersion = function(vid) {
    if (vid === this.editingVersionId) {
        console.log('[Switch] 已是当前版本，跳过');
        return;
    }
    
    console.log('[Switch] 开始切换版本:', vid, '当前:', this.editingVersionId);
    
    // 【关键】先保存当前版本数据到 tempEntry，避免丢失
    let saveSuccess = false;
    try {
        this.collectCurrentEditData();
        const currentVidx = this.tempEntry.versions.findIndex(v => v.vid === this.editingVersionId);
        if (currentVidx >= 0) {
            // 深拷贝保存当前版本
            this.tempEntry.versions[currentVidx] = JSON.parse(JSON.stringify(this.tempVersion));
            saveSuccess = true;
            console.log('[Switch] 当前版本数据已保存到 tempEntry.versions[', currentVidx, ']');
        }
    } catch (e) {
        console.error('[Switch] 保存当前版本数据失败:', e);
        // 【修复】即使保存失败，也继续切换，但提示用户
        if (!confirm('保存当前编辑内容时出错，是否继续切换版本？\n（未保存的修改将丢失）')) {
            return;
        }
    }

    // 切换到新版本
    const newVersion = this.tempEntry.versions.find(v => v.vid === vid);
    if (!newVersion) {
        console.error('[Switch] 找不到版本:', vid, '可用版本:', this.tempEntry.versions.map(v => v.vid));
        alert('切换失败：找不到目标版本');
        return;
    }
    
    console.log('[Switch] 找到新版本:', newVersion.title, 'vid:', newVersion.vid);

    // 确保新版本有 images 结构
    if (!newVersion.images) {
        newVersion.images = { 
            avatar: newVersion.image, 
            card: newVersion.image, 
            cover: newVersion.image 
        };
    }

    // 【关键】更新状态
    this.tempVersion = JSON.parse(JSON.stringify(newVersion));
    this.editingVersionId = vid;
    this.data.viewingVersionId = vid;

    // 【修复】强制清空并重新渲染容器，避免 DOM 残留
    const container = document.getElementById('main-container');
    if (!container) {
        console.error('[Switch] 找不到 main-container');
        return;
    }
    
    // 清空容器内容（重要！防止旧 DOM 干扰）
    container.innerHTML = '';
    
    // 重新渲染编辑页面
    try {
        this.renderEdit(container);
        this.showSaveToast(`已切换到版本：${newVersion.title}`);
        console.log('[Switch] 切换完成');
    } catch (err) {
        console.error('[Switch] 渲染失败:', err);
        alert('切换版本时出错：' + err.message);
    }
};

// ============================================
// 代码块 2: wiki-features-edit.js - collectCurrentEditData 函数修改
// 简化 htmlToMarkdown 调用，确保 contenteditable 内容正确收集
// ============================================

app.collectCurrentEditData = function() {
    if (!this.tempVersion) {
        console.warn('[Collect] tempVersion 为空');
        return;
    }

    console.log('[Collect] 开始收集数据，当前版本:', this.tempVersion.vid);

    // 1. 收集标题和题记（保持原有）
    const titleEl = app.$e('edit-title');
    const subtitleEl = app.$e('edit-subtitle');
    
    if (titleEl) this.tempVersion.title = titleEl.value.trim();
    if (subtitleEl) this.tempVersion.subtitle = subtitleEl.value.trim();

    const levelEl = app.$e('edit-level');
    if (levelEl) this.tempVersion.level = parseInt(levelEl.value) || 5;

    // 2. 收集置顶设置（保持原有）
    const pinnedCheck = app.$e('edit-pinned');
    const pinStart = app.$e('edit-pin-start');
    const pinEnd = app.$e('edit-pin-end');
    
    if (pinnedCheck) {
        this.tempEntry.pinned = pinnedCheck.checked;
        if (pinStart) this.tempEntry.pinStartChapter = pinStart.value || null;
        if (pinEnd) this.tempEntry.pinEndChapter = pinEnd.value || null;
    }

    // 3. 【核心修改】收集内容块 - 强制展平 + 再删除冗余
    const blocks = [];
    const blockDivs = document.querySelectorAll('#edit-blocks-container > div');
    
    console.log('[Collect] 发现', blockDivs.length, '个内容块');
    
    blockDivs.forEach((div, idx) => {
        const type = div.dataset.type;
        
        try {
            if (type === 'p') {
                const editor = div.querySelector('.block-input[contenteditable="true"]');
                if (editor) {
                    let text = '';
                    try {
                        // 【工序1】强制展平：将 <div> 转为换行标记（插入换行）
                        let rawHtml = editor.innerHTML;
                        
                        // 将 <div> 容器替换为 [[LINEBREAK]] + 内容 + [[LINEBREAK]]
                        rawHtml = rawHtml.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, function(match, content) {
                            const trimmedContent = content.trim();
                            // 如果div是空的或只有br，视为段落分隔
                            if (!trimmedContent || trimmedContent.match(/^<br\s*\/?>$/i)) {
                                return '[[LINEBREAK]]';
                            }
                            // 否则包裹内容（前后都加换行标记，确保段落边界清晰）
                            return '[[LINEBREAK]]' + content + '[[LINEBREAK]]';
                        });
                        
                        // 将 <br> 也转为换行标记
                        rawHtml = rawHtml.replace(/<br\s*\/?>/gi, '[[LINEBREAK]]');
                        
                        // 【工序2】转换为Markdown（删除冗余但会把第一次删完）
                        text = this.htmlToMarkdown(rawHtml);
                        
                        // 【工序3】还原换行标记（再追加一次换行）
                        text = text.replace(/\[\[LINEBREAK\]\]/g, '\n');
                        
                        // 【工序4】再删除冗余（全局规范化）
                        // 将所有连续换行（2个及以上）合并为恰好1个换行
                        // 这样无论之前是1个还是2个，最终都统一为1个
                        text = text.replace(/\n{2,}/g, '\n');
                        
                        // 清理首尾空白（但保留内部换行）
                        text = text.replace(/^\n+/, '').replace(/\n+$/, '');
                        
                    } catch (e) {
                        console.error('[Collect] 强制展平失败，降级使用 innerText:', e);
                        text = editor.innerText || '';
                    }
                    
                    // 【二次保护】如果处理后为空但编辑器有内容
                    if ((!text || text.trim() === '') && editor.innerText && editor.innerText.trim() !== '') {
                        text = editor.innerText;
                    }
                    
                    blocks.push({ type, text });
                    console.log('[Collect] 段落块', idx, '长度:', text.length, '换行数:', (text.match(/\n/g) || []).length);
                }
            } else if (type === 'h2' || type === 'h3') {
                // 【保留原有逻辑】标题块处理不变
                const textarea = div.querySelector('textarea.block-input');
                if (textarea) {
                    blocks.push({ type, text: textarea.value });
                }
            } else if (type === 'img') {
                // 【新增】收集图片元件
                const imgEl = div.querySelector('img');
                const captionEl = div.querySelector('.block-image-caption');
                if (imgEl) {
                    // 【关键】优先使用 hidden input 中保存的原引用（{{IMG:...}} 或 data:），
                    // 避免使用预览 img 的 src（可能是 blob URL，保存后重启即失效导致图片丢失）
                    const srcInput = div.querySelector('.block-image-src');
                    const src = srcInput ? srcInput.value
                        : (imgEl.dataset.originalSrc || imgEl.dataset.imgRef || imgEl.src || '');
                    const caption = captionEl ? captionEl.value.trim() : '';
                    blocks.push({ type, src, caption });
                }
            } else if (type === 'table') {
                // 【新增】收集表格元件（支持colspan/rowspan合并）
                const tbl = div.querySelector('table');
                if (tbl) {
                    const rows = [];
                    const colspans = []; // 与rows对应，记录每个单元格的colspan
                    tbl.querySelectorAll('thead tr, tbody tr').forEach(tr => {
                        const row = [];
                        const spanRow = [];
                        tr.querySelectorAll('th[contenteditable], td[contenteditable]').forEach(cell => {
                            // 【关键修复】跳过被合并隐藏的单元格（data-merged="1"）
                            if (cell.dataset.merged === '1') return;
                            row.push(cell.textContent.trim());
                            spanRow.push(cell.colSpan > 1 ? cell.colSpan : 1);
                        });
                        if (row.length > 0) {
                            rows.push(row);
                            colspans.push(spanRow);
                        }
                    });
                    // 收集单元格样式（对齐+颜色）
                    const aligns = [];
                    const cellStyles = [];
                    tbl.querySelectorAll('thead tr, tbody tr').forEach(tr => {
                        const alignRow = [];
                        const styleRow = [];
                        tr.querySelectorAll('th[contenteditable], td[contenteditable]').forEach(cell => {
                            if (cell.dataset.merged === '1') return;
                            alignRow.push(cell.dataset.align || cell.style.textAlign || '');
                            styleRow.push({
                                color: cell.dataset.textColor || cell.style.color || '',
                                bg: cell.dataset.bgColor || cell.style.backgroundColor || ''
                            });
                        });
                        if (alignRow.length > 0) {
                            aligns.push(alignRow);
                            cellStyles.push(styleRow);
                        }
                    });
                    if (rows.length > 0) {
                        const tableBlock = { type, rows, colspans };
                        if (aligns.length > 0) tableBlock.aligns = aligns;
                        if (cellStyles.length > 0) tableBlock.styles = cellStyles;
                        blocks.push(tableBlock);
                    }
                }
            }
        } catch (e) {
            console.error('[Collect] 处理块', idx, '失败:', e);
        }
    });
    
    this.tempVersion.blocks = blocks;
    console.log('[Collect] 收集完成，共', blocks.length, '个块');

    // 4. 收集时间轴设置（保持原有）
    const fromSelect = app.$e('edit-chapter-from');
    const toSelect = app.$e('edit-chapter-to');
    const hasEndCheck = app.$e('edit-has-end');

    if (fromSelect) this.tempVersion.chapterFrom = fromSelect.value || null;
    if (hasEndCheck && toSelect) {
        this.tempVersion.chapterTo = hasEndCheck.checked ? (toSelect.value || null) : null;
    }
};

// ========== 词条CRUD（增强版） ==========
app.saveEntry = function() {
    const title = app.$e('edit-title').value;
    if(!title) return alert('请输入版本名称');

    this.collectCurrentEditData();

    if (!this.tempVersion.images) {
        this.tempVersion.images = { 
            avatar: this.tempVersion.image, 
            card: this.tempVersion.image, 
            cover: this.tempVersion.image 
        };
    }
    if (!this.tempVersion.images.avatar) this.tempVersion.images.avatar = this.tempVersion.images.card;
    if (!this.tempVersion.images.cover) this.tempVersion.images.cover = this.tempVersion.images.card;
    this.tempVersion.image = this.tempVersion.images.card;

    const vidx = this.tempEntry.versions.findIndex(v => v.vid === this.editingVersionId);
    if(vidx >= 0) {
        this.tempEntry.versions[vidx] = this.tempVersion;
    } else {
        this.tempEntry.versions.push(this.tempVersion);
    }

    // 确保Layer 4和Layer 5字段存在
    if (this.tempEntry.pinned === undefined) this.tempEntry.pinned = false;
    if (this.tempEntry.pinStartChapter === undefined) this.tempEntry.pinStartChapter = null;
    if (this.tempEntry.pinEndChapter === undefined) this.tempEntry.pinEndChapter = null;
    if (this.tempEntry.pinnedVersions === undefined) this.tempEntry.pinnedVersions = {};
    if (this.tempEntry.missingIntervalVersion === undefined) this.tempEntry.missingIntervalVersion = null;
    if (this.tempEntry.defaultPinnedVersion === undefined) this.tempEntry.defaultPinnedVersion = null;

    this.tempEntry.code = app.$e('edit-code').value.toUpperCase();
    
    const campSelect = app.$e('edit-camp');
    if(this.tempEntry.type === 'character' && campSelect) {
        this.tempEntry.camp = campSelect.value;
    }

    const settingTypeSelect = app.$e('edit-setting-type');
    const settingTypeCustom = app.$e('edit-setting-type-custom');
    if(this.tempEntry.type === 'non-character' && settingTypeSelect) {
        const val = settingTypeSelect.value;
        // 【功能1】处理已有自定义目录 "custom:目录名" 格式
        if (val.startsWith('custom:')) {
            this.tempEntry.settingType = 'custom';
            this.tempEntry.customSettingType = val.substring(7);
        } else {
            this.tempEntry.settingType = val;
            if(val === 'custom' && settingTypeCustom) {
                this.tempEntry.customSettingType = settingTypeCustom.value;
            }
        }
    }

    // 【新增】保存活动页词条数据
    if (this.tempEntry.type === 'event') {
        // 保存头图
        const headerPreview = app.$e('edit-event-header-preview');
        if (headerPreview && !headerPreview.classList.contains('hidden') && headerPreview.src && headerPreview.src !== window.location.href) {
            this.tempEntry.headerImage = headerPreview.dataset.originalSrc || headerPreview.src;
        } else if (!headerPreview || headerPreview.classList.contains('hidden')) {
            this.tempEntry.headerImage = null;
        }
        
        // 保存持续时间
        const permRadio = document.getElementById('event-duration-permanent');
        if (permRadio && permRadio.checked) {
            this.tempEntry.duration = { type: 'permanent' };
        } else {
            const startDate = document.getElementById('event-start-date');
            const endDate = document.getElementById('event-end-date');
            this.tempEntry.duration = {
                type: 'period',
                startDate: startDate && startDate.value ? new Date(startDate.value).toISOString() : null,
                endDate: endDate && endDate.value ? new Date(endDate.value).toISOString() : null
            };
        }
    }

    // 【外源直链模式】正文词条收集外源链接
    if (this.tempEntry.type === 'body') {
        const sl = document.getElementById('edit-source-link');
        const slName = document.getElementById('edit-source-link-name');
        this.tempEntry.sourceLink = sl && sl.value ? String(sl.value).trim() : '';
        this.tempEntry.sourceLinkName = slName && slName.value ? String(slName.value).trim() : '';
        if (!this.tempEntry.sourceLink) delete this.tempEntry.sourceLink;
        if (!this.tempEntry.sourceLinkName) delete this.tempEntry.sourceLinkName;
    }

    // 【功能4】保存隐藏目录及密码设置（每个词条独立）
    const isHidden = settingTypeSelect && settingTypeSelect.value === 'hidden';
    if (!this.data.settings.hiddenCategory) this.data.settings.hiddenCategory = { entries: [] };
    if (!this.data.settings.hiddenCategory.entries) this.data.settings.hiddenCategory.entries = [];
    if (!this.data.settings.hiddenCategory.entryPasswords) this.data.settings.hiddenCategory.entryPasswords = {};
    // 更新隐藏目录entries
    if (isHidden) {
        if (!this.data.settings.hiddenCategory.entries.includes(this.tempEntry.id)) {
            this.data.settings.hiddenCategory.entries.push(this.tempEntry.id);
        }
        this.tempEntry.settingType = 'hidden';
    } else {
        this.data.settings.hiddenCategory.entries = this.data.settings.hiddenCategory.entries.filter(id => id !== this.tempEntry.id);
        delete this.data.settings.hiddenCategory.entryPasswords[this.tempEntry.id];
    }
    // 保存密码设置（每个词条独立）
    const pwHintInput = app.$e('edit-hidden-pw-hint');
    const pwAnswersInput = app.$e('edit-hidden-pw-answers');
    const pwAlways = app.$e('edit-hidden-pw-always');
    if (isHidden && pwHintInput && pwAnswersInput) {
        const ep = this.data.settings.hiddenCategory.entryPasswords[this.tempEntry.id] || {};
        ep.hint = pwHintInput.value;
        ep.answers = pwAnswersInput.value.split('\n').filter(a => a.trim());
        ep.alwaysRequired = pwAlways ? pwAlways.checked : true;
        const pwResult = this.collectHiddenPwRules ? this.collectHiddenPwRules() : { rules: [], defaultMessage: '' };
        ep.defaultMessage = pwResult.defaultMessage || '不对啦！';
        ep.rules = pwResult.rules;
        this.data.settings.hiddenCategory.entryPasswords[this.tempEntry.id] = ep;
    }

    const idx = this.data.entries.findIndex(e => e.id === this.tempEntry.id);
    if(idx >= 0) {
        this.data.entries[idx] = this.tempEntry;
    } else {
        this.data.entries.push(this.tempEntry);
    }

    this.saveData();
    this.data.editingId = this.tempEntry.id;
    this.data.viewingVersionId = this.tempVersion.vid;
    
    // 重置编辑状态
    this.editState.hasChanges = false;
    this.editState.undoStack = [];
    this.editState.redoStack = [];
    this.unbindEditKeyboardShortcuts();
    // 【关键】保存完成后清空临时编辑数据，防止后续"新建词条"复用残留内容
    this.tempEntry = null;
    this.tempVersion = null;
    
    this.router('detail');
};

app.createEntry = function(type) {
    this.data.editingId = null;
    this.data.viewingVersionId = null;
    this.data.editingType = type;
    // 【关键】清空残留的 tempEntry/tempVersion（防止 renderEdit 新建模式复用上一个词条的编辑数据）
    this.tempEntry = null;
    this.tempVersion = null;
    this.editState.hasChanges = false;
    this.editState.undoStack = [];
    this.editState.redoStack = [];
    this.router('edit');
};

app.createEntryFromList = function() {
    const type = this.data.currentView === 'characters' ? 'character' : 'non-character';
    this.createEntry(type);
};

app.editCurrentEntry = function() {
    this.router('edit');
};

app.cancelEdit = async function() {
    // 检查是否有修改
    if (!this.editState.hasChanges && this.editState.undoStack.length === 0) {
        // 没有修改，直接退出
        this.unbindEditKeyboardShortcuts();
        this.tempEntry = null;
        this.tempVersion = null;
        this.data.editingType = null;
        // 新建词条（无 editingId）取消时关闭"新词条"标签
        if (!this.data.editingId && this.tabsSystem) {
            const nt = this.tabsSystem.list.find(t => t.kind === 'edit' && !t.entryId);
            if (nt) this.tabsSystem.closeTab(nt.id);
        }
        this.router(this.data.editingId ? 'detail' : 'home');
        return;
    }
    
    // 有修改，显示确认弹窗
    const confirmed = await this.showConfirmDialog({
        title: '放弃编辑',
        message: '确定放弃当前编辑？\n未保存的修改将丢失。',
        confirmText: '放弃',
        cancelText: '继续编辑',
        type: 'warning'
    });
    
    if (confirmed) {
        this.unbindEditKeyboardShortcuts();
        this.tempEntry = null;
        this.tempVersion = null;
        this.data.editingType = null;
        this.editState.hasChanges = false;
        this.editState.undoStack = [];
        this.editState.redoStack = [];
        if (!this.data.editingId && this.tabsSystem) {
            const nt = this.tabsSystem.list.find(t => t.kind === 'edit' && !t.entryId);
            if (nt) this.tabsSystem.closeTab(nt.id);
        }
        this.router(this.data.editingId ? 'detail' : 'home');
    }
};

app.deleteEntry = function(id) {
    const entry = this.data.entries.find(e => e.id === id);
    if (!entry) return;
    
    // 二次确认，显示将要删除的词条内容
    const visibleVersion = this.getVisibleVersion(entry);
    const title = visibleVersion ? visibleVersion.title : entry.code;
    
    if(!confirm(`确定删除词条【${title}】(${entry.code})？\n\n⚠️ 警告：\n• 该词条的 ${entry.versions.length} 个历史版本将全部永久删除\n• 关联的图片、关系链、首页引用将被清理\n• 编号 ${entry.code} 将被回收供后续使用\n• 此操作无法撤销`)) {
        return;
    }
    
    // 1. 【编号回收】解析编号数字并入池（含活动E前缀）
    const prefixMap = { character: 'C', 'non-character': 'N', event: 'E' };
    const prefix = prefixMap[entry.type] || 'N';
    const codeMatch = entry.code.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (codeMatch) {
        const codeNum = parseInt(codeMatch[1], 10);
        if (!isNaN(codeNum) && codeNum > 0) {
            if (!this.data.recycledCodes[prefix]) this.data.recycledCodes[prefix] = [];
            this.data.recycledCodes[prefix].push(codeNum);
            this.data.recycledCodes[prefix] = [...new Set(this.data.recycledCodes[prefix])].sort((a, b) => a - b);
            console.log(`[Delete] 回收编号: ${entry.code}, 当前回收池:`, this.data.recycledCodes[prefix]);
        }
    }
    
    // 2. 【清理存储图片】删除该词条所有关联图片（含活动词条头图和图片元件）
    if (this.storageManager) {
        const imgsToClean = [];
        // 2a. 普通词条版本图片
        if (entry.versions) {
            entry.versions.forEach(v => {
                if (v.images) {
                    Object.values(v.images).forEach(imgRef => {
                        if (imgRef && imgRef.startsWith('{{IMG:')) {
                            const m = imgRef.match(/\{\{IMG:(.+?)\}\}/);
                            if (m) imgsToClean.push(m[1]);
                        }
                    });
                }
                // 2b. 活动词条图片元件
                if (entry.type === 'event' && v.blocks) {
                    v.blocks.forEach(b => {
                        if (b.type === 'img' && b.src && b.src.startsWith('{{IMG:')) {
                            const m = b.src.match(/\{\{IMG:(.+?)\}\}/);
                            if (m) imgsToClean.push(m[1]);
                        }
                    });
                }
            });
        }
        // 2c. 活动词条头图
        if (entry.type === 'event' && entry.headerImage && entry.headerImage.startsWith('{{IMG:')) {
            const m = entry.headerImage.match(/\{\{IMG:(.+?)\}\}/);
            if (m) imgsToClean.push(m[1]);
        }
        // 统一清理：memoryCache + 本地文件夹/OPFS
        imgsToClean.forEach(filename => {
            this.storageManager.memoryCache.delete(filename);
            if (this.storageManager.deleteFile) {
                this.storageManager.deleteFile(filename).catch(e => console.warn('[Delete] 文件删除失败:', filename, e.message));
            }
            console.log(`[Delete] 清理图片: ${filename}`);
        });
    }
    
    // 3. 【清理数据】从 entries 数组移除（连带所有版本一起删除）
    this.data.entries = this.data.entries.filter(e => e.id !== id);
    
    // 4. 【清理历史记录】移除浏览历史中对此词条的引用
    this.data.history = this.data.history.filter(h => h.id !== id);
    
    // 5. 【清理首页自定义】移除首页内容中对此词条的引用
    this.data.homeContent = this.data.homeContent.filter(item => 
        !(item.type === 'entry-ref' && item.entryId === id)
    );
    
    // 6. 【清理关系链】在其他角色的 relatedCharacters 中移除此角色
    this.data.entries.forEach(otherEntry => {
        if (otherEntry.versions) {
            otherEntry.versions.forEach(v => {
                if (v.relatedCharacters) {
                    v.relatedCharacters = v.relatedCharacters.filter(rc => rc.charId !== id);
                }
            });
        }
    });
    
    this.saveData();
    this.showSaveToast(`已删除【${title}】，编号 ${entry.code} 已回收`);
    
    // 如果当前正在查看该词条详情，返回列表页；否则刷新当前页
    if (this.data.editingId === id) {
        this.router(entry.type === 'character' ? 'characters' : 'non-characters');
    } else {
        this.router(this.data.currentView, false);
    }
};
/**
 * 【新增】自动修复新章节插入后的并行区间置顶设置
 * 当新章节插入到现有并行区间内时，自动继承相邻章节的置顶设置
 */
app.autoFixParallelIntervalsForNewChapter = function(newChapterId) {
    const newChapter = this.data.chapters.find(c => c.id === newChapterId);
    if (!newChapter) return;
    
    let affectedCount = 0;
    
    // 遍历所有角色，检测是否有并行区间包含新章节
    this.data.entries.forEach(entry => {
        if (entry.type !== 'character' || !entry.versions || entry.versions.length < 2) return;
        
        // 检查新章节是否使该角色进入并行状态
        const activeVersions = entry.versions.filter(v => {
            const fromOrder = this.getChapterOrder(v.chapterFrom);
            const toOrder = this.getChapterOrder(v.chapterTo);
            return newChapter.order >= fromOrder && newChapter.order <= toOrder;
        });
        
        // 只有在新章节导致并行（或处于现有并行区间）时才处理
        if (activeVersions.length >= 2) {
            // 检查是否已有置顶设置
            if (!entry.pinnedVersions) entry.pinnedVersions = {};
            
            // 如果新章节没有置顶设置，尝试继承相邻章节的设置
            if (!entry.pinnedVersions[newChapterId]) {
                // 查找相邻章节（order最接近）的置顶设置
                const adjacentPinned = this.findAdjacentPinnedVersion(entry, newChapter.order);
                
                if (adjacentPinned) {
                    // 自动继承相邻章节的置顶版本
                    entry.pinnedVersions[newChapterId] = adjacentPinned.vid;
                    affectedCount++;
                    console.log(`[AutoFix] 角色 ${entry.code} 的新章节 ${newChapter.num} 继承置顶版本: ${adjacentPinned.title}`);
                }
            }
        }
    });
    
    if (affectedCount > 0) {
        this.saveData();
        this.showSaveToast(`已为 ${affectedCount} 个角色的并行区间自动继承置顶设置`);
    }
};

/**
 * 【新增】查找相邻章节的置顶版本
 */
app.findAdjacentPinnedVersion = function(entry, targetOrder) {
    if (!entry.pinnedVersions || Object.keys(entry.pinnedVersions).length === 0) return null;
    
    let closestChapter = null;
    let minDistance = Infinity;
    let pinnedVid = null;
    
    // 遍历已有置顶设置的章节，找到order最接近的
    Object.entries(entry.pinnedVersions).forEach(([chId, vid]) => {
        const ch = this.data.chapters.find(c => c.id === chId);
        if (!ch) return;
        
        const distance = Math.abs(ch.order - targetOrder);
        if (distance < minDistance && distance > 0) { // distance>0 排除自身
            minDistance = distance;
            closestChapter = ch;
            pinnedVid = vid;
        }
    });
    
    if (pinnedVid) {
        return entry.versions.find(v => v.vid === pinnedVid);
    }
    return null;
};
// ========== 键盘快捷键 ==========
app.bindEditKeyboardShortcuts = function() {
    const handler = (e) => {
        // Ctrl+S 保存
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            e.stopPropagation();
            this.saveEntry();
        }
        // Ctrl+Z 撤销
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            this.undo();
        }
        // Ctrl+Shift+Z 或 Ctrl+Y 重做
        else if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
                 ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
            e.preventDefault();
            e.stopPropagation();
            this.redo();
        }
    };
    
    document.addEventListener('keydown', handler);
    this._editKeyHandler = handler;
};

app.unbindEditKeyboardShortcuts = function() {
    if (this._editKeyHandler) {
        document.removeEventListener('keydown', this._editKeyHandler);
        this._editKeyHandler = null;
    }
};

// 导出标记设置更新
app.updateExportMarkEnabled = function(enabled) {
    if (!this.data.settings.exportMark) {
        this.data.settings.exportMark = { enabled: false, text: '' };
    }
    this.data.settings.exportMark.enabled = enabled;
    this.saveData();
    this.showToast('标记设置已更新', 'success');
};

app.updateExportMarkText = function(text) {
    if (!this.data.settings.exportMark) {
        this.data.settings.exportMark = { enabled: false, text: '' };
    }
    this.data.settings.exportMark.text = text;
    this.saveData();
    this.showToast('标记文本已更新', 'success');
};

/**
 * 【新增】更新导出标记图片
 */
app.updateExportMarkImage = function(input) {
    if (!input || !input.files || !input.files[0]) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
        this.showToast('请选择图片文件', 'warning');
        return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
        if (!this.data.settings.exportMark) {
            this.data.settings.exportMark = { enabled: false, text: '' };
        }
        const dataUrl = e.target.result;
        // 【桌面版修复】标记图片直接写入存档目录 wiki-images/export-mark.png，
        // 数据中保存 {{IMG:export-mark.png}} 引用（重启不丢失、导出 ZIP 时自动包含、GitHub 版可读取）
        if (this.storageManager && this.storageManager.mode === 'desktop') {
            try {
                await this.storageManager.saveImage('export-mark.png', dataUrl);
                this.data.settings.exportMark.image = '{{IMG:export-mark.png}}';
            } catch (err) {
                console.error('[MarkImage] 保存标记图片失败:', err);
                this.showToast('标记图片保存失败', 'error');
                return;
            }
        } else {
            // 浏览器模式：保留 dataURL + localStorage 兼容旧逻辑
            this.data.settings.exportMark.image = dataUrl;
            try {
                localStorage.setItem('novelWiki_exportMarkImage', dataUrl);
            } catch (e2) {
                console.warn('[MarkImage] 直接存储失败:', e2.message);
            }
        }
        this.saveData();
        this._updateMarkImagePreview(this.data.settings.exportMark.image);
        this.showToast('标记图片已更新', 'success');
    };
    reader.readAsDataURL(file);
    input.value = '';
};

/**
 * 【新增】清除导出标记图片
 */
app.clearExportMarkImage = function() {
    if (this.data.settings.exportMark) {
        // 桌面版：同时删除文件
        if (this.storageManager && this.storageManager.mode === 'desktop' && this.storageManager.deleteFile) {
            try { this.storageManager.deleteFile('export-mark.png'); } catch (e) {}
        }
        delete this.data.settings.exportMark.image;
        this.saveData();
    }
    this._updateMarkImagePreview(null);
    this.showToast('标记图片已清除', 'info');
};

/**
 * 【新增】更新标记图片预览UI（支持 {{IMG:}} 引用异步解析）
 */
app._updateMarkImagePreview = function(imageData) {
    const preview = document.getElementById('export-mark-image-preview');
    const img = document.getElementById('export-mark-image-preview-img');
    const clearBtn = document.getElementById('export-mark-image-clear');
    const show = (src) => {
        if (preview && img && src) {
            img.src = src;
            preview.classList.remove('hidden');
            if (clearBtn) clearBtn.classList.remove('hidden');
        } else {
            if (preview) preview.classList.add('hidden');
            if (img) img.src = '';
            if (clearBtn) clearBtn.classList.add('hidden');
        }
    };
    if (!imageData) { show(null); return; }
    if (imageData.startsWith('{{IMG:')) {
        // 从内存缓存解析，缺失则异步加载
        const m = imageData.match(/\{\{IMG:(.+?)\}\}/);
        if (m && this.storageManager) {
            if (this.storageManager.memoryCache.has(m[1])) {
                show(this.storageManager.memoryCache.get(m[1]));
            } else {
                this.storageManager.loadImage(m[1]).then(url => show(url)).catch(() => show(null));
            }
        } else {
            show(null);
        }
    } else {
        show(imageData);
    }
};



// ========== 设定目录管理 ==========

// 拖拽排序的状态
app._catDragKey = null;

app._catDragStart = function(e, catKey) {
    app._catDragKey = catKey;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
};

app._catDragOver = function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
};

app._catDragEnter = function(e) {
    e.preventDefault();
    const item = e.currentTarget;
    item.classList.add('border-indigo-400', 'bg-indigo-50');
};

app._catDragLeave = function(e) {
    const item = e.currentTarget;
    item.classList.remove('border-indigo-400', 'bg-indigo-50');
};

app._catDrop = function(e, targetKey) {
    e.preventDefault();
    const item = e.currentTarget;
    item.classList.remove('border-indigo-400', 'bg-indigo-50');
    item.style.opacity = '1';

    const sourceKey = app._catDragKey;
    app._catDragKey = null;
    if (!sourceKey || sourceKey === targetKey) return;

    // 交换 sourceKey 和 targetKey 在 categoryOrder 中的位置
    if (!app.data.settings.settingConfig) app.data.settings.settingConfig = {};
    let order = app.data.settings.settingConfig.categoryOrder || [];

    // 如果目录不在 order 中，先初始化
    const allCats = app.getSettingCategoriesWithEntries(app.data.entries.filter(e => e.type === 'non-character'));
    const allKeys = allCats.map(c => c.key);
    if (order.length === 0) {
        order = [...allKeys];
    } else {
        // 补充缺失的 key
        allKeys.forEach(k => { if (!order.includes(k)) order.push(k); });
    }

    const sourceIdx = order.indexOf(sourceKey);
    const targetIdx = order.indexOf(targetKey);
    if (sourceIdx < 0 || targetIdx < 0) return;

    // 移除 source 并插入到 target 位置
    order.splice(sourceIdx, 1);
    order.splice(targetIdx, 0, sourceKey);

    app.data.settings.settingConfig.categoryOrder = order;
    app.saveData();
    app._refreshCatSortList();
};

// 拖拽结束时恢复透明度（处理未成功 drop 的情况）
document.addEventListener('dragend', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('cat-sort-item')) {
        e.target.style.opacity = '1';
        e.target.classList.remove('border-indigo-400', 'bg-indigo-50');
    }
});

/**
 * 【功能2】显示设定目录排序管理弹窗
 */
app.showSettingCategoryManager = function() {
    // 关闭已存在的窗口，避免重复弹窗
    document.querySelectorAll('.cat-manager-modal').forEach(el => el.remove());

    const modal = document.createElement('div');
    modal.className = 'cat-manager-modal fixed inset-0 bg-black/50 z-[10002] flex items-center justify-center p-4 fade-in';

    // 构建列表HTML（独立函数便于内联刷新）
    const _buildCatList = () => {
        const allEntries = this.data.entries.filter(e => e.type === 'non-character');
        const categories = this.getSettingCategoriesWithEntries(allEntries);
        const currentOrder = this.data.settings?.settingConfig?.categoryOrder || [];
        const sortedCats = [...categories];
        if (currentOrder.length > 0) {
            sortedCats.sort((a, b) => {
                const idxA = currentOrder.indexOf(a.key);
                const idxB = currentOrder.indexOf(b.key);
                if (idxA >= 0 && idxB >= 0) return idxA - idxB;
                if (idxA >= 0) return -1;
                if (idxB >= 0) return 1;
                return 0;
            });
        }
        this._catManagerSortedCats = sortedCats; // 缓存供箭头禁用判断
        return sortedCats.map((cat, idx) => `
            <div class="cat-sort-item flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-move" data-key="${cat.key}" draggable="true" ondragstart="app._catDragStart(event, '${cat.key}')" ondragover="app._catDragOver(event)" ondrop="app._catDrop(event, '${cat.key}')" ondragenter="app._catDragEnter(event)" ondragleave="app._catDragLeave(event)">
                <div class="text-gray-400"><i class="fa-solid fa-grip-lines"></i></div>
                <div class="flex-1">
                    <div class="font-medium text-sm">${this.escapeHtml(cat.title)}</div>
                    <div class="text-xs text-gray-400">${cat.count}个词条</div>
                </div>
                <div class="flex gap-1">
                    <button onclick="app.moveCategoryOrder('${cat.key}', -1)" class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
                    <button onclick="app.moveCategoryOrder('${cat.key}', 1)" class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500" ${idx === sortedCats.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
                </div>
                <button onclick="app.showCategoryEntryConfig('${cat.key}')" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs hover:bg-indigo-100 transition">
                    <i class="fa-solid fa-sliders"></i> 词条配置
                </button>
            </div>
        `).join('');
    };

    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">
            <div class="p-4 border-b flex justify-between items-center">
                <h3 class="font-bold text-lg"><i class="fa-solid fa-folder-tree text-indigo-600 mr-2"></i>设定目录管理</h3>
                <button onclick="this.closest('.cat-manager-modal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="p-4 overflow-y-auto flex-1">
                <div class="text-xs text-gray-500 mb-3">点击箭头调整目录显示顺序</div>
                <div id="cat-sort-list" class="space-y-2">${_buildCatList()}</div>
            </div>
            <div class="p-4 border-t flex justify-end gap-2">
                <button onclick="this.closest('.cat-manager-modal').remove()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};

/**
 * 获取所有设定目录及其词条
 */
app.getSettingCategoriesWithEntries = function(entries) {
    const cats = {};
    const typeLabels = { world: '世界设定', document: '文献', art: '绘画/图片', faction: '阵营' };
    entries.forEach(e => {
        let key = e.settingType || 'world';
        let title = typeLabels[key] || key;
        if (key === 'custom' && e.customSettingType) {
            key = 'custom-' + e.customSettingType;
            title = e.customSettingType;
        }
        if (!cats[key]) cats[key] = { key, title, count: 0 };
        cats[key].count++;
    });
    return Object.values(cats);
};

/**
 * 移动目录顺序（内联刷新，不重建窗口）
 */
app.moveCategoryOrder = function(catKey, direction) {
    if (!this.data.settings.settingConfig) this.data.settings.settingConfig = {};
    let order = this.data.settings.settingConfig.categoryOrder || [];
    const idx = order.indexOf(catKey);
    if (idx < 0) {
        // 未排序，先初始化排序列表
        const cats = this.getSettingCategoriesWithEntries(this.data.entries.filter(e => e.type === 'non-character'));
        order = cats.map(c => c.key);
    }
    const currentIdx = order.indexOf(catKey);
    const newIdx = currentIdx + direction;
    if (newIdx < 0 || newIdx >= order.length) return;
    const temp = order[currentIdx];
    order[currentIdx] = order[newIdx];
    order[newIdx] = temp;
    this.data.settings.settingConfig.categoryOrder = order;
    this.saveData();
    // 内联刷新：只更新列表内容，不重建整个窗口
    this._refreshCatSortList();
};

/**
 * 设定目录管理窗口内联刷新
 */
app._refreshCatSortList = function() {
    const container = document.getElementById('cat-sort-list');
    if (!container) return;
    // 重新构建列表HTML（与showSettingCategoryManager中相同的逻辑）
    const allEntries = this.data.entries.filter(e => e.type === 'non-character');
    const categories = this.getSettingCategoriesWithEntries(allEntries);
    const currentOrder = this.data.settings?.settingConfig?.categoryOrder || [];
    const sortedCats = [...categories];
    if (currentOrder.length > 0) {
        sortedCats.sort((a, b) => {
            const idxA = currentOrder.indexOf(a.key);
            const idxB = currentOrder.indexOf(b.key);
            if (idxA >= 0 && idxB >= 0) return idxA - idxB;
            if (idxA >= 0) return -1;
            if (idxB >= 0) return 1;
            return 0;
        });
    }
    container.innerHTML = sortedCats.map((cat, idx) => `
        <div class="cat-sort-item flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-move" data-key="${cat.key}" draggable="true" ondragstart="app._catDragStart(event, '${cat.key}')" ondragover="app._catDragOver(event)" ondrop="app._catDrop(event, '${cat.key}')" ondragenter="app._catDragEnter(event)" ondragleave="app._catDragLeave(event)">
            <div class="text-gray-400"><i class="fa-solid fa-grip-lines"></i></div>
            <div class="flex-1">
                <div class="font-medium text-sm">${this.escapeHtml(cat.title)}</div>
                <div class="text-xs text-gray-400">${cat.count}个词条</div>
            </div>
            <div class="flex gap-1">
                <button onclick="app.moveCategoryOrder('${cat.key}', -1)" class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
                <button onclick="app.moveCategoryOrder('${cat.key}', 1)" class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500" ${idx === sortedCats.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
            </div>
            <button onclick="app.showCategoryEntryConfig('${cat.key}')" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs hover:bg-indigo-100 transition">
                <i class="fa-solid fa-sliders"></i> 词条配置
            </button>
        </div>
    `).join('');
};

/**
 * 【功能3】显示目录内词条配置（排序+隐藏）- 重写版
 * 修复：显示所有条目（含隐藏）、排序可工作、关闭不弹父窗口
 */
app.showCategoryEntryConfig = function(catKey) {
    // 先关闭已存在的词条配置窗口，避免重复弹窗
    document.querySelectorAll('.entry-cfg-modal').forEach(el => el.remove());

    const modal = document.createElement('div');
    modal.className = 'entry-cfg-modal fixed inset-0 bg-black/50 z-[10003] flex items-center justify-center p-4 fade-in';

    // 解析目录key
    let settingType = catKey;
    let customType = null;
    if (catKey.startsWith('custom-')) {
        settingType = 'custom';
        customType = catKey.substring(7);
    }

    // 获取该目录的所有词条
    const entries = this.data.entries.filter(e => {
        if (e.type !== 'non-character') return false;
        if (settingType === 'custom') return e.settingType === 'custom' && e.customSettingType === customType;
        return (e.settingType || 'world') === settingType;
    });

    // 读取当前配置
    if (!this.data.settings.settingConfig) this.data.settings.settingConfig = {};
    if (!this.data.settings.settingConfig.categoryDisplay) this.data.settings.settingConfig.categoryDisplay = {};
    if (!this.data.settings.settingConfig.categoryDisplay[catKey]) {
        this.data.settings.settingConfig.categoryDisplay[catKey] = { displayOrder: [], homeHidden: [] };
    }
    const cfg = this.data.settings.settingConfig.categoryDisplay[catKey];
    if (!cfg.displayOrder) cfg.displayOrder = [];
    if (!cfg.homeHidden) cfg.homeHidden = [];

    // 构建统一显示列表：按 displayOrder 排序，未排序的排在后面
    const orderedIds = cfg.displayOrder.filter(id => entries.some(e => e.id === id));
    const unorderedEntries = entries.filter(e => !orderedIds.includes(e.id));
    const displayList = [
        ...orderedIds.map(id => entries.find(e => e.id === id)).filter(Boolean),
        ...unorderedEntries
    ];

    // 渲染单行条目
    const _buildRows = () => {
        const cfgNow = this.data.settings.settingConfig.categoryDisplay[catKey];
        const orderNow = cfgNow.displayOrder || [];
        const hiddenNow = cfgNow.homeHidden || [];

        return displayList.map((entry, idx) => {
            const isHidden = hiddenNow.includes(entry.id);
            const title = entry.versions?.[0]?.title || entry.code;
            return `<div class="flex items-center gap-2 p-2 ${isHidden ? 'bg-gray-100 opacity-60' : 'bg-white'} rounded border border-gray-200" data-eid="${entry.id}">
                <span class="text-xs font-bold ${isHidden ? 'text-gray-400' : 'text-indigo-600'} w-4 text-center">${idx + 1}</span>
                <span class="text-xs text-gray-500 font-mono w-16 truncate">${entry.code}</span>
                <span class="flex-1 text-sm truncate">${this.escapeHtml(title)}</span>
                ${isHidden ? '<span class="text-xs text-gray-400 mr-1"><i class="fa-solid fa-eye-slash"></i></span>' : ''}
                <button onclick="app.moveEntryDisplayOrder('${catKey}', '${entry.id}', -1)" class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600" ${idx === 0 ? 'disabled style="visibility:hidden"' : ''}><i class="fa-solid fa-chevron-up text-xs"></i></button>
                <button onclick="app.moveEntryDisplayOrder('${catKey}', '${entry.id}', 1)" class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600" ${idx === displayList.length - 1 ? 'disabled style="visibility:hidden"' : ''}><i class="fa-solid fa-chevron-down text-xs"></i></button>
                <label class="flex items-center gap-1 ml-1 cursor-pointer select-none">
                    <input type="checkbox" ${!isHidden ? 'checked' : ''} onchange="app.toggleEntryHomeDisplay('${catKey}', '${entry.id}', this.checked)" class="accent-indigo-600">
                    <span class="text-xs text-gray-500">显示</span>
                </label>
            </div>`;
        }).join('');
    };

    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
            <div class="p-4 border-b flex justify-between items-center">
                <h3 class="font-bold text-lg"><i class="fa-solid fa-sliders text-indigo-600 mr-2"></i>词条配置</h3>
                <button onclick="this.closest('.entry-cfg-modal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="p-4 overflow-y-auto flex-1">
                <div class="flex items-center justify-between mb-2">
                    <div class="text-xs text-gray-500">共 ${entries.length} 个词条 · 拖动排序（灰色=隐藏）</div>
                </div>
                <div id="entry-cfg-list" class="space-y-1">${_buildRows()}</div>
            </div>
            <div class="p-4 border-t flex justify-end gap-2">
                <button onclick="this.closest('.entry-cfg-modal').remove()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};

/**
 * 移动词条在目录内的显示顺序
 */
app.moveEntryDisplayOrder = function(catKey, entryId, direction) {
    const cfg = this.data.settings.settingConfig?.categoryDisplay?.[catKey];
    if (!cfg) return;
    if (!cfg.displayOrder) cfg.displayOrder = [];

    const list = cfg.displayOrder;
    const idx = list.indexOf(entryId);
    if (idx < 0) {
        // 不在列表中，先加入再移动
        const entries = this._getCategoryEntries(catKey);
        cfg.displayOrder = entries.map(e => e.id);
        const newIdx = cfg.displayOrder.indexOf(entryId) + direction;
        if (newIdx < 0 || newIdx >= cfg.displayOrder.length) return;
        const temp = cfg.displayOrder[cfg.displayOrder.indexOf(entryId)];
        cfg.displayOrder[cfg.displayOrder.indexOf(entryId)] = cfg.displayOrder[newIdx];
        cfg.displayOrder[newIdx] = temp;
    } else {
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= list.length) return;
        const temp = list[idx];
        list[idx] = list[newIdx];
        list[newIdx] = temp;
    }
    this.saveData();
    // 内联刷新：重新渲染列表内容，不重建整个窗口
    this._refreshEntryCfgList(catKey);
};

/**
 * 词条配置窗口内联刷新
 */
app._refreshEntryCfgList = function(catKey) {
    const container = document.getElementById('entry-cfg-list');
    if (!container) return;

    // 重新构建显示列表
    const entries = this._getCategoryEntries(catKey);
    const cfg = this.data.settings.settingConfig?.categoryDisplay?.[catKey] || { displayOrder: [], homeHidden: [] };
    const orderedIds = (cfg.displayOrder || []).filter(id => entries.some(e => e.id === id));
    const unorderedEntries = entries.filter(e => !orderedIds.includes(e.id));
    const displayList = [
        ...orderedIds.map(id => entries.find(e => e.id === id)).filter(Boolean),
        ...unorderedEntries
    ];
    const hiddenNow = cfg.homeHidden || [];

    container.innerHTML = displayList.map((entry, idx) => {
        const isHidden = hiddenNow.includes(entry.id);
        const title = entry.versions?.[0]?.title || entry.code;
        return `<div class="flex items-center gap-2 p-2 ${isHidden ? 'bg-gray-100 opacity-60' : 'bg-white'} rounded border border-gray-200" data-eid="${entry.id}">
            <span class="text-xs font-bold ${isHidden ? 'text-gray-400' : 'text-indigo-600'} w-4 text-center">${idx + 1}</span>
            <span class="text-xs text-gray-500 font-mono w-16 truncate">${entry.code}</span>
            <span class="flex-1 text-sm truncate">${this.escapeHtml(title)}</span>
            ${isHidden ? '<span class="text-xs text-gray-400 mr-1"><i class="fa-solid fa-eye-slash"></i></span>' : ''}
            <button onclick="app.moveEntryDisplayOrder('${catKey}', '${entry.id}', -1)" class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600" ${idx === 0 ? 'disabled style="visibility:hidden"' : ''}><i class="fa-solid fa-chevron-up text-xs"></i></button>
            <button onclick="app.moveEntryDisplayOrder('${catKey}', '${entry.id}', 1)" class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600" ${idx === displayList.length - 1 ? 'disabled style="visibility:hidden"' : ''}><i class="fa-solid fa-chevron-down text-xs"></i></button>
            <label class="flex items-center gap-1 ml-1 cursor-pointer select-none">
                <input type="checkbox" ${!isHidden ? 'checked' : ''} onchange="app.toggleEntryHomeDisplay('${catKey}', '${entry.id}', this.checked)" class="accent-indigo-600">
                <span class="text-xs text-gray-500">显示</span>
            </label>
        </div>`;
    }).join('');
};

/**
 * 获取指定目录下的所有词条（辅助函数）
 */
app._getCategoryEntries = function(catKey) {
    let settingType = catKey;
    let customType = null;
    if (catKey.startsWith('custom-')) {
        settingType = 'custom';
        customType = catKey.substring(7);
    }
    return this.data.entries.filter(e => {
        if (e.type !== 'non-character') return false;
        if (settingType === 'custom') return e.settingType === 'custom' && e.customSettingType === customType;
        return (e.settingType || 'world') === settingType;
    });
};

app.toggleEntryHomeDisplay = function(catKey, entryId, show) {
    if (!this.data.settings.settingConfig) this.data.settings.settingConfig = {};
    if (!this.data.settings.settingConfig.categoryDisplay) this.data.settings.settingConfig.categoryDisplay = {};
    if (!this.data.settings.settingConfig.categoryDisplay[catKey]) {
        this.data.settings.settingConfig.categoryDisplay[catKey] = { displayOrder: [], homeHidden: [] };
    }
    const cfg = this.data.settings.settingConfig.categoryDisplay[catKey];
    if (!cfg.homeHidden) cfg.homeHidden = [];
    if (!cfg.displayOrder) cfg.displayOrder = [];

    if (show) {
        cfg.homeHidden = cfg.homeHidden.filter(id => id !== entryId);
    } else {
        if (!cfg.homeHidden.includes(entryId)) cfg.homeHidden.push(entryId);
    }
    this.saveData();
    // 内联刷新，不重建窗口
    this._refreshEntryCfgList(catKey);
};



// ========== 隐藏目录一览（已简化为只读） ==========

/**
 * 【功能4】显示隐藏词条一览（只读）
 * 所有管理操作（隐藏/密码设置）请在词条编辑页面完成
 */
app.showHiddenCategoryManager = function() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[10002] flex items-center justify-center p-4 fade-in';

    const hiddenCfg = this.data.settings?.hiddenCategory || { entries: [] };
    if (!hiddenCfg.entries) hiddenCfg.entries = [];
    const hiddenIds = hiddenCfg.entries;

    // 所有设定词条
    const allSettings = this.data.entries.filter(e => e.type === 'non-character');
    const hiddenEntries = allSettings.filter(e => hiddenIds.includes(e.id));

    let hiddenHtml = hiddenEntries.map(e => {
        const v = e.versions?.[0];
        const pw = hiddenCfg.entryPasswords?.[e.id];
        const hasPw = pw && pw.answers && pw.answers.length > 0;
        return `<div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <span class="text-xs text-gray-500 font-mono w-16 truncate">${e.code}</span>
            <span class="flex-1 text-sm truncate">${this.escapeHtml(v ? v.title : e.code)}</span>
            ${hasPw ? `<span class="text-xs text-amber-600"><i class="fa-solid fa-lock mr-1"></i>${pw.answers.length}个答案</span>` : '<span class="text-xs text-gray-400">无密码</span>'}
            ${pw?.alwaysRequired !== false ? '<span class="text-xs text-indigo-600">每次需密码</span>' : '<span class="text-xs text-gray-400">记住后免密</span>'}
        </div>`;
    }).join('') || '<div class="text-center text-gray-400 text-sm py-8"><i class="fa-solid fa-eye-slash text-2xl mb-2 block"></i>暂无隐藏词条</div>';

    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[70vh]">
            <div class="p-4 border-b flex justify-between items-center">
                <h3 class="font-bold text-lg"><i class="fa-solid fa-eye-slash text-gray-500 mr-2"></i>隐藏词条一览</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="p-4 overflow-y-auto flex-1">
                <div class="text-xs text-gray-500 mb-3">共 ${hiddenEntries.length} 个隐藏词条 · 请在词条编辑页面管理</div>
                <div class="space-y-2">${hiddenHtml}</div>
            </div>
            <div class="p-4 border-t">
                <div class="text-xs text-gray-400 bg-gray-50 p-3 rounded-lg">
                    <i class="fa-solid fa-circle-info mr-1"></i>
                    要隐藏词条或设置密码保护，请在词条编辑页面将"设定目录"设为"隐藏"
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};

/**
 * 【功能4】显示"复制其他词条密码规则"对话框
 */
app.showCopyPasswordDialog = function(otherEntryIds) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-[10004] flex items-center justify-center p-4 fade-in';

    // 获取候选词条信息
    const entries = otherEntryIds.map(id => {
        const e = this.data.entries.find(x => x.id === id);
        if (!e) return null;
        const v = e.versions?.[0];
        const pw = this.data.settings?.hiddenCategory?.entryPasswords?.[id];
        return { id, code: e.code, title: v ? v.title : e.code, pw };
    }).filter(Boolean);

    const listHtml = entries.map(e => {
        const hasRules = e.pw?.rules && e.pw.rules.length > 0;
        return `<button onclick="app._doCopyPasswordRule('${e.id}')" class="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition flex items-center gap-3">
            <span class="text-xs text-gray-500 font-mono">${e.code}</span>
            <span class="flex-1 text-sm">${this.escapeHtml(e.title)}</span>
            <span class="text-xs ${hasRules ? 'text-indigo-600' : 'text-gray-400'}">${hasRules ? e.pw.rules.length + '条规则' : '无规则'}</span>
            <i class="fa-solid fa-copy text-gray-400"></i>
        </button>`;
    }).join('');

    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-bold text-lg"><i class="fa-solid fa-copy text-indigo-600 mr-2"></i>复制密码规则</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="text-xs text-gray-500 mb-3">选择一个词条，将其密码规则复制到当前词条</div>
            <div class="space-y-2 max-h-60 overflow-y-auto">${listHtml}</div>
            <div class="mt-4 flex justify-end">
                <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">取消</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
};

/**
 * 执行复制密码规则
 */
app._doCopyPasswordRule = function(fromEntryId) {
    const sourcePw = this.data.settings?.hiddenCategory?.entryPasswords?.[fromEntryId];
    if (!sourcePw) {
        this.showToast('源词条没有密码规则', 'error');
        return;
    }
    // 复制到当前编辑的词条
    if (!this.tempEntry) {
        this.showToast('没有正在编辑的词条', 'error');
        return;
    }
    if (!this.data.settings.hiddenCategory) this.data.settings.hiddenCategory = { entries: [] };
    if (!this.data.settings.hiddenCategory.entryPasswords) this.data.settings.hiddenCategory.entryPasswords = {};
    const targetPw = this.data.settings.hiddenCategory.entryPasswords[this.tempEntry.id] || {};
    targetPw.hint = sourcePw.hint || '';
    targetPw.answers = sourcePw.answers ? [...sourcePw.answers] : [];
    targetPw.alwaysRequired = sourcePw.alwaysRequired !== false;
    targetPw.defaultMessage = sourcePw.defaultMessage || '不对啦！';
    targetPw.rules = sourcePw.rules ? sourcePw.rules.map(r => ({ ...r })) : [];
    this.data.settings.hiddenCategory.entryPasswords[this.tempEntry.id] = targetPw;

    // 刷新UI
    const hintInput = app.$e('edit-hidden-pw-hint');
    const answersInput = app.$e('edit-hidden-pw-answers');
    const alwaysCheck = app.$e('edit-hidden-pw-always');
    if (hintInput) hintInput.value = targetPw.hint || '';
    if (answersInput) answersInput.value = (targetPw.answers || []).join('\n');
    if (alwaysCheck) alwaysCheck.checked = targetPw.alwaysRequired !== false;

    // 刷新规则列表
    const container = app.$e('edit-hidden-pw-rules');
    if (container) {
        container.innerHTML = '';
        this.addHiddenPwRule('default', '', targetPw.defaultMessage || '');
        (targetPw.rules || []).forEach(r => this.addHiddenPwRule(r.condition, r.answer, r.message));
    }

    // 关闭复制对话框
    document.querySelectorAll('.fixed.inset-0.z-\[10004\]').forEach(el => el.remove());
    this.showToast('密码规则已复制', 'success');
};

/**
 * 【功能4】显示密码输入对话框（黑底白字风格，显示词条名称）
 * @param {string} hint - 提示词
 * @param {Function} onSuccess - 密码正确时的回调
 * @param {Function} onCancel - 点击返回时的回调
 * @param {string|null} errorMessage - 错误提示消息
 * @param {string} entryName - 词条名称（显示"xx已锁定"）
 * @param {string} entryId - 词条ID
 */
app.showPasswordDialog = function(hint, onSuccess, onCancel, errorMessage, entryName, entryId) {
    // 关闭已存在的密码对话框
    document.querySelectorAll('.pw-dialog-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'pw-dialog-overlay fixed inset-0 bg-black z-[9999] flex items-center justify-center p-4 fade-in';
    const errorHtml = errorMessage ? `<div class="text-red-400 text-sm mb-4 text-center animate-pulse"><i class="fa-solid fa-circle-exclamation mr-1"></i>${errorMessage}</div>` : '';
    const nameHtml = entryName ? `<div class="text-white font-bold text-lg mb-1">${app.escapeHtml(entryName)}</div>` : '';
    overlay.innerHTML = `
        <div class="w-full max-w-sm">
            <div class="text-center mb-8">
                <div class="w-14 h-14 rounded-full border-2 border-gray-600 flex items-center justify-center mx-auto mb-4">
                    <i class="fa-solid fa-lock text-gray-400 text-xl"></i>
                </div>
                ${nameHtml}
                <div class="text-gray-500 text-sm mb-1">该词条已锁定</div>
                <div class="text-gray-400 text-xs">请根据要求输入口令</div>
            </div>
            ${hint ? `<div class="text-gray-300 text-sm mb-3 text-center"><i class="fa-solid fa-circle-question mr-1 text-gray-500"></i>${app.escapeHtml(hint)}</div>` : ''}
            ${errorHtml}
            <input type="text" id="pw-input" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white mb-4 focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none placeholder-gray-600" placeholder="输入口令..." autocomplete="off">
            <div class="flex gap-3">
                <button id="pw-cancel" class="flex-1 py-2.5 border border-gray-700 text-gray-400 rounded-lg hover:bg-gray-900 hover:text-gray-200 transition text-sm">返回</button>
                <button id="pw-submit" class="flex-1 py-2.5 bg-gray-100 text-black rounded-lg hover:bg-white transition text-sm font-medium">确认</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#pw-input');
    input.focus();

    const submit = () => {
        const val = input.value.trim();
        // 【修复】空输入不通过：不关闭对话框，显示错误
        if (!val) {
            const existingError = overlay.querySelector('.pw-empty-error');
            if (!existingError) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'pw-empty-error text-red-400 text-sm mb-4 text-center animate-pulse';
                errorDiv.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-1"></i>请输入口令后再确认';
                input.parentNode.insertBefore(errorDiv, input);
            }
            input.focus();
            return;
        }
        overlay.remove();
        onSuccess(val);
    };

    overlay.querySelector('#pw-submit').onclick = submit;
    input.onkeydown = (e) => {
        // 清除空输入错误提示
        if (e.key !== 'Enter') {
            const emptyError = overlay.querySelector('.pw-empty-error');
            if (emptyError) emptyError.remove();
        }
        if (e.key === 'Enter') submit();
    };
    overlay.querySelector('#pw-cancel').onclick = () => { overlay.remove(); onCancel && onCancel(); };
    overlay.onclick = (e) => { if (e.target === overlay) { /* 点击遮罩不关闭，必须点返回 */ } };
};

console.log('Part 6-1-Enhanced (Edit Core) v4.0 加载完成');
console.log('包含：Layer1(版本级别重要程度), Layer4(置顶时间设置), Layer5(并行区间与失踪区间置顶设置)');

// ========== 活动页词条编辑专用函数 ==========

/**
 * 【关键修复】处理活动页头图上传
 * 模仿 finalizeCropping 模式：saveImage写入OPFS/本地文件夹 + {{IMG:}}引用
 */
app.handleEventHeaderUpload = async function(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('请选择图片文件'); input.value=''; return; }

    // 检查storageManager是否可用
    if (!this.storageManager) {
        console.warn('[EventHeader] storageManager不可用，尝试直接保存dataUrl');
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        const dataUrl = e.target.result;
        const preview = app.$e('edit-event-header-preview');
        const placeholder = app.$e('edit-event-header-placeholder');
        const removeBtn = app.$e('edit-event-header-remove');

        let imgRef = dataUrl; // 默认使用dataUrl（storageManager不可用时）

        // 【关键】使用固定文件名写入OPFS/本地文件夹，数据中存{{IMG:}}引用
        if (this.storageManager && this.tempEntry && this.tempEntry.id) {
            try {
                const entryId = this.tempEntry.id;
                const versionId = (this.tempVersion && this.tempVersion.vid) || 'v0';
                const ext = dataUrl.includes('image/png') ? 'png' : 'jpg';
                const filename = `${entryId}_${versionId}_header.${ext}`;

                await this.storageManager.saveImage(filename, dataUrl, {
                    entryId: entryId,
                    versionId: versionId,
                    type: 'header'
                });

                imgRef = `{{IMG:${filename}}}`;
                console.log('[EventHeader] 已写入OPFS/本地文件夹:', filename);
            } catch (err) {
                console.warn('[EventHeader] saveImage失败，回退到dataUrl:', err.message);
                imgRef = dataUrl;
            }
        }

        if (preview) {
            preview.src = dataUrl; // 预览始终用dataUrl
            preview.classList.remove('hidden');
            preview.dataset.originalSrc = imgRef; // 存{{IMG:}}引用或dataUrl
        }
        if (placeholder) placeholder.classList.add('hidden');
        if (removeBtn) removeBtn.classList.remove('hidden');

        this.tempEntry.headerImage = imgRef;
        console.log('[EventHeader] Header image uploaded, ref:', imgRef.substring(0, 50));
    };
    reader.readAsDataURL(file);
    input.value = '';
};

/**
 * 删除活动页头图
 */
app.removeEventHeaderImage = function() {
    const preview = app.$e('edit-event-header-preview');
    const placeholder = app.$e('edit-event-header-placeholder');
    const removeBtn = app.$e('edit-event-header-remove');

    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.add('hidden');

    this.tempEntry.headerImage = null;
};

/**
 * 切换持续时间类型
 */
app.onEventDurationTypeChange = function(value) {
    const dateContainer = document.getElementById('event-duration-dates');
    if (dateContainer) {
        dateContainer.classList.toggle('hidden', value === 'permanent');
    }
};

/**
 * 【关键修复】处理图片元件上传
 * 模仿 finalizeCropping 模式：saveImage写入OPFS/本地文件夹 + {{IMG:}}引用
 */
app.handleImgBlockUpload = async function(input, blockIndex) {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('请选择图片文件'); input.value=''; return; }

    const reader = new FileReader();
    reader.onload = async (e) => {
        const dataUrl = e.target.result;
        const preview = document.getElementById(`img-block-preview-${blockIndex}`);
        const placeholder = document.getElementById(`img-block-placeholder-${blockIndex}`);
        const srcInput = document.querySelector(`#edit-blocks-container > div:nth-child(${blockIndex + 1}) .block-image-src`);

        let imgRef = dataUrl;

        // 【关键】使用固定文件名写入OPFS/本地文件夹，数据中存{{IMG:}}引用
        if (this.storageManager && this.tempEntry && this.tempEntry.id) {
            try {
                const entryId = this.tempEntry.id;
                const versionId = (this.tempVersion && this.tempVersion.vid) || 'v0';
                const ext = dataUrl.includes('image/png') ? 'png' : 'jpg';
                const filename = `${entryId}_${versionId}_block_${blockIndex}.${ext}`;

                await this.storageManager.saveImage(filename, dataUrl, {
                    entryId: entryId,
                    versionId: versionId,
                    type: 'block_img'
                });

                imgRef = `{{IMG:${filename}}}`;
                console.log('[ImgBlock] 已写入OPFS/本地文件夹:', filename);
            } catch (err) {
                console.warn('[ImgBlock] saveImage失败，回退到dataUrl:', err.message);
                imgRef = dataUrl;
            }
        }

        if (preview) {
            preview.src = dataUrl;
            preview.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
        if (srcInput) srcInput.value = imgRef;

        // 同步到 tempVersion
        if (this.tempVersion && this.tempVersion.blocks && this.tempVersion.blocks[blockIndex]) {
            this.tempVersion.blocks[blockIndex].src = imgRef;
        }

        console.log('[ImgBlock] Image uploaded for block', blockIndex, 'ref:', imgRef.substring(0, 50));
    };
    reader.readAsDataURL(file);
    input.value = '';
};

// ========== 词条迁移：导出与导入 ==========

/**
 * 导出当前编辑的版本为单一版本存档
 * 导出范围：大标题、题记、图片、重要程度、元件
 * 不导出：时间轴、角色关系、阵营、置顶设置等
 */
app.exportEntry = function() {
    if (!this.tempEntry || !this.tempVersion) {
        this.showToast('当前没有可导出的词条', 'warning');
        return;
    }
    const entry = this.tempEntry;
    if (entry.type !== 'character' && entry.type !== 'non-character') {
        this.showToast('仅支持导出角色/设定类词条', 'error');
        return;
    }
    const v = this.tempVersion;
    // 计算当前版本在所有版本中的索引
    const currentVidx = entry.versions.findIndex(ver => ver.vid === v.vid);
    const versionLabel = currentVidx >= 0 ? `V${currentVidx + 1}` : 'V?';

    // 【关键】导出时将词条索引链接转换为纯文本（外链保留）
    const convertLinksToText = (text) => {
        if (!text) return text;
        // [[entryId|versionId:displayText]] → displayText
        text = text.replace(/\[\[[^\]|]+\|[^:\]]+:[^\]]+\]\]/g, (match) => {
            const lastColon = match.lastIndexOf(':');
            return match.substring(lastColon + 1, match.length - 2);
        });
        // [[entryId:displayText]] → displayText
        text = text.replace(/\[\[[^:\]]+:[^\]]+\]\]/g, (match) => {
            const colon = match.indexOf(':');
            return match.substring(colon + 1, match.length - 2);
        });
        return text;
    };
    const exportedBlocks = v.blocks ? JSON.parse(JSON.stringify(v.blocks)).map(b => {
        if (b.text !== undefined) b.text = convertLinksToText(b.text);
        if (b.caption !== undefined) b.caption = convertLinksToText(b.caption);
        return b;
    }) : [];

    const exportData = {
        _format: 'glight-wiki-entry',
        _version: 1,
        exportedAt: new Date().toISOString(),
        _archiveInfo: {
            type: entry.type === 'character' ? '角色' : '设定',
            versionIndex: currentVidx >= 0 ? currentVidx + 1 : 1,
            totalVersions: entry.versions.length
        },
        entry: {
            type: entry.type,
            versions: [{
                vid: v.vid,
                title: v.title || '',
                subtitle: v.subtitle || '',
                level: v.level !== undefined ? v.level : 5,
                image: v.image || null,
                images: v.images ? JSON.parse(JSON.stringify(v.images)) : null,
                blocks: exportedBlocks
            }]
        }
    };
    const title = v.title || entry.code || 'entry';
    const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
    const typeLabel = entry.type === 'character' ? '角色' : '设定';
    const filename = `Wiki${typeLabel}_${safeTitle}_${versionLabel}.json`;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`已导出: ${filename}`, 'success');
};

/**
 * 常驻导入按钮 — 支持三种存档类型识别
 * - glight-wiki-entry：单一版本存档
 * - glight-wiki-entry-batch：批量词条存档
 * - Wiki全量存档（含 entries/chapters/synopsis/settings）：提示去设置页
 */
app.importEntry = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // 1. Wiki全量存档检测（含 entries + chapters + synopsis + settings）
            if (data.entries && data.chapters && data.synopsis && data.settings) {
                this.showToast('此为Wiki全量存档，请到设置页进行操作', 'warning');
                return;
            }

            // 2. 批量存档
            if (data._format === 'glight-wiki-entry-batch') {
                if (!Array.isArray(data.entries) || data.entries.length === 0) {
                    this.showToast('批量存档中没有词条数据', 'error');
                    return;
                }
                await this._importBatchArchive(data.entries, file.name);
                return;
            }

            // 3. 单一版本存档
            if (data._format === 'glight-wiki-entry') {
                if (!data.entry || typeof data.entry !== 'object') {
                    this.showToast('存档中缺少词条数据', 'error');
                    return;
                }
                const importedEntry = data.entry;
                if (importedEntry.type !== 'character' && importedEntry.type !== 'non-character') {
                    this.showToast(`不支持的词条类型: ${importedEntry.type}`, 'error');
                    return;
                }
                if (!Array.isArray(importedEntry.versions) || importedEntry.versions.length === 0) {
                    this.showToast('存档中没有版本数据', 'error');
                    return;
                }

                // 调试日志：记录存档内容摘要
                const src = importedEntry.versions[0];
                console.log('[Import] 存档解析成功:', {
                    title: src.title,
                    subtitle: src.subtitle,
                    blocksCount: src.blocks ? src.blocks.length : 0,
                    firstBlockType: src.blocks && src.blocks[0] ? src.blocks[0].type : 'none',
                    firstBlockText: src.blocks && src.blocks[0] ? src.blocks[0].text?.substring(0, 50) : 'none'
                });

                // 当前处于编辑状态时：追加到当前词条
                if (this.data.currentView === 'edit' && this.tempEntry) {
                    await this._applyImportToCurrentEntry(importedEntry);
                    return;
                }

                // 非编辑状态：新增词条并进入编辑
                await this._importAsNewEntry(importedEntry, file.name);
                return;
            }

            this.showToast('无法识别的存档格式', 'error');
        } catch (err) {
            console.error('[Import] 解析失败:', err);
            this.showToast('文件解析失败: ' + (err.message || '未知错误'), 'error');
        }
    };
    input.click();
};

/**
 * 判断版本是否为空白版本（只有默认设置，无实质内容）
 * 重要程度5级、阵营空、时间轴空等默认值不算非空白
 * doCreateNewVersion 生成的 "-新形态"/"-并行态" 标题视为空白
 */
app._isBlankVersion = function(version) {
    if (!version) return true;
    // 标题非空且不是自动生成的默认标题
    if (version.title && version.title.trim().length > 0) {
        const t = version.title.trim();
        if (!t.endsWith('-新形态') && !t.endsWith('-并行态')) return false;
    }
    // 题记非空
    if (version.subtitle && version.subtitle.trim().length > 0) return false;
    // 图片非空（data URL 或 {{IMG:}} 引用都算有图片）
    if (version.image) return false;
    if (version.images) {
        if (version.images.avatar || version.images.card || version.images.cover) return false;
    }
    // blocks 有实质内容
    if (version.blocks && version.blocks.length > 0) {
        const hasContent = version.blocks.some(b => {
            if (b.type === 'p') return b.text && b.text.trim().length > 0;
            if (b.type === 'h2' || b.type === 'h3') return b.text && b.text.trim().length > 0;
            if (b.type === 'img') return b.src && b.src.trim().length > 0;
            if (b.type === 'table') return b.rows && b.rows.length > 0;
            return false;
        });
        if (hasContent) return false;
    }
    return true;
};

/**
 * 同步存档中的图片到本地存储
 * @param {Object} version - 存档版本
 * @returns {Promise<void>}
 */
app._syncArchiveImages = async function(version) {
    if (!version) return;
    const isDataUrl = (s) => s && typeof s === 'string' && s.startsWith('data:');
    const isImgRef = (s) => s && typeof s === 'string' && s.startsWith('{{IMG:');
    let savedCount = 0, skippedCount = 0;
    /**
     * 保存data URL图片到本地存储，返回 {{IMG:filename}} 格式引用
     */
    const saveIfDataUrl = async (src, type) => {
        if (!isDataUrl(src)) { skippedCount++; return src; }
        try {
            const filename = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + '.png';
            if (this.storageManager && this.storageManager.saveImage) {
                await this.storageManager.saveImage(filename, src, { type });
                savedCount++;
            }
            if (this.imageCache) this.imageCache[filename] = src;
            return '{{IMG:' + filename + '}}';
        } catch (e) {
            console.warn('[Import] 图片保存失败，保留原始data URL:', e.message);
            return src;
        }
    };
    // 头图
    if (version.image) version.image = await saveIfDataUrl(version.image, 'card');
    // 图片集
    if (version.images) {
        if (version.images.avatar) version.images.avatar = await saveIfDataUrl(version.images.avatar, 'avatar');
        if (version.images.card) version.images.card = await saveIfDataUrl(version.images.card, 'card');
        if (version.images.cover) version.images.cover = await saveIfDataUrl(version.images.cover, 'cover');
    }
    // 元件图片（img 类型 block 的 src）
    if (version.blocks) {
        for (const block of version.blocks) {
            if (block.type === 'img' && block.src) {
                if (isDataUrl(block.src)) {
                    block.src = await saveIfDataUrl(block.src, 'block');
                } else if (isImgRef(block.src)) {
                    // {{IMG:filename}} 引用格式，尝试从当前Wiki加载图片数据
                    const match = block.src.match(/\{\{IMG:(.+?)\}\}/);
                    if (match && this.storageManager && this.storageManager.loadImage) {
                        try {
                            const existingUrl = await this.storageManager.loadImage(match[1]);
                            if (!existingUrl) {
                                console.warn('[Import] 图片引用在原Wiki中不存在:', match[1]);
                            }
                        } catch (e) {
                            console.warn('[Import] 图片引用检查失败:', match[1], e.message);
                        }
                    }
                }
            }
        }
    }
    console.log('[Import] 图片同步完成:', { saved: savedCount, skipped: skippedCount });
};

/**
 * 将单一版本存档导入到当前编辑的词条
 * 统一流程：无论当前版本是否空白，都创建新空白版本并导入到该版本
 * 确保"先导入后新建"和"先新建后导入"结果完全一致
 */
app._applyImportToCurrentEntry = async function(importedEntry) {
    const source = importedEntry.versions[0];
    if (!source.blocks) source.blocks = [];

    console.log('[Import] 开始导入到当前词条:', {
        sourceTitle: source.title,
        sourceSubtitle: source.subtitle,
        sourceBlocksCount: source.blocks.length,
        currentVersionTitle: this.tempVersion.title,
        currentVersionBlocksCount: this.tempVersion.blocks ? this.tempVersion.blocks.length : 0
    });

    // 【关键】先同步图片到本地存储
    await this._syncArchiveImages(source);

    // 【统一流程】创建全新的空白版本作为导入目标
    const newVid = 'v-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const newVersion = {
        vid: newVid,
        title: '',
        subtitle: '',
        level: 5,
        image: null,
        images: { avatar: null, card: null, cover: null },
        chapterFrom: null,
        chapterTo: null,
        relatedCharacters: [],
        relatedVersions: [],
        isDraft: false,
        blocks: []
    };

    // 【核心】从存档复制内容到新版本 — 强制覆盖所有内容字段
    newVersion.title = source.title || '';
    newVersion.subtitle = source.subtitle || '';
    newVersion.image = source.image || null;
    newVersion.images = source.images ? JSON.parse(JSON.stringify(source.images)) : { avatar: null, card: null, cover: null };
    newVersion.level = source.level !== undefined ? source.level : 5;
    newVersion.blocks = source.blocks ? JSON.parse(JSON.stringify(source.blocks)) : [];

    // 【强化】防御性检查：确保标题和题记已正确导入
    if (source.title && (!newVersion.title || newVersion.title.trim().length === 0)) {
        console.warn('[Import] 标题导入失败，强制同步:', source.title);
        newVersion.title = source.title;
    }
    if (source.subtitle && (!newVersion.subtitle || newVersion.subtitle.trim().length === 0)) {
        console.warn('[Import] 题记导入失败，强制同步:', source.subtitle);
        newVersion.subtitle = source.subtitle;
    }

    console.log('[Import] 新版本创建完成:', {
        newVersionTitle: newVersion.title,
        newVersionSubtitle: newVersion.subtitle,
        newVersionBlocksCount: newVersion.blocks.length
    });

    // 将新版本添加到词条
    this.tempEntry.versions.push(newVersion);

    // 切换到新版本
    this.tempVersion = JSON.parse(JSON.stringify(newVersion));
    this.editingVersionId = newVid;
    this.data.viewingVersionId = newVid;
    this.editState.hasChanges = true;

    // 渲染编辑界面
    this.renderEdit(this.getEntryContainer ? this.getEntryContainer() : document.getElementById('main-container'));

    // 【强化】渲染后再次确认标题和题记已正确同步到DOM
    setTimeout(() => {
        const titleInput = app.$e('edit-title');
        const subtitleInput = app.$e('edit-subtitle');
        if (titleInput && titleInput.value !== newVersion.title) {
            console.log('[Import] 强制同步标题到DOM:', newVersion.title);
            titleInput.value = newVersion.title;
            // 触发input事件，确保编辑状态同步
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (subtitleInput && subtitleInput.value !== newVersion.subtitle) {
            console.log('[Import] 强制同步题记到DOM:', newVersion.subtitle);
            subtitleInput.value = newVersion.subtitle;
            // 触发input事件，确保编辑状态同步
            subtitleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, 100);

    this.showToast(`已导入: ${source.title || '未命名'}`, 'success');
};

/**
 * 将单一版本存档作为新词条导入并进入编辑
 */
app._importAsNewEntry = function(importedEntry, filename) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[10001] flex items-center justify-center p-4 fade-in';
    const src = importedEntry.versions[0];
    const typeLabel = importedEntry.type === 'character' ? '角色' : '设定';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl max-w-sm w-full">
            <div class="flex items-center justify-between p-4 border-b">
                <h3 class="font-bold text-gray-800"><i class="fa-solid fa-file-import text-teal-600 mr-2"></i>导入词条存档</h3>
                <button class="close-modal text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="p-4 space-y-3">
                <div class="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div class="flex justify-between"><span class="text-gray-500">文件名</span><span class="text-gray-800 font-medium truncate max-w-[200px]">${filename}</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">类型</span><span class="text-gray-800 font-medium">${typeLabel}</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">名称</span><span class="text-gray-800 font-medium">${src.title || '未命名'}</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">导入内容</span><span class="text-teal-600 font-medium">大标题、题记、图片、重要程度、元件</span></div>
                </div>
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <p class="text-xs text-amber-700"><i class="fa-solid fa-triangle-exclamation mr-1"></i>将新建词条并进入编辑界面，请手动保存</p>
                </div>
            </div>
            <div class="p-4 border-t flex gap-2 justify-end">
                <button class="close-modal px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition">取消</button>
                <button id="import-new-confirm" class="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition font-medium">
                    <i class="fa-solid fa-check mr-1"></i>确认导入
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('.close-modal').forEach(btn => btn.onclick = () => modal.remove());
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.querySelector('#import-new-confirm').onclick = async () => {
        modal.remove();
        // 【关键】先同步图片到本地存储
        await this._syncArchiveImages(src);
        // 创建新词条结构
        const type = importedEntry.type;
        const code = this.generateCode(type);
        const entry = {
            id: (type === 'character' ? 'char-' : 'non-') + Date.now(),
            type: type,
            code: code,
            camp: type === 'character' ? '' : '',
            settingType: type === 'non-character' ? 'world' : null,
            pinned: false,
            pinStartChapter: null,
            pinEndChapter: null,
            pinnedVersions: {},
            missingIntervalVersion: null,
            defaultPinnedVersion: null,
            createdAt: Date.now(),
            versions: []
        };
        const version = {
            vid: 'v-' + Date.now(),
            title: src.title || '',
            subtitle: src.subtitle || '',
            level: src.level !== undefined ? src.level : 5,
            image: src.image || null,
            images: src.images ? JSON.parse(JSON.stringify(src.images)) : { avatar: null, card: null, cover: null },
            chapterFrom: null,
            chapterTo: null,
            blocks: src.blocks ? JSON.parse(JSON.stringify(src.blocks)) : [],
            relatedVersions: [],
            relatedCharacters: [],
            createdAt: Date.now()
        };
        entry.versions.push(version);
        // 设置状态并进入编辑 — 【关键】不设置 editingId，让 renderEdit 走新建模式保留 tempEntry
        this.tempEntry = entry;
        this.tempVersion = JSON.parse(JSON.stringify(version));
        this.editingVersionId = version.vid;
        this.data.editingId = null; // 强制走新建模式
        this.data.viewingVersionId = version.vid;
        this.data.editingType = type;
        this.editState.hasChanges = true;
        this.editState.originalEntry = null;
        this.editState.originalVersion = null;
        this.unbindEditKeyboardShortcuts();
        this.router('edit');
        this.showToast(`已导入: ${src.title || '未命名'}，请保存`, 'success');
    };
};

/**
 * 导入批量存档
 */
app._importBatchArchive = function(entries, filename) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[10001] flex items-center justify-center p-4 fade-in';
    const entryList = entries.map((en, i) => {
        const v = en.versions && en.versions[0];
        const typeLabel = en.type === 'character' ? '角色' : '设定';
        return `<div class="flex justify-between text-sm py-1 border-b border-gray-100 last:border-0">
            <span class="text-gray-700">${i + 1}. ${v ? v.title : '未命名'}</span>
            <span class="text-gray-400 text-xs">${typeLabel} ${en.versions ? en.versions.length + '版本' : ''}</span>
        </div>`;
    }).join('');
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
            <div class="flex items-center justify-between p-4 border-b shrink-0">
                <h3 class="font-bold text-gray-800"><i class="fa-solid fa-box-archive text-teal-600 mr-2"></i>导入批量存档</h3>
                <button class="close-modal text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="p-4 space-y-3 overflow-y-auto flex-1">
                <div class="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div class="flex justify-between"><span class="text-gray-500">文件名</span><span class="text-gray-800 font-medium truncate max-w-[200px]">${filename}</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">词条数</span><span class="text-gray-800 font-medium">${entries.length} 个</span></div>
                </div>
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <p class="text-xs text-amber-700"><i class="fa-solid fa-triangle-exclamation mr-1"></i>时间轴、角色关系、阵营等不会被导入</p>
                </div>
                <div class="border border-gray-200 rounded-lg p-2 max-h-[30vh] overflow-y-auto">${entryList}</div>
            </div>
            <div class="p-4 border-t flex gap-2 justify-end shrink-0">
                <button class="close-modal px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition">取消</button>
                <button id="import-batch-confirm" class="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition font-medium">
                    <i class="fa-solid fa-check mr-1"></i>确认导入 ${entries.length} 个词条
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('.close-modal').forEach(btn => btn.onclick = () => modal.remove());
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.querySelector('#import-batch-confirm').onclick = async () => {
        modal.remove();
        // 【关键】先同步所有存档中的图片到本地存储
        for (const srcEntry of entries) {
            for (const srcV of (srcEntry.versions || [])) {
                await this._syncArchiveImages(srcV);
            }
        }
        const applyContentFields = (target, src) => {
            if (src.title !== undefined) target.title = src.title;
            if (src.subtitle !== undefined) target.subtitle = src.subtitle;
            if (src.image !== undefined) target.image = src.image;
            if (src.images !== undefined) target.images = JSON.parse(JSON.stringify(src.images));
            if (src.level !== undefined) target.level = src.level;
            if (src.blocks !== undefined) target.blocks = JSON.parse(JSON.stringify(src.blocks));
        };
        let success = 0, fail = 0;
        entries.forEach(srcEntry => {
            try {
                const type = srcEntry.type;
                const code = this.generateCode(type);
                const newEntry = {
                    id: (type === 'character' ? 'char-' : 'non-') + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                    type: type,
                    code: code,
                    camp: type === 'character' ? '' : '',
                    settingType: type === 'non-character' ? 'world' : null,
                    pinned: false,
                    pinStartChapter: null,
                    pinEndChapter: null,
                    pinnedVersions: {},
                    missingIntervalVersion: null,
                    defaultPinnedVersion: null,
                    createdAt: Date.now(),
                    versions: []
                };
                (srcEntry.versions || []).forEach((srcV, vi) => {
                    const newVid = 'v-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6) + '-' + vi;
                    const newVersion = {
                        vid: newVid,
                        title: '',
                        subtitle: type === 'event' ? null : '',
                        level: type === 'event' ? null : 5,
                        image: null,
                        images: type === 'event' ? null : { avatar: null, card: null, cover: null },
                        chapterFrom: null,
                        chapterTo: null,
                        blocks: [],
                        relatedVersions: type === 'event' ? null : [],
                        relatedCharacters: type === 'event' ? null : [],
                        createdAt: Date.now()
                    };
                    applyContentFields(newVersion, srcV);
                    newEntry.versions.push(newVersion);
                });
                this.data.entries.push(newEntry);
                success++;
            } catch (e) {
                console.error('[BatchImport] 词条导入失败:', e);
                fail++;
            }
        });
        this.saveData();
        // 刷新当前页面
        const view = this.data.currentView;
        if (view === 'characters' || view === 'settings') {
            this.renderCharacterList(document.getElementById('main-container'));
        } else if (view === 'world') {
            this.renderWorldSettings(document.getElementById('main-container'));
        }
        this.showToast(`批量导入完成: ${success} 成功${fail > 0 ? ', ' + fail + ' 失败' : ''}`, success > 0 ? 'success' : 'error');
    };
};

// ========== 批量设置 ==========

/**
 * 显示批量设置弹窗 — 多选角色/设定词条，支持删除和导出
 */
app.showBatchSettings = function() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[10001] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div class="flex items-center justify-between p-4 border-b shrink-0">
                <h3 class="font-bold text-gray-800"><i class="fa-solid fa-list-check text-gray-600 mr-2"></i>批量设置</h3>
                <button class="close-modal text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="p-3 border-b shrink-0">
                <div class="flex gap-2">
                    <button id="batch-select-all" class="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition">全选</button>
                    <button id="batch-select-none" class="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition">全不选</button>
                    <button id="batch-select-char" class="px-3 py-1 text-xs bg-indigo-100 hover:bg-indigo-200 rounded text-indigo-600 transition">仅角色</button>
                    <button id="batch-select-setting" class="px-3 py-1 text-xs bg-emerald-100 hover:bg-emerald-200 rounded text-emerald-600 transition">仅设定</button>
                </div>
                <div class="flex gap-2 mt-2">
                    <span id="batch-selected-count" class="text-xs text-gray-500">已选 0 个</span>
                </div>
            </div>
            <div id="batch-entry-list" class="overflow-y-auto flex-1 p-2 space-y-1"></div>
            <div class="p-4 border-t flex gap-2 justify-end shrink-0">
                <button class="close-modal px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition">关闭</button>
                <button id="batch-export-btn" class="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition font-medium flex items-center gap-1">
                    <i class="fa-solid fa-file-export"></i> 导出所选
                </button>
                <button id="batch-delete-btn" class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition font-medium flex items-center gap-1">
                    <i class="fa-solid fa-trash"></i> 删除所选
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const listContainer = modal.querySelector('#batch-entry-list');
    const countEl = modal.querySelector('#batch-selected-count');
    const selected = new Set();

    const updateCount = () => {
        countEl.textContent = `已选 ${selected.size} 个`;
    };

    const renderList = () => {
        listContainer.innerHTML = '';
        const charEntries = this.data.entries.filter(e => e.type === 'character');
        const settingEntries = this.data.entries.filter(e => e.type === 'non-character');

        // 角色分组
        if (charEntries.length > 0) {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'text-xs font-bold text-indigo-600 px-2 py-1 mt-1';
            groupHeader.textContent = `角色 (${charEntries.length})`;
            listContainer.appendChild(groupHeader);
            charEntries.forEach(entry => {
                const v = entry.versions && entry.versions[0];
                const title = v ? v.title : '未命名';
                const item = document.createElement('div');
                item.className = 'flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer transition';
                item.innerHTML = `
                    <input type="checkbox" class="batch-checkbox w-4 h-4 text-indigo-600 rounded" data-id="${entry.id}" ${selected.has(entry.id) ? 'checked' : ''}>
                    <span class="text-xs font-mono text-gray-400 w-16">${entry.code}</span>
                    <span class="text-sm text-gray-800 flex-1 truncate">${title}</span>
                    <span class="text-xs text-gray-400">${entry.versions ? entry.versions.length + '版本' : ''}</span>
                `;
                item.onclick = (e) => {
                    if (e.target.type !== 'checkbox') {
                        const cb = item.querySelector('.batch-checkbox');
                        cb.checked = !cb.checked;
                    }
                    const cb = item.querySelector('.batch-checkbox');
                    if (cb.checked) selected.add(entry.id); else selected.delete(entry.id);
                    updateCount();
                };
                item.querySelector('.batch-checkbox').onchange = (e) => {
                    if (e.target.checked) selected.add(entry.id); else selected.delete(entry.id);
                    updateCount();
                };
                listContainer.appendChild(item);
            });
        }

        // 设定分组
        if (settingEntries.length > 0) {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'text-xs font-bold text-emerald-600 px-2 py-1 mt-1';
            groupHeader.textContent = `设定 (${settingEntries.length})`;
            listContainer.appendChild(groupHeader);
            settingEntries.forEach(entry => {
                const v = entry.versions && entry.versions[0];
                const title = v ? v.title : '未命名';
                const item = document.createElement('div');
                item.className = 'flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer transition';
                item.innerHTML = `
                    <input type="checkbox" class="batch-checkbox w-4 h-4 text-indigo-600 rounded" data-id="${entry.id}" ${selected.has(entry.id) ? 'checked' : ''}>
                    <span class="text-xs font-mono text-gray-400 w-16">${entry.code}</span>
                    <span class="text-sm text-gray-800 flex-1 truncate">${title}</span>
                    <span class="text-xs text-gray-400">${entry.versions ? entry.versions.length + '版本' : ''}</span>
                `;
                item.onclick = (e) => {
                    if (e.target.type !== 'checkbox') {
                        const cb = item.querySelector('.batch-checkbox');
                        cb.checked = !cb.checked;
                    }
                    const cb = item.querySelector('.batch-checkbox');
                    if (cb.checked) selected.add(entry.id); else selected.delete(entry.id);
                    updateCount();
                };
                item.querySelector('.batch-checkbox').onchange = (e) => {
                    if (e.target.checked) selected.add(entry.id); else selected.delete(entry.id);
                    updateCount();
                };
                listContainer.appendChild(item);
            });
        }
    };

    renderList();

    modal.querySelector('#batch-select-all').onclick = () => {
        this.data.entries.filter(e => e.type === 'character' || e.type === 'non-character').forEach(e => selected.add(e.id));
        renderList(); updateCount();
    };
    modal.querySelector('#batch-select-none').onclick = () => {
        selected.clear(); renderList(); updateCount();
    };
    modal.querySelector('#batch-select-char').onclick = () => {
        selected.clear();
        this.data.entries.filter(e => e.type === 'character').forEach(e => selected.add(e.id));
        renderList(); updateCount();
    };
    modal.querySelector('#batch-select-setting').onclick = () => {
        selected.clear();
        this.data.entries.filter(e => e.type === 'non-character').forEach(e => selected.add(e.id));
        renderList(); updateCount();
    };

    modal.querySelector('#batch-delete-btn').onclick = () => {
        if (selected.size === 0) { this.showToast('请先选择词条', 'warning'); return; }
        if (!confirm(`确定删除选中的 ${selected.size} 个词条？\n\n此操作不可撤销！`)) return;
        const ids = Array.from(selected);
        ids.forEach(id => {
            const idx = this.data.entries.findIndex(e => e.id === id);
            if (idx >= 0) {
                // 回收编号
                const entry = this.data.entries[idx];
                if (entry && entry.code) {
                    const match = entry.code.match(/^(\D+)(\d+)$/);
                    if (match && !this.data.recycledCodes.includes(entry.code)) {
                        this.data.recycledCodes.push(entry.code);
                    }
                }
                this.data.entries.splice(idx, 1);
            }
        });
        this.saveData();
        // 如果当前正在查看被删除的词条，回到首页
        if (this.data.editingId && ids.includes(this.data.editingId)) {
            this.data.editingId = null;
            this.data.viewingVersionId = null;
        }
        modal.remove();
        // 刷新当前页面
        const view = this.data.currentView;
        if (view === 'characters') this.renderCharacterList(document.getElementById('main-container'));
        else if (view === 'world') this.renderWorldSettings(document.getElementById('main-container'));
        else if (view === 'edit') this.cancelEdit();
        else this.router(view);
        this.showToast(`已删除 ${ids.length} 个词条`, 'success');
    };

    modal.querySelector('#batch-export-btn').onclick = () => {
        if (selected.size === 0) { this.showToast('请先选择词条', 'warning'); return; }
        const selectedEntries = this.data.entries.filter(e => selected.has(e.id));
        // 【关键】导出时将词条索引链接转换为纯文本
        const convertLinksToText = (text) => {
            if (!text) return text;
            text = text.replace(/\[\[[^\]|]+\|[^:\]]+:[^\]]+\]\]/g, (match) => {
                const lastColon = match.lastIndexOf(':');
                return match.substring(lastColon + 1, match.length - 2);
            });
            text = text.replace(/\[\[[^:\]]+:[^\]]+\]\]/g, (match) => {
                const colon = match.indexOf(':');
                return match.substring(colon + 1, match.length - 2);
            });
            return text;
        };
        // 构建批量导出数据（包含所有版本）
        const extractContentVersion = (v) => {
            const exportedBlocks = v.blocks ? JSON.parse(JSON.stringify(v.blocks)).map(b => {
                if (b.text !== undefined) b.text = convertLinksToText(b.text);
                if (b.caption !== undefined) b.caption = convertLinksToText(b.caption);
                return b;
            }) : [];
            return {
                vid: v.vid,
                title: v.title || '',
                subtitle: v.subtitle || '',
                level: v.level !== undefined ? v.level : 5,
                image: v.image || null,
                images: v.images ? JSON.parse(JSON.stringify(v.images)) : null,
                blocks: exportedBlocks
            };
        };
        // 统计类型
        const charCount = selectedEntries.filter(e => e.type === 'character').length;
        const settingCount = selectedEntries.filter(e => e.type === 'non-character').length;
        const now = new Date();
        const timeStr = now.toISOString().slice(0, 19).replace('T', '_');
        const exportData = {
            _format: 'glight-wiki-entry-batch',
            _version: 1,
            exportedAt: now.toISOString(),
            _archiveInfo: {
                types: `${charCount > 0 ? '角色' + charCount + '个' : ''}${charCount > 0 && settingCount > 0 ? ' ' : ''}${settingCount > 0 ? '设定' + settingCount + '个' : ''}`,
                entryCount: selectedEntries.length,
                versionCount: selectedEntries.reduce((sum, e) => sum + (e.versions ? e.versions.length : 0), 0),
                exportedAt: timeStr
            },
            entries: selectedEntries.map(e => ({
                type: e.type,
                versions: e.versions.map(extractContentVersion)
            }))
        };
        const filename = `Wiki批量_${selectedEntries.length}词条_${timeStr}.json`;
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast(`已导出 ${selectedEntries.length} 个词条`, 'success');
    };

    modal.querySelectorAll('.close-modal').forEach(btn => btn.onclick = () => modal.remove());
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};

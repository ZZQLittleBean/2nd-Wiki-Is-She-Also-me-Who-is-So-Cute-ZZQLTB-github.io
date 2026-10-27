/**
 * Part 6-4: 内容管理器 (Content Manager) - v4.2
 * 更新内容：
 * 1. 查看模式长文本自动换行（word-break: break-all）
 * 2. 弹窗转换为网页内部UI（替代浏览器confirm/alert）
 * 3. 移动端适配优化
 */

if (typeof app === 'undefined') {
    console.error('wiki-features-content.js: app 对象未定义');contentBlocksHtml
    throw new Error('Missing dependency: wiki-core.js');
}

// 【Layer 2】初始化会话级已确认未来词条集合（防重复弹窗）
app.confirmedFutureEntries = new Set();

// ========== 网页内部弹窗系统 ==========

// 确认弹窗（替代浏览器confirm）
app.showConfirmDialog = function(options) {
    return new Promise((resolve) => {
        const { title = '确认', message, confirmText = '确认', cancelText = '取消', type = 'info' } = options;
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        
        const iconColors = {
            info: 'text-blue-600 bg-blue-100',
            warning: 'text-amber-600 bg-amber-100',
            danger: 'text-red-600 bg-red-100',
            success: 'text-green-600 bg-green-100'
        };
        
        const icons = {
            info: 'fa-circle-info',
            warning: 'fa-triangle-exclamation',
            danger: 'fa-circle-exclamation',
            success: 'fa-check-circle'
        };
        
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
                <div class="text-center mb-6">
                    <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fa-solid ${icons[type]} text-2xl"></i>
                    </div>
                    <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                    <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                </div>
                <div class="flex gap-3">
                    <button id="confirm-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">
                        ${cancelText}
                    </button>
                    <button id="confirm-ok" class="flex-1 py-2.5 ${type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white rounded-lg transition font-medium shadow-lg">
                        ${confirmText}
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        overlay.querySelector('#confirm-cancel').onclick = () => {
            overlay.remove();
            resolve(false);
        };
        
        overlay.querySelector('#confirm-ok').onclick = () => {
            overlay.remove();
            resolve(true);
        };
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        };
    });
};

// 提示弹窗（替代浏览器alert）
app.showAlertDialog = function(options) {
    return new Promise((resolve) => {
        const { title = '提示', message, confirmText = '确定', type = 'info' } = options;
        
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
        
        const iconColors = {
            info: 'text-blue-600 bg-blue-100',
            warning: 'text-amber-600 bg-amber-100',
            danger: 'text-red-600 bg-red-100',
            success: 'text-green-600 bg-green-100'
        };
        
        const icons = {
            info: 'fa-circle-info',
            warning: 'fa-triangle-exclamation',
            danger: 'fa-circle-exclamation',
            success: 'fa-check-circle'
        };
        
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
                <div class="text-center mb-6">
                    <div class="w-16 h-16 ${iconColors[type]} rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fa-solid ${icons[type]} text-2xl"></i>
                    </div>
                    <h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>
                    <p class="text-gray-600 text-sm whitespace-pre-wrap">${message}</p>
                </div>
                <button id="alert-ok" class="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-lg">
                    ${confirmText}
                </button>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        overlay.querySelector('#alert-ok').onclick = () => {
            overlay.remove();
            resolve(true);
        };
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(true);
            }
        };
    });
};

// 输入弹窗（替代浏览器prompt——Electron 桌面版不支持 window.prompt）
app.showPromptDialog = function(options) {
    return new Promise((resolve) => {
        const { title = '请输入', message, placeholder = '', defaultValue = '', confirmText = '确定', cancelText = '取消' } = options || {};

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';

        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                <h3 class="text-lg font-bold text-gray-800 mb-1">${title}</h3>
                ${message ? '<p class="text-xs text-gray-500 mb-3">' + message + '</p>' : ''}
                <input type="text" id="prompt-dialog-input"
                    class="w-full p-2.5 border border-gray-300 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="${String(placeholder).replace(/"/g, '&quot;')}"
                    value="${String(defaultValue).replace(/"/g, '&quot;')}">
                <div class="flex justify-end gap-2">
                    <button data-act="cancel" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition">${cancelText}</button>
                    <button data-act="ok" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition font-medium">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input = overlay.querySelector('#prompt-dialog-input');
        const done = (val) => {
            overlay.remove();
            resolve(val);
        };

        input.focus();
        input.select();

        // 遮罩点击关闭（返回 null 表示取消）
        overlay.onclick = (e) => { if (e.target === overlay) done(null); };
        overlay.querySelector('[data-act=cancel]').onclick = () => done(null);
        overlay.querySelector('[data-act=ok]').onclick = () => done(input.value.trim() || null);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim() || null); }
            if (e.key === 'Escape') { e.stopPropagation(); done(null); }
        });
    });
};

// Toast提示
app.showToast = function(message, type = 'info', duration = 3000) {    const toast = document.createElement('div');
    toast.className = `fixed top-20 left-1/2 transform -translate-x-1/2 z-[99999] px-4 py-2 rounded-lg shadow-lg text-white text-sm flex items-center gap-2 fade-in`;
    
    const colors = {
        info: 'bg-blue-600',
        success: 'bg-green-600',
        warning: 'bg-amber-600',
        error: 'bg-red-600'
    };
    
    toast.classList.add(colors[type] || colors.info);
    
    const icons = {
        info: 'fa-circle-info',
        success: 'fa-check-circle',
        warning: 'fa-triangle-exclamation',
        error: 'fa-circle-exclamation'
    };
    
    toast.innerHTML = `
        <i class="fa-solid ${icons[type]}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
};

// ========== 历史记录缩略图加载辅助函数 ==========
app.loadHistoryThumbnail = async function(entryId, containerElement) {
    const entry = this.data.entries.find(e => e.id === entryId);
    if (!entry) return;
    
    const version = this.getVisibleVersion(entry);
    if (!version) return;
    
    let imgUrl = version.images?.avatar || version.images?.card || version.image;
    
    if (imgUrl && imgUrl.startsWith('{{IMG:') && this.storageManager) {
        const match = imgUrl.match(/\{\{IMG:(.+?)\}\}/);
        if (match) {
            const filename = match[1];
            if (this.storageManager.memoryCache && this.storageManager.memoryCache.has(filename)) {
                imgUrl = this.storageManager.memoryCache.get(filename);
            } else {
                try {
                    const actualUrl = await this.storageManager.loadImage(filename);
                    if (actualUrl) imgUrl = actualUrl;
                } catch (e) {
                    imgUrl = null;
                }
            }
        }
    }
    
    const hasValidImage = imgUrl && (imgUrl.startsWith('data:') || imgUrl.startsWith('blob:') || imgUrl.startsWith('http'));
    
    if (hasValidImage) {
        containerElement.innerHTML = `
            <img src="${imgUrl}" class="w-full h-full object-cover" 
                 onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=\\'fa-solid fa-user text-gray-400\\'></i>';"
                 alt="头像">
        `;
    } else {
        containerElement.innerHTML = '<i class="fa-solid fa-user text-gray-400"></i>';
    }
};

// ========== Layer 1+2+3+4+5+6: 列表渲染与角色状态处理 ==========

/**
 * 【Layer 2/3/4/5/6】检测角色显示状态
 */
app.getCharacterDisplayStatus = function(entry) {
    if (!entry || entry.type !== 'character') return 'normal';
    
    const currentVersion = this.getVisibleVersion(entry);
    if (!currentVersion) return 'missing';
    
    const timeStatus = this.getVersionTimeStatus(entry, currentVersion);
    
    // Layer 2: 未来角色检测
    if (timeStatus === 'future') {
        return 'future';
    }
    
    // Layer 3: 失踪检测
    if (timeStatus === 'current' || timeStatus === 'past') {
        const isMissing = this.checkIfMissing(entry);
        if (isMissing) return 'missing';
    }
    
    // Layer 5: 并行版本检测
    const hasParallel = this.checkHasParallelVersions(entry);
    if (hasParallel) return 'parallel';
    
    return 'normal';
};

/**
 * 【Layer 3】【关键修复】检查角色是否失踪
 */
app.checkIfMissing = function(entry) {
    if (!entry || !entry.versions || entry.versions.length === 0) return false;
    
    const currentCh = this.data.currentTimeline === 'latest' 
        ? { order: Infinity } 
        : this.data.chapters.find(c => c.id === this.data.currentTimeline);
    
    if (!currentCh || currentCh.order === Infinity) return false;
    
    const currentVersion = this.getVisibleVersion(entry);
    if (!currentVersion) return false;
    
    // 【关键修复1】如果当前版本没有结束时间（全时间有效），则判定为未失踪
    if (!currentVersion.chapterTo) return false;
    
    const currentToOrder = this.getChapterOrder(currentVersion.chapterTo);
    
    // 【关键修复2】如果当前版本尚未结束，则未失踪
    if (currentCh.order < currentToOrder) return false;
    
    // 【关键修复3】检测是否有版本在当前版本结束之后开始
    const hasFutureVersion = entry.versions.some(v => {
        if (v.vid === currentVersion.vid) return false;
        const vFromOrder = this.getChapterOrder(v.chapterFrom);
        return vFromOrder > currentToOrder;
    });
    
    if (hasFutureVersion) return false;
    
    return true;
};

/**
 * 【Layer 4】检查角色是否置顶
 */
app.isCharacterPinned = function(entry) {
    if (!entry || !entry.pinned) return false;
    
    if (!entry.pinStartChapter && !entry.pinEndChapter) return true;
    
    const currentCh = this.data.currentTimeline === 'latest'
        ? null
        : this.data.chapters.find(c => c.id === this.data.currentTimeline);
    
    if (!currentCh) return true;
    
    const startOrder = entry.pinStartChapter ? this.getChapterOrder(entry.pinStartChapter) : -1;
    const endOrder = entry.pinEndChapter ? this.getChapterOrder(entry.pinEndChapter) : Infinity;
    
    return currentCh.order >= startOrder && currentCh.order <= endOrder;
};

/**
 * 【Layer 5】检查是否存在并行版本
 */
app.checkHasParallelVersions = function(entry) {
    if (!entry || !entry.versions || entry.versions.length < 2) return false;
    if (this.data.currentTimeline === 'latest') return false;
    
    const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
    if (!currentCh) return false;
    
    let activeCount = 0;
    for (const v of entry.versions) {
        const fromOrder = this.getChapterOrder(v.chapterFrom);
        const toOrder = this.getChapterOrder(v.chapterTo);
        if (currentCh.order >= fromOrder && currentCh.order <= toOrder) {
            activeCount++;
            if (activeCount >= 2) return true;
        }
    }
    return false;
};

/**
 * 【Layer 2 辅助】获取角色首个版本的最高重要程度
 */
app.getFirstVersionMaxLevel = function(entry) {
    if (!entry || !entry.versions || entry.versions.length === 0) return 5;
    
    const sortedByTime = entry.versions
        .map(v => ({
            version: v,
            order: v.chapterFrom ? this.getChapterOrder(v.chapterFrom) : Infinity
        }))
        .sort((a, b) => a.order - b.order);
    
    const firstTimeOrder = sortedByTime[0].order;
    const firstTimeVersions = sortedByTime.filter(v => v.order === firstTimeOrder);
    
    let maxLevel = 5;
    firstTimeVersions.forEach(v => {
        const level = v.version.level || 5;
        if (level < maxLevel) maxLevel = level;
    });
    
    return maxLevel;
};

/**
 * 【Layer 5 辅助】获取指定章节的置顶版本
 */
app.getPinnedVersionInChapter = function(entry, chapterId) {
    if (!entry || !chapterId) return null;
    
    if (entry.pinnedVersions && entry.pinnedVersions[chapterId]) {
        const vid = entry.pinnedVersions[chapterId];
        return entry.versions.find(v => v.vid === vid);
    }
    
    const chapter = this.data.chapters.find(c => c.id === chapterId);
    if (!chapter) return null;
    
    return entry.versions.find(v => {
        const fromOrder = this.getChapterOrder(v.chapterFrom);
        const toOrder = this.getChapterOrder(v.chapterTo);
        return chapter.order >= fromOrder && chapter.order <= toOrder;
    });
};

/**
 * 【Layer 3 辅助】获取失踪前的最新版本信息
 */
app.getMissingInfo = function(entry) {
    const currentVersion = this.getVisibleVersion(entry);
    if (!currentVersion) return null;
    
    const futureVersions = entry.versions
        .filter(v => {
            const vFromOrder = this.getChapterOrder(v.chapterFrom);
            const currentFromOrder = this.getChapterOrder(currentVersion.chapterFrom);
            return vFromOrder > currentFromOrder;
        })
        .sort((a, b) => {
            return this.getChapterOrder(a.chapterFrom) - this.getChapterOrder(b.chapterFrom);
        });
    
    const latestBeforeMissing = futureVersions.length > 0 
        ? futureVersions[futureVersions.length - 1] 
        : currentVersion;
    
    return {
        isMissing: true,
        latestVersion: latestBeforeMissing,
        currentVersion: currentVersion,
        missingSince: currentVersion.chapterTo 
            ? this.data.chapters.find(c => c.id === currentVersion.chapterTo)
            : null
    };
};

// ========== Layer 1+2+3+4+5+6: 列表渲染 ==========

app.renderList = function(container, type) {
    if (type === 'non-character') {
        return this.renderSettingsGrouped ? this.renderSettingsGrouped(container) : this.renderSettingsGroupedFallback(container);
    }
    
    const tpl = document.getElementById('tpl-list');
    const clone = tpl.content.cloneNode(true);
    const masonry = clone.querySelector('#masonry-container');
    const countBadge = clone.querySelector('#list-count');
    const title = clone.querySelector('#list-title');
    
    container.appendChild(clone);
    
    masonry.className = 'max-w-7xl mx-auto pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4';
    
    if (title) title.textContent = '角色';
    
    let items = this.data.entries.filter(e => e.type === 'character');
    
    items.sort((a, b) => {
        const statusA = this.getCharacterDisplayStatus(a);
        const statusB = this.getCharacterDisplayStatus(b);
        const pinnedA = this.isCharacterPinned(a);
        const pinnedB = this.isCharacterPinned(b);
        
        if (pinnedA && statusA !== 'future' && (!pinnedB || statusB === 'future')) return -1;
        if (pinnedB && statusB !== 'future' && (!pinnedA || statusA === 'future')) return 1;
        
        if (statusA === 'future' && statusB !== 'future') return 1;
        if (statusA !== 'future' && statusB === 'future') return -1;
        
        const getSortLevel = (entry, status) => {
            if (status === 'future') {
                return entry.versions?.[0]?.level || 5;
            }
            
            if (status === 'parallel' && this.data.currentTimeline !== 'latest') {
                const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
                if (currentCh && entry.versions?.length > 0) {
                    const activeVersions = entry.versions.filter(v => {
                        const fromOrder = this.getChapterOrder(v.chapterFrom);
                        const toOrder = this.getChapterOrder(v.chapterTo);
                        return currentCh.order >= fromOrder && currentCh.order <= toOrder;
                    });
                    
                    if (activeVersions.length > 0) {
                        const levels = activeVersions.map(v => v.level || 5);
                        return Math.min(...levels);
                    }
                }
            }
            
            const version = this.getVisibleVersion(entry);
            return version?.level || entry.level || 5;
        };
        
        const levelA = getSortLevel(a, statusA);
        const levelB = getSortLevel(b, statusB);
        
        if (levelA !== levelB) {
            return levelA - levelB;
        }
        
        if (statusA === 'missing' && statusB !== 'missing') return 1;
        if (statusA !== 'missing' && statusB === 'missing') return -1;
        
        return a.code.localeCompare(b.code);
    });
    
    if (countBadge) countBadge.textContent = items.length;
    
    if (items.length === 0) {
        masonry.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400">暂无角色数据</div>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    items.forEach(entry => {
        let version = this.getVisibleVersion(entry);
        if (!version) version = entry.versions?.[entry.versions.length - 1];
        
        const status = this.getCharacterDisplayStatus(entry);
        const isPinned = this.isCharacterPinned(entry);
        
        if (version) {
            const card = this.createEntryCard(entry, version, status, isPinned);
            if (card) fragment.appendChild(card);
        }
    });
    
    masonry.appendChild(fragment);
};

/**
 * 【Layer 2+3+4+5+6】创建角色卡片
 */
app.createEntryCard = function(entry, version, status = 'normal', isPinned = false) {
    const div = document.createElement('div');
    
    let statusClass = '';
    let statusStyle = '';
    let subtitleText = version.subtitle || '';
    
    if (status === 'future') {
        statusClass = 'opacity-50 future-character';
        statusStyle = 'filter: grayscale(100%) brightness(0.7);';
        subtitleText = '该角色还潜藏于阴影中。';
    } else if (status === 'missing') {
        statusClass = 'opacity-60 missing-character';
        statusStyle = 'filter: brightness(0.6) contrast(0.8);';
    }
    
    div.className = `bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-300 active:scale-95 flex flex-col w-3/4 mx-auto relative group ${statusClass}`;
    if (statusStyle) div.style.cssText = statusStyle;
    
    div.onclick = () => {
        if (status === 'future') {
            this.showFutureConfirmDialog(entry, version);
        } else if (status === 'missing') {
            const missingInfo = this.getMissingInfo(entry);
            if (missingInfo) {
                this.showMissingConfirmDialog(entry, missingInfo);
            } else {
                this.openEntry(entry.id);
            }
        } else {
            this.openEntry(entry.id);
        }
    };
    
    // 删除按钮
    if (this.data.currentMode === 'edit') {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'absolute top-8 right-2 w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg z-30 transition-all transform hover:scale-110 border-2 border-white';
        deleteBtn.title = `删除 ${entry.code}（回收编号）`;
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can text-xs"></i>';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            const version = this.getVisibleVersion(entry);
            const title = version ? version.title : entry.code;
            const confirmed = await this.showConfirmDialog({
                title: '删除确认',
                message: `确定删除角色 "${title}" (${entry.code})？\n\n⚠️ 将同时删除 ${entry.versions.length} 个版本，编号将被回收。`,
                confirmText: '删除',
                cancelText: '取消',
                type: 'danger'
            });
            if (confirmed) {
                this.deleteEntry(entry.id);
            }
        };
        div.appendChild(deleteBtn);
    }
    
    // 置顶标记
    if (isPinned && status !== 'future') {
        const pinBadge = document.createElement('div');
        pinBadge.className = 'absolute -top-2 -left-2 w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg z-20';
        pinBadge.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
        pinBadge.title = '已置顶';
        div.appendChild(pinBadge);
    }
    
    // 处理图片引用
    let img = version.images?.card || version.images?.avatar || version.image || '';
    if (img && img.startsWith('{{IMG:') && this.storageManager) {
        const match = img.match(/\{\{IMG:(.+?)\}\}/);
        if (match && this.storageManager.memoryCache.has(match[1])) {
            img = this.storageManager.memoryCache.get(match[1]);
        }
    }
    const hasImage = img && (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http'));
    
    // 重要程度标记
    let displayLevel = version?.level || entry?.level || 5;
    if (status === 'parallel' && this.data.currentTimeline !== 'latest') {
        const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
        if (currentCh && entry?.versions?.length > 0) {
            const pinnedVid = entry.pinnedVersions?.[currentCh.id];
            if (pinnedVid) {
                const pinnedVersion = entry.versions.find(v => v.vid === pinnedVid);
                if (pinnedVersion) displayLevel = pinnedVersion.level || 5;
            }
        }
    }
    
    const isProtagonist = displayLevel === 1;
    const isImportant = displayLevel === 2;
    let badgeHtml = '';
    if (status === 'future') {
        badgeHtml = `<span class="role-badge badge-protagonist" style="background: linear-gradient(135deg, #6b7280, #374151);">???</span>`;
    } else if (isProtagonist) {
        badgeHtml = `<span class="role-badge badge-protagonist">主角</span>`;
    } else if (isImportant) {
        badgeHtml = `<span class="role-badge badge-important">重要</span>`;
    }
    
    // 并行版本圆形小图标注
    let parallelIndicator = '';
    if (status !== 'future' && entry.versions && entry.versions.length > 1) {
        const hasParallel = this.checkHasParallelVersions(entry);
        if (hasParallel) {
            const currentCh = this.data.currentTimeline === 'latest' 
                ? null 
                : this.data.chapters.find(c => c.id === this.data.currentTimeline);
            
            let otherVersions = entry.versions.filter(v => v.vid !== version.vid);
            
            if (currentCh) {
                otherVersions = otherVersions.filter(v => {
                    const fromOrder = this.getChapterOrder(v.chapterFrom);
                    const toOrder = this.getChapterOrder(v.chapterTo);
                    return currentCh.order >= fromOrder && currentCh.order <= toOrder;
                });
            }
            
            if (otherVersions.length > 0) {
                const randomOther = otherVersions[Math.floor(Math.random() * otherVersions.length)];
                let otherImg = randomOther.images?.avatar || randomOther.images?.card;
                
                if (otherImg && otherImg.startsWith('{{IMG:') && this.storageManager) {
                    const match = otherImg.match(/\{\{IMG:(.+?)\}\}/);
                    if (match && this.storageManager.memoryCache.has(match[1])) {
                        otherImg = this.storageManager.memoryCache.get(match[1]);
                    }
                }
                
                if (otherImg) {
                    parallelIndicator = `
                        <div class="absolute bottom-12 right-2 z-10 group/parallel cursor-pointer"
                            onclick="event.stopPropagation(); app.switchToVersion('${entry.id}', '${randomOther.vid}')">
                            <div class="w-8 h-8 rounded-full border-2 border-white overflow-hidden shadow-md bg-gray-100 relative">
                                <img src="${otherImg}" class="w-full h-full object-cover opacity-80 group-hover/parallel:opacity-100 transition">
                                <div class="absolute inset-0 bg-black/20 group-hover/parallel:bg-transparent transition"></div>
                            </div>
                            <div class="absolute -bottom-5 right-0 text-[9px] text-white bg-black/70 px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover/parallel:opacity-100 transition pointer-events-none">
                                存在其他版本
                            </div>
                        </div>
                    `;
                }
            }
        }
    }
    
    div.innerHTML += `
        <div class="relative aspect-[3/4] overflow-hidden bg-gray-100 shrink-0">
            ${hasImage ? 
                `<img src="${img}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-110" 
                    loading="lazy"
                    style="${status === 'future' || status === 'missing' ? 'filter: grayscale(100%) brightness(0.6);' : ''}"
                    onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-gray-300\\'><i class=\\'fa-solid fa-user text-4xl\\'></i></div>'">` :
                `<div class="w-full h-full flex items-center justify-center text-gray-300">
                    <i class="fa-solid fa-user text-4xl"></i>
                </div>`
            }
            
            ${badgeHtml}
            ${parallelIndicator}
            
            <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                <div class="text-white font-bold text-sm truncate">${version.title}</div>
                <div class="text-white/80 text-xs font-mono truncate">${entry.code}</div>
            </div>
        </div>
        <div class="p-3 flex-1 flex flex-col justify-between min-h-[60px]">
            <p class="text-xs text-gray-500 line-clamp-2 ${status === 'future' ? 'italic text-gray-400' : ''}">${subtitleText}</p>
        </div>
    `;
    
    return div;
};

/**
 * 【Layer 2】未来角色确认弹窗
 */
app.showFutureConfirmDialog = function(entry, version, confirmKey) {
    if (!confirmKey) {
        confirmKey = `${entry.id}_${version.vid}`;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 fade-in';
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
            <div class="text-center mb-6">
                <div class="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fa-solid fa-clock-rotate-left text-amber-600 text-2xl"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">未来内容警告</h3>
                <p class="text-gray-600 text-sm">你正在查看<span class="font-bold text-indigo-600">${version.title}</span>的<span class="text-amber-600 font-bold">未来形态</span>，可能包含剧透内容。</p>
            </div>
            <div class="flex gap-3">
                <button id="future-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">
                    返回当前
                </button>
                <button id="future-confirm" class="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-lg shadow-indigo-200">
                    仍要查看
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('#future-cancel').onclick = () => {
        overlay.remove();
    };
    
    overlay.querySelector('#future-confirm').onclick = () => {
        overlay.remove();
        this.confirmedFutureEntries.add(confirmKey);
        this.openEntry(entry.id);
    };
    
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
};

/**
 * 【Layer 3】失踪角色确认弹窗
 */
app.showMissingConfirmDialog = function(entry, missingInfo) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 fade-in';
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 transform scale-100 transition-transform">
            <div class="text-center mb-6">
                <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fa-solid fa-question text-gray-600 text-2xl"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">角色失踪警告</h3>
                <p class="text-gray-600 text-sm">
                    ${missingInfo.latestVersion.title}目前<span class="font-bold text-gray-800">貌似失踪了</span>......<br>
                    是否仍然查看其最新版本的词条内容？
                </p>
            </div>
            <div class="flex gap-3">
                <button id="missing-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">
                    返回列表
                </button>
                <button id="missing-confirm" class="flex-1 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition font-medium shadow-lg">
                    仍要查看
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('#missing-cancel').onclick = () => {
        overlay.remove();
    };
    
    overlay.querySelector('#missing-confirm').onclick = () => {
        overlay.remove();
        this.openEntry(entry.id);
    };
    
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
};

/**
 * 【Layer 6】切换到指定版本
 */
app.switchToVersion = function(entryId, versionId) {
    this.data.editingId = entryId;
    this.data.viewingVersionId = versionId;
    this.router('detail');
};

// ========== 设定页面渲染 ==========

// 【新增】获取设定的时间状态（类似角色系统）
app.getSettingTimeStatus = function(entry, version) {
    if (!version) return 'current';
    if (this.data.currentTimeline === 'latest') return 'current';
    
    const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
    if (!currentCh) return 'current';
    
    const fromCh = version.chapterFrom ? this.data.chapters.find(c => c.id === version.chapterFrom) : null;
    const toCh = version.chapterTo ? this.data.chapters.find(c => c.id === version.chapterTo) : null;
    
    const fromOrder = fromCh ? fromCh.order : -1;
    const toOrder = toCh ? toCh.order : Infinity;
    
    if (currentCh.order >= fromOrder && currentCh.order <= toOrder) return 'current';
    if (currentCh.order > toOrder) return 'past';
    return 'future';
};

// 【新增】查看特定设定目录（修复报错）
app.viewSettingCategory = function(type) {
    const container = document.getElementById('main-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // 获取该分类下的所有设定（包括自定义目录分类）
    const settings = this.data.entries.filter(e => {
        if (e.type !== 'non-character') return false;
        // 处理自定义目录的 key 格式 custom-xxx
        if (type.startsWith('custom-') && e.settingType === 'custom') {
            return e.customSettingType === type.replace('custom-', '');
        }
        return e.settingType === type;
    });
    
    if (settings.length === 0) {
        container.innerHTML = `
            <div class="h-full overflow-y-auto p-4 fade-in">
                <div class="max-w-7xl mx-auto">
                    <button onclick="app.router('non-characters')" class="mb-4 text-gray-600 hover:text-gray-900 flex items-center gap-1 text-sm">
                        <i class="fa-solid fa-arrow-left"></i> 返回设定
                    </button>
                    <div class="text-center py-20 text-gray-400">
                        <i class="fa-solid fa-folder-open text-4xl mb-4 opacity-50"></i>
                        <p>该目录下暂无设定词条</p>
                    </div>
                </div>
            </div>`;
        return;
    }
    
    // 按时间状态排序：current > past > future（future 置底）
    const sorted = settings.map(entry => {
        const version = this.getVisibleVersion(entry) || entry.versions[0];
        return { entry, version, status: this.getSettingTimeStatus(entry, version) };
    }).sort((a, b) => {
        const order = { current: 0, past: 1, future: 2 };
        return order[a.status] - order[b.status];
    });
    
    // 构建页面
    const wrapper = document.createElement('div');
    wrapper.className = 'h-full overflow-y-auto p-4 fade-in';
    
    const header = document.createElement('div');
    header.className = 'max-w-7xl mx-auto mb-6';
    const groupTitle = type.startsWith('custom-') ? type.replace('custom-', '') : this.getSettingTypeLabel(type);
    header.innerHTML = `
        <button onclick="app.router('non-characters')" class="mb-4 text-gray-600 hover:text-gray-900 flex items-center gap-1 text-sm">
            <i class="fa-solid fa-arrow-left"></i> 返回设定
        </button>
        <h2 class="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <i class="fa-solid ${this.getSettingTypeIcon(type.replace('custom-', ''))} text-indigo-600"></i>
            ${groupTitle}
            <span class="text-sm font-normal text-gray-500 bg-gray-100 px-3 py-1 rounded-full">${sorted.length}个</span>
        </h2>
    `;
    wrapper.appendChild(header);
    
    // 【功能3】编辑模式下显示管理按钮
    if (this.data.currentMode === 'edit') {
        const editBar = document.createElement('div');
        editBar.className = 'max-w-7xl mx-auto mb-4 flex gap-2';
        editBar.innerHTML = `
            <button onclick="app.showCategoryEntryConfig('${type}')" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs hover:bg-indigo-100 transition"><i class="fa-solid fa-sliders mr-1"></i>排序与隐藏</button>
            <button onclick="app.showSettingCategoryManager()" class="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 transition"><i class="fa-solid fa-folder-tree mr-1"></i>目录管理</button>
        `;
        wrapper.appendChild(editBar);
    }
    
    // 使用 Grid 布局，无图卡片紧凑排列
    const grid = document.createElement('div');
    grid.className = 'max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20';
    
    sorted.forEach(({ entry, version, status }) => {
        const card = this.createSettingCard(entry, version, {
            timeStatus: status,
            forceCompact: false // 在目录页面使用正常布局，但 future 置灰
        });
        grid.appendChild(card);
    });
    
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
};

app.renderSettingsGrouped = function(container) {
    const tpl = document.getElementById('tpl-list');
    const clone = tpl.content.cloneNode(true);
    
    const originalMasonry = clone.querySelector('#masonry-container');
    if (originalMasonry) {
        originalMasonry.innerHTML = '';
        originalMasonry.className = 'max-w-7xl mx-auto pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4';
    }
    
    const countBadge = clone.querySelector('#list-count');
    const title = clone.querySelector('#list-title');
    
    if (title) title.textContent = '设定';
    
    container.appendChild(clone);
    
    const wrapper = originalMasonry || container;
    
    // 【功能2】编辑模式下显示"管理目录与排序"按钮
    if (this.data.currentMode === 'edit') {
        const mgmtBar = document.createElement('div');
        mgmtBar.className = 'col-span-full mb-4 flex gap-2';
        mgmtBar.innerHTML = `
            <button onclick="app.showSettingCategoryManager()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition shadow"><i class="fa-solid fa-folder-tree mr-1"></i>管理目录与排序</button>
        `;
        wrapper.appendChild(mgmtBar);
    }
    
    const settings = this.data.entries.filter(e => e.type === 'non-character');
    
    // 【功能4】过滤掉隐藏目录的词条（不在普通目录中显示）
    const hiddenIds = this.data.settings?.hiddenCategory?.entries || [];
    const normalSettings = settings.filter(e => !hiddenIds.includes(e.id));
    
    if (countBadge) countBadge.textContent = normalSettings.length;
    
    if (normalSettings.length === 0 && hiddenIds.length === 0) {
        wrapper.innerHTML += '<div class="col-span-full text-center py-10 text-gray-400">暂无设定数据</div>';
    }
    
    // 【修改】智能分组：自定义目录按 customSettingType 分散归类
    const groups = {};
    
    normalSettings.forEach(entry => {
        let type = entry.settingType || 'world';
        let groupKey = type;
        let groupTitle = this.getSettingTypeLabel(type);
        let groupIcon = this.getSettingTypeIcon(type);
        
        if (type === 'custom' && entry.customSettingType && entry.customSettingType.trim()) {
            groupKey = `custom-${entry.customSettingType.trim()}`;
            groupTitle = entry.customSettingType.trim();
            groupIcon = 'fa-folder-open';
        }
        
        if (!groups[groupKey]) {
            groups[groupKey] = { 
                key: groupKey,
                title: groupTitle, 
                icon: groupIcon, 
                type: type,
                items: [] 
            };
        }
        groups[groupKey].items.push(entry);
    });
    
    // 【功能2】按目录排序配置排列
    const catOrder = this.data.settings?.settingConfig?.categoryOrder || [];
    const typeOrder = ['world', 'document', 'art', 'faction'];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        // 优先应用目录排序配置
        const oa = catOrder.indexOf(a);
        const ob = catOrder.indexOf(b);
        if (oa >= 0 && ob >= 0) return oa - ob;
        if (oa >= 0) return -1;
        if (ob >= 0) return 1;
        // 预设类型优先
        const aIsPreset = typeOrder.includes(groups[a].type);
        const bIsPreset = typeOrder.includes(groups[b].type);
        if (aIsPreset && !bIsPreset) return -1;
        if (!aIsPreset && bIsPreset) return 1;
        return a.localeCompare(b);
    });
    
    sortedKeys.forEach(key => {
        const group = groups[key];
        const visibleItems = group.items.filter(entry => {
            const version = this.getVisibleVersion(entry) || entry.versions[0];
            return this.getSettingTimeStatus(entry, version) !== 'future';
        });
        
        if (visibleItems.length === 0) return;
        
        // 【功能3】应用显示配置
        const displayCfg = this.data.settings?.settingConfig?.categoryDisplay?.[key] || {};
        const homeOrder = displayCfg.homeOrder || [];
        const homeHidden = displayCfg.homeHidden || [];
        let sortedItems = [...visibleItems];
        if (homeOrder.length > 0) {
            sortedItems.sort((a, b) => {
                const ia = homeOrder.indexOf(a.id);
                const ib = homeOrder.indexOf(b.id);
                if (ia >= 0 && ib >= 0) return ia - ib;
                if (ia >= 0) return -1;
                if (ib >= 0) return 1;
                return 0;
            });
        }
        const showItems = sortedItems.filter(e => !homeHidden.includes(e.id)).slice(0, 8);
        
        const section = document.createElement('div');
        section.className = 'col-span-full mb-6';
        
        // 【功能3】编辑模式下显示"排序与隐藏"按钮
        const editButtons = this.data.currentMode === 'edit' ? `
            <button onclick="app.showCategoryEntryConfig('${key}')" class="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition mr-1"><i class="fa-solid fa-sliders"></i> 排序/隐藏</button>
        ` : '';
        
        section.innerHTML = `
            <div class="setting-category-header flex justify-between items-center mb-4 pb-2 border-b-2 border-gray-200">
                <div class="setting-category-title flex items-center gap-2">
                    <i class="fa-solid ${group.icon} text-indigo-600 text-lg"></i>
                    <span class="text-lg font-bold text-gray-800">${group.title}</span>
                    <span class="setting-count-badge bg-indigo-100 text-indigo-700 px-3 py-0.5 rounded-full text-xs font-bold">${visibleItems.length}个</span>
                </div>
                <div class="flex items-center">
                    ${editButtons}
                    <button onclick="app.viewSettingCategory('${key}')" class="setting-more-btn text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-indigo-50 transition">
                        更多 <i class="fa-solid fa-chevron-right text-xs"></i>
                    </button>
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" id="setting-group-${key.replace(/[^a-zA-Z0-9]/g, '-')}">
            </div>
        `;
        
        wrapper.appendChild(section);
        
        const grid = section.querySelector(`#setting-group-${key.replace(/[^a-zA-Z0-9]/g, '-')}`);
        
        showItems.forEach(entry => {
            let version = this.getVisibleVersion(entry) || entry.versions[0];
            if (!version) return;
            const card = this.createSettingCard(entry, version, { compact: true });
            grid.appendChild(card);
        });
    });
    
    // 【功能4】置底折叠的隐藏目录
    if (this.data.currentMode === 'edit') {
        const hiddenEntries = settings.filter(e => hiddenIds.includes(e.id));
        const hiddenSection = document.createElement('div');
        hiddenSection.className = 'col-span-full mt-8';
        const isExpanded = hiddenSection.dataset?.expanded === 'true';
        hiddenSection.innerHTML = `
            <div class="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
                <div class="flex justify-between items-center p-4 cursor-pointer" onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.toggle-icon').classList.toggle('fa-rotate-180')">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-eye-slash text-gray-400"></i>
                        <span class="text-lg font-bold text-gray-200">隐藏目录</span>
                        <span class="bg-gray-700 text-gray-300 px-3 py-0.5 rounded-full text-xs font-bold">${hiddenEntries.length}个</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="event.stopPropagation(); app.showHiddenCategoryManager()" class="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition"><i class="fa-solid fa-gear"></i> 管理</button>
                        <i class="fa-solid fa-chevron-down text-gray-400 toggle-icon transition-transform"></i>
                    </div>
                </div>
                <div class="hidden p-4 pt-0">
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" id="setting-group-hidden"></div>
                </div>
            </div>
        `;
        wrapper.appendChild(hiddenSection);
        const hiddenGrid = hiddenSection.querySelector('#setting-group-hidden');
        if (hiddenEntries.length === 0) {
            hiddenGrid.innerHTML = '<div class="col-span-full text-center py-6 text-gray-500 text-sm">暂无隐藏词条<br><span class="text-xs text-gray-600">编辑词条时选择"隐藏"目录即可添加</span></div>';
        } else {
            hiddenEntries.forEach(entry => {
                let version = this.getVisibleVersion(entry) || entry.versions[0];
                if (!version) return;
                const card = this.createSettingCard(entry, version, { compact: true });
                card.style.background = '#1f2937';
                card.style.borderColor = '#374151';
                const t = card.querySelector('h4');
                if (t) t.style.color = '#e5e7eb';
                hiddenGrid.appendChild(card);
            });
        }
    }
};

// 【修改】createSettingCard 支持无图模式和时间状态标记
app.createSettingCard = function(entry, version, options = {}) {
    const { timeStatus = 'current', compact = false } = options;
    
    const div = document.createElement('div');
    
    // 处理图片引用
    let img = version.images?.card || version.images?.avatar || '';
    if (img && img.startsWith('{{IMG:') && this.storageManager) {
        const match = img.match(/\{\{IMG:(.+?)\}\}/);
        if (match && this.storageManager.memoryCache.has(match[1])) {
            img = this.storageManager.memoryCache.get(match[1]);
        }
    }
    const hasImage = img && (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http'));
    
    // 标记是否有图，供布局使用
    div.dataset.hasImage = hasImage ? 'true' : 'false';
    div.dataset.timeStatus = timeStatus;
    
    // 【优化】无图卡片样式 + 未来置灰
    let className = 'bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:shadow-md transition hover:border-indigo-300 flex flex-col relative group';
    if (!hasImage && compact) {
        className += ' setting-card-compact'; // 紧凑模式
    }
    if (timeStatus === 'future') {
        className += ' opacity-50 grayscale'; // 置灰
    }
    div.className = className;
    
    div.onclick = () => this.openEntry(entry.id);
    
    // 删除按钮（编辑模式）
    if (this.data.currentMode === 'edit') {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'absolute -top-2 -right-2 w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg z-20 transition-transform hover:scale-110 border-2 border-white text-xs';
        deleteBtn.title = `删除设定 ${entry.code}`;
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.confirmDeleteSetting(entry.id);
        };
        div.appendChild(deleteBtn);
    }
    
    // 【优化】HTML 结构：无图时省略图片区域，内容区域自适应
    let imageHtml = '';
    if (hasImage) {
        imageHtml = `
            <div class="aspect-[3/2] bg-gray-100 rounded-lg mb-3 overflow-hidden flex items-center justify-center shrink-0">
                <img src="${img}" class="w-full h-full object-cover" loading="lazy" 
                     onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=\\'fa-solid fa-image text-gray-300 text-2xl\\'></i>'">
            </div>
        `;
    }
    
    // 未来标记
    const futureBadge = timeStatus === 'future' ? 
        '<span class="absolute top-2 left-2 px-2 py-0.5 bg-gray-800 text-white text-[10px] rounded-full opacity-70">未来</span>' : '';
    
    div.innerHTML = `
        ${futureBadge}
        ${imageHtml}
        <div class="flex items-center justify-between min-h-[24px] ${!hasImage ? 'mb-1' : ''}">
            <h4 class="font-bold text-sm text-gray-800 truncate flex-1 ${timeStatus === 'future' ? 'text-gray-500' : ''}">${version.title}</h4>
            <span class="text-[10px] text-gray-400 font-mono ml-2">${entry.code}</span>
        </div>
        <p class="text-xs text-gray-500 mt-1 line-clamp-2 ${timeStatus === 'future' ? 'text-gray-400' : ''}">${version.subtitle || ''}</p>
        ${!hasImage && compact ? '<div class="flex-1"></div>' : ''}
    `;
    
    return div;
};

app.getSettingTypeLabel = function(type) {
    const labels = {
        'world': '世界设定',
        'document': '特殊文献',
        'art': '绘画/图片',
        'faction': '阵营',
        'custom': '自定义'
    };
    return labels[type] || '其他';
};

app.getSettingTypeIcon = function(type) {
    const icons = {
        'world': 'fa-globe',
        'document': 'fa-scroll',
        'art': 'fa-palette',
        'faction': 'fa-shield-halved',
        'custom': 'fa-folder'
    };
    return icons[type] || 'fa-folder';
};

// 确认删除设定
app.confirmDeleteSetting = async function(entryId) {
    const entry = this.data.entries.find(e => e.id === entryId);
    if (!entry) return;
    const version = this.getVisibleVersion(entry);
    
    const confirmed = await this.showConfirmDialog({
        title: '删除确认',
        message: `确定删除设定【${version?.title || entry.code}】(${entry.code})？\n\n⚠️ 此操作将：\n• 删除该设定的所有历史版本\n• 回收编号 ${entry.code} 供后续使用\n• 此操作不可撤销`,
        confirmText: '删除',
        cancelText: '取消',
        type: 'danger'
    });
    
    if (confirmed) {
        this.deleteEntry(entryId);
    }
};

app.renderSettingsGroupedFallback = function(container) {
    return this.renderSettingsGrouped(container);
};

// ========== 词条详情页 ==========
// 【已删除】词条详情页渲染已移至 wiki-core.js 的 renderDetail 函数
// 确保 wiki-core.js 中的 GitHub 版同步样式唯一生效，避免此处后加载覆盖


app.getVersionTimeStatus = function(entry, version) {
    if (this.data.currentTimeline === 'latest') return 'current';
    
    const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
    if (!currentCh) return 'current';
    
    const fromCh = version.chapterFrom ? this.data.chapters.find(c => c.id === version.chapterFrom) : null;
    const toCh = version.chapterTo ? this.data.chapters.find(c => c.id === version.chapterTo) : null;
    
    const fromOrder = fromCh ? fromCh.order : -1;
    const toOrder = toCh ? toCh.order : Infinity;
    
    if (currentCh.order >= fromOrder && currentCh.order <= toOrder) return 'current';
    if (currentCh.order > toOrder) return 'past';
    return 'future';
};

app.getChapterOrder = function(chapterId) {
    if (!chapterId) return -1;
    const chapter = this.data.chapters.find(c => c.id === chapterId);
    return chapter ? chapter.order : -1;
};

app.searchAndOpen = function(name) {
    const entry = this.data.entries.find(e => {
        const v = this.getVisibleVersion(e);
        return v && v.title === name;
    });
    
    if (entry) {
        this.openEntry(entry.id);
    } else {
        this.showToast('未找到该词条', 'warning');
    }
};

// ========== 公告管理 ==========
app.createAnnouncement = function() {
    this.data.currentAnnouncement = null;
    this.router('announcement-edit');
};

app.cancelAnnouncementEdit = function() {
    this.showConfirmDialog({
        title: '放弃编辑',
        message: '确定放弃编辑公告？',
        confirmText: '放弃',
        cancelText: '继续编辑',
        type: 'warning'
    }).then(confirmed => {
        if (confirmed) this.router('home');
    });
};

app.viewAnnouncement = function() {
    const ann = this.data.announcements?.find(a => a.isActive);
    if (!ann) {
        this.showToast('当前没有生效的公告', 'info');
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div class="p-4 border-b bg-gradient-to-r from-orange-50 to-amber-50 flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-lg text-gray-800">${ann.title || '公告'}</h3>
                    <p class="text-xs text-gray-500">${ann.author || '匿名'} · ${ann.date || new Date(ann.createdAt).toLocaleDateString('zh-CN')}</p>
                </div>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-6 overflow-y-auto prose prose-sm max-w-none">
                ${ann.content || ''}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
};

app.closeAnnouncementView = function() {
    const modal = document.querySelector('.fixed.inset-0.bg-black\\/60');
    if (modal) modal.remove();
};

app.viewAnnouncementHistory = function() {
    if (!this.data.announcements || this.data.announcements.length === 0) {
        this.showToast('暂无历史公告', 'info');
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4 fade-in';
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                <h3 class="font-bold text-lg text-gray-800">历史公告</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-4 overflow-y-auto space-y-3">
                ${this.data.announcements.map(ann => `
                    <div class="p-3 bg-gray-50 rounded-lg border ${ann.isActive ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}">
                        <div class="flex justify-between items-start">
                            <h4 class="font-medium text-gray-800">${ann.title || '无标题'}</h4>
                            ${ann.isActive ? '<span class="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">生效中</span>' : ''}
                        </div>
                        <p class="text-xs text-gray-500 mt-1">${ann.author || '匿名'} · ${ann.date || new Date(ann.createdAt).toLocaleDateString('zh-CN')}</p>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
};

app.showEntrySelectDialog = function(callback) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
            <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                <h3 class="font-bold text-lg text-gray-800">选择词条</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-4">
                <input type="text" id="entry-search-input" placeholder="搜索词条名称或编号..." 
                    class="w-full p-2 border border-gray-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none">
                <div id="entry-select-list" class="space-y-1 max-h-[50vh] overflow-y-auto"></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    const list = overlay.querySelector('#entry-select-list');
    const searchInput = overlay.querySelector('#entry-search-input');
    
    const renderEntries = (filter = '') => {
        list.innerHTML = '';
        this.data.entries.forEach(entry => {
            const visibleVersion = this.getVisibleVersion(entry);
            const title = visibleVersion ? visibleVersion.title : entry.code;
            if (filter && !entry.code.toLowerCase().includes(filter.toLowerCase()) && !title.toLowerCase().includes(filter.toLowerCase())) return;
            
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 flex items-center gap-3 transition';
            item.innerHTML = `
                <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${entry.code}</span>
                <span class="text-sm text-gray-700">${title}</span>
            `;
            item.onclick = () => { overlay.remove(); callback(entry); };
            list.appendChild(item);
        });
    };
    
    renderEntries();
    searchInput.oninput = (e) => renderEntries(e.target.value);
    searchInput.focus();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
};
app.showVersionSelectDialogForHome = function(entry, callback) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div class="p-4 border-b bg-indigo-50 rounded-t-xl flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-lg text-indigo-800">选择要引用的版本</h3>
                    <p class="text-xs text-gray-600 mt-1">词条：${entry.code || '未命名'} (${entry.versions.length}个版本)</p>
                </div>
                <button id="close-version-modal" class="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-indigo-100 transition">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="p-4">
                <div class="relative mb-3">
                    <i class="fa-solid fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                    <input type="text" id="version-search-input" placeholder="搜索版本标题..." 
                        class="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                </div>
                <div id="version-list-container" class="space-y-2 max-h-[50vh] overflow-y-auto">
                </div>
            </div>
            <div class="p-4 border-t bg-gray-50 rounded-b-xl flex justify-between items-center">
                <span class="text-xs text-gray-500">选择后，首页将显示该版本的大标题</span>
                <button id="btn-cancel-select" class="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition text-sm">
                    取消
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const closeModal = () => {
        modal.remove();
        callback(null);
    };
    
    modal.querySelector('#close-version-modal').onclick = closeModal;
    modal.querySelector('#btn-cancel-select').onclick = closeModal;
    modal.onclick = (e) => { if(e.target === modal) closeModal(); };
    
    // 渲染版本列表（按时间排序）
    const renderVersions = (filter = '') => {
        const container = modal.querySelector('#version-list-container');
        container.innerHTML = '';
        
        const sortedVersions = [...entry.versions].sort((a, b) => {
            const orderA = a.chapterFrom ? this.getChapterOrder(a.chapterFrom) : -1;
            const orderB = b.chapterFrom ? this.getChapterOrder(b.chapterFrom) : -1;
            return orderA - orderB;
        });
        
        let hasVisible = false;
        
        sortedVersions.forEach((version, idx) => {
            // 搜索过滤
            if (filter && !version.title.toLowerCase().includes(filter.toLowerCase())) return;
            hasVisible = true;
            
            const fromCh = version.chapterFrom ? this.data.chapters.find(c => c.id === version.chapterFrom) : null;
            const toCh = version.chapterTo ? this.data.chapters.find(c => c.id === version.chapterTo) : null;
            const timeRange = fromCh || toCh ? 
                `${fromCh ? this.formatChapterNum(fromCh.num) : '开始'} ~ ${toCh ? this.formatChapterNum(toCh.num) : '至今'}` : 
                '全时间有效';
            
            const subtitlePreview = version.subtitle ? 
                (version.subtitle.length > 40 ? version.subtitle.substring(0, 40) + '...' : version.subtitle) : 
                '无题记';
            
            const levelStar = version.level <= 2 ? (version.level === 1 ? '★ 主角' : '重要') : '';
            const levelClass = version.level <= 2 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' : 'text-gray-500 bg-gray-100 border-gray-200';
            
            const item = document.createElement('div');
            item.className = 'p-3 border border-gray-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer transition group';
            item.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 flex-wrap mb-1">
                            <span class="font-bold text-gray-800">${version.title}</span>
                            ${levelStar ? `<span class="text-xs ${levelClass} px-2 py-0.5 rounded-full border font-medium">${levelStar}</span>` : ''}
                        </div>
                        <div class="text-xs text-gray-500 font-mono bg-gray-50 inline-block px-2 py-0.5 rounded border border-gray-200">
                            <i class="fa-regular fa-clock mr-1"></i>${timeRange}
                        </div>
                    </div>
                    <span class="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full ml-2 shrink-0">版本${idx + 1}</span>
                </div>
                <div class="text-xs text-gray-600 italic border-l-2 border-indigo-200 pl-3 mt-2 line-clamp-2">
                    ${subtitlePreview}
                </div>
            `;
            
            item.onclick = () => {
                modal.remove();
                callback(version);
            };
            
            container.appendChild(item);
        });
        
        if (!hasVisible) {
            container.innerHTML = `
                <div class="text-center py-6 text-gray-400">
                    <i class="fa-solid fa-filter text-2xl mb-2 block"></i>
                    <span class="text-sm">没有匹配的版本</span>
                </div>
            `;
        }
    };
    
    // 搜索功能
    const searchInput = modal.querySelector('#version-search-input');
    searchInput.addEventListener('input', (e) => renderVersions(e.target.value));
    setTimeout(() => searchInput.focus(), 50);
    
    renderVersions();
    
    // ESC关闭
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
};

app.updateHomeText = function(idx, value) {
    if (this.data.homeContent && this.data.homeContent[idx]) {
        this.data.homeContent[idx].content = value;
    }
};

// ========== 备份恢复对话框 ==========
app.showBackupRestoreDialog = function() {
    this.showConfirmDialog({
        title: '备份与恢复',
        message: '请选择操作：',
        confirmText: '导出备份',
        cancelText: '取消',
        type: 'info'
    }).then(confirmed => {
        if (confirmed) {
            this.exportZipBackup && this.exportZipBackup();
        }
    });
};

// ========== 剧情梗概编辑 ==========
app.renderSynopsisEdit = function(container) {
    const tpl = document.getElementById('tpl-synopsis-edit');
    if (!tpl) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概编辑模板未找到</div>';
        return;
    }
    const clone = tpl.content.cloneNode(true);
    container.appendChild(clone);

    this.syncSynopsisWithChapters();
    const list = document.getElementById('synopsis-chapters-list');
    if (list) this.renderSynopsisEditList(list);
};

// ============================================
// 代码块 5: wiki-features-content.js - markdownToHtml 函数完整替换
// 确保换行符转换为 <br>，使 contenteditable 能正确渲染多行
// ============================================

// 替换为以下完整版本（支持版本化链接和换行符处理）：
app.markdownToHtml = function(text) {
    if (!text) return '';
    
    let html = text;
    
    // 辅助函数：通过ID或Code查找Entry（增强容错）
    const findEntry = (idOrCode) => {
        if (!idOrCode) return null;
        const cleanId = String(idOrCode).trim();
        let entry = app.data.entries.find(e => String(e.id).trim() === cleanId);
        if (!entry) {
            entry = app.data.entries.find(e => e.code === cleanId);
        }
        return entry;
    };
    
    // 1. 处理角色引用 @名字[代码]
    html = html.replace(/@([^\[]+)\[([^\]]+)\]/g, (match, name, code) => {
        const cleanCode = code.replace(/\\/g, '').trim();
        return `<span class="synopsis-entry-ref" data-entry-code="${cleanCode}" contenteditable="false">@${name.trim()}</span>`;
    });
    
    // 2. 处理剧情引用 {{synopsis:id:title}}
    html = html.replace(/\{\{synopsis:([^:]+):([^}]+)\}\}/g, (match, id, title) => {
        return `<span class="synopsis-entry-ref" data-chapter-id="${id.trim()}" contenteditable="false">@${title.trim()}</span>`;
    });

    // 【新增】处理外链格式 [[显示文本|url:https://...]]（必须在词条链接之前）
    html = html.replace(/\[\[([^\]|]+)\|url:([^\]]+)\]\]/g, (match, displayText, url) => {
        const cleanUrl = url.trim();
        const cleanText = displayText.trim();
        return '<a href="' + cleanUrl + '" class="entry-external-link" target="_blank" rel="noopener noreferrer" data-external-url="' + cleanUrl + '" onclick="app.confirmExternalLink(event, \'' + cleanUrl.replace(/'/g, "\\'") + '\'); return false;"><i class="fa-solid fa-arrow-up-right-from-square text-xs mr-1"></i>' + cleanText + '</a>';
    });

    // 3. 处理词条链接 - 新格式 [[entryId|versionId:displayText]]
    // 【关键修复】使用 .trim() 清除首尾空格，避免匹配失败
    html = html.replace(/\[\[([^\]|]+)\|([^:\]]+):([^\]]+)\]\]/g, (match, entryId, versionId, displayText) => {
        const cleanEntryId = entryId.trim();
        const cleanVersionId = versionId.trim();
        const entry = findEntry(cleanEntryId);
        
        if (entry && entry.versions) {
            // 验证versionId是否有效，无效则使用第一个版本
            const version = entry.versions.find(v => v.vid === cleanVersionId);
            const actualVid = version ? version.vid : (entry.versions[0]?.vid || '');
            const safeId = String(entry.id).replace(/'/g, "\\'"); // 转义单引号防止破坏onclick
            const safeVid = String(actualVid).replace(/'/g, "\\'");
            return `<a href="javascript:void(0)" class="entry-index-link" data-entry-id="${entry.id}" data-version-id="${actualVid}" onclick="app.openEntryWithVersion('${safeId}', '${safeVid}'); return false;">${displayText.trim()}</a>`;
        }
        return `<span class="text-red-400" title="词条未找到">[[${displayText.trim()}]]</span>`;
    });
    
    // 4. 处理词条链接 - 旧格式 [[entryId:displayText]] 或 [[code:displayText]]
    html = html.replace(/\[\[([^\]|]+):([^\]]+)\]\]/g, (match, entryIdOrCode, displayText) => {
        const cleanId = entryIdOrCode.trim();
        const entry = findEntry(cleanId);
        
        if (entry && entry.versions && entry.versions.length > 0) {
            // 【关键】指向第一个版本（最旧），确保新增版本后链接不变
            const firstVersion = entry.versions[0];
            const safeId = String(entry.id).replace(/'/g, "\\'");
            const safeVid = String(firstVersion.vid).replace(/'/g, "\\'");
            return `<a href="javascript:void(0)" class="entry-index-link" data-entry-id="${entry.id}" data-version-id="${firstVersion.vid}" onclick="app.openEntryWithVersion('${safeId}', '${safeVid}'); return false;">${displayText.trim()}</a>`;
        }
        return `<span class="text-red-400" title="词条未找到">[[${displayText.trim()}]]</span>`;
    });
    
    // 5. 处理旧格式 [[title]]（通过标题查找）
    html = html.replace(/\[\[(.*?)\]\]/g, (match, title) => {
        if (match.includes('|') || match.includes(':')) return match;
        const cleanTitle = title.trim();
        const entry = app.data.entries.find(e => {
            const v = app.getVisibleVersion(e);
            return v && v.title === cleanTitle;
        });
        if (entry && entry.versions.length > 0) {
            const firstVersion = entry.versions[0];
            const safeId = String(entry.id).replace(/'/g, "\\'");
            const safeVid = String(firstVersion.vid).replace(/'/g, "\\'");
            return `<a href="javascript:void(0)" class="entry-index-link" data-entry-id="${entry.id}" data-version-id="${firstVersion.vid}" onclick="app.openEntryWithVersion('${safeId}', '${safeVid}'); return false;">${cleanTitle}</a>`;
        }
        return `<span class="text-gray-400">[[${cleanTitle}]]</span>`;
    });
    
    // 6. 保护代码块和行内代码（防止被其他规则处理）
    const codeBlocks = [];
    const inlineCodes = [];
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
        codeBlocks.push(`<pre class="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto my-3 text-sm"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
        return `\x00CB${codeBlocks.length - 1}\x00`;
    });
    html = html.replace(/`([^`]+)`/g, (match, code) => {
        inlineCodes.push(`<code class="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`);
        return `\x00IC${inlineCodes.length - 1}\x00`;
    });

    // 7. 处理分隔线（需在块级元素之前）
    html = html.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '<hr class="my-4 border-gray-200">');

    // 8. 处理标题 # ... ######
    html = html.replace(/^######\s+(.+)$/gm, '<h6 class="text-sm font-bold text-gray-600 mt-4 mb-2">$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5 class="text-base font-bold text-gray-700 mt-5 mb-2">$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4 class="text-lg font-bold text-gray-800 mt-5 mb-3">$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3 class="text-xl font-bold text-gray-900 mt-6 mb-3 pb-2 border-b border-gray-200">$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2 class="text-2xl font-bold text-gray-900 mt-8 mb-4 pb-2 border-b-2 border-indigo-200">$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1 class="text-3xl font-bold text-gray-900 mt-10 mb-5 pb-3 border-b-4 border-indigo-300">$1</h1>');

    // 9. 处理引用块 > text
    html = html.replace(/^>\s+(.*)$/gm, '<blockquote class="border-l-4 border-indigo-400 bg-indigo-50 pl-4 pr-3 py-2 my-3 text-gray-700 italic rounded-r">$1</blockquote>');

    // 10. 处理无序列表 - item 或 * item
    const processUl = (match) => {
        const items = match.trim().split(/\n/);
        let listHtml = '<ul class="list-disc pl-6 my-3 space-y-1 text-gray-700">';
        for (const item of items) {
            const cleaned = item.replace(/^[-*+]\s+/, '').trim();
            if (cleaned) listHtml += `<li>${cleaned}</li>`;
        }
        listHtml += '</ul>';
        return listHtml;
    };
    html = html.replace(/(?:^[-*+]\s+.*\n?)+/gm, processUl);

    // 11. 处理有序列表 1. item
    const processOl = (match) => {
        const items = match.trim().split(/\n/);
        let listHtml = '<ol class="list-decimal pl-6 my-3 space-y-1 text-gray-700">';
        for (const item of items) {
            const cleaned = item.replace(/^\d+\.\s+/, '').trim();
            if (cleaned) listHtml += `<li>${cleaned}</li>`;
        }
        listHtml += '</ol>';
        return listHtml;
    };
    html = html.replace(/(?:^\d+\.\s+.*\n?)+/gm, processOl);

    // 12. 处理普通链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-800 hover:underline">$1</a>');

    // 13. 处理表格 | col1 | col2 |
    const processTable = (match) => {
        const lines = match.trim().split('\n');
        if (lines.length < 2) return match;
        // Check if second line is separator |---|---|
        const sepLine = lines[1];
        if (!/^\s*\|?(?:[-:]+\|)+\s*$/.test(sepLine)) return match;
        let tableHtml = '<table class="w-full my-4 border-collapse border border-gray-300 text-sm" style="table-layout:fixed;">';
        // Header
        const headers = lines[0].split('|').map(s => s.trim()).filter(s => s);
        tableHtml += '<thead><tr class="bg-gray-100">';
        for (const h of headers) {
            tableHtml += `<th class="border border-gray-300 px-3 py-2 text-left font-semibold text-gray-700">${h}</th>`;
        }
        tableHtml += '</tr></thead><tbody>';
        // Rows (skip header and separator)
        for (let i = 2; i < lines.length; i++) {
            const cells = lines[i].split('|').map(s => s.trim()).filter(s => s);
            if (cells.length === 0) continue;
            tableHtml += '<tr class="hover:bg-gray-50">';
            for (const cell of cells) {
                tableHtml += `<td class="border border-gray-300 px-3 py-2 text-gray-700">${cell}</td>`;
            }
            tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        return tableHtml;
    };
    html = html.replace(/(?:^\s*\|.*\|\s*\n)+/gm, processTable);

    // 14. 处理 Markdown 行内样式（粗体、斜体、下划线、删除线）
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em class="italic text-gray-700">$1</em>');
    html = html.replace(/__(.+?)__/g, '<u class="underline decoration-indigo-400">$1</u>');
    html = html.replace(/~~(.+?)~~/g, '<del class="line-through text-gray-400">$1</del>');

    // 15. 恢复保护的代码块和行内代码
    html = html.replace(/\x00CB(\d+)\x00/g, (match, idx) => codeBlocks[parseInt(idx)]);
    html = html.replace(/\x00IC(\d+)\x00/g, (match, idx) => inlineCodes[parseInt(idx)]);

    // 16. 处理换行符（将剩余的换行转为<br>，但避免在块级元素后重复添加）
    html = html.replace(/\n/g, '<br>');

    return html;
};

// ============================================
// 代码块 4: wiki-features-content.js - htmlToMarkdown 函数完整替换
// 简化处理，专门针对 contenteditable 产生的扁平化 HTML 结构
// ============================================

app.htmlToMarkdown = function(html) {
    if (!html) return '';
    
    // 创建临时容器
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // 递归处理节点，将 HTML 转换为 Markdown 文本
    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }
        
        const tag = node.tagName.toLowerCase();
        
        // 【最高优先级】处理词条链接 - 必须在其他处理之前
        if (tag === 'a') {
            // 【新增】处理外链（增强检测：data-external-url / class / href）
            const externalUrl = node.getAttribute('data-external-url');
            const href = node.getAttribute('href') || '';
            const isExternal = externalUrl || node.classList.contains('entry-external-link') ||
                (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) && !node.getAttribute('data-entry-id'));
            if (isExternal) {
                const text = processChildren(node).trim();
                const url = externalUrl || href || '';
                return '[[' + text + '|url:' + url + ']]';
            }

            let entryId = node.getAttribute('data-entry-id');
            let versionId = node.getAttribute('data-version-id');

            // 【安全网】如果没有 data-entry-id 但有 entry-index-link class，尝试从 onclick 提取
            if (!entryId && node.classList.contains('entry-index-link')) {
                const onclickAttr = node.getAttribute('onclick');
                if (onclickAttr) {
                    const match = onclickAttr.match(/app\.openEntryWithVersion\('([^']+)'\s*,\s*'([^']+)'\)/);
                    if (match) {
                        entryId = match[1];
                        versionId = match[2];
                    }
                }
            }

            // 如果是有 data-entry-id 的链接（我们插入的词条链接）
            if (entryId) {
                const text = processChildren(node).trim();
                // 必须包含版本ID，否则链接会失效
                if (versionId) {
                    return `[[${entryId}|${versionId}:${text}]]`;
                } else {
                    return `[[${entryId}:${text}]]`;
                }
            }

            // 普通链接（如剧情引用等）
            const text = processChildren(node);
            return text; // 普通链接只保留文本
        }
        
        // 处理行内样式标签（b, i, u等）
        if (tag === 'b' || tag === 'strong') {
            return '**' + processChildren(node) + '**';
        }
        if (tag === 'i' || tag === 'em') {
            return '*' + processChildren(node) + '*';
        }
        if (tag === 'u') {
            return '__' + processChildren(node) + '__';
        }
        if (tag === 's' || tag === 'strike' || tag === 'del') {
            return '~~' + processChildren(node) + '~~';
        }
        if (tag === 'br') {
            return '\n';
        }
        
        // 处理块级元素
        if (tag === 'div' || tag === 'p' || tag === 'section') {
            return processChildren(node) + '\n';
        }
        
        // 【安全网】处理 span.entry-index-link（兼容直接DOM创建的a标签降级场景）
        if (tag === 'span' && node.classList.contains('entry-index-link')) {
            const entryId = node.getAttribute('data-entry-id');
            const versionId = node.getAttribute('data-version-id');
            if (entryId) {
                const text = processChildren(node).trim();
                if (versionId) return `[[${entryId}|${versionId}:${text}]]`;
                return `[[${entryId}:${text}]]`;
            }
        }

        // 处理角色/剧情引用标签
        if (tag === 'span' && node.classList.contains('synopsis-entry-ref')) {
            const code = node.getAttribute('data-entry-code');
            const chapterId = node.getAttribute('data-chapter-id');
            const text = processChildren(node).replace(/^@/, '').trim();
            
            if (code) {
                return `@${text}[${code}]`;
            } else if (chapterId) {
                return `{{synopsis:${chapterId}:${text}}}`;
            }
            return text;
        }
        
        // 其他标签默认只取文本
        return processChildren(node);
    }
    
    function processChildren(parent) {
        let result = '';
        parent.childNodes.forEach(child => {
            result += processNode(child);
        });
        return result;
    }
    
    // 处理整个文档
    let text = processChildren(temp);
    
    // 清理：合并连续换行（最多保留 2 个，即 1 个空行）
    text = text.replace(/\n{3,}/g, '\n\n');
    // 清理首尾换行
    text = text.replace(/^\n+|\n+$/g, '');
    
    return text;
};
app.openEntryWithVersion = function(entryIdRaw, versionIdRaw) {
    // 【关键修复】处理 entryId 可能包含 |versionId 的解析错误情况
    let entryId = String(entryIdRaw || '').trim();
    let versionId = String(versionIdRaw || '').trim();
    
    console.log('[OpenEntryWithVersion] 原始参数:', {entryIdRaw: entryIdRaw, versionIdRaw: versionIdRaw});
    
    // 容错：如果 entryId 包含 |，说明是格式 [[id|vid:text]] 被错误解析了
    if (entryId.includes('|')) {
        console.warn('[OpenEntryWithVersion] 检测到 entryId 包含 |，进行容错分割');
        const parts = entryId.split('|');
        entryId = parts[0].trim();
        // 如果第二个参数为空，尝试从分割结果中获取
        if (!versionId && parts[1]) {
            // 可能包含 :text，再分割一次
            versionId = parts[1].split(':')[0].trim();
        }
    }
    
    console.log('[OpenEntryWithVersion] 处理后:', {entryId: entryId, versionId: versionId});
    
    if (!entryId) {
        app.showToast('链接错误：缺少词条ID', 'error');
        return;
    }
    
    // 查找词条（先匹配 id，再匹配 code）
    let entry = app.data.entries.find(function(e) { 
        return String(e.id) === entryId; 
    });
    
    if (!entry) {
        entry = app.data.entries.find(function(e) { 
            return e.code === entryId; 
        });
    }
    
    if (!entry) {
        console.error('[OpenEntryWithVersion] 未找到词条，查找ID:', entryId);
        app.showToast('条目不存在或已被删除', 'error');
        return;
    }
    
    // 查找版本（强制字符串比较）
    let version = entry.versions.find(function(v) { 
        return String(v.vid) === versionId; 
    });
    
    // 如果找不到指定版本，降级到第一个版本
    if (!version && entry.versions.length > 0) {
        version = entry.versions[0];
        console.warn('[OpenEntryWithVersion] 版本未找到，降级到:', version.vid);
    }
    
    if (!version) {
        app.showToast('词条无可用版本', 'error');
        return;
    }
    
    // 【回到xx】记录来源词条（通过索引链接跳转时）
    app._recordPreviousEntry();

    // 执行跳转
    app.data.editingId = entry.id;
    app.data.viewingVersionId = version.vid;
    app.addToHistory(entry);
    app.router('detail');
};
// 修复插入位置 - 使用 insertTextAtCursor 辅助函数
app.insertSynopsisEntryRef = function(entryCode, entryTitle) {
    const chapterId = this._currentSynopsisChapterId;
    if (!chapterId) return;
    
    const editor = document.getElementById(`synopsis-editor-${chapterId}`);
    if (!editor) return;
    
    editor.focus();
    const refMarker = `@${entryTitle}[${entryCode}]`;
    
    // 【修复】使用标准 execCommand 在光标处插入，而非操作 DOM
    if (document.queryCommandSupported('insertText')) {
        document.execCommand('insertText', false, refMarker);
    } else {
        // 降级方案
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(refMarker);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }
    
    // 触发输入事件保存数据
    this.updateSynopsisContent(chapterId);
};

// 通过代码打开词条
app.openEntryByCode = function(code) {
    // 【关键】移除转义字符
    const cleanCode = code.replace(/\\/g, '');
    const entry = this.data.entries.find(e => e.code === cleanCode);
    if (entry) {
        this.openEntry(entry.id);
    } else {
        this.showToast('未找到该角色: ' + cleanCode, 'warning');
    }
};

app.syncSynopsisWithChapters = function() {
    const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
    const existingSynopsis = {};
    this.data.synopsis.forEach(s => { existingSynopsis[s.chapterId] = s; });

    const newSynopsis = [];
    sortedChapters.forEach(ch => {
        if (existingSynopsis[ch.id]) {
            newSynopsis.push(existingSynopsis[ch.id]);
        } else {
            newSynopsis.push({
                id: 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                chapterId: ch.id,
                num: ch.num,
                title: ch.title || `第${ch.num}章`,
                content: '',
                image: null
            });
        }
    });
    this.data.synopsis = newSynopsis;
};

// 当前编辑的剧情章节ID和编辑器元素
app._currentSynopsisEditor = null;
app._currentSynopsisChapterId = null;

app.renderSynopsisEditList = function(container) {
    if (!container) return;
    container.innerHTML = '';
    this.data.synopsis.forEach((chapter, idx) => {
        const item = document.createElement('div');
        item.className = 'synopsis-chapter-item bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden shadow-sm';
        item.dataset.id = chapter.id;
        item.dataset.idx = idx;

        // 章节图片（如果有）- 解析 {{IMG:}} 格式，支持异步加载
        let displayImageUrl = chapter.image || '';
        let imgFilename = null;
        if (displayImageUrl.startsWith('{{IMG:')) {
            const match = displayImageUrl.match(/\{\{IMG:(.+?)\}\}/);
            imgFilename = match ? match[1] : null;
            if (imgFilename && app.storageManager) {
                const cached = app.storageManager.memoryCache.get(imgFilename);
                if (cached) displayImageUrl = cached;
            }
        }
        // 如果仍是 {{IMG:}} 格式（缓存未命中），生成带 data-filename 的占位，渲染后异步加载
        const imageHtml = displayImageUrl ? `
            <div class="relative mx-3 mt-3 synopsis-img-container" data-img-filename="${imgFilename || ''}">
                <img src="${displayImageUrl.startsWith('{{IMG:') ? '' : displayImageUrl}"
                     class="w-full h-32 object-cover rounded-lg synopsis-edit-img"
                     alt="章节图片"
                     style="${displayImageUrl.startsWith('{{IMG:') ? 'display:none;' : ''}"
                     onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs\\'><i class=\\'fa-solid fa-image mr-1\\'></i>图片加载失败</div>';">
                ${displayImageUrl.startsWith('{{IMG:') ? '<div class="synopsis-img-loading w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-1"></i>加载中...</div>' : ''}
                <button onclick="app.removeSynopsisImage('${chapter.id}')" class="absolute top-2 right-2 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-red-600 z-10">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
        ` : '';

        item.innerHTML = `
            <div class="synopsis-chapter-header flex items-center gap-3 p-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200">
                <span class="bg-indigo-600 text-white px-2 py-0.5 rounded text-xs font-bold font-mono">${this.formatChapterNum(chapter.num)}</span>
                <input type="text" class="synopsis-chapter-title-input flex-1 bg-transparent border-none outline-none text-sm font-medium text-gray-800" 
                    value="${chapter.title || ''}" 
                    onchange="app.updateSynopsisTitle('${chapter.id}', this.value)" placeholder="章节标题">
                <button onclick="app.removeSynopsisChapter('${chapter.id}')" class="text-red-500 hover:text-red-700 p-1.5 transition">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </div>
            ${imageHtml}
            <div class="synopsis-chapter-content p-3">
                <!-- 富文本工具栏 -->
                <div class="flex items-center gap-1 mb-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
                    <button onclick="app.formatSynopsisText('${chapter.id}', 'bold')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow-sm text-gray-600 transition" title="粗体">
                        <i class="fa-solid fa-bold text-sm"></i>
                    </button>
                    <button onclick="app.formatSynopsisText('${chapter.id}', 'italic')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow-sm text-gray-600 transition" title="斜体">
                        <i class="fa-solid fa-italic text-sm"></i>
                    </button>
                    <button onclick="app.formatSynopsisText('${chapter.id}', 'underline')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow-sm text-gray-600 transition" title="下划线">
                        <i class="fa-solid fa-underline text-sm"></i>
                    </button>
                    <div class="w-px h-5 bg-gray-300 mx-1"></div>
                    <button onclick="app.showSynopsisEntrySearch('${chapter.id}')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow-sm text-indigo-600 transition" title="插入角色引用">
                        <i class="fa-solid fa-at text-sm"></i>
                    </button>
                    <button onclick="app.addSynopsisImage('${chapter.id}')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow-sm text-green-600 transition" title="添加图片">
                        <i class="fa-solid fa-image text-sm"></i>
                    </button>
                </div>
                <!-- 富文本编辑区域 -->
                <div id="synopsis-editor-${chapter.id}" 
                    class="synopsis-rich-editor w-full min-h-[120px] p-3 border border-gray-200 rounded-lg text-sm leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    contenteditable="true"
                    oninput="app.updateSynopsisContent('${chapter.id}')"
                    onfocus="app._currentSynopsisEditor = this; app._currentSynopsisChapterId = '${chapter.id}'"
                    placeholder="在此输入本章剧情梗概...">${this.markdownToHtml(chapter.content || '')}</div>
            </div>
        `;
        container.appendChild(item);
    });

    // 【修复】异步加载所有 {{IMG:}} 格式的剧情梗概图片
    container.querySelectorAll('[data-img-filename]').forEach(async (wrapper) => {
        const filename = wrapper.dataset.imgFilename;
        if (!filename || !app.storageManager) return;
        try {
            const actualUrl = await app.storageManager.loadImage(filename);
            if (actualUrl) {
                const img = wrapper.querySelector('.synopsis-edit-img');
                const loading = wrapper.querySelector('.synopsis-img-loading');
                if (img) { img.src = actualUrl; img.style.display = 'block'; }
                if (loading) loading.remove();
            } else {
                const loading = wrapper.querySelector('.synopsis-img-loading');
                if (loading) loading.innerHTML = '<i class="fa-solid fa-image mr-1"></i>图片未找到';
            }
        } catch (e) {
            const loading = wrapper.querySelector('.synopsis-img-loading');
            if (loading) loading.innerHTML = '<i class="fa-solid fa-image mr-1"></i>加载失败';
        }
    });
};

// 【修复】添加新剧情梗概章节
app.addSynopsisChapter = function() {
    // 计算新章节编号
    const maxNum = this.data.synopsis.reduce((max, s) => Math.max(max, parseFloat(s.num) || 0), 0);
    const newNum = maxNum + 1;
    const newId = 'syn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const newChapter = {
        id: newId,
        chapterId: newId, // 自关联
        num: newNum,
        title: `第${newNum}章`,
        content: '',
        image: null
    };
    this.data.synopsis.push(newChapter);
    this.renderSynopsisEditList(document.getElementById('synopsis-chapters-list'));
    // 滚动到新章节
    setTimeout(() => {
        const newItem = document.querySelector(`[data-id="${newId}"]`);
        if (newItem) newItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
};

// 格式化剧情梗概文本
app.formatSynopsisText = function(chapterId, command) {
    const editor = document.getElementById(`synopsis-editor-${chapterId}`);
    if (!editor) return;
    
    editor.focus();
    document.execCommand(command, false, null);
    
    // 更新数据
    const chapter = this.data.synopsis.find(s => s.id === chapterId);
    if (chapter) {
        chapter.content = this.htmlToMarkdown(editor.innerHTML);
    }
};

// 显示角色引用搜索弹窗
app.showSynopsisEntrySearch = function(chapterId) {
    this._currentSynopsisChapterId = chapterId;
    
    const tpl = document.getElementById('tpl-synopsis-entry-search');
    if (!tpl) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'synopsis-entry-search-overlay';
    overlay.innerHTML = tpl.innerHTML;
    document.body.appendChild(overlay);
    
    const input = document.getElementById('synopsis-entry-search-input');
    const list = document.getElementById('synopsis-entry-search-list');
    
    // 渲染角色列表
    const renderList = (filter = '') => {
        list.innerHTML = '';
        const entries = this.data.entries.filter(e => {
            const version = this.getVisibleVersion(e);
            const title = version ? version.title : e.code;
            return e.type === 'character' && 
                (!filter || e.code.toLowerCase().includes(filter.toLowerCase()) || 
                 title.toLowerCase().includes(filter.toLowerCase()));
        });
        
        if (entries.length === 0) {
            list.innerHTML = '<p class="text-gray-400 text-center py-4">未找到匹配的角色</p>';
            return;
        }
        
        entries.forEach(entry => {
            const version = this.getVisibleVersion(entry);
            const title = version ? version.title : entry.code;
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 p-3 hover:bg-indigo-50 cursor-pointer rounded-lg border-b border-gray-100 transition';
            item.innerHTML = `
                <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold">${entry.code}</span>
                <span class="text-sm text-gray-700">${title}</span>
            `;
            item.onclick = () => {
                this.insertSynopsisEntryRef(entry.code, title);
                this.closeSynopsisEntrySearch();
            };
            list.appendChild(item);
        });
    };
    
    renderList();
    input.focus();
    input.oninput = (e) => renderList(e.target.value);
};

// 关闭角色引用搜索弹窗
app.closeSynopsisEntrySearch = function() {
    const overlay = document.getElementById('synopsis-entry-search-overlay');
    if (overlay) overlay.remove();
};

// 添加章节图片
app.addSynopsisImage = function(chapterId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            
            // 【🛡️ 剧情梗概图片机制 — 保护区域开始】
            // 此机制已与角色词条图片机制完全统一，使用 saveImage + {{IMG:filename}} + resolveImageUrl 模式
            // 禁止修改此区域为其他存储格式（如 dataUrl/blobUrl），禁止添加特殊处理逻辑
            // 所有修改必须保持与角色词条 finalizeCropping 的调用方式完全一致
            const ext = file.name.split('.').pop() || 'jpg';
            const filename = `synopsis_${chapterId}_cover.${ext}`;
            
            // 保存到 storage（与角色词条 finalizeCropping 完全相同的调用方式）
            if (this.storageManager) {
                await this.storageManager.saveImage(filename, dataUrl, {
                    type: 'synopsis',
                    chapterId: chapterId
                });
            }
            
            // 直接存储 {{IMG:filename}} 引用（与角色词条 images 格式完全一致）
            const chapter = this.data.synopsis.find(s => s.id === chapterId);
            if (chapter) {
                chapter.image = '{{IMG:' + filename + '}}';
                chapter.imageFilename = filename;
            }
            // 【🛡️ 剧情梗概图片机制 — 保护区域结束】
            
            this.saveData();
            
            // 【修复】强制重新渲染整个视图以正确加载图片
            this.showToast('图片已添加，正在刷新...', 'success');
            setTimeout(() => {
                this.renderSynopsisEdit(document.getElementById('main-container'));
            }, 100);
            
        } catch (err) {
            console.error('图片插入失败:', err);
            this.showToast('图片插入失败', 'error');
        }
    };
    
    input.click();
};

// 移除章节图片
app.removeSynopsisImage = function(chapterId) {
    const chapter = this.data.synopsis.find(s => s.id === chapterId);
    if (chapter) {
        chapter.image = null;
        delete chapter.imageFilename; // 清除旧格式引用
        this.renderSynopsisEdit(document.getElementById('main-container'));
    }
};

app.updateSynopsisTitle = function(chapterId, title) {
    const chapter = this.data.synopsis.find(s => s.id === chapterId);
    if (chapter) chapter.title = title;
};

app.updateSynopsisContent = function(chapterId) {
    const editor = document.getElementById(`synopsis-editor-${chapterId}`);
    if (!editor) return;
    
    const chapter = this.data.synopsis.find(s => s.id === chapterId);
    if (chapter) {
        chapter.content = this.htmlToMarkdown(editor.innerHTML);
    }
};

app.removeSynopsisChapter = function(chapterId) {
    this.showConfirmDialog({
        title: '删除确认',
        message: '确定删除此章节的剧情梗概？',
        confirmText: '删除',
        cancelText: '取消',
        type: 'warning'
    }).then(confirmed => {
        if (confirmed) {
            this.data.synopsis = this.data.synopsis.filter(s => s.id !== chapterId);
            this.renderSynopsisEdit(document.getElementById('main-container'));
        }
    });
};

app.saveSynopsis = function() {
    // 保存所有编辑器的内容
    this.data.synopsis.forEach(chapter => {
        const editor = document.getElementById(`synopsis-editor-${chapter.id}`);
        if (editor) {
            chapter.content = this.htmlToMarkdown(editor.innerHTML);
        }
    });
    this.saveData();
    this.showToast('剧情梗概已保存', 'success');
};

app.previewSynopsis = function() {
    this.saveSynopsis();
    this.router('synopsis');
};

// ========== 公告编辑 ==========
app.renderAnnouncementEdit = function(container) {
    // 使用 innerHTML 构建以确保事件绑定正确
    container.innerHTML = `
        <div class="h-full flex flex-col bg-gray-50 fade-in">
            <div class="bg-white border-b px-4 py-3 flex justify-between items-center shrink-0">
                <div class="flex items-center gap-2">
                    <button onclick="app.cancelAnnouncementEdit()" class="text-gray-500 hover:text-gray-800 mr-2">
                        <i class="fa-solid fa-arrow-left"></i>
                    </button>
                    <span class="font-bold text-gray-800">${this.data.currentAnnouncement ? '编辑公告' : '新建公告'}</span>
                </div>
                <div class="flex gap-2">
                    <button onclick="app.saveAnnouncement()" class="px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow text-sm">
                        <i class="fa-solid fa-save mr-1"></i>保存
                    </button>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
                <div class="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <input type="text" id="announcement-edit-title" 
                            class="w-full text-2xl font-bold border-b-2 border-gray-200 focus:border-indigo-500 outline-none py-2" 
                            placeholder="公告标题（必填）" 
                            value="${this.data.currentAnnouncement?.title || ''}">
                        <input type="text" id="announcement-edit-author" 
                            class="w-full text-sm border border-gray-200 rounded-lg p-2" 
                            placeholder="撰写人/署名（选填）"
                            value="${this.data.currentAnnouncement?.author || ''}">
                    </div>

                    <!-- 修复：使用 contenteditable div 代替 textarea 以支持富文本 -->
                    <div class="rich-text-toolbar flex gap-2 p-2 bg-gray-100 rounded-lg mb-2">
                        <button onclick="app.formatAnnouncementText('bold')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow transition" title="粗体">
                            <i class="fa-solid fa-bold"></i>
                        </button>
                        <button onclick="app.formatAnnouncementText('italic')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow transition" title="斜体">
                            <i class="fa-solid fa-italic"></i>
                        </button>
                        <button onclick="app.formatAnnouncementText('underline')" class="w-8 h-8 flex items-center justify-center rounded hover:bg-white hover:shadow transition" title="下划线">
                            <i class="fa-solid fa-underline"></i>
                        </button>
                    </div>
                    
                    <div id="announcement-edit-content" 
                        class="w-full min-h-[300px] p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                        contenteditable="true"
                        placeholder="在此输入公告正文...">${this.data.currentAnnouncement?.content || ''}</div>
                </div>
            </div>
        </div>
    `;
};

// 修复格式应用
app.formatAnnouncementText = function(command) {
    const editor = document.getElementById('announcement-edit-content');
    if (!editor) return;
    
    editor.focus();
    document.execCommand(command, false, null);
};

// 修复保存逻辑 - 防止卡死
app.saveAnnouncement = function() {
    const title = document.getElementById('announcement-edit-title')?.value?.trim();
    const author = document.getElementById('announcement-edit-author')?.value?.trim();
    const contentDiv = document.getElementById('announcement-edit-content');
    const content = contentDiv ? contentDiv.innerHTML : '';

    if (!title) {
        this.showAlertDialog({
            title: '信息不完整',
            message: '请输入公告标题',
            type: 'warning'
        });
        return;
    }

    try {
        if (this.data.currentAnnouncement) {
            // 编辑现有公告
            const ann = this.data.announcements.find(a => a.id === this.data.currentAnnouncement.id);
            if (ann) {
                ann.title = title;
                ann.author = author;
                ann.content = content;
                ann.updatedAt = Date.now();
            }
        } else {
            // 创建新公告
            const newAnn = {
                id: 'ann-' + Date.now(),
                title: title,
                author: author || '匿名',
                content: content,
                createdAt: Date.now(),
                date: new Date().toLocaleDateString('zh-CN'),
                isActive: true
            };
            // 将其他公告设为非激活
            this.data.announcements.forEach(a => a.isActive = false);
            this.data.announcements.unshift(newAnn);
        }

        this.saveData();
        this.showToast('公告已保存', 'success');
        this.router('home');
    } catch (e) {
        console.error('保存公告失败:', e);
        this.showToast('保存失败: ' + e.message, 'error');
    }
};

// 公告文本格式化
app.formatAnnText = function(command) {
    const textarea = document.getElementById('announcement-edit-content');
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    
    if (!selectedText) return;
    
    let formattedText = selectedText;
    switch(command) {
        case 'bold': formattedText = `**${selectedText}**`; break;
        case 'italic': formattedText = `*${selectedText}*`; break;
        case 'underline': formattedText = `__${selectedText}__`; break;
    }
    
    textarea.value = text.substring(0, start) + formattedText + text.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + formattedText.length, start + formattedText.length);
};

app.cancelAnnouncementEdit = function() {
    this.data.currentAnnouncement = null;
    this.router('home');
};

// ========== 词条分享与导出 ==========

// 【辅助函数】不依赖this，确保本地版可用
function _stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}
function _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
function _parseInlineMarkdown(text) {
    if (!text) return '';
    let html = _escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
    html = html.replace(/__(.+?)__/g, '<u>$1</u>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

/**
 * 【核心】将索引链接语法替换为表面文本（用于txt/md导出）
 */
function _stripIndexLinks(text) {
    if (!text) return '';
    return text
        .replace(/\[\[[^\]|]+\|[^:\]]+:[^\]]+\]\]/g, (match) => {
            const m = match.match(/\[\[[^\]|]+\|[^:\]]+:([^\]]+)\]\]/);
            return m ? m[1] : match;
        })
        .replace(/\[\[[^:\]]+:[^\]]+\]\]/g, (match) => {
            const m = match.match(/\[\[[^:\]]+:([^\]]+)\]\]/);
            return m ? m[1] : match;
        })
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/@([^\[]+)\[[^\]]+\]/g, '@$1');
}

/** 解析图片引用为可用URL */
function _resolveImageUrl(imgRef) {
    if (!imgRef) return '';
    if (imgRef.startsWith('data:') || imgRef.startsWith('http') || imgRef.startsWith('blob:')) return imgRef;
    if (imgRef.startsWith('{{IMG:')) {
        const m = imgRef.match(/\{\{IMG:(.+?)\}\}/);
        if (m && m[1]) {
            // 桌面版：优先使用内存缓存中的实际 URL（blob/data），否则分享导出时图片会因
            // GitHub 相对路径（./data/wiki-images/）不存在而加载失败
            try {
                if (typeof app !== 'undefined' && app.storageManager && app.storageManager.memoryCache && app.storageManager.memoryCache.has(m[1])) {
                    const cached = app.storageManager.memoryCache.get(m[1]);
                    if (cached && (cached.startsWith('blob:') || cached.startsWith('data:'))) return cached;
                }
            } catch (e) {}
            return './data/wiki-images/' + m[1];
        }
    }
    return imgRef;
}

/** 【新增】处理文本中的{{IMG:...}}引用，转为img标签 */
function _renderInlineImages(text) {
    if (!text) return '';
    return text.replace(/\{\{IMG:([^}]+)\}\}/g, (match, filename) => {
        // 【桌面版】优先内存缓存中的实际 URL（blob/data），否则 GitHub 相对路径在桌面版不可用
        try {
            if (typeof app !== 'undefined' && app.storageManager && app.storageManager.memoryCache && app.storageManager.memoryCache.has(filename)) {
                const cached = app.storageManager.memoryCache.get(filename);
                if (cached && (cached.startsWith('blob:') || cached.startsWith('data:'))) {
                    return '<img src="' + cached + '" style="max-width:100%;border-radius:8px;margin:8px 0;" onerror="this.style.display=\'none\'"/>';
                }
            }
        } catch (e) {}
        return '<img src="./data/wiki-images/' + filename + '" style="max-width:100%;border-radius:8px;margin:8px 0;" onerror="this.style.display=\'none\'"/>';
    });
}

// 打开分享对话框
app.shareCurrentEntry = function() {
    const entry = this.data.entries.find(e => e.id === this.data.editingId);
    if (!entry) { this.showToast('未找到当前词条', 'error'); return; }
    const tpl = document.getElementById('tpl-share-dialog');
    if (!tpl) { this.showToast('分享模板未找到', 'error'); return; }
    this.closeShareDialog();
    document.body.appendChild(tpl.content.cloneNode(true));
};
app.closeShareDialog = function() {
    document.querySelectorAll('[data-share-dialog]').forEach(el => el.remove());
};

/**
 * 【核心】获取当前词条的完整导出数据
 */
app._getCurrentEntryExportData = function() {
    const entry = this.data.entries.find(e => e.id === this.data.editingId);
    if (!entry) return null;

    const version = entry.versions.find(v => v.vid === this.data.viewingVersionId)
        || (this.getVisibleVersion ? this.getVisibleVersion(entry) : null)
        || entry.versions[entry.versions.length - 1];
    if (!version) return null;

    const typeLabels = { character: '角色', 'non-character': '设定', body: '正文', event: '活动' };
    const typeLabel = typeLabels[entry.type] || entry.type;

    // 章节范围
    let chapterRange = '';
    if (version.chapterFrom || version.chapterTo) {
        const fc = this.data.chapters.find(c => c.id === version.chapterFrom);
        const tc = this.data.chapters.find(c => c.id === version.chapterTo);
        const fs = fc ? (fc.num !== undefined ? String(fc.num) : (fc.title || '')) : '';
        const ts = tc ? (tc.num !== undefined ? String(tc.num) : (tc.title || '')) : '';
        if (fs && ts && fs !== ts) chapterRange = fs + ' ~ ' + ts;
        else if (fs) chapterRange = fs;
        else if (ts) chapterRange = ts;
    }

    // 所有版本
    let allVersions = [];
    if (entry.versions && entry.versions.length > 1) {
        entry.versions.forEach(v => {
            const isCurrent = v.vid === version.vid;
            let vr = '';
            if (v.chapterFrom || v.chapterTo) {
                const vf = this.data.chapters.find(c => c.id === v.chapterFrom);
                const vt = this.data.chapters.find(c => c.id === v.chapterTo);
                const vfs = vf ? (vf.num !== undefined ? String(vf.num) : (vf.title || '')) : '';
                const vts = vt ? (vt.num !== undefined ? String(vt.num) : (vt.title || '')) : '';
                if (vfs && vts && vfs !== vts) vr = vfs + '~' + vts;
                else if (vfs) vr = vfs;
                else if (vts) vr = vts;
            }
            allVersions.push({ title: v.title, isCurrent, range: vr, vid: v.vid });
        });
    }

    // 相关角色
    let relations = [];
    const relChars = version.relatedCharacters || [];
    if (entry.type === 'character' && relChars.length > 0) {
        relChars.forEach(rc => {
            const relatedEntry = this.data.entries.find(e => e.id === rc.charId);
            if (relatedEntry) {
                const rv = relatedEntry.versions ? relatedEntry.versions[0] : null;
                relations.push({
                    name: rv ? rv.title : relatedEntry.code,
                    relationName: rc.relationName || '相关',
                    code: relatedEntry.code
                });
            }
        });
    }

    // 【修复3】剧情梗概：用 chapterId 关联（不是 entryId）
    let synopsis = null;
    let synopsisHtml = '';
    if (entry.type === 'body') {
        // 正文词条的 chapterFrom 就是对应的 chapterId
        const chapterId = version.chapterFrom;
        const bs = chapterId && this.data.synopsis ? this.data.synopsis.find(s => s.chapterId === chapterId) : null;
        if (bs && bs.content) {
            synopsis = _stripIndexLinks(_stripHtml(bs.content));
            // 解析content中的{{IMG:...}}引用
            let renderedSynopsis = _escapeHtml(synopsis);
            renderedSynopsis = _renderInlineImages(renderedSynopsis);
            synopsisHtml = renderedSynopsis.replace(/\n/g, '<br>');
        }
    }

    // 构建完整内容
    let contentText = '', contentMarkdown = '', contentHtml = '';
    if (version.blocks && version.blocks.length > 0) {
        version.blocks.forEach(block => {
            const rawText = block.text || '';
            const plainText = _stripIndexLinks(rawText);
            const safeHtml = _escapeHtml(plainText);

            if (block.type === 'h2') {
                contentText += plainText + '\n\n';
                contentMarkdown += '## ' + plainText + '\n\n';
                contentHtml += '<h2 style="font-size:22px;font-weight:bold;color:#1f2937;margin:28px 0 12px;border-bottom:2px solid #4f46e5;padding-bottom:8px;">' + safeHtml + '</h2>';
            } else if (block.type === 'h3') {
                contentText += plainText + '\n\n';
                contentMarkdown += '### ' + plainText + '\n\n';
                contentHtml += '<h3 style="font-size:18px;font-weight:bold;color:#374151;margin:18px 0 8px;">' + safeHtml + '</h3>';
            } else if (block.type === 'p') {
                contentText += plainText + '\n\n';
                contentMarkdown += plainText + '\n\n';
                let rendered = _parseInlineMarkdown(plainText);
                contentHtml += '<p style="font-size:15px;line-height:1.8;color:#4b5563;margin:10px 0;text-align:justify;">' + rendered + '</p>';
            } else if (block.type === 'img' || block.type === 'image') {
                const imgUrl = _resolveImageUrl(block.src || '');
                if (imgUrl) {
                    contentHtml += '<div style="margin:16px 0;text-align:center;"><img src="' + imgUrl + '" style="max-width:100%;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);" onerror="this.style.display=\'none\'"/></div>';
                    if (block.caption) {
                        contentHtml += '<div style="text-align:center;font-size:12px;color:#6b7280;font-style:italic;margin-top:4px;">' + _escapeHtml(block.caption) + '</div>';
                    }
                }
            } else if (block.type === 'table') {
                // 【新增】表格导出渲染（支持colspan+对齐+样式）
                const rows = block.rows || [];
                const colspans = block.colspans || [];
                const aligns = block.aligns || [];
                const styles = block.styles || [];
                const _cellExportStyle = (r, c) => {
                    const parts = ['border:1px solid #d1d5db;padding:8px;font-size:13px;'];
                    const a = aligns[r] && aligns[r][c] ? aligns[r][c] : '';
                    parts.push(a ? 'text-align:' + a : 'text-align:left');
                    const s = styles[r] && styles[r][c] ? styles[r][c] : null;
                    if (s) { if (s.color) parts.push('color:' + s.color); if (s.bg) parts.push('background-color:' + s.bg); }
                    return parts.join(';');
                };
                if (rows.length > 0) {
                    contentText += '[表格]\n';
                    rows.forEach(row => { contentText += (row || []).join(' | ') + '\n'; });
                    contentText += '\n';
                    contentMarkdown += '| ' + (rows[0] || []).join(' | ') + ' |\n';
                    contentMarkdown += '| ' + (rows[0] || []).map(() => '---').join(' | ') + ' |\n';
                    for (let r = 1; r < rows.length; r++) {
                        contentMarkdown += '| ' + (rows[r] || []).join(' | ') + ' |\n';
                    }
                    contentMarkdown += '\n';
                    contentHtml += '<div style="margin:16px 0;"><table style="width:100%;border-collapse:collapse;table-layout:fixed;">';
                    if (rows[0]) {
                        contentHtml += '<tr style="background:#f3f4f6;">' + rows[0].map((c, cIdx) => {
                            const cs = colspans[0] && colspans[0][cIdx] > 1 ? ' colspan="' + colspans[0][cIdx] + '"' : '';
                            return '<th style="' + _cellExportStyle(0, cIdx) + '"' + cs + '>' + _escapeHtml(c) + '</th>';
                        }).join('') + '</tr>';
                    }
                    for (let r = 1; r < rows.length; r++) {
                        contentHtml += '<tr>' + (rows[r] || []).map((c, cIdx) => {
                            const cs = colspans[r] && colspans[r][cIdx] > 1 ? ' colspan="' + colspans[r][cIdx] + '"' : '';
                            return '<td style="' + _cellExportStyle(r, cIdx) + '"' + cs + '>' + _escapeHtml(c) + '</td>';
                        }).join('') + '</tr>';
                    }
                    contentHtml += '</table></div>';
                }
            }
        });
    }

    // 封面图片
    let coverImage = '';
    if (entry.type === 'event' && entry.headerImage) {
        // 【修复】活动页头图需要解析{{IMG:}}引用
        coverImage = _resolveImageUrl(entry.headerImage);
    } else if (version.images && version.images.cover) coverImage = _resolveImageUrl(version.images.cover);
    else if (version.image) coverImage = _resolveImageUrl(version.image);
    else if (version.images && version.images.card) coverImage = _resolveImageUrl(version.images.card);

    // 管理员标记
    const mark = this.data.settings?.exportMark;
    let markText = '', markMarkdown = '', markHtml = '';
    if (mark && mark.enabled) {
        if (mark.text) {
            markText = '\n---\n' + mark.text;
            markMarkdown = '\n\n---\n\n' + mark.text;
            markHtml += '<div style="margin-top:24px;padding-top:16px;border-top:2px solid #e5e7eb;color:#6b7280;font-size:13px;">' + _escapeHtml(mark.text).replace(/\n/g, '<br>') + '</div>';
        }
        if (mark.image) {
            const miu = _resolveImageUrl(mark.image);
            markHtml += '<div style="margin-top:12px;text-align:center;"><img src="' + miu + '" style="max-width:200px;max-height:80px;border-radius:4px;" onerror="this.style.display=\'none\'"/></div>';
        }
    }

    return {
        entry, version, typeLabel, chapterRange,
        allVersions, relations, synopsis, synopsisHtml,
        contentText, contentMarkdown, contentHtml,
        coverImage,
        markText, markMarkdown, markHtml, mark
    };
};

// 导出为TXT
app.exportEntryAsTxt = function() {
    const d = this._getCurrentEntryExportData();
    if (!d) return;
    let txt = '';
    txt += '╔' + '═'.repeat(40) + '╗\n';
    const pad = Math.max(0, Math.floor((40 - d.version.title.length) / 2));
    txt += '║' + ' '.repeat(pad) + d.version.title + ' '.repeat(Math.max(0, 40 - d.version.title.length - pad)) + '║\n';
    txt += '╠' + '═'.repeat(40) + '╣\n';
    txt += '║ 编号: ' + d.entry.code + ' '.repeat(Math.max(0, 32 - String(d.entry.code).length)) + '║\n';
    txt += '║ 类型: ' + d.typeLabel + ' '.repeat(Math.max(0, 32 - d.typeLabel.length)) + '║\n';
    if (d.chapterRange) txt += '║ 章节: ' + d.chapterRange + ' '.repeat(Math.max(0, 32 - d.chapterRange.length)) + '║\n';
    txt += '╚' + '═'.repeat(40) + '╝\n\n';
    if (d.allVersions.length > 0) { txt += '【版本】\n'; d.allVersions.forEach(v => { txt += (v.isCurrent ? '  ▶ ' : '  ○ ') + v.title + (v.range ? ' (' + v.range + ')' : '') + '\n'; }); txt += '\n'; }
    if (d.relations.length > 0) { txt += '【关系】\n'; d.relations.forEach(r => { txt += '  • ' + r.name + ' — ' + r.relationName + '\n'; }); txt += '\n'; }
    if (d.synopsis) txt += '【剧情梗概】\n' + d.synopsis + '\n\n';
    if (d.version.subtitle) txt += '【题记】\n  "' + _stripHtml(d.version.subtitle) + '"\n\n';
    if (d.contentText.trim()) txt += '【内容】\n\n' + d.contentText;
    if (d.markText) txt += d.markText;
    txt += '\n\n── 导自 ' + (this.data.settings?.name || 'Wiki') + ' ──';
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = d.version.title + '_' + d.entry.code + '.txt'; a.click(); URL.revokeObjectURL(url);
    this.showToast('TXT导出成功', 'success'); this.closeShareDialog();
};

// 导出为Markdown
app.exportEntryAsMarkdown = function() {
    const d = this._getCurrentEntryExportData();
    if (!d) return;
    let md = '# ' + d.version.title + '\n\n> **编号**: `' + d.entry.code + '`\n> **类型**: ' + d.typeLabel + '\n';
    if (d.chapterRange) md += '> **章节**: ' + d.chapterRange + '\n';
    md += '\n---\n\n';
    if (d.allVersions.length > 0) { md += '## 版本\n\n'; d.allVersions.forEach(v => { md += '- ' + (v.isCurrent ? '**【当前】** ' : '') + v.title + (v.range ? ' (`' + v.range + '`)' : '') + '\n'; }); md += '\n'; }
    if (d.relations.length > 0) { md += '## 关系\n\n'; d.relations.forEach(r => { md += '- **' + r.name + '** — ' + r.relationName + '\n'; }); md += '\n'; }
    if (d.synopsis) md += '## 剧情梗概\n\n' + d.synopsis + '\n\n';
    if (d.version.subtitle) md += '## 题记\n\n> ' + _stripHtml(d.version.subtitle) + '\n\n';
    if (d.contentMarkdown.trim()) md += d.contentMarkdown;
    if (d.markMarkdown) md += d.markMarkdown;
    md += '\n\n---\n\n*导自 ' + (this.data.settings?.name || 'Wiki') + '*\n';
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = d.version.title + '_' + d.entry.code + '.md'; a.click(); URL.revokeObjectURL(url);
    this.showToast('Markdown导出成功', 'success'); this.closeShareDialog();
};

/**
 * 【重写】导出为长图 — flex标题区 + 修复截断 + 剧情梗概
 */
app.exportEntryAsImage = async function() {
    if (typeof html2canvas === 'undefined') {
        this.showToast('正在加载图片导出库...', 'info');
        try { await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'); }
        catch (e) { this.showToast('图片导出库加载失败', 'error'); return; }
    }

    // 【修复】桌面版：先预加载导出涉及的图片（封面/头图/图片元件），
    // 确保 _resolveImageUrl 能从内存缓存解析出可加载的 blob URL（而非失效的 GitHub 相对路径）
    if (this.storageManager && this.storageManager.mode === 'desktop') {
        try {
            const refs = new Set();
            const scanRef = (v) => {
                if (typeof v === 'string' && v.startsWith('{{IMG:')) {
                    const m = v.match(/\{\{IMG:(.+?)\}\}/);
                    if (m) refs.add(m[1]);
                }
            };
            const entry = (this.data.entries || []).find(e => e.id === this.data.editingId);
            if (entry) {
                scanRef(entry.headerImage);
                for (const v of entry.versions || []) {
                    if (v.images) Object.values(v.images).forEach(scanRef);
                    for (const b of (v.blocks || [])) if (b.type === 'img') scanRef(b.src);
                }
            }
            for (const f of refs) {
                try { if (!this.storageManager.memoryCache.has(f)) await this.storageManager.loadImage(f); } catch (e) {}
            }
        } catch (e) {
            console.warn('[Export] 图片预加载失败:', e);
        }
    }

    const d = this._getCurrentEntryExportData();
    if (!d) return;

    const container = document.createElement('div');
    // 【修复2】不设置固定width/height，让html2canvas自动计算
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#ffffff;padding:48px;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;z-index:-1;';

    // 【新增】活动词条特殊布局：头图在上→大标题+活动时间在下
    let headerFlex = '';
    if (d.entry.type === 'event') {
        let dateText = '';
        const dur = d.entry.duration;
        if (!dur || dur.type === 'permanent') dateText = '常态上线';
        else if (dur.type === 'period' && dur.startDate && dur.endDate) {
            const s = new Date(dur.startDate); const e = new Date(dur.endDate);
            const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            dateText = `${fmt(s)} ~ ${fmt(e)}`;
        }
        headerFlex = '<div style="margin-bottom:8px;padding-bottom:24px;border-bottom:3px solid #f43f5e;">';
        if (d.coverImage) {
            headerFlex += '<div style="width:100%;margin-bottom:16px;border-radius:12px;overflow:hidden;background:#f3f4f6;"><img src="' + d.coverImage + '" style="width:100%;height:auto;max-height:280px;object-fit:cover;" onerror="this.style.display=\'none\'"/></div>';
        }
        headerFlex += '<div style="display:inline-block;padding:4px 14px;background:#f43f5e;color:#fff;font-size:12px;border-radius:12px;margin-bottom:12px;">' + _escapeHtml(d.typeLabel) + '</div>' +
            '<h1 style="font-size:30px;font-weight:bold;color:#1f2937;margin:0 0 8px;line-height:1.3;">' + _escapeHtml(d.version.title) + '</h1>' +
            '<div style="font-size:13px;color:#6b7280;font-family:monospace;">' + d.entry.code + ' · ' + dateText + '</div>' +
        '</div>';
    } else if (d.coverImage) {
        headerFlex = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:8px;padding-bottom:24px;border-bottom:3px solid #4f46e5;">' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="display:inline-block;padding:4px 14px;background:#4f46e5;color:#fff;font-size:12px;border-radius:12px;margin-bottom:12px;">' + _escapeHtml(d.typeLabel) + '</div>' +
                '<h1 style="font-size:30px;font-weight:bold;color:#1f2937;margin:0 0 8px;line-height:1.3;">' + _escapeHtml(d.version.title) + '</h1>' +
                '<div style="font-size:13px;color:#6b7280;font-family:monospace;">' + d.entry.code + (d.chapterRange ? ' · 第' + _escapeHtml(d.chapterRange) + '章' : '') + '</div>' +
            '</div>' +
            '<div style="flex-shrink:0;">' +
                '<img src="' + d.coverImage + '" style="width:200px;max-height:320px;height:auto;object-fit:cover;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.15);" onerror="this.style.display=\'none\'"/>' +
            '</div>' +
        '</div>';
    } else {
        headerFlex = '<div style="text-align:center;margin-bottom:8px;padding-bottom:24px;border-bottom:3px solid #4f46e5;">' +
            '<div style="display:inline-block;padding:4px 14px;background:#4f46e5;color:#fff;font-size:12px;border-radius:12px;margin-bottom:12px;">' + _escapeHtml(d.typeLabel) + '</div>' +
            '<h1 style="font-size:30px;font-weight:bold;color:#1f2937;margin:0 0 8px;line-height:1.3;">' + _escapeHtml(d.version.title) + '</h1>' +
            '<div style="font-size:13px;color:#6b7280;font-family:monospace;">' + d.entry.code + (d.chapterRange ? ' · 第' + _escapeHtml(d.chapterRange) + '章' : '') + '</div>' +
        '</div>';
    }

    // 版本（活动词条不显示）
    let extraSections = '';
    if (d.entry.type !== 'event' && d.allVersions.length > 0) {
        let vh = '<div style="margin:20px 0;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;"><div style="font-size:13px;font-weight:bold;color:#475569;margin-bottom:10px;">📋 版本</div>';
        d.allVersions.forEach(v => { vh += '<div style="font-size:14px;color:#334155;padding:4px 0;">' + (v.isCurrent ? '<span style="color:#4f46e5;font-weight:bold;">▶</span> ' : '<span style="color:#94a3b8;">○</span> ') + _escapeHtml(v.title) + (v.range ? ' <span style="color:#94a3b8;font-size:12px;">(' + _escapeHtml(v.range) + ')</span>' : '') + '</div>'; });
        vh += '</div>'; extraSections += vh;
    }
    // 关系（活动词条不显示）
    if (d.entry.type !== 'event' && d.relations.length > 0) {
        let rh = '<div style="margin:20px 0;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;"><div style="font-size:13px;font-weight:bold;color:#166534;margin-bottom:10px;">🔗 关系</div><div style="display:flex;flex-wrap:wrap;gap:8px;">';
        d.relations.forEach(r => { rh += '<span style="display:inline-block;padding:6px 12px;background:#dcfce7;border-radius:20px;font-size:13px;color:#15803d;">' + _escapeHtml(r.name) + '<span style="color:#86efac;margin:0 4px;">·</span>' + _escapeHtml(r.relationName) + '</span>'; });
        rh += '</div></div>'; extraSections += rh;
    }
    // 【修复3】剧情梗概
    if (d.synopsisHtml) {
        extraSections += '<div style="margin:20px 0;padding:16px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;"><div style="font-size:13px;font-weight:bold;color:#92400e;margin-bottom:10px;">📖 剧情梗概</div><div style="font-size:14px;color:#78350f;line-height:1.8;">' + d.synopsisHtml + '</div></div>';
    }
    // 题记
    let subtitleHtml = '';
    if (d.version.subtitle) {
        subtitleHtml = '<div style="margin:20px 0;padding:16px 20px;border-left:4px solid #4f46e5;background:#eef2ff;border-radius:0 8px 8px 0;font-size:15px;color:#4338ca;font-style:italic;line-height:1.8;">' + _parseInlineMarkdown(_stripHtml(d.version.subtitle)) + '</div>';
    }

    container.innerHTML = '<div style="max-width:720px;margin:0 auto;">' +
        headerFlex +
        extraSections +
        subtitleHtml +
        '<div style="margin-top:24px;">' + d.contentHtml + '</div>' +
        d.markHtml +
        '<div style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#9ca3af;">导自 ' + _escapeHtml(this.data.settings?.name || 'Wiki') + '</div>' +
    '</div>';

    document.body.appendChild(container);
    // 【修复2】等待图片加载完成后再截图
    await new Promise(resolve => setTimeout(resolve, 300));
    const images = container.querySelectorAll('img');
    await Promise.all(Array.from(images).map(img => new Promise(r => {
        if (img.complete) r();
        else { img.onload = r; img.onerror = r; }
    })));

    try {
        // 【修复2】不指定固定height，让html2canvas自动计算完整内容高度
        const canvas = await html2canvas(container, {
            scale: 1.5,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            // 关键：不设置width和height，让html2canvas自动计算
            // 这样可以避免canvas高度限制导致的截断
        });
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a'); a.href = url; a.download = d.version.title + '_' + d.entry.code + '.png'; a.click();
        this.showToast('图片导出成功', 'success');
    } catch (e) { console.error('图片导出失败:', e); this.showToast('图片导出失败: ' + e.message, 'error'); }
    finally { container.remove(); }
    this.closeShareDialog();
};

// 辅助：动态加载JS脚本
app._loadScript = function(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

console.log('Part 6-4 (Content Manager) v4.4 加载完成 - 导出修复版');



// ========== 活动页词条功能 ==========

/**
 * 检查活动是否当前上线中
 */
app.isEventActive = function(eventEntry) {
    if (!eventEntry || eventEntry.type !== 'event') return false;
    const dur = eventEntry.duration;
    if (!dur) return true; // 默认上线
    if (dur.type === 'permanent') return true;
    if (dur.type === 'period' && dur.startDate && dur.endDate) {
        const now = new Date();
        const start = new Date(dur.startDate);
        const end = new Date(dur.endDate);
        return now >= start && now <= end;
    }
    return false;
};

/**
 * 获取活动状态标签
 */
app.getEventStatus = function(eventEntry) {
    if (!eventEntry || eventEntry.type !== 'event') return { label: '未知', className: 'ended' };
    const dur = eventEntry.duration;
    if (!dur || dur.type === 'permanent') return { label: '常态', className: 'permanent' };
    if (dur.type === 'period' && dur.startDate && dur.endDate) {
        const now = new Date();
        const start = new Date(dur.startDate);
        const end = new Date(dur.endDate);
        if (now < start) return { label: '即将开始', className: 'upcoming' };
        if (now > end) return { label: '已结束', className: 'ended' };
        return { label: '进行中', className: 'active' };
    }
    return { label: '进行中', className: 'active' };
};

/**
 * 获取当前所有上线的活动（按添加时间倒序）
 */
app.getActiveEvents = function() {
    const events = this.data.entries.filter(e => e.type === 'event');
    const active = events.filter(e => this.isEventActive(e));
    // 按 createdAt 倒序，最新的排最前
    active.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return active;
};

/**
 * 渲染首页活动窗口
 */
app.renderHomeEventBanner = function(container) {
    const activeEvents = this.getActiveEvents();
    const bannerEl = container.querySelector('#active-event-banner');
    if (!bannerEl) return;

    if (activeEvents.length === 0) {
        bannerEl.classList.add('hidden');
        return;
    }

    bannerEl.classList.remove('hidden');

    // 恢复轮播索引（从缓存中读取，避免页面切换后重置）
    let currentIdx = this._homeBannerIndex || 0;
    if (currentIdx >= activeEvents.length) currentIdx = 0;
    this._homeBannerIndex = currentIdx;
    this._homeBannerEvents = activeEvents;

    const currentEvent = activeEvents[currentIdx];
    const version = this.getVisibleVersion(currentEvent) || currentEvent.versions[0];

    const titleEl = container.querySelector('#active-event-title');
    const descEl = container.querySelector('#active-event-desc');
    const imgEl = container.querySelector('#active-event-image');
    const dotsEl = container.querySelector('#active-event-dots');

    if (titleEl) titleEl.textContent = version?.title || currentEvent.code;
    if (descEl) descEl.textContent = version?.subtitle || '';

    // 【重构】头图：src留空 + data-img-ref标记，appendChild后统一异步加载
    if (imgEl) {
        const imgRef = currentEvent.headerImage || '';
        if (imgRef.startsWith('data:') || imgRef.startsWith('http')) {
            imgEl.src = imgRef;
        } else {
            imgEl.src = '';
        }
        imgEl.dataset.imgRef = imgRef;
        imgEl.classList.remove('hidden');
    }

    // 点状指示器
    if (dotsEl) {
        dotsEl.innerHTML = '';
        activeEvents.forEach((_, idx) => {
            const dot = document.createElement('div');
            dot.className = 'active-event-dot ' + (idx === currentIdx ? 'active' : '');
            dot.onclick = (e) => { e.stopPropagation(); this._switchHomeBanner(idx); };
            dotsEl.appendChild(dot);
        });
    }

    // 绑定点击
    const bannerDiv = bannerEl.querySelector('.active-event-banner');
    if (bannerDiv) {
        bannerDiv.onclick = () => {
            const evts = this._homeBannerEvents || activeEvents;
            const idx = this._homeBannerIndex || 0;
            if (evts[idx]) this.openEntry(evts[idx].id);
        };
    }

    // 启动自动轮播
    this._startHomeBannerAutoPlay();
};

/**
 * 【新增】切换首页活动窗口到指定索引
 */
app._switchHomeBanner = function(index) {
    const events = this._homeBannerEvents;
    if (!events || !events[index]) return;
    this._homeBannerIndex = index;
    const event = events[index];
    const version = this.getVisibleVersion(event) || event.versions[0];

    const titleEl = document.getElementById('active-event-title');
    const descEl = document.getElementById('active-event-desc');
    const imgEl = document.getElementById('active-event-image');
    const dots = document.querySelectorAll('.active-event-dot');

    if (titleEl) titleEl.textContent = version?.title || event.code;
    if (descEl) descEl.textContent = version?.subtitle || '';

    if (imgEl) {
        const imgRef = event.headerImage || '';
        if (imgRef.startsWith('data:') || imgRef.startsWith('http')) {
            imgEl.src = imgRef;
        } else {
            imgEl.src = '';
            imgEl.dataset.imgRef = imgRef;
            this._loadBannerImageAsync(imgEl, imgRef);
        }
    }

    dots.forEach((d, i) => d.classList.toggle('active', i === index));
};

/**
 * 【新增】启动自动轮播（5秒间隔）
 */
app._startHomeBannerAutoPlay = function() {
    this._stopHomeBannerAutoPlay();
    const events = this._homeBannerEvents;
    if (!events || events.length <= 1) return;
    this._bannerAutoPlayTimer = setInterval(() => {
        const nextIdx = ((this._homeBannerIndex || 0) + 1) % events.length;
        this._switchHomeBanner(nextIdx);
    }, 5000);
};

/**
 * 【新增】停止自动轮播
 */
app._stopHomeBannerAutoPlay = function() {
    if (this._bannerAutoPlayTimer) {
        clearInterval(this._bannerAutoPlayTimer);
        this._bannerAutoPlayTimer = null;
    }
};

/**
 * 【新增】异步加载banner头图
 */
app._loadBannerImageAsync = async function(imgEl, imgRef) {
    if (!imgRef || !this.storageManager) return;
    if (imgRef.startsWith('data:') || imgRef.startsWith('http')) {
        if (imgEl) imgEl.src = imgRef;
        return;
    }
    if (imgRef.startsWith('{{IMG:')) {
        const match = imgRef.match(/\{\{IMG:(.+?)\}\}/);
        if (!match) return;
        try {
            const url = await this.storageManager.loadImage(match[1]);
            if (url && imgEl && document.body.contains(imgEl)) {
                imgEl.src = url;
            }
        } catch (e) {
            console.warn('[_loadBannerImageAsync] 加载失败:', match[1]);
        }
    }
};

/**
 * 【新增】加载首页活动窗口头图（在appendChild后调用）
 */
app.loadHomeEventBannerImages = function() {
    const imgEl = document.getElementById('active-event-image');
    if (!imgEl) return;
    const imgRef = imgEl.dataset.imgRef;
    if (!imgRef) return;
    if (imgRef.startsWith('{{IMG:') && this.storageManager) {
        const m = imgRef.match(/\{\{IMG:(.+?)\}\}/);
        if (m && this.storageManager.memoryCache.has(m[1])) {
            imgEl.src = this.storageManager.memoryCache.get(m[1]);
            return;
        }
    }
    this._loadBannerImageAsync(imgEl, imgRef);
};

app.openActiveEvent = function() {
    const activeEvents = this.getActiveEvents();
    if (activeEvents.length > 0) {
        this.openEntry(activeEvents[0].id);
    }
};

/**
 * 渲染全部活动页面
 */
app.renderEvents = function(container) {
    const tpl = document.getElementById('tpl-events');
    if (!tpl) {
        container.innerHTML = '<div class="p-4 text-center text-gray-500">模板加载失败</div>';
        return;
    }
    const clone = tpl.content.cloneNode(true);
    const listEl = clone.getElementById('events-list');
    const countEl = clone.getElementById('events-count');
    const emptyEl = clone.getElementById('events-empty');

    container.appendChild(clone);

    const events = this.data.entries.filter(e => e.type === 'event');

    if (countEl) countEl.textContent = events.length;

    if (events.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (listEl) listEl.classList.add('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    // 排序：进行中的按createdAt倒序 → 即将开始 → 已结束
    events.sort((a, b) => {
        const statusA = this.getEventStatus(a).className;
        const statusB = this.getEventStatus(b).className;
        const order = { active: 0, upcoming: 1, permanent: 0, ended: 2 };
        const orderA = order[statusA] ?? 3;
        const orderB = order[statusB] ?? 3;
        if (orderA !== orderB) return orderA - orderB;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    events.forEach(event => {
        const card = this.createEventCard(event);
        if (card && listEl) listEl.appendChild(card);
    });
    // 【关键修复】所有卡片插入DOM后，统一异步加载头图
    requestAnimationFrame(() => this._loadLazyImagesInContainer(listEl));
};

/**
 * 创建活动卡片
 */
app.createEventCard = function(event) {
    const version = this.getVisibleVersion(event) || event.versions[0];
    if (!version) return null;

    const status = this.getEventStatus(event);
    const div = document.createElement('div');
    div.className = 'event-card';
    div.onclick = () => this.openEntry(event.id);

    // 头图：使用data-img-ref标记，renderEvents插入后统一异步加载
    const imgRef = event.headerImage || '';
    let headerImg = imgRef;
    if (headerImg.startsWith('{{IMG:') && this.storageManager) {
        const match = headerImg.match(/\{\{IMG:(.+?)\}\}/);
        if (match && this.storageManager.memoryCache.has(match[1])) {
            headerImg = this.storageManager.memoryCache.get(match[1]);
        }
    }
    // 【关键修复】非dataUrl/http时src留空，避免浏览器加载本地路径失败
    const hasDirectImage = headerImg && (headerImg.startsWith('data:') || headerImg.startsWith('http'));
    const needsAsyncLoad = imgRef.startsWith('{{IMG:') && !hasDirectImage;
    const srcForTag = hasDirectImage ? headerImg : '';
    const safeRef = this.escapeHtml(imgRef).replace(/"/g, '&quot;');

    // 日期显示
    let dateText = '';
    const dur = event.duration;
    if (!dur || dur.type === 'permanent') {
        dateText = '常态上线';
    } else if (dur.type === 'period' && dur.startDate && dur.endDate) {
        const start = new Date(dur.startDate);
        const end = new Date(dur.endDate);
        const fmt = (d) => `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        dateText = `${fmt(start)} ~ ${fmt(end)}`;
    }

    div.innerHTML = `
        <div class="event-card-image">
            ${hasDirectImage || needsAsyncLoad ? `<img src="${srcForTag}" data-img-ref="${safeRef}" alt="${this.escapeHtml(version.title)}" loading="lazy" class="event-img-loadable" onerror="this.classList.add('event-img-failed');">` : '<div class="w-full h-full flex items-center justify-center text-gray-300"><i class="fa-solid fa-image text-3xl"></i></div>'}
            ${needsAsyncLoad ? '<div class="event-img-fail-msg hidden" style="position:absolute;inset:0;"><div class="w-full h-full flex items-center justify-center text-gray-300"><i class="fa-solid fa-image text-3xl"></i></div></div>' : ''}
            <span class="event-card-status ${status.className}">${status.label}</span>
        </div>
        <div class="event-card-body">
            <div class="event-card-title">${this.escapeHtml(version.title)}</div>
            <div class="event-card-date">
                <i class="fa-regular fa-calendar"></i>
                <span>${dateText}</span>
                <span class="ml-2 text-gray-400 font-mono">${event.code}</span>
            </div>
        </div>
    `;

    return div;
};

/**
 * 渲染活动页词条内容块HTML（返回字符串，由renderDetail组装完整页面）
 */
app.renderEventDetail = function(version) {
    if (!version) return '';

    let html = '<div class="prose prose-sm max-w-none mt-4">';

    if (version.blocks && version.blocks.length > 0) {
        version.blocks.forEach(block => {
            if (block.type === 'h2') {
                html += `<h2 class="text-xl font-bold text-gray-800 mt-6 mb-3 border-b pb-2">${this.escapeHtml(block.text)}</h2>`;
            } else if (block.type === 'h3') {
                html += `<h3 class="text-lg font-semibold text-gray-700 mt-4 mb-2">${this.escapeHtml(block.text)}</h3>`;
            } else if (block.type === 'p') {
                let text = block.text || '';
                text = this.parseContentText(text);
                html += `<p class="text-gray-600 leading-relaxed mb-4" style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;">${text}</p>`;
            } else if (block.type === 'img') {
                const imgRef = block.src || '';
                let imgSrc = imgRef;
                // 优先从memoryCache获取dataUrl
                if (imgSrc.startsWith('{{IMG:') && this.storageManager) {
                    const match = imgSrc.match(/\{\{IMG:(.+?)\}\}/);
                    if (match && this.storageManager.memoryCache.has(match[1])) {
                        imgSrc = this.storageManager.memoryCache.get(match[1]);
                    }
                }
                // 【关键修复】非dataUrl/http时src留空，避免浏览器加载本地路径失败
                // 只通过data-img-ref保存引用，由_loadEventBlockImages异步填充
                const isDirectLoadable = imgSrc.startsWith('data:') || imgSrc.startsWith('http');
                const srcForTag = isDirectLoadable ? imgSrc : '';
                const safeRef = this.escapeHtml(imgRef).replace(/"/g, '&quot;');
                const caption = block.caption || '';
                const safeCaption = this.escapeHtml(caption);
                html += `<div class="event-block-image">
                    <img src="${srcForTag}" data-img-ref="${safeRef}" alt="${safeCaption}" loading="lazy" class="event-img-loadable" onerror="this.classList.add('event-img-failed');">
                    <div class="event-img-fail-msg hidden"><div class="text-gray-400 py-4 text-center"><i class="fa-solid fa-image text-2xl"></i><p class="text-xs mt-1">图片加载失败</p></div></div>
                    ${caption ? `<div class="event-block-image-caption">${safeCaption}</div>` : ''}
                </div>`;
            } else if (block.type === 'table') {
                // 【新增】表格元件渲染（查看模式，支持colspan+对齐+样式）
                const rows = block.rows || [];
                const colspans = block.colspans || [];
                const aligns = block.aligns || [];
                const styles = block.styles || [];
                const _cellViewStyle = (r, c) => {
                    const parts = [];
                    const a = aligns[r] && aligns[r][c] ? aligns[r][c] : '';
                    if (a) parts.push('text-align:' + a);
                    const s = styles[r] && styles[r][c] ? styles[r][c] : null;
                    if (s) { if (s.color) parts.push('color:' + s.color); if (s.bg) parts.push('background-color:' + s.bg); }
                    return parts.length > 0 ? ' style="' + parts.join(';') + '"' : '';
                };
                if (rows.length > 0) {
                    html += '<div class="overflow-x-auto my-4"><table class="w-full border-collapse bg-white rounded-lg overflow-hidden shadow-sm" style="table-layout:fixed;">';
                    html += '<thead class="bg-gray-100"><tr>';
                    (rows[0] || []).forEach((cell, cIdx) => {
                        const cs = colspans[0] && colspans[0][cIdx] > 1 ? ' colspan="' + colspans[0][cIdx] + '"' : '';
                        html += '<th class="border border-gray-200 p-2 text-xs text-gray-700 font-semibold"' + cs + _cellViewStyle(0, cIdx) + '>' + this.parseInlineMarkdown(this.escapeHtml(cell)) + '</th>';
                    });
                    html += '</tr></thead><tbody>';
                    for (let r = 1; r < rows.length; r++) {
                        html += '<tr>';
                        (rows[r] || []).forEach((cell, cIdx) => {
                            const cs = colspans[r] && colspans[r][cIdx] > 1 ? ' colspan="' + colspans[r][cIdx] + '"' : '';
                            html += '<td class="border border-gray-200 p-2 text-sm text-gray-600"' + cs + _cellViewStyle(r, cIdx) + '>' + this.parseInlineMarkdown(this.escapeHtml(cell)) + '</td>';
                        });
                        html += '</tr>';
                    }
                    html += '</tbody></table></div>';
                }
            }
        });
    } else {
        html += '<div class="text-gray-400 italic text-center py-8">暂无内容</div>';
    }

    html += '</div>';
    return html;
};

// ========== 首页分栏显示控制 ==========

/**
 * 设置首页显示列数
 */
app.setHomeColumns = function(cols) {
    cols = parseInt(cols) || 1;
    if (cols < 1) cols = 1;
    if (cols > 3) cols = 3;
    
    const container = document.getElementById('home-multi-col-container');
    if (container) {
        container.className = 'home-multi-col-' + cols;
    }
    
    // 【关键修复】分栏时减少左右留白75%：1列保持max-w-3xl，2/3列去除max-w限制
    const layoutContainer = document.getElementById('home-layout-container');
    if (layoutContainer) {
        if (cols === 1) {
            layoutContainer.classList.add('max-w-3xl');
            layoutContainer.style.maxWidth = '';
        } else {
            layoutContainer.classList.remove('max-w-3xl');
            layoutContainer.style.maxWidth = '100%';
        }
    }
    
    // 更新按钮状态
    document.querySelectorAll('.home-col-btn').forEach(btn => {
        const btnCols = parseInt(btn.dataset.cols);
        btn.classList.toggle('active', btnCols === cols);
    });
    
    // 缓存到 localStorage
    try { localStorage.setItem('novelWiki_homeColumns', String(cols)); } catch(e) {}
    
    // 同步缓存到 data.settings（供导出备份）
    if (!this.data.settings) this.data.settings = {};
    this.data.settings._homeColumns = cols;
};

/**
 * 从缓存加载首页列数设置
 */
app.loadHomeColumnSetting = function() {
    let cols = 1;
    // 优先从 localStorage 读取
    try {
        const saved = localStorage.getItem('novelWiki_homeColumns');
        if (saved) cols = parseInt(saved) || 1;
    } catch(e) {}
    // 回退：从 data.settings 读取（从备份恢复时）
    if (cols === 1 && this.data.settings && this.data.settings._homeColumns) {
        cols = parseInt(this.data.settings._homeColumns) || 1;
    }
    return Math.max(1, Math.min(3, cols));
};

/**
 * 在 renderHome 中初始化列数控制
 */
app.initHomeColumnControl = function(container) {
    const control = container.querySelector('#home-column-control');
    const colContainer = container.querySelector('#home-multi-col-container');
    if (!control || !colContainer) return;
    
    // 【修复】始终显示列数选择器（所有首页组件都参与分栏）
    control.classList.remove('hidden');
    
    // 应用缓存的列数
    const cols = this.loadHomeColumnSetting();
    this.setHomeColumns(cols);
};

/**
 * 【通用】异步加载容器内所有标记了data-img-ref的图片
 * 用于renderEvents(全部活动页)、_renderDetailInternal(详情页)等场景
 */
app._loadLazyImagesInContainer = async function(container) {
    if (!container || !this.storageManager) return;
    const imgs = container.querySelectorAll('img[data-img-ref^="{{IMG:"]');
    for (const img of imgs) {
        const ref = img.dataset.imgRef;
        if (!ref) continue;
        const match = ref.match(/\{\{IMG:(.+?)\}\}/);
        if (!match) continue;
        try {
            const url = await this.storageManager.loadImage(match[1]);
            if (url) {
                img.src = url;
                img.classList.remove('event-img-failed');
            }
        } catch (e) {
            console.warn('[_loadLazyImages] 加载失败:', match[1]);
            img.classList.add('event-img-failed');
        }
    }
};

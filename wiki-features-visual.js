/**
 * Part 6-3: 可视化引擎 (Visual Engine) - 修复版 v2.4
 * 修复内容：
 * 1. 关系图支持双击打开词条，保留单击显示关系
 * 2. 关系图侧边栏添加"查看词条"按钮
 * 3. 支持从 storageManager 加载图片引用
 * 4. 增强错误处理和边界检查
 */

// 依赖检查
if (typeof app === 'undefined') {
    console.error('wiki-features-visual.js: app 对象未定义');
    throw new Error('Missing dependency: wiki-core.js');
}

// ========== 关系图谱系统 ==========
app.renderGraph = function(container) {
    const tpl = document.getElementById('tpl-graph');
    if (!tpl) {
        console.error('[RenderGraph] 模板不存在');
        return;
    }
    const clone = tpl.content.cloneNode(true);
    container.appendChild(clone);

    this.initDraggablePanel();
    this.initGraphPan();

    // 延迟渲染节点，确保DOM已就绪
    setTimeout(() => this.renderGraphNodes(), 50);
};

app.initDraggablePanel = function() {
    const panel = document.getElementById('graph-info-panel');
    if (!panel) return;
    
    const handle = panel.querySelector('.draggable-handle');
    if (!handle) return;

    let isDragging = false;
    let startX, startY, initialX, initialY;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        panel.classList.add('dragging');
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        panel.style.left = `${initialX + dx}px`;
        panel.style.top = `${initialY + dy}px`;
        panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            panel.classList.remove('dragging');
        }
    });
};


app.initGraphPan = function() {
    const container = document.getElementById('graph-container');
    if (!container) return;

    let isMouseDown = false;
    let isPanning = false;
    let startX, startY, downX, downY;
    const PAN_THRESHOLD = 3; // 移动超过3px视为拖拽

    container.addEventListener('mousedown', (e) => {
        // 排除 info-panel 及其子元素、工具栏、导航栏
        if (e.target.closest('#graph-info-panel')) return;
        if (e.target.closest('nav') || e.target.closest('header')) return;

        isMouseDown = true;
        isPanning = false;
        downX = e.clientX;
        downY = e.clientY;
        startX = e.clientX - (this.data.graphState.translateX || 0);
        startY = e.clientY - (this.data.graphState.translateY || 0);
        // 不立即 grab，等确认是拖拽后再改变光标
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;

        // 检查是否超过拖拽阈值
        if (!isPanning) {
            const dx = Math.abs(e.clientX - downX);
            const dy = Math.abs(e.clientY - downY);
            if (dx > PAN_THRESHOLD || dy > PAN_THRESHOLD) {
                isPanning = true;
                container.style.cursor = 'grabbing';
            } else {
                return; // 未超过阈值，不执行平移
            }
        }

        this.data.graphState.translateX = e.clientX - startX;
        this.data.graphState.translateY = e.clientY - startY;
        this.applyGraphTransform();
    });

    document.addEventListener('mouseup', (e) => {
        if (!isMouseDown) return;
        isMouseDown = false;

        if (isPanning) {
            isPanning = false;
            container.style.cursor = 'grab';
            // 【关键】阻止本次拖拽产生的 click 事件到达节点，避免误触发选中
            const suppressClick = (ce) => {
                // 只拦截 graph-container 内部的 click（包括节点）
                if (ce.target.closest('#graph-container')) {
                    ce.stopPropagation();
                }
                document.removeEventListener('click', suppressClick, true);
            };
            setTimeout(() => {
                document.addEventListener('click', suppressClick, true);
            }, 0);
        }
    });

    // Touch support for mobile
    let isTouchPanning = false;
    let touchStartX, touchStartY;
    container.addEventListener('touchstart', (e) => {
        if (e.target.closest('#graph-info-panel')) return;
        if (e.target.closest('nav') || e.target.closest('header')) return;
        isTouchPanning = true;
        touchStartX = e.touches[0].clientX - (this.data.graphState.translateX || 0);
        touchStartY = e.touches[0].clientY - (this.data.graphState.translateY || 0);
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isTouchPanning) return;
        this.data.graphState.translateX = e.touches[0].clientX - touchStartX;
        this.data.graphState.translateY = e.touches[0].clientY - touchStartY;
        this.applyGraphTransform();
    }, { passive: true });

    document.addEventListener('touchend', () => {
        isTouchPanning = false;
    });
};
app.togglePanelCollapse = function() {
    const content = document.getElementById('panel-content');
    const icon = document.querySelector('#graph-info-panel button i');
    if (!content || !icon) return;
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.className = 'fa-solid fa-minus';
    } else {
        content.classList.add('hidden');
        icon.className = 'fa-solid fa-plus';
    }
};

app.renderGraphNodes = function() {
    const container = document.getElementById('graph-nodes');
    const svg = document.getElementById('graph-svg');
    if (!container || !svg) {
        console.error('[RenderGraphNodes] 容器不存在');
        return;
    }
    
    container.innerHTML = '';
    svg.innerHTML = '';

    let chars = this.data.entries.filter(e => e.type === 'character');
    if (this.data.currentTimeline !== 'latest') {
        chars = chars.filter(e => this.getVisibleVersion(e) !== null);
    }

    if (chars.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 mt-20">暂无角色数据</div>';
        return;
    }

    const hexRadius = 80;
    const hexWidth = hexRadius * Math.sqrt(3);
    const hexHeight = hexRadius * 2;

    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;

    const positions = this.calculateHoneycombPositions(chars.length, hexWidth, hexHeight, centerX, centerY);

    chars.forEach((char, idx) => {
        const version = this.getVisibleVersion(char);
        if (!version) return;

        const pos = positions[idx];

        const node = document.createElement('div');
        node.className = 'hexagon-wrapper absolute';
        node.style.left = `${pos.x - 70}px`;
        node.style.top = `${pos.y - 80}px`;
        node.style.width = '140px';
        node.style.height = '160px';
        node.dataset.charId = char.id;

        // 处理图片：优先从内存缓存获取引用标记对应的实际URL
        let avatarImg = version.images?.avatar || version.image;
        if (avatarImg && avatarImg.startsWith('{{IMG:') && this.storageManager) {
            const match = avatarImg.match(/\{\{IMG:(.+?)\}\}/);
            if (match && this.storageManager.memoryCache.has(match[1])) {
                avatarImg = this.storageManager.memoryCache.get(match[1]);
            }
        }

        node.innerHTML = `
            <div class="hexagon lvl-${char.level || 3}">
                <div class="hexagon-content">
                    <div class="w-16 h-16 rounded-full bg-gray-200 overflow-hidden mb-2 border-2 border-white shadow">
                        ${avatarImg ? 
                            `<img src="${avatarImg}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'w-full h-full bg-indigo-100 flex items-center justify-center text-indigo-500 text-xs font-bold\\'>${char.code}</div>'">` :
                            `<div class="w-full h-full bg-indigo-100 flex items-center justify-center text-indigo-500 text-xs font-bold">${char.code}</div>`
                        }
                    </div>
                    <div class="text-xs font-bold text-center truncate w-full px-2">${version.title}</div>
                    ${char.level === 1 ? '<div class="absolute -top-1 -right-1 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center text-white text-[10px] shadow"><i class="fa-solid fa-star"></i></div>' : ''}
                </div>
            </div>
        `;

        // 关键修复：单击显示关系，双击打开词条
        let clickTimer = null;
        let clickCount = 0;
        
        node.onclick = (e) => {
            e.stopPropagation();
            clickCount++;
            
            if (clickCount === 1) {
                // 第一次单击：显示关系（保留原有功能）
                this.selectGraphNode(char);
                
                // 设置定时器，300ms内无第二次点击则重置
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                // 双击：打开词条详情
                clearTimeout(clickTimer);
                clickCount = 0;
                this.openEntry(char.id);
            }
        };

        container.appendChild(node);
    });

    this.drawRelationLines(chars, positions);

    const graphContainer = document.getElementById('graph-container');
    if (graphContainer) {
        graphContainer.onclick = (e) => {
            if (e.target.id === 'graph-container' || e.target.id === 'graph-svg') {
                this.resetGraphSelection();
            }
        };
    }
};

app.calculateHoneycombPositions = function(count, hexW, hexH, centerX, centerY) {
    const positions = [{x: centerX, y: centerY}];

    if (count <= 1) return positions;

    let ring = 1;
    let remaining = count - 1;

    while (remaining > 0) {
        const ringCount = ring * 6;
        for (let i = 0; i < Math.min(ringCount, remaining); i++) {
            const angle = (i / ringCount) * Math.PI * 2 - Math.PI / 2;
            const radius = ring * hexW;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius * 0.866;
            positions.push({x, y});
        }
        remaining -= ringCount;
        ring++;
    }

    return positions;
};

app.drawRelationLines = function(chars, positions) {
    const svg = document.getElementById('graph-svg');
    if (!svg) return;

    chars.forEach((char, idx) => {
        const version = this.getVisibleVersion(char);
        if (!version || !version.relatedCharacters) return;

        const startPos = positions[idx];

        version.relatedCharacters.forEach(rc => {
            const targetIdx = chars.findIndex(c => c.id === rc.charId);
            if (targetIdx === -1) return;

            const endPos = positions[targetIdx];

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', startPos.x);
            line.setAttribute('y1', startPos.y);
            line.setAttribute('x2', endPos.x);
            line.setAttribute('y2', endPos.y);
            line.setAttribute('stroke', '#cbd5e1');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-dasharray', '5,5');
            svg.appendChild(line);
        });
    });
};

// 修复：添加查看词条按钮，并确保单击高亮仍然工作
app.selectGraphNode = function(char) {
    const version = this.getVisibleVersion(char);
    if (!version) return;

    const infoDiv = document.getElementById('selected-character-info');
    if (!infoDiv) return;
    
    infoDiv.classList.remove('hidden');
    
    // 修复：添加带有点击跳转的标题和查看按钮
    const nameEl = document.getElementById('selected-char-name');
    if (nameEl) {
        nameEl.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <span class="truncate cursor-pointer hover:text-indigo-600 transition" onclick="app.openEntry('${char.id}')" title="双击角色也可打开">${version.title}</span>
                <button onclick="app.openEntry('${char.id}')" class="shrink-0 text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 transition whitespace-nowrap">
                    查看词条
                </button>
            </div>
        `;
    }
    
    // 关系文本
    const relationEl = document.getElementById('selected-char-relation');
    if (relationEl) {
        let relationText = '';
        if (version.relatedCharacters && version.relatedCharacters.length > 0) {
            relationText = version.relatedCharacters.map(rc => {
                const relatedChar = this.data.entries.find(e => e.id === rc.charId);
                if (!relatedChar) return '';
                const relatedVersion = this.getVisibleVersion(relatedChar);
                return `与 ${relatedVersion ? relatedVersion.title : relatedChar.code} 是${rc.relationName}`;
            }).filter(Boolean).join('；');
        }
        relationEl.textContent = relationText || '暂无关系';
    }

    // 视觉高亮
    document.querySelectorAll('.hexagon-wrapper').forEach(node => {
        if (node.dataset.charId === char.id) {
            node.style.opacity = '1';
            node.style.transform = 'scale(1.1)';
            node.style.zIndex = '10';
            node.style.filter = 'drop-shadow(0 8px 16px rgba(0,0,0,0.2))';
        } else {
            node.style.opacity = '0.3';
            node.style.transform = 'scale(1)';
            node.style.zIndex = '1';
            node.style.filter = 'none';
        }
    });

    this.showRelatedNodes(char);
};

app.showRelatedNodes = function(char) {
    const version = this.getVisibleVersion(char);
    if (!version || !version.relatedCharacters) return;

    let related = version.relatedCharacters.map(rc => {
        const entry = this.data.entries.find(e => e.id === rc.charId);
        if (!entry) return null;
        return {
            entry,
            relationName: rc.relationName,
            level: entry.level || 5
        };
    }).filter(Boolean);

    related.sort((a, b) => a.level - b.level);
    related = related.slice(0, 5);

    related.forEach(r => {
        const node = document.querySelector(`.hexagon-wrapper[data-char-id="${r.entry.id}"]`);
        if (node) {
            node.style.opacity = '1';
            node.style.transform = 'scale(1.05)';
        }
    });
};

app.resetGraphSelection = function() {
    document.querySelectorAll('.hexagon-wrapper').forEach(node => {
        node.style.opacity = '1';
        node.style.transform = 'scale(1)';
        node.style.zIndex = '1';
        node.style.filter = 'none';
    });
    const infoDiv = document.getElementById('selected-character-info');
    if (infoDiv) infoDiv.classList.add('hidden');
};

app.zoomIn = function() {
    this.data.graphState.scale = Math.min(this.data.graphState.scale * 1.2, 3);
    this.applyGraphTransform();
};

app.zoomOut = function() {
    this.data.graphState.scale = Math.max(this.data.graphState.scale / 1.2, 0.3);
    this.applyGraphTransform();
};

app.resetGraphView = function() {
    this.data.graphState.scale = 1;
    this.data.graphState.translateX = 0;
    this.data.graphState.translateY = 0;
    this.applyGraphTransform();
};

app.applyGraphTransform = function() {
    const nodes = document.getElementById('graph-nodes');
    const svg = document.getElementById('graph-svg');
    const transform = `translate(${this.data.graphState.translateX}px, ${this.data.graphState.translateY}px) scale(${this.data.graphState.scale})`;
    if (nodes) nodes.style.transform = transform;
    if (svg) svg.style.transform = transform;
};

app.setSynopsisActiveIndex = function(idx) {
    // 修复：边界检查
    if (!this.data.synopsis || idx < 0 || idx >= this.data.synopsis.length) {
        console.warn('[Synopsis] 无效的索引:', idx);
        return;
    }
    
    this.data.synopsisViewIndex = idx;

    document.querySelectorAll('.synopsis-view-item').forEach((item, i) => {
        if (i === idx) {
            item.classList.add('active');
            item.classList.remove('inactive');
            const content = item.querySelector('.synopsis-view-content');
            if (content) {
                content.classList.remove('line-clamp');
                // 修复：移除可能的内联样式限制
                content.style.display = 'block';
            }
            const img = item.querySelector('.synopsis-view-image');
            if (img) {
                img.style.maxHeight = '300px';
                img.style.opacity = '1';
            }
        } else {
            item.classList.remove('active');
            item.classList.add('inactive');
            const content = item.querySelector('.synopsis-view-content');
            if (content) {
                content.classList.add('line-clamp');
                // 修复：确保收起状态正确应用
                content.style.display = '-webkit-box';
                content.style.webkitBoxOrient = 'vertical';
                content.style.webkitLineClamp = '1';
            }
            const img = item.querySelector('.synopsis-view-image');
            if (img) {
                img.style.maxHeight = '200px';
                img.style.opacity = '0.5';
            }
        }
    });

    this.scrollToSynopsisItem(idx);
    this.updateSwitchTimeButton();
};

app.scrollToSynopsisItem = function(idx) {
    const item = document.getElementById(`synopsis-item-${idx}`);
    if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

app.navigateSynopsis = function(direction) {
    const newIdx = this.data.synopsisViewIndex + direction;
    if (newIdx >= 0 && newIdx < this.data.synopsis.length) {
        this.setSynopsisActiveIndex(newIdx);
    }
};

// 【修改】updateSwitchTimeButton 函数，仅控制显示/隐藏，不修改位置：
app.updateSwitchTimeButton = function() {
    const btn = document.getElementById('synopsis-switch-time-btn');
    if (!btn) return;

    const chapter = this.data.synopsis[this.data.synopsisViewIndex];
    if (!chapter) {
        btn.classList.add('hidden');
        return;
    }
    
    const chapterId = chapter.chapterId || chapter.id;
    const isDifferentTime = this.data.currentTimeline !== chapterId;
    
    // 仅切换显示状态，不再修改任何位置属性
    btn.classList.toggle('hidden', !isDifferentTime);
    
    // 【确保】即使被其他代码意外修改，也强制恢复右下角（防御性代码）
    if (isDifferentTime) {
        requestAnimationFrame(() => {
            btn.style.setProperty('top', 'auto', 'important');
            btn.style.setProperty('bottom', '80px', 'important');
            btn.style.setProperty('right', '20px', 'important');
            btn.style.setProperty('position', 'fixed', 'important');
        });
    }
};

app.switchToSynopsisTime = function() {
    const chapter = this.data.synopsis[this.data.synopsisViewIndex];
    if (!chapter) return;

    this.setTimeline(chapter.chapterId);
    this.updateSwitchTimeButton();

    const toast = document.getElementById('timeline-switch-toast');
    const toastText = document.getElementById('timeline-switch-text');
    if (toast && toastText) {
        toastText.textContent = `已切换到 ${this.formatChapterNum(chapter.num)}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
};

// ========== 剧情引用悬浮窗系统 ==========
app.showSynopsisTooltip = function(chapterId, triggerElement) {
    const chapter = this.data.synopsis.find(s => s.id === chapterId);
    if (!chapter) {
        console.warn('未找到章节:', chapterId);
        return;
    }

    this.closeSynopsisTooltip();

    const tpl = document.getElementById('tpl-synopsis-tooltip');
    if (!tpl) {
        console.error('模板 tpl-synopsis-tooltip 不存在');
        return;
    }

    const clone = tpl.content.cloneNode(true);
    document.body.appendChild(clone);

    const numEl = document.getElementById('tooltip-chapter-num');
    const titleEl = document.getElementById('tooltip-chapter-title');
    const imgEl = document.getElementById('tooltip-chapter-image');
    const contentEl = document.getElementById('tooltip-chapter-content');
    const tooltip = document.getElementById('synopsis-tooltip-box');

    if (!numEl || !titleEl || !contentEl || !tooltip) {
        console.error('tooltip元素未找到');
        this.closeSynopsisTooltip();
        return;
    }

    numEl.textContent = this.formatChapterNum(chapter.num);
    titleEl.textContent = chapter.title;

    if (imgEl && chapter.image) {
        imgEl.src = chapter.image;
        imgEl.classList.remove('hidden');
    }

    contentEl.innerHTML = chapter.content || '<span class="text-gray-400 italic">暂无内容</span>';

    const rect = triggerElement.getBoundingClientRect();
    const tooltipWidth = 450;
    const tooltipHeight = 300;

    let top = rect.bottom + 10 + window.scrollY;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2 + window.scrollX;

    if (left + tooltipWidth > window.innerWidth) {
        left = window.innerWidth - tooltipWidth - 20;
    }
    if (left < 10) {
        left = 10;
    }
    if (top + tooltipHeight > window.innerHeight + window.scrollY) {
        top = rect.top + window.scrollY - tooltipHeight - 10;
    }

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';

    document.body.classList.add('body-dimmed');

    requestAnimationFrame(() => {
        tooltip.classList.add('show');
    });

    this.currentTooltipChapterId = chapterId;

    tooltip.onclick = (e) => {
        e.stopPropagation();
        this.closeSynopsisTooltip();
        this.router('synopsis');
        const idx = this.data.synopsis.findIndex(s => s.id === chapterId);
        if (idx !== -1) {
            this.data.synopsisViewIndex = idx;
            setTimeout(() => this.setSynopsisActiveIndex(idx), 100);
        }
    };

    tooltip.onmouseleave = () => {
        setTimeout(() => {
            if (!triggerElement.matches(':hover')) {
                this.closeSynopsisTooltip();
            }
        }, 300);
    };

    this.tooltipClickOutsideHandler = (e) => {
        if (!tooltip.contains(e.target) && !triggerElement.contains(e.target)) {
            this.closeSynopsisTooltip();
        }
    };
    setTimeout(() => {
        document.addEventListener('click', this.tooltipClickOutsideHandler);
    }, 100);
};

app.closeSynopsisTooltip = function() {
    const tooltip = document.querySelector('.synopsis-tooltip');
    if (tooltip) tooltip.remove();
    
    document.body.classList.remove('body-dimmed');
    this.currentTooltipChapterId = null;

    if (this.tooltipClickOutsideHandler) {
        document.removeEventListener('click', this.tooltipClickOutsideHandler);
        this.tooltipClickOutsideHandler = null;
    }
};

app.handleSynopsisRefHover = function(element) {
    const chapterId = element.dataset.chapterId;
    if (!chapterId) return;
    if (this.currentTooltipChapterId === chapterId) return;

    if (this.tooltipHoverTimeout) {
        clearTimeout(this.tooltipHoverTimeout);
    }

    this.tooltipHoverTimeout = setTimeout(() => {
        this.tooltipHoverTimeout = null;
        this.showSynopsisTooltip(chapterId, element);
    }, 300);
};

app.handleSynopsisRefLeave = function(element) {
    if (this.tooltipHoverTimeout) {
        clearTimeout(this.tooltipHoverTimeout);
        this.tooltipHoverTimeout = null;
    }

    this.tooltipLeaveTimeout = setTimeout(() => {
        this.tooltipLeaveTimeout = null;
        const tooltip = document.querySelector('.synopsis-tooltip');
        if (tooltip) {
            if (tooltip.matches(':hover')) return;
            this.closeSynopsisTooltip();
        }
    }, 300);
};

app.handleSynopsisRefClick = function(element) {
    const chapterId = element.dataset.chapterId;
    if (!chapterId) return;

    if (this.tooltipHoverTimeout) {
        clearTimeout(this.tooltipHoverTimeout);
        this.tooltipHoverTimeout = null;
    }

    if (this.currentTooltipChapterId === chapterId) {
        this.closeSynopsisTooltip();
        this.router('synopsis');
        const idx = this.data.synopsis.findIndex(s => s.id === chapterId);
        if (idx !== -1) {
            this.data.synopsisViewIndex = idx;
            setTimeout(() => this.setSynopsisActiveIndex(idx), 100);
        }
    } else {
        this.showSynopsisTooltip(chapterId, element);
    }
};

// ========== 词条索引点击功能 ==========
app.bindEntryIndexClickHandlers = function(container) {
    if (!container) return;

    const entryIndexes = container.querySelectorAll('.entry-index');
    entryIndexes.forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            const entryId = el.dataset.entryId;
            const versionId = el.dataset.versionId;
            if (entryId) {
                this.viewEntryById(entryId, versionId);
            }
        };
    });
};

app.viewEntryById = function(entryId, versionId) {
    const entry = this.data.entries.find(e => e.id === entryId);
    if (!entry) {
        alert('词条不存在');
        return;
    }

    this.data.editingId = entry.id;

    if (versionId && entry.versions.some(v => v.vid === versionId)) {
        this.data.viewingVersionId = versionId;
    } else {
        const visibleVersion = this.getVisibleVersion(entry);
        this.data.viewingVersionId = visibleVersion ? visibleVersion.vid : entry.versions[0]?.vid;
    }

    this.addToHistory(entry);
    this.router('detail');
};

// ========== 键盘导航初始化（修复版） ==========
app.initKeyboardListeners = function() {
    // 移除可能存在的旧监听器（防止重复绑定）
    if (this._keydownHandler) {
        document.removeEventListener('keydown', this._keydownHandler);
    }
    
    // 定义新的处理器
    this._keydownHandler = (e) => {
        // 仅在剧情梗概视图生效
        if (this.data.currentView !== 'synopsis') return;
        
        // 忽略输入框内的按键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation(); // 修复：阻止冒泡确保不被其他组件拦截
            this.navigateSynopsis(-1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            this.navigateSynopsis(1);
        } else if (e.key === 'Escape') {
            // 修复：同时关闭弹窗和提示
            this.closeSynopsisPopup();
            this.closeSynopsisTooltip();
        } else if (e.key === 'Enter') {
            // 修复：如果当前有悬浮提示，则点击进入
            const tooltip = document.querySelector('.synopsis-tooltip.show');
            if (tooltip) {
                e.preventDefault();
                const chapterId = this.currentTooltipChapterId;
                if (chapterId) {
                    this.closeSynopsisTooltip();
                    // 找到索引并跳转
                    const idx = this.data.synopsis.findIndex(s => s.id === chapterId);
                    if (idx !== -1) {
                        this.setSynopsisActiveIndex(idx);
                    }
                }
            }
        }
    };
    
    // 绑定到 document（捕获阶段确保优先级）
    document.addEventListener('keydown', this._keydownHandler, true);
    this._keyboardListenersInitialized = true;
    
    console.log('[Keyboard] 剧情梗概键盘导航已初始化');
};

console.log('Part 6-3 (Visual Engine) 加载完成 - 修复版：支持关系图双击打开词条，保留单击显示关系');
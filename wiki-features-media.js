/**
 * Part 6-2: 媒体处理系统 (Media Processor) - v3.0
 * 更新内容：
 * 1. 富文本编辑使用contenteditable，隐藏Markdown标记
 * 2. 添加键盘快捷键支持（Ctrl+S保存，Ctrl+Z撤销）
 * 3. 移动端图片裁剪降级处理
 */

// 依赖检查：确保核心模块已加载
if (typeof app === 'undefined') {
    console.error('wiki-features-media.js: app 对象未定义，请先加载 wiki-core.js');
    throw new Error('Missing dependency: wiki-core.js must be loaded before wiki-features-media.js');
}

// ========== 图片尺寸配置 ==========
app.imageSizes = {
    avatar: { ratio: 1, label: '头像 1:1', width: 200, height: 200 },
    card: { ratio: 3/4, label: '词条 3:4', width: 300, height: 400 },
    cover: { ratio: 4/3, label: '封面 4:3', width: 400, height: 300 }
};

// ========== 检测是否为移动端 ==========
app.isMobile = function() {
    // 【修复】仅使用userAgent检测，去掉window.innerWidth判断
    // 避免窄窗口电脑浏览器被误判为移动端
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// ========== 图片上传处理 ==========
app.handleImageUpload = function(input) {
    const file = input.files[0];
    if(!file) return;
    
    // ZIP架构下的大图片警告（影响数据包体积）
    const fileSizeKB = file.size / 1024;
    if (fileSizeKB > 500) {
        if (!confirm(`图片体积较大 (${(fileSizeKB/1024).toFixed(1)}MB)，会导致ZIP数据包体积变大。\n建议：\n1. 压缩后再上传\n2. 或使用小尺寸图片\n\n仍要继续吗？`)) {
            input.value = '';
            return;
        }
    }
    
    if(!file.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        this.tempImageData = e.target.result;
        this.tempCropData = {};
        this.currentCropRatio = 'avatar';

        // 移动端检测：使用系统裁剪或原图
        if (this.isMobile()) {
            this.handleMobileImageUpload(e.target.result);
            return;
        }

        // 检查 Cropper.js 是否加载
        if(typeof Cropper === 'undefined') {
            // 降级处理：直接使用原图作为所有尺寸
            if (!this.tempVersion.images) this.tempVersion.images = {};
            this.tempVersion.images.avatar = e.target.result;
            this.tempVersion.images.card = e.target.result;
            this.tempVersion.images.cover = e.target.result;
            this.tempVersion.image = e.target.result;
            
            this.safeInitImagePreview();
            this.showSaveToast('图片已上传（裁剪库未加载，使用原图）');
            return;
        }

        this.openImageCropper(e.target.result);
    };
    reader.onerror = () => {
        alert('图片读取失败');
    };
    reader.readAsDataURL(file);
};

// ========== 移动端图片处理 ==========
app.handleMobileImageUpload = function(imageSrc) {
    // 移动端使用简单裁剪或直接原图
    if (!this.tempVersion.images) this.tempVersion.images = {};
    
    // 尝试使用简单的canvas裁剪
    try {
        const img = new Image();
        img.onload = () => {
            // 生成三种尺寸的简单居中裁剪
            const sizes = [
                { name: 'avatar', width: 200, height: 200 },
                { name: 'card', width: 300, height: 400 },
                { name: 'cover', width: 400, height: 300 }
            ];
            
            sizes.forEach(size => {
                const canvas = document.createElement('canvas');
                canvas.width = size.width;
                canvas.height = size.height;
                const ctx = canvas.getContext('2d');
                
                // 计算居中裁剪
                const imgRatio = img.width / img.height;
                const targetRatio = size.width / size.height;
                let sx, sy, sw, sh;
                
                if (imgRatio > targetRatio) {
                    sh = img.height;
                    sw = sh * targetRatio;
                    sx = (img.width - sw) / 2;
                    sy = 0;
                } else {
                    sw = img.width;
                    sh = sw / targetRatio;
                    sx = 0;
                    sy = (img.height - sh) / 2;
                }
                
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size.width, size.height);
                this.tempVersion.images[size.name] = canvas.toDataURL('image/jpeg', 0.9);
            });
            
            this.tempVersion.image = this.tempVersion.images.card;
            this.safeInitImagePreview();
            this.showSaveToast('图片已处理（移动端简单裁剪）');
        };
        img.src = imageSrc;
    } catch (e) {
        // 降级：直接使用原图
        this.tempVersion.images.avatar = imageSrc;
        this.tempVersion.images.card = imageSrc;
        this.tempVersion.images.cover = imageSrc;
        this.tempVersion.image = imageSrc;
        this.safeInitImagePreview();
        this.showSaveToast('图片已上传（使用原图）');
    }
};

// ========== 图片裁剪器核心 ==========
app.openImageCropper = function(imageSrc) {
    this.closeImageCropper();

    const tpl = document.getElementById('tpl-image-cropper');
    if (!tpl) {
        console.error('裁剪器模板未找到');
        return;
    }
    
    const clone = tpl.content.cloneNode(true);
    document.body.appendChild(clone);
    document.body.classList.add('cropper-modal-open');

    this.currentCropStep = 0;
    this.tempCropData = {};
    this.tempImages = {}; // 存储裁剪后的各尺寸图片

    const image = document.getElementById('cropper-image');
    image.src = imageSrc;

    image.onload = () => {
        this.initCropperForStep(0);
    };

    // 键盘事件绑定
    this.cropperKeyHandler = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            this.handleEnterKey();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.closeImageCropper();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            this.cycleToNextStep();
        }
    };

    document.addEventListener('keydown', this.cropperKeyHandler);
};

app.initCropperForStep = function(step) {
    if (this.cropper) {
        if (this.currentCropStep !== undefined) {
            this.tempCropData[this.currentCropStep] = this.cropper.getData();
        }
        this.cropper.destroy();
    }

    this.currentCropStep = step;
    const ratioTypes = ['avatar', 'card', 'cover'];
    const ratioType = ratioTypes[step];
    const config = this.imageSizes[ratioType];
    const image = document.getElementById('cropper-image');

    this.updateProgressDisplay(step);

    this.cropper = new Cropper(image, {
        aspectRatio: config.ratio,
        viewMode: 1,
        autoCropArea: 0.8,
        responsive: true,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        ready: () => {
            if (this.tempCropData[step]) {
                this.cropper.setData(this.tempCropData[step]);
            }
        }
    });
};

app.handleEnterKey = function() {
    if (!this.cropper) return;

    const ratioTypes = ['avatar', 'card', 'cover'];
    const sizes = {
        avatar: { width: 200, height: 200 },
        card: { width: 300, height: 400 }, 
        cover: { width: 400, height: 300 }
    };

    const currentType = ratioTypes[this.currentCropStep];
    const size = sizes[currentType];

    try {
        const canvas = this.cropper.getCroppedCanvas({
            width: size.width,
            height: size.height,
            fillColor: '#fff',
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });

        if (!this.tempImages) this.tempImages = {};
        this.tempImages[currentType] = canvas.toDataURL('image/jpeg', 0.9);

    } catch (err) {
        console.error('裁剪失败:', err);
    }

    if (this.currentCropStep < 2) {
        this.initCropperForStep(this.currentCropStep + 1);
    } else {
        this.finalizeCropping();
    }
};

app.cycleToNextStep = function() {
    const nextStep = (this.currentCropStep + 1) % 3;
    this.initCropperForStep(nextStep);
};

app.updateProgressDisplay = function(currentStep) {
    const steps = ['头像 1:1', '词条 3:4', '封面 4:3'];

    document.querySelectorAll('.progress-step').forEach((el, idx) => {
        el.classList.remove('active', 'completed');
        if (idx < currentStep) {
            el.classList.add('completed');
            el.innerHTML = `<i class="fa-solid fa-check mr-1"></i>${steps[idx]}`;
        } else if (idx === currentStep) {
            el.classList.add('active');
            el.textContent = `${idx + 1}. ${steps[idx]}`;
        } else {
            el.textContent = `${idx + 1}. ${steps[idx]}`;
        }
    });

    const statusText = document.getElementById('crop-status-text');
    const actionText = document.getElementById('enter-action-text');
    const badge = document.getElementById('auto-save-hint');

    if (statusText) {
        statusText.textContent = `正在编辑：${steps[currentStep]}（${currentStep + 1}/3）`;
    }

    if (actionText) {
        actionText.textContent = currentStep < 2 ? '确认并进入下一步' : '确认并保存所有';
    }

    if (badge) {
        if (currentStep < 2) {
            badge.textContent = '按 Enter 继续';
            badge.classList.remove('completed');
        } else {
            badge.textContent = '按 Enter 完成';
            badge.classList.add('completed');
        }
    }
};

app.finalizeCropping = function() {
    if (!this.tempImages || !this.tempImages.card) {
        alert('图片处理失败，请重试');
        return;
    }

    if (!this.tempVersion.images) {
        this.tempVersion.images = {};
    }

    const entryId = this.tempEntry.id || 'temp';
    const versionId = this.tempVersion.vid || 'v-temp';
    
    // 修复：使用固定文件名（不含时间戳），确保重复保存会覆盖而非新建
    const files = {};
    ['avatar', 'card', 'cover'].forEach(type => {
        if (this.tempImages[type]) {
            const ext = 'jpg';
            // 关键修复：固定文件名格式，避免生成重复文件
            const filename = `${entryId}_${versionId}_${type}.${ext}`;
            
            // 保存到存储管理器（OPFS/本地文件夹）
            this.storageManager.saveImage(filename, this.tempImages[type], {
                entryId, versionId, type
            });
            
            // 在数据中保留引用标记
            files[type] = `{{IMG:${filename}}}`;
        }
    });

    // 应用引用标记到当前版本
    this.tempVersion.images.avatar = files.avatar;
    this.tempVersion.images.card = files.card;
    this.tempVersion.images.cover = files.cover;
    this.tempVersion.image = files.card;

    this.tempImages = {};
    this.closeImageCropper();

    setTimeout(() => {
        this.safeInitImagePreview();
    }, 200);

    this.showSaveToast('已生成三种尺寸并保存到本地存储');
};

app.closeImageCropper = function() {
    if (this.cropperKeyHandler) {
        document.removeEventListener('keydown', this.cropperKeyHandler);
        this.cropperKeyHandler = null;
    }
    if (this.cropper) {
        this.cropper.destroy();
        this.cropper = null;
    }
    
    const modal = document.querySelector('.cropper-modal');
    if (modal) modal.remove();
    
    document.body.classList.remove('cropper-modal-open');
    this.currentCropStep = 0;
    this.tempCropData = {};
};

app.removeImage = function() {
    this.tempVersion.images = { avatar: null, card: null, cover: null };
    this.tempVersion.image = null;
    this.safeInitImagePreview();
    if (app.scheduleAutoSave) app.scheduleAutoSave(300);
};

// ========== 图片预览系统 ==========
// 在 wiki-features-media.js 中替换 safeInitImagePreview 函数
app.safeInitImagePreview = async function() {
    // 解析引用标记并加载实际图片。
    // 【关键】只用于预览，绝不写回 tempVersion.images：
    // 加载出的 blob URL 若写回数据，保存时会被 saveData 判定为非法值而置 null，导致图片丢失。
    let previewImages = { avatar: null, card: null, cover: null };
    if (this.tempVersion && this.tempVersion.images) {
        for (const key of ['avatar', 'card', 'cover']) {
            const val = this.tempVersion.images[key];
            if (val && val.startsWith('{{IMG:')) {
                const match = val.match(/\{\{IMG:(.+?)\}\}/);
                const filename = match ? match[1] : null;
                if (filename && this.storageManager) {
                    try {
                        const actualUrl = await this.storageManager.loadImage(filename);
                        if (actualUrl) previewImages[key] = actualUrl;
                    } catch (e) {
                        console.warn('[Image] 加载失败:', filename);
                    }
                }
            } else {
                previewImages[key] = val;
            }
        }
    }
    
    // DOM更新逻辑（保持原有）
    setTimeout(() => {
        const imgPreview = app.$e('edit-image-preview');
        const imgPlaceholder = app.$e('edit-image-placeholder');
        const imgRemove = app.$e('edit-image-remove');
        const sizePreviews = document.getElementById('image-size-previews');

        if (!imgPreview || !imgPlaceholder) return;

        const images = previewImages;
        const mainImg = images.card || images.avatar || images.cover || this.tempVersion?.image;

        if (mainImg && (mainImg.startsWith('data:image') || mainImg.startsWith('blob:') || mainImg.startsWith('http'))) {
            imgPreview.src = mainImg;
            imgPreview.classList.remove('hidden');
            imgPlaceholder.classList.add('hidden');
            if (imgRemove) imgRemove.classList.remove('hidden');

            if (sizePreviews) {
                sizePreviews.classList.remove('hidden');
                const updateThumb = (id, src) => {
                    const thumb = document.getElementById(id);
                    if (thumb && src) {
                        thumb.src = src;
                        thumb.classList.remove('hidden');
                    }
                };
                updateThumb('preview-thumb-avatar', images.avatar);
                updateThumb('preview-thumb-card', images.card);
                updateThumb('preview-thumb-cover', images.cover);
            }
        } else {
            imgPreview.classList.add('hidden');
            imgPlaceholder.classList.remove('hidden');
            if (imgRemove) imgRemove.classList.add('hidden');
            if (sizePreviews) sizePreviews.classList.add('hidden');
        }
    }, 100);
};

// ========== 富文本编辑系统（使用contenteditable隐藏Markdown） ==========

// 将Markdown转换为HTML显示
app.markdownToHtml = function(markdown) {
    if (!markdown) return '';
    return markdown
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.+?)\*/g, '<i>$1</i>')
        .replace(/__(.+?)__/g, '<u>$1</u>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        // 【新增】外链格式 [[显示文本|url:https://...]]
        .replace(/\[\[([^\]|]+)\|url:([^\]]+)\]\]/g, (match, displayText, url) => {
            const cleanUrl = url.trim();
            const cleanText = displayText.trim();
            return '<a href="' + cleanUrl + '" class="entry-external-link" target="_blank" rel="noopener noreferrer" data-external-url="' + cleanUrl + '" onclick="app.confirmExternalLink(event, \'' + cleanUrl.replace(/'/g, "\\'") + '\'); return false;"><i class="fa-solid fa-arrow-up-right-from-square text-xs mr-1"></i>' + cleanText + '</a>';
        })
        .replace(/\[\[(.+?)\]\]/g, '<span class="entry-link" data-entry="$1">$1</span>')
        .replace(/\{\{synopsis:([^:]+):([^}]+)\}\}/g, '<span class="synopsis-ref-inline" data-chapter-id="$1">$2</span>');
};

// 将HTML转换回Markdown存储
app.htmlToMarkdown = function(html) {
    if (!html) return '';
    // 创建一个临时元素来解析HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // 递归处理节点
    const processNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            const content = Array.from(node.childNodes).map(processNode).join('');
            
            switch(tag) {
                case 'b':
                case 'strong': return `**${content}**`;
                case 'i':
                case 'em': return `*${content}*`;
                case 'u': return `__${content}__`;
                case 's':
                case 'strike':
                case 'del': return `~~${content}~~`;
                case 'br': return '\n';
                case 'div':
                case 'p': return content + '\n';
                // 【新增】外链 a 标签（增强检测：data-external-url / class / href）
                case 'a': {
                    const externalUrl = node.getAttribute('data-external-url');
                    const href = node.getAttribute('href') || '';
                    const isExternal = externalUrl || node.classList.contains('entry-external-link') ||
                        (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) && !node.getAttribute('data-entry-id'));
                    if (isExternal) {
                        const url = externalUrl || href || '';
                        return '[[' + content.trim() + '|url:' + url + ']]';
                    }
                    return content;
                }
                default: return content;
            }
        }
        return '';
    };
    
    return processNode(temp).trim();
};

// 创建富文本编辑块
app.createRichEditBlock = function(container, block, idx) {
    const blockDiv = document.createElement('div');
    blockDiv.className = 'edit-block border border-gray-200 rounded-lg p-3 bg-white';
    blockDiv.dataset.index = idx;
    
    const isTitle = block.type === 'h2' || block.type === 'h3';
    
    // 块头部工具栏
    const header = document.createElement('div');
    header.className = 'flex justify-between items-center mb-2';
    header.innerHTML = `
        <div class="flex items-center gap-2">
            <span class="text-xs text-gray-400 font-mono">#${idx + 1}</span>
            <span class="text-xs px-2 py-0.5 rounded ${isTitle ? 'bg-indigo-100 text-indigo-700' : block.type === 'img' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600'}">
                ${block.type === 'h2' ? '二级标题' : block.type === 'h3' ? '小标题' : block.type === 'img' ? '图片' : '正文'}
            </span>
        </div>
        <div class="flex gap-1">
            <button onclick="app.moveBlock(${idx}, -1)" class="text-gray-400 hover:text-gray-600 p-1" title="上移">
                <i class="fa-solid fa-arrow-up text-xs"></i>
            </button>
            <button onclick="app.moveBlock(${idx}, 1)" class="text-gray-400 hover:text-gray-600 p-1" title="下移">
                <i class="fa-solid fa-arrow-down text-xs"></i>
            </button>
            <button onclick="app.deleteBlock(${idx})" class="text-red-400 hover:text-red-600 p-1" title="删除">
                <i class="fa-solid fa-trash text-xs"></i>
            </button>
        </div>
    `;
    blockDiv.appendChild(header);
    
    // 富文本编辑区域（contenteditable）
    const editor = document.createElement('div');
    editor.className = 'rich-editor min-h-[60px] p-2 border border-gray-200 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none';
    editor.contentEditable = true;
    editor.innerHTML = this.markdownToHtml(block.text || '');
    
    // 根据类型设置样式
    if (block.type === 'h2') {
        editor.className += ' text-xl font-bold text-gray-800';
    } else if (block.type === 'h3') {
        editor.className += ' text-lg font-semibold text-gray-700';
    } else {
        editor.className += ' text-sm text-gray-600 leading-relaxed';
    }
    
    // 将Markdown转换为HTML显示
    editor.innerHTML = this.markdownToHtml(block.text || '');
    
    // 监听输入事件，实时更新数据
    editor.addEventListener('input', () => {
        const markdown = this.htmlToMarkdown(editor.innerHTML);
        this.tempVersion.blocks[idx].text = markdown;
    });
    
    // 监听粘贴事件，纯文本粘贴
    editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
    });
    
    // 键盘快捷键
    editor.addEventListener('keydown', (e) => {
        // Ctrl+B/I/U 格式化
        if (e.ctrlKey || e.metaKey) {
            switch(e.key.toLowerCase()) {
                case 'b':
                    e.preventDefault();
                    document.execCommand('bold');
                    break;
                case 'i':
                    e.preventDefault();
                    document.execCommand('italic');
                    break;
                case 'u':
                    e.preventDefault();
                    document.execCommand('underline');
                    break;
            }
        }
    });
    
    blockDiv.appendChild(editor);
    container.appendChild(blockDiv);
};

// 旧的textarea编辑块（保留兼容）
app.createEditBlock = function(container, block, idx) {
    // 使用新的富文本编辑块
    this.createRichEditBlock(container, block, idx);
};

// 格式化选中文本（通过execCommand）
app.formatText = function(command) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    let editor = range.commonAncestorContainer;
    
    // 找到最近的富文本编辑器
    while (editor && !editor.classList?.contains('rich-editor')) {
        editor = editor.parentElement;
    }
    
    if (!editor) {
        // 降级到旧方式
        this.formatTextLegacy(command);
        return;
    }
    
    // 执行格式化命令
    editor.focus();
    document.execCommand(command, false, null);
    
    // 更新数据
    const idx = parseInt(editor.closest('.edit-block').dataset.index);
    if (!isNaN(idx) && this.tempVersion.blocks[idx]) {
        this.tempVersion.blocks[idx].text = this.htmlToMarkdown(editor.innerHTML);
    }
};

// 旧版格式化（兼容）
app.formatTextLegacy = function(command) {
    const activeElement = app.lastFocusedTextarea || document.activeElement;
    if (!activeElement || !activeElement.classList?.contains('block-input')) return;
    
    const start = activeElement.selectionStart;
    const end = activeElement.selectionEnd;
    if (start === end) return;
    
    const selectedText = activeElement.value.substring(start, end);
    if (!selectedText) return;

    let formattedText = selectedText;
    switch(command) {
        case 'bold': formattedText = `**${selectedText}**`; break;
        case 'italic': formattedText = `*${selectedText}*`; break;
        case 'underline': formattedText = `__${selectedText}__`; break;
        case 'strikeThrough': formattedText = `~~${selectedText}~~`; break;
    }

    const value = activeElement.value;
    activeElement.value = value.substring(0, start) + formattedText + value.substring(end);
    activeElement.setSelectionRange(start + formattedText.length, start + formattedText.length);
    activeElement.focus();
};

app.insertLink = async function() {
    // 使用网页内输入弹窗（Electron 不支持 window.prompt）
    let name = null;
    if (app.showPromptDialog) {
        name = await app.showPromptDialog({ title: '插入词条链接', placeholder: '输入要链接的词条名称', confirmText: '插入' });
    } else {
        name = prompt('输入要链接的词条名称：');
    }
    if (name) {
        const selection = window.getSelection();
        if (selection.rangeCount) {
            const range = selection.getRangeAt(0);
            let editor = range.commonAncestorContainer;
            while (editor && !editor.classList?.contains('rich-editor')) {
                editor = editor.parentElement;
            }
            if (editor) {
                editor.focus();
                const span = document.createElement('span');
                span.className = 'entry-link';
                span.dataset.entry = name;
                span.textContent = name;
                range.deleteContents();
                range.insertNode(span);
                
                // 更新数据
                const idx = parseInt(editor.closest('.edit-block').dataset.index);
                if (!isNaN(idx) && this.tempVersion.blocks[idx]) {
                    this.tempVersion.blocks[idx].text = this.htmlToMarkdown(editor.innerHTML);
                }
                return;
            }
        }
        
        // 降级处理
        const activeElement = document.activeElement;
        if (activeElement && activeElement.classList?.contains('block-input')) {
            const start = activeElement.selectionStart;
            const value = activeElement.value;
            const linkText = `[[${name}]]`;
            activeElement.value = value.substring(0, start) + linkText + value.substring(start);
            activeElement.setSelectionRange(start + linkText.length, start + linkText.length);
            activeElement.focus();
        }
    }
};

// 插入剧情梗概引用
app.insertSynopsisRef = function() {
    if (!this.data.synopsis || this.data.synopsis.length === 0) {
        alert('暂无剧情梗概章节');
        return;
    }
    
    // 创建选择弹窗
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4 fade-in';
    overlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden">
            <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                <h3 class="font-bold text-gray-800">选择要引用的章节</h3>
                <button class="close-btn text-gray-400 hover:text-gray-600">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="flex-1 overflow-y-auto p-2" id="synopsis-ref-list"></div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    const list = overlay.querySelector('#synopsis-ref-list');
    this.data.synopsis.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'p-3 hover:bg-gray-100 rounded-lg cursor-pointer flex items-center gap-3 transition';
        item.innerHTML = `
            <span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-medium">${this.formatChapterNum(ch.num)}</span>
            <span class="text-sm text-gray-700">${ch.title}</span>
        `;
        item.onclick = () => {
            const selection = window.getSelection();
            if (selection.rangeCount) {
                const range = selection.getRangeAt(0);
                let editor = range.commonAncestorContainer;
                while (editor && !editor.classList?.contains('rich-editor')) {
                    editor = editor.parentElement;
                }
                if (editor) {
                    editor.focus();
                    const span = document.createElement('span');
                    span.className = 'synopsis-ref-inline';
                    span.dataset.chapterId = ch.id;
                    span.innerHTML = `<i class="fa-solid fa-film text-xs mr-1"></i>${ch.title}`;
                    range.deleteContents();
                    range.insertNode(span);
                    
                    const idx = parseInt(editor.closest('.edit-block').dataset.index);
                    if (!isNaN(idx) && this.tempVersion.blocks[idx]) {
                        this.tempVersion.blocks[idx].text = this.htmlToMarkdown(editor.innerHTML);
                    }
                }
            }
            overlay.remove();
        };
        list.appendChild(item);
    });
    
    overlay.querySelector('.close-btn').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
};

console.log('Part 6-2 (Media Processor) v3.0 加载完成 - 富文本编辑、移动端适配');

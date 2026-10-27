/**
 * Part 5+7-Enhanced: 核心系统与增强型本地存储管理整合版（修复白屏与加载中问题）
 * 修复内容：
 * 1. 提供 renderHome/renderSettings 的完整实现，消除"加载中"状态
 * 2. 添加键盘监听防重复绑定机制（_keyboardListenersInitialized 标志）
 * 3. 优化存储管理器初始化流程
 * 【2026-03-25 修复】修复全时间有效角色被误标为"失踪"的问题
 * 【2026-03-25 优化】排序算法：置顶>重要程度>失踪置后>编号，未来角色置后但按最高重要程度排序
 * 【2026-03-25 修复】并行区间指示器位置下移避免遮挡重要程度标记
 */

const app = {
    // ========== 增强型存储管理器（完整原始实现） ==========
    storageManager: {
        opfsRoot: null,
        localDirectory: null,
        localImagesDir: null,
        hasDirectoryPermission: false,
        // 【优化】LRU 图片缓存：限制内存中图片数量，按需加载/卸载
        memoryCache: new Map(),
        MAX_MEMORY_CACHE_SIZE: 30, // 最多保留30张图片在内存中
        _accessOrder: [], // LRU 访问顺序追踪
        
        manifest: { version: '2.5.0', lastUpdate: 0, mappings: {} },
        db: null,

        async init() {
            await this.initIndexedDB();
            if ('storage' in navigator && 'getDirectory' in navigator.storage) {
                try {
                    this.opfsRoot = await navigator.storage.getDirectory();
                    console.log('[Storage] OPFS 已挂载');
                } catch (e) {
                    console.warn('[Storage] OPFS 不可用:', e);
                }
            }
            await this.restoreDirectoryPermission();
            await this.loadManifest();
            await this.autoRestoreImages();
            
            setTimeout(async () => {
                if (this.localDirectory && this.hasDirectoryPermission) {
                    try {
                        const count = await this.syncImagesFromLocalDirectory();
                        if (count > 0 && typeof app !== 'undefined' && app.refreshAllImageReferences) {
                            app.refreshAllImageReferences();
                        }
                    } catch (e) {
                        console.warn('[Init] 延迟同步图片失败:', e);
                    }
                }
            }, 1000);
            return !!this.opfsRoot;
        },

        async initIndexedDB() {
            if (!('indexedDB' in window)) return;
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('WikiStorageDB', 1);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('handles')) {
                        db.createObjectStore('handles', { keyPath: 'id' });
                    }
                };
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    resolve();
                };
                request.onerror = () => reject(request.error);
            });
        },

        async restoreDirectoryPermission() {
            const savedDirName = localStorage.getItem('wiki_local_directory');
            if (!savedDirName || !this.db) return false;
            try {
                const transaction = this.db.transaction(['handles'], 'readonly');
                const store = transaction.objectStore('handles');
                const request = store.get('local_directory');
                const handle = await new Promise((resolve, reject) => {
                    request.onsuccess = () => resolve(request.result?.handle);
                    request.onerror = () => reject(request.error);
                });
                if (handle) {
                    const permission = await handle.queryPermission({ mode: 'readwrite' });
                    if (permission === 'granted') {
                        this.localDirectory = handle;
                        this.hasDirectoryPermission = true;
                        await this.setupLocalImagesDir();
                        console.log('[Storage] 成功恢复目录权限:', savedDirName);
                        return 'granted';
                    } else if (permission === 'prompt') {
                        // 【优化】不立即 requestPermission（非用户触发会失败），记录状态供UI使用
                        this._pendingDirectoryHandle = handle;
                        this._pendingDirectoryName = savedDirName;
                        console.log('[Storage] 目录权限待请求:', savedDirName);
                        return 'prompt';
                    }
                }
                console.log('[Storage] 目录权限已丢失，需要重新绑定');
                this.hasDirectoryPermission = false;
                return false;
            } catch (e) {
                console.warn('[Storage] 恢复权限失败:', e);
                return false;
            }
        },

        async saveDirectoryHandle(handle) {
            if (!this.db) return;
            const transaction = this.db.transaction(['handles'], 'readwrite');
            const store = transaction.objectStore('handles');
            await new Promise((resolve, reject) => {
                const req = store.put({ id: 'local_directory', handle, name: handle.name, timestamp: Date.now() });
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        },

        async autoRestoreImages() {
            console.log('[Storage] 开始自动恢复图片...');
            let count = 0;
            if (this.localDirectory && this.hasDirectoryPermission) {
                count += await this.syncImagesFromLocalDirectory();
            }
            if (this.opfsRoot) {
                count += await this.syncFromOPFS();
            }
            const missing = this.checkMissingFiles();
            if (missing.length > 0) {
                setTimeout(() => {
                    if (typeof app !== 'undefined' && app.showMissingImagesNotification) {
                        app.showMissingImagesNotification(missing);
                    }
                }, 2000);
            }
            console.log(`[Storage] 自动恢复完成，共 ${count} 张图片`);
            if (count > 0 && typeof app !== 'undefined' && app.refreshAllImageReferences) {
                await app.refreshAllImageReferences();
            }
            return count;
        },

        checkMissingFiles() {
            const missing = [];
            for (const [filename] of Object.entries(this.manifest.mappings || {})) {
                if (!this.memoryCache.has(filename)) missing.push(filename);
            }
            return missing;
        },

        generateManifest() {
            const manifest = {
                version: '2.5.0',
                lastUpdate: Date.now(),
                mappings: {},
                appName: 'NovelWiki',
                exportTime: Date.now()
            };
            this.memoryCache.forEach((dataUrl, filename) => {
                const parts = filename.split('_');
                if (filename.startsWith('synopsis_') && parts.length >= 2) {
                    manifest.mappings[filename] = { type: 'synopsis', chapterId: parts[1], role: parts[2] || 'cover' };
                } else if (parts.length >= 3) {
                    manifest.mappings[filename] = {
                        type: 'entry',
                        entryId: parts[0],
                        versionId: parts[1],
                        imageType: parts[2].replace(/\.(jpg|png)$/, '')
                    };
                }
            });
            return manifest;
        },

        async saveManifest() {
            this.manifest = this.generateManifest();
            const json = JSON.stringify(this.manifest, null, 2);
            if (this.opfsRoot) {
                try {
                    const fileHandle = await this.opfsRoot.getFileHandle('wiki-manifest.json', { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(json);
                    await writable.close();
                } catch (e) {}
            }
            if (this.localDirectory && this.hasDirectoryPermission) {
                try {
                    const fileHandle = await this.localDirectory.getFileHandle('wiki-manifest.json', { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(json);
                    await writable.close();
                } catch (e) {}
            }
        },

        async loadManifest() {
            let data = null;
            if (this.localDirectory && this.hasDirectoryPermission) {
                try {
                    const handle = await this.localDirectory.getFileHandle('wiki-manifest.json');
                    const file = await handle.getFile();
                    data = JSON.parse(await file.text());
                } catch (e) {}
            }
            if (!data && this.opfsRoot) {
                try {
                    const handle = await this.opfsRoot.getFileHandle('wiki-manifest.json');
                    const file = await handle.getFile();
                    data = JSON.parse(await file.text());
                } catch (e) {}
            }
            if (data) this.manifest = data;
        },

        async saveImage(filename, dataUrl, options = {}) {
            const { entryId, versionId, type, chapterId } = options;
            // 【优化】使用LRU缓存
            this.setCachedImage(filename, dataUrl);
            // 【关键】保存原始 data URL，供 saveData 导出 imageCache 使用（OPFS加载后会变成blob URL）
            if (!this._originalDataUrls) this._originalDataUrls = {};
            this._originalDataUrls[filename] = dataUrl;
            if (filename.startsWith('synopsis_')) {
                this.manifest.mappings[filename] = { type: 'synopsis', chapterId: chapterId || filename.split('_')[1], timestamp: Date.now() };
            } else {
                this.manifest.mappings[filename] = { type: 'entry', entryId, versionId, imageType: type, timestamp: Date.now() };
            }
            if (this.opfsRoot) {
                try {
                    const blob = this.dataUrlToBlob(dataUrl);
                    const fileHandle = await this.opfsRoot.getFileHandle(filename, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (e) { console.error('[Storage] OPFS写入失败:', e); }
            }
            if (this.localImagesDir && this.hasDirectoryPermission) {
                try {
                    const blob = this.dataUrlToBlob(dataUrl);
                    const fileHandle = await this.localImagesDir.getFileHandle(filename, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (e) {
                    console.warn('[Storage] 本地文件夹写入失败:', e);
                    this.hasDirectoryPermission = false;
                }
            }
            this.debouncedSaveManifest();
            return filename;
        },

        debouncedSaveManifest: (function() {
            let timeout;
            return async function() {
                clearTimeout(timeout);
                timeout = setTimeout(async () => {
                    if (this.saveManifest) await this.saveManifest();
                }, 2000);
            };
        })(),

        // 【优化】使用LRU缓存的图片加载，按需读取不常驻内存
        async loadImage(filename) {
            // 检查内存缓存（带LRU更新）
            const cached = this.getCachedImage(filename);
            if (cached) return cached;

            // 检查存储空间，如不足则先清理
            await this.checkStorageAndEvictIfNeeded();

            // 优先从本地文件夹读取
            if (this.localImagesDir && this.hasDirectoryPermission) {
                try {
                    const handle = await this.localImagesDir.getFileHandle(filename);
                    const file = await handle.getFile();
                    if (file.size > 1 * 1024 * 1024) {
                        const blobUrl = URL.createObjectURL(file);
                        this.setCachedImage(filename, blobUrl);
                        return blobUrl;
                    } else {
                        const dataUrl = await this.fileToDataUrl(file);
                        this.setCachedImage(filename, dataUrl);
                        return dataUrl;
                    }
                } catch (e) {}
            }

            // 从 OPFS 读取
            if (this.opfsRoot) {
                try {
                    const handle = await this.opfsRoot.getFileHandle(filename);
                    const file = await handle.getFile();
                    const blobUrl = URL.createObjectURL(file);
                    this.setCachedImage(filename, blobUrl);
                    return blobUrl;
                } catch (e) {}
            }

            // 【关键修复】OPFS/本地文件夹都失败时，尝试从 localStorage 分片缓存加载
            try {
                const chunkCount = localStorage.getItem('novelWiki_img_count');
                if (chunkCount) {
                    for (let i = 0; i < parseInt(chunkCount); i++) {
                        const chunkStr = localStorage.getItem(`novelWiki_img_${i}`);
                        if (chunkStr) {
                            const chunk = JSON.parse(chunkStr);
                            if (chunk[filename]) {
                                this.setCachedImage(filename, chunk[filename]);
                                return chunk[filename];
                            }
                        }
                    }
                }
                // 回退：尝试旧格式缓存
                const oldCache = localStorage.getItem('novelWiki_imageCache_v1');
                if (oldCache) {
                    const cache = JSON.parse(oldCache);
                    if (cache[filename]) {
                        this.setCachedImage(filename, cache[filename]);
                        return cache[filename];
                    }
                }
            } catch (e) {}

            // 【关键修复】模糊匹配：对 synopsis 图片，如果精确文件名找不到，从 manifest 按 chapterId 匹配
            // 这修复了 saveData 生成错误文件名（synopsis_${id}_image.jpg）导致的数据损坏
            try {
                const parts = filename.split('_');
                if (parts[0] === 'synopsis' && parts.length >= 2) {
                    const chapterId = parts[1];
                    for (const [fname, meta] of Object.entries(this.manifest.mappings || {})) {
                        if (meta.type === 'synopsis' && meta.chapterId === chapterId) {
                            // 找到匹配的 synopsis 图片，从 OPFS 加载
                            if (this.opfsRoot) {
                                try {
                                    const handle = await this.opfsRoot.getFileHandle(fname);
                                    const file = await handle.getFile();
                                    const blobUrl = URL.createObjectURL(file);
                                    this.setCachedImage(filename, blobUrl); // 用原文件名缓存，避免重复查找
                                    console.log(`[LoadImage] 模糊匹配成功: ${filename} → ${fname}`);
                                    return blobUrl;
                                } catch (e) {}
                            }
                            if (this.localImagesDir && this.hasDirectoryPermission) {
                                try {
                                    const handle = await this.localImagesDir.getFileHandle(fname);
                                    const file = await handle.getFile();
                                    const blobUrl = URL.createObjectURL(file);
                                    this.setCachedImage(filename, blobUrl);
                                    console.log(`[LoadImage] 模糊匹配成功: ${filename} → ${fname}`);
                                    return blobUrl;
                                } catch (e) {}
                            }
                            break; // 只匹配第一个
                        }
                    }
                }
            } catch (e) {}

            console.warn(`[LoadImage] 无法加载图片: ${filename}`);
            return null;
        },

        async syncImagesFromLocalDirectory() {
            if (!this.localImagesDir) {
                console.warn('[Sync] 本地文件夹未初始化');
                return 0;
            }
            
            // 如果权限标记为false，尝试恢复
            if (!this.hasDirectoryPermission && this.localDirectory) {
                try {
                    const perm = await this.localDirectory.requestPermission({ mode: 'readwrite' });
                    this.hasDirectoryPermission = (perm === 'granted');
                    if (!this.hasDirectoryPermission) {
                        console.warn('[Sync] 无法获得文件夹权限');
                        return 0;
                    }
                } catch (e) {
                    console.warn('[Sync] 请求权限失败:', e);
                    return 0;
                }
            }
            
            // 【优化】不再全量加载到内存，改为按需加载模式
            // 只验证文件存在性并更新manifest，内存中只保留少量最近使用的
            let fileCount = 0;
            const files = [];
            try {
                console.log('[Sync] 开始扫描本地文件夹...');
                for await (const [name, handle] of this.localImagesDir.entries()) {
                    if (handle.kind === 'file' && (name.endsWith('.jpg') || name.endsWith('.png'))) {
                        files.push(name);
                        fileCount++;
                    }
                }
                
                // 更新manifest中缺失的映射
                for (const name of files) {
                    if (!this.manifest.mappings[name]) {
                        // 尝试从文件名推断映射
                        const parts = name.split('_');
                        if (name.startsWith('synopsis_') && parts.length >= 2) {
                            this.manifest.mappings[name] = { type: 'synopsis', chapterId: parts[1] };
                        } else if (parts.length >= 3) {
                            this.manifest.mappings[name] = { type: 'entry', entryId: parts[0], versionId: parts[1], imageType: parts[2].replace(/\\.(jpg|png)$/, '') };
                        }
                    }
                }
                
                // 【优化】只预加载前10张到内存（LRU会自动管理）
                const preloadCount = Math.min(10, files.length);
                let loadedCount = 0;
                for (let i = 0; i < preloadCount; i++) {
                    const name = files[i];
                    if (this.memoryCache.has(name)) continue;
                    try {
                        const handle = await this.localImagesDir.getFileHandle(name);
                        const file = await handle.getFile();
                        if (file.size > 1 * 1024 * 1024) {
                            const blobUrl = URL.createObjectURL(file);
                            this.setCachedImage(name, blobUrl);
                        } else {
                            const dataUrl = await this.fileToDataUrl(file);
                            this.setCachedImage(name, dataUrl);
                        }
                        loadedCount++;
                    } catch (e) {}
                }
                
                console.log(`[Sync] 本地文件夹扫描完成: ${fileCount} 个文件, 预加载 ${loadedCount} 张到内存`);
            } catch (e) {
                console.error('[Sync] 扫描本地文件夹失败:', e);
                this.hasDirectoryPermission = false;
            }
            return fileCount;
        },

        // 【优化】OPFS同步改为按需模式：只更新manifest，不全部加载到内存
        async syncFromOPFS() {
            if (!this.opfsRoot) return 0;
            let fileCount = 0;
            try {
                for await (const [name, handle] of this.opfsRoot.entries()) {
                    if (handle.kind === 'file' && (name.endsWith('.jpg') || name.endsWith('.png'))) {
                        fileCount++;
                        // 只更新manifest映射，不加载到内存
                        if (!this.manifest.mappings[name]) {
                            const parts = name.split('_');
                            if (name.startsWith('synopsis_') && parts.length >= 2) {
                                this.manifest.mappings[name] = { type: 'synopsis', chapterId: parts[1] };
                            } else if (parts.length >= 3) {
                                this.manifest.mappings[name] = { type: 'entry', entryId: parts[0], versionId: parts[1], imageType: parts[2].replace(/\\.(jpg|png)$/, '') };
                            }
                        }
                    }
                }
                // 【优化】只预加载前5张到内存
                let loadedCount = 0;
                for await (const [name, handle] of this.opfsRoot.entries()) {
                    if (loadedCount >= 5) break;
                    if (handle.kind === 'file' && (name.endsWith('.jpg') || name.endsWith('.png'))) {
                        if (this.memoryCache.has(name)) continue;
                        try {
                            const file = await handle.getFile();
                            const blobUrl = URL.createObjectURL(file);
                            this.setCachedImage(name, blobUrl);
                            loadedCount++;
                        } catch (e) {}
                    }
                }
                console.log(`[Sync] OPFS扫描完成: ${fileCount} 个文件, 预加载 ${loadedCount} 张到内存`);
            } catch (e) {}
            return fileCount;
        },


        // ========== LRU 缓存管理（按需加载/卸载图片） ==========

        // 【优化】带LRU追踪的缓存读取
        getCachedImage(filename) {
            if (this.memoryCache.has(filename)) {
                // 更新访问顺序（移到末尾表示最近使用）
                this._updateAccessOrder(filename);
                return this.memoryCache.get(filename);
            }
            return null;
        },

        // 【优化】带LRU追踪的缓存写入
        setCachedImage(filename, dataUrl) {
            // 如果缓存已满且这是新条目，先淘汰最旧的
            if (!this.memoryCache.has(filename) && this.memoryCache.size >= this.MAX_MEMORY_CACHE_SIZE) {
                this._evictLRU();
            }
            this.memoryCache.set(filename, dataUrl);
            this._updateAccessOrder(filename);
        },

        // 【优化】更新访问顺序
        _updateAccessOrder(filename) {
            const idx = this._accessOrder.indexOf(filename);
            if (idx >= 0) {
                this._accessOrder.splice(idx, 1);
            }
            this._accessOrder.push(filename);
        },

        // 【优化】淘汰最久未使用的图片
        _evictLRU() {
            if (this._accessOrder.length === 0) return;
            const oldest = this._accessOrder.shift();
            if (oldest && this.memoryCache.has(oldest)) {
                const dataUrl = this.memoryCache.get(oldest);
                // 如果是 blob URL，需要释放
                if (dataUrl && dataUrl.startsWith('blob:')) {
                    try { URL.revokeObjectURL(dataUrl); } catch(e) {}
                }
                this.memoryCache.delete(oldest);
                console.log(`[LRU] 淘汰内存缓存: ${oldest}, 当前缓存: ${this.memoryCache.size}`);
            }
        },

        // 【优化】按需加载图片（优先本地文件夹，其次OPFS，都不在则返回null）
        async loadImageOnDemand(filename) {
            // 1. 检查内存缓存
            const cached = this.getCachedImage(filename);
            if (cached) return cached;

            // 2. 优先从本地文件夹读取（不缓存到内存，直接返回）
            if (this.localImagesDir && this.hasDirectoryPermission) {
                try {
                    const handle = await this.localImagesDir.getFileHandle(filename);
                    const file = await handle.getFile();
                    // 对于大文件使用 blob URL，小文件使用 dataUrl
                    if (file.size > 1 * 1024 * 1024) {
                        const blobUrl = URL.createObjectURL(file);
                        this.setCachedImage(filename, blobUrl);
                        return blobUrl;
                    } else {
                        const dataUrl = await this.fileToDataUrl(file);
                        this.setCachedImage(filename, dataUrl);
                        return dataUrl;
                    }
                } catch (e) {
                    // 本地文件夹没有，继续尝试OPFS
                }
            }

            // 3. 从 OPFS 读取
            if (this.opfsRoot) {
                try {
                    const handle = await this.opfsRoot.getFileHandle(filename);
                    const file = await handle.getFile();
                    const blobUrl = URL.createObjectURL(file);
                    this.setCachedImage(filename, blobUrl);
                    return blobUrl;
                } catch (e) {
                    // OPFS也没有
                }
            }

            return null;
        },

        // 【优化】释放指定图片的内存缓存
        evictImage(filename) {
            if (this.memoryCache.has(filename)) {
                const dataUrl = this.memoryCache.get(filename);
                if (dataUrl && dataUrl.startsWith('blob:')) {
                    try { URL.revokeObjectURL(dataUrl); } catch(e) {}
                }
                this.memoryCache.delete(filename);
                const idx = this._accessOrder.indexOf(filename);
                if (idx >= 0) this._accessOrder.splice(idx, 1);
            }
        },

        // 【优化】清理所有图片缓存（保留manifest映射）
        evictAllImages() {
            this.memoryCache.forEach((dataUrl, filename) => {
                if (dataUrl && dataUrl.startsWith('blob:')) {
                    try { URL.revokeObjectURL(dataUrl); } catch(e) {}
                }
            });
            this.memoryCache.clear();
            this._accessOrder = [];
            console.log('[LRU] 已清理所有内存图片缓存');
        },

        // 【优化】检查存储空间，如果不足则清理缓存
        async checkStorageAndEvictIfNeeded() {
            if ('storage' in navigator && 'estimate' in navigator.storage) {
                try {
                    const estimate = await navigator.storage.estimate();
                    const usage = estimate.usage || 0;
                    const quota = estimate.quota || Infinity;
                    const percentUsed = quota > 0 ? (usage / quota) : 0;

                    // 如果使用超过 80%，清理一半缓存
                    if (percentUsed > 0.8) {
                        console.warn(`[Storage] 存储使用 ${(percentUsed*100).toFixed(1)}%，清理图片缓存...`);
                        const toEvict = Math.floor(this._accessOrder.length / 2);
                        for (let i = 0; i < toEvict; i++) {
                            this._evictLRU();
                        }
                        return true; // 表示已清理
                    }
                } catch (e) {
                    // 无法获取存储估算，忽略
                }
            }
            return false;
        },
        
        // 【优化】紧急释放OPFS空间：当存储满时，删除OPFS中的图片文件（保留data.json和manifest）
        async emergencyFreeOPFSSpace() {
            if (!this.opfsRoot) return;
            let freed = 0;
            try {
                const entries = [];
                for await (const [name, handle] of this.opfsRoot.entries()) {
                    if (handle.kind === 'file' && (name.endsWith('.jpg') || name.endsWith('.png'))) {
                        entries.push(name);
                    }
                }
                
                // 删除所有图片文件（原始文件仍在本地文件夹中，可重新加载）
                for (const name of entries) {
                    try {
                        await this.opfsRoot.removeEntry(name);
                        freed++;
                    } catch (e) {}
                }
                
                // 同时清理内存缓存
                this.evictAllImages();
                
                console.log(`[Emergency] 已从OPFS删除 ${freed} 个图片文件以释放空间`);
            } catch (e) {
                console.error('[Emergency] 释放OPFS空间失败:', e);
            }
        },

        async createZipPackage(dataJson, aboutInfo) {
            const zip = new JSZip();
            zip.file('data.json', JSON.stringify(dataJson, null, 2));
            if (aboutInfo) {
                zip.file('about.json', JSON.stringify(aboutInfo, null, 2));
            }
            zip.file('wiki-manifest.json', JSON.stringify(this.manifest, null, 2));
            const imgFolder = zip.folder('wiki-images');
            const added = new Set();
            
            // 【关键修复】1. 从dataJson中提取所有被引用的图片文件名
            const referencedFiles = new Set();
            if (dataJson.entries) {
                dataJson.entries.forEach(entry => {
                    if (!entry.versions) return;
                    entry.versions.forEach(v => {
                        if (v.images) {
                            Object.values(v.images).forEach(imgRef => {
                                if (imgRef && imgRef.startsWith('{{IMG:')) {
                                    const match = imgRef.match(/\{\{IMG:(.+?)\}\}/);
                                    if (match) referencedFiles.add(match[1]);
                                } else if (imgRef && (imgRef.startsWith('data:') || imgRef.startsWith('blob:'))) {
                                    // 处理直接存储的dataUrl（旧数据兼容）
                                    const ext = imgRef.includes('image/png') ? 'png' : 'jpg';
                                    const filename = `${entry.id}_${v.vid}_avatar.${ext}`;
                                    // 将dataUrl临时存回内存以便后续处理
                                    if (!this.memoryCache.has(filename)) {
                                        this.setCachedImage(filename, imgRef);
                                    }
                                    referencedFiles.add(filename);
                                }
                            });
                        }
                    });
                });
            }
            
            // 【关键修复】2. 从剧情梗概提取图片引用
            if (dataJson.synopsis) {
                dataJson.synopsis.forEach(ch => {
                    if (ch.image && ch.image.startsWith('{{IMG:')) {
                        const match = ch.image.match(/\{\{IMG:(.+?)\}\}/);
                        if (match) referencedFiles.add(match[1]);
                    }
                });
            }
            
            console.log(`[Export] 发现 ${referencedFiles.size} 个被引用的图片文件`);
            
            // 【关键修复】3. 优先使用本地文件夹，OPFS作为后备
            const allFiles = new Set([
                ...referencedFiles,
                ...this.memoryCache.keys()
            ]);
            
            // 扫描本地文件夹（即使hasDirectoryPermission标记为false也尝试读取，因为可能实际还有权限）
            if (this.localImagesDir) {
                try {
                    // 尝试静默请求权限（如果已过期）
                    if (!this.hasDirectoryPermission) {
                        try {
                            const perm = await this.localDirectory.requestPermission({ mode: 'readwrite' });
                            this.hasDirectoryPermission = (perm === 'granted');
                            console.log('[Export] 尝试恢复权限:', perm);
                        } catch (e) {
                            console.warn('[Export] 无法恢复权限:', e);
                        }
                    }
                    
                    for await (const [name, handle] of this.localImagesDir.entries()) {
                        if (name.endsWith('.jpg') || name.endsWith('.png')) {
                            allFiles.add(name);
                        }
                    }
                    console.log('[Export] 扫描本地文件夹完成');
                } catch (e) {
                    console.error('[Export] 扫描本地文件夹失败:', e);
                }
            }
            
            // 扫描OPFS（即使失效也尝试）
            if (this.opfsRoot) {
                try {
                    for await (const [name, handle] of this.opfsRoot.entries()) {
                        if (name.endsWith('.jpg') || name.endsWith('.png')) {
                            allFiles.add(name);
                        }
                    }
                } catch (e) {}
            }
            
            // 【关键修复】4. 增强的文件读取逻辑
            let successCount = 0;
            let failCount = 0;
            
            for (const filename of allFiles) {
                if (added.has(filename)) continue;
                let buffer = null;
                let source = '';
                
                // 策略1：从内存缓存（dataUrl转换为ArrayBuffer）
                if (!buffer && this.memoryCache.has(filename)) {
                    try {
                        const dataUrl = this.memoryCache.get(filename);
                        if (dataUrl.startsWith('data:')) {
                            buffer = this.dataUrlToArrayBuffer(dataUrl);
                            source = 'memory';
                        } else if (dataUrl.startsWith('blob:')) {
                            // blob URL需要fetch转换
                            const response = await fetch(dataUrl);
                            buffer = await response.arrayBuffer();
                            source = 'blob';
                        }
                    } catch (e) {
                        console.warn(`[Export] 内存缓存转换失败 ${filename}:`, e);
                    }
                }
                
                // 策略2：直接从本地文件夹读取（最高优先级，因为OPFS失效）
                if (!buffer && this.localImagesDir) {
                    try {
                        const handle = await this.localImagesDir.getFileHandle(filename);
                        const file = await handle.getFile();
                        buffer = await file.arrayBuffer();
                        source = 'local';
                    } catch (e) {
                        // 文件不存在或权限错误
                    }
                }
                
                // 策略3：从OPFS读取（后备）
                if (!buffer && this.opfsRoot) {
                    try {
                        const handle = await this.opfsRoot.getFileHandle(filename);
                        const file = await handle.getFile();
                        buffer = await file.arrayBuffer();
                        source = 'opfs';
                    } catch (e) {}
                }
                
                if (buffer) {
                    imgFolder.file(filename, buffer);
                    added.add(filename);
                    successCount++;
                    console.log(`[Export] 成功添加 ${filename} (来源: ${source})`);
                } else {
                    failCount++;
                    console.warn(`[Export] 无法找到文件: ${filename}`);
                }
            }
            
            console.log(`[Export] 打包完成: ${successCount} 成功, ${failCount} 失败`);
            
            // 如果有文件缺失，抛出警告但继续生成ZIP
            if (failCount > 0 && referencedFiles.size > 0) {
                console.warn(`[Export] 警告: ${failCount} 个文件缺失，这些图片可能在导入后无法显示`);
            }
            
            return zip;
        },

        async importZipPackage(zipFile) {
            const zip = await JSZip.loadAsync(zipFile);
            const dataFile = zip.file('data.json');
            if (!dataFile) throw new Error('无效的Wiki数据包：缺少data.json');
            const dataJson = JSON.parse(await dataFile.async('string'));
            // 【新增】读取 about.json
            let aboutInfo = null;
            const aboutFile = zip.file('about.json');
            if (aboutFile) {
                try {
                    aboutInfo = JSON.parse(await aboutFile.async('string'));
                    console.log('[Import] 成功读取 about.json');
                } catch (e) {
                    console.warn('[Import] about.json 解析失败:', e);
                }
            }

            const manifestFile = zip.file('wiki-manifest.json');
            if (manifestFile) {
                try {
                    const pkgManifest = JSON.parse(await manifestFile.async('string'));
                    Object.assign(this.manifest.mappings, pkgManifest.mappings || {});
                } catch (e) {}
            }
            const imageFiles = Object.keys(zip.files).filter(n => n.startsWith('wiki-images/') && (n.endsWith('.jpg') || n.endsWith('.png')));
            for (const imgPath of imageFiles) {
                const filename = imgPath.replace('wiki-images/', '');
                const arrayBuffer = await zip.file(imgPath).async('arraybuffer');
                const ext = filename.endsWith('.png') ? 'png' : 'jpeg';
                const blob = new Blob([arrayBuffer], { type: `image/${ext}` });
                const dataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.readAsDataURL(blob);
                });
                this.setCachedImage(filename, dataUrl);
                if (this.opfsRoot) {
                    try {
                        const handle = await this.opfsRoot.getFileHandle(filename, { create: true });
                        const writable = await handle.createWritable();
                        await writable.write(arrayBuffer);
                        await writable.close();
                    } catch (e) {}
                }
                if (this.localImagesDir && this.hasDirectoryPermission) {
                    try {
                        const handle = await this.localImagesDir.getFileHandle(filename, { create: true });
                        const writable = await handle.createWritable();
                        await writable.write(arrayBuffer);
                        await writable.close();
                    } catch (e) {}
                }
                if (!this.manifest.mappings[filename]) {
                    const found = this.findEntryByImageRef(dataJson, filename);
                    if (found) this.manifest.mappings[filename] = found;
                }
            }
            await this.saveManifest();
            return { data: dataJson, aboutInfo };
        },

        findEntryByImageRef(dataJson, filename) {
            if (!dataJson.entries) return null;
            for (const entry of dataJson.entries) {
                for (const v of entry.versions || []) {
                    if (!v.images) continue;
                    for (const [type, ref] of Object.entries(v.images)) {
                        if (ref && ref.includes(filename)) {
                            return { type: 'entry', entryId: entry.id, versionId: v.vid, imageType: type };
                        }
                    }
                }
            }
            if (dataJson.synopsis) {
                for (const s of dataJson.synopsis) {
                    if (s.image && s.image.includes(filename)) {
                        return { type: 'synopsis', chapterId: s.id };
                    }
                }
            }
            return null;
        },

        async requestLocalDirectory() {
            if (!('showDirectoryPicker' in window)) {
                alert('您的浏览器不支持直接访问本地文件夹（仅Chrome/Edge支持）\n系统将使用浏览器内部存储（OPFS）。');
                return false;
            }
            try {
                const dirHandle = await window.showDirectoryPicker();
                await this.saveDirectoryHandle(dirHandle);
                this.localDirectory = dirHandle;
                this.hasDirectoryPermission = true;
                localStorage.setItem('wiki_local_directory', dirHandle.name);
                await this.setupLocalImagesDir();
                const files = await this.getLocalFolderFileList();
                if (files.length === 0) {
                    await this.syncOPFSToLocalFolder();
                } else {
                    await this.syncImagesFromLocalDirectory();
                    await this.loadManifestFromDirectory();
                }
                await this.saveManifest();
                alert(`已连接工作目录: ${dirHandle.name}/wiki-images/\n共同步 ${this.memoryCache.size} 张图片。`);
                if (typeof app !== 'undefined' && app.updateLocalDirectoryStatus) app.updateLocalDirectoryStatus();
                if (typeof app !== 'undefined' && app.refreshAllImageReferences) await app.refreshAllImageReferences();
                return true;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error('选择目录失败:', e);
                    alert('无法访问目录: ' + e.message);
                }
                return false;
            }
        },

        async setupLocalImagesDir() {
            if (!this.localDirectory) return;
            this.localImagesDir = await this.localDirectory.getDirectoryHandle('wiki-images', { create: true });
        },

        async getLocalFolderFileList() {
            if (!this.localImagesDir) return [];
            const files = [];
            try {
                for await (const [name, handle] of this.localImagesDir.entries()) {
                    if (handle.kind === 'file') files.push(name);
                }
            } catch (e) {}
            return files;
        },

        async syncOPFSToLocalFolder() {
            if (!this.opfsRoot || !this.localImagesDir) return;
            let count = 0;
            for await (const [name, handle] of this.opfsRoot.entries()) {
                if (handle.kind === 'file' && (name.endsWith('.jpg') || name.endsWith('.png'))) {
                    try {
                        const file = await handle.getFile();
                        const buffer = await file.arrayBuffer();
                        const fileHandle = await this.localImagesDir.getFileHandle(name, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(buffer);
                        await writable.close();
                        count++;
                    } catch (e) {}
                }
            }
            console.log(`[Storage] 已同步 ${count} 张图片到新文件夹`);
        },

        async loadManifestFromDirectory() {
            if (!this.localDirectory) return;
            try {
                const handle = await this.localDirectory.getFileHandle('wiki-manifest.json');
                const file = await handle.getFile();
                const content = await file.text();
                const data = JSON.parse(content);
                if (data.manifest) await this.syncImagesFromLocalDirectory(data.manifest);
            } catch (e) {}
        },

        fileToDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        },

        dataUrlToBlob(dataUrl) {
            const arr = dataUrl.split(',');
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) u8arr[n] = bstr.charCodeAt(n);
            return new Blob([u8arr], { type: mime });
        },

        dataUrlToArrayBuffer(dataUrl) {
            const base64 = dataUrl.split(',')[1];
            const binary = atob(base64);
            const len = binary.length;
            const buffer = new Uint8Array(len);
            for (let i = 0; i < len; i++) buffer[i] = binary.charCodeAt(i);
            return buffer.buffer;
        },
        // ========== Layer 2+3+4+5+6: 角色状态检测、置顶与并行管理 ==========

        /**
         * 【Layer 5 辅助】判断角色是否处于失踪区间
         */
        async isInMissingInterval(entry) {
            const status = await this.getCharacterDisplayStatus(entry);
            return status === 'missing';
        },

        checkHasParallelVersions(entry) {
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
        },

        getParallelIntervals(entry) {
            if (!entry || !entry.versions || entry.versions.length < 2) return [];
            
            const intervals = [];
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            
            let currentInterval = null;
            
            for (const chapter of sortedChapters) {
                const activeVersions = this.getActiveVersionsInChapter(entry, chapter.id);
                
                if (activeVersions.length >= 2) {
                    if (!currentInterval) {
                        currentInterval = {
                            startChapterId: chapter.id,
                            endChapterId: chapter.id,
                            chapters: [chapter],
                            versions: activeVersions
                        };
                    } else {
                        currentInterval.endChapterId = chapter.id;
                        currentInterval.chapters.push(chapter);
                        activeVersions.forEach(v => {
                            if (!currentInterval.versions.find(ev => ev.vid === v.vid)) {
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
        },

        getActiveVersionsInChapter(entry, chapterId) {
            if (!entry || !entry.versions) return [];
            
            const chapter = this.data.chapters.find(c => c.id === chapterId);
            if (!chapter) return [];
            
            return entry.versions.filter(v => {
                const fromOrder = this.getChapterOrder(v.chapterFrom);
                const toOrder = this.getChapterOrder(v.chapterTo);
                return chapter.order >= fromOrder && chapter.order <= toOrder;
            });
        },

        getMissingIntervals(entry) {
            if (!entry || !entry.versions || entry.versions.length === 0) return [];
            
            const intervals = [];
            const sortedVersions = [...entry.versions].sort((a, b) => {
                return this.getChapterOrder(a.chapterFrom) - this.getChapterOrder(b.chapterFrom);
            });
            
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            
            for (let i = 0; i < sortedVersions.length - 1; i++) {
                const currentVersion = sortedVersions[i];
                const nextVersion = sortedVersions[i + 1];
                
                const currentEndOrder = this.getChapterOrder(currentVersion.chapterTo);
                const nextStartOrder = this.getChapterOrder(nextVersion.chapterFrom);
                
                if (nextStartOrder > currentEndOrder + 1) {
                    const startCh = sortedChapters.find(c => c.order === currentEndOrder + 1);
                    const endCh = sortedChapters.find(c => c.order === nextStartOrder - 1);
                    
                    if (startCh && endCh) {
                        intervals.push({
                            startChapterId: startCh.id,
                            endChapterId: endCh.id,
                            lastVersionBefore: currentVersion,
                            nextVersionAfter: nextVersion
                        });
                    }
                }
            }
            
            const latestVersion = sortedVersions[sortedVersions.length - 1];
            if (latestVersion.chapterTo) {
                const lastOrder = this.getChapterOrder(latestVersion.chapterTo);
                const lastCh = sortedChapters.find(c => c.order === lastOrder);
                if (lastCh && this.data.currentTimeline !== 'latest') {
                    const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
                    if (currentCh && currentCh.order > lastOrder) {
                        intervals.push({
                            startChapterId: lastCh.id,
                            endChapterId: null,
                            lastVersionBefore: latestVersion,
                            nextVersionAfter: null
                        });
                    }
                }
            }
            
            return intervals;
        },

        renderSettingsGrouped(container) {
            return this.renderSettingsGroupedFallback(container);
        },
        /**
         * 【Layer 5 辅助】识别所有并行区间（用于并行详细设置）
         */
        async identifyParallelIntervals(entry) {
            if (!entry.versions || entry.versions.length < 2) return [];
            
            const intervals = [];
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            
            // 遍历每个章节，检测是否有多个活跃版本
            for (let i = 0; i < sortedChapters.length; i++) {
                const ch = sortedChapters[i];
                const activeVersions = entry.versions.filter(v => {
                    const fromCh = v.chapterFrom ? this.data.chapters.find(c => c.id === v.chapterFrom) : null;
                    const toCh = v.chapterTo ? this.data.chapters.find(c => c.id === v.chapterTo) : null;
                    const fromOrder = fromCh ? fromCh.order : -1;
                    const toOrder = toCh ? toCh.order : Infinity;
                    return ch.order >= fromOrder && ch.order <= toOrder;
                });
                
                if (activeVersions.length >= 2) {
                    // 找到并行区间的结束点
                    let endIndex = i;
                    for (let j = i + 1; j < sortedChapters.length; j++) {
                        const nextCh = sortedChapters[j];
                        const nextActive = entry.versions.filter(v => {
                            const fromCh = v.chapterFrom ? this.data.chapters.find(c => c.id === v.chapterFrom) : null;
                            const toCh = v.chapterTo ? this.data.chapters.find(c => c.id === v.chapterTo) : null;
                            const fromOrder = fromCh ? fromCh.order : -1;
                            const toOrder = toCh ? toCh.order : Infinity;
                            return nextCh.order >= fromOrder && nextCh.order <= toOrder;
                        });
                        
                        if (nextActive.length < 2) break;
                        endIndex = j;
                    }
                    
                    intervals.push({
                        startChapterId: ch.id,
                        endChapterId: sortedChapters[endIndex].id,
                        startOrder: ch.order,
                        endOrder: sortedChapters[endIndex].order,
                        chapters: sortedChapters.slice(i, endIndex + 1).map(c => c.id),
                        versions: activeVersions
                    });
                    
                    i = endIndex; // 跳过已处理的章节
                }
            }
            
            return intervals;
        },

        /**
         * 【Layer 5 辅助】识别失踪区间
         */
        async identifyMissingIntervals(entry) {
            if (!entry.versions || entry.versions.length === 0) return [];
            
            const intervals = [];
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            const sortedVersions = entry.versions
                .map(v => ({
                    version: v,
                    fromOrder: v.chapterFrom ? (this.data.chapters.find(c => c.id === v.chapterFrom)?.order || -1) : -1,
                    toOrder: v.chapterTo ? (this.data.chapters.find(c => c.id === v.chapterTo)?.order || Infinity) : Infinity
                }))
                .sort((a, b) => a.fromOrder - b.fromOrder);
            
            // 检查版本之间的间隙
            for (let i = 0; i < sortedVersions.length - 1; i++) {
                const currentEnd = sortedVersions[i].toOrder;
                const nextStart = sortedVersions[i + 1].fromOrder;
                
                if (currentEnd < nextStart) {
                    // 找到失踪区间
                    const startCh = sortedChapters.find(c => c.order === currentEnd) || 
                                sortedChapters.filter(c => c.order > currentEnd)[0];
                    const endCh = sortedChapters.find(c => c.order === nextStart) || 
                                [...sortedChapters].reverse().find(c => c.order < nextStart);
                    
                    if (startCh && endCh && startCh.order < endCh.order) {
                        intervals.push({
                            startChapterId: startCh.id,
                            endChapterId: endCh.id,
                            startOrder: startCh.order,
                            endOrder: endCh.order,
                            latestVersionBefore: sortedVersions[i].version,
                            nextVersionAfter: sortedVersions[i + 1].version
                        });
                    }
                }
            }
            
            // 检查最后一个版本之后（如果是有限结束时间）
            const lastVersion = sortedVersions[sortedVersions.length - 1];
            if (lastVersion.toOrder !== Infinity && lastVersion.toOrder < sortedChapters[sortedChapters.length - 1].order) {
                const startCh = sortedChapters.find(c => c.order === lastVersion.toOrder) ||
                            sortedChapters.filter(c => c.order > lastVersion.toOrder)[0];
                const endCh = sortedChapters[sortedChapters.length - 1];
                
                if (startCh && endCh) {
                    intervals.push({
                        startChapterId: startCh.id,
                        endChapterId: endCh.id,
                        startOrder: startCh.order,
                        endOrder: endCh.order,
                        latestVersionBefore: lastVersion.version,
                        nextVersionAfter: null
                    });
                }
            }
            
            return intervals;
        },
        async getStorageStats() {
            let opfsSize = 0, opfsCount = 0;
            if (this.opfsRoot) {
                try {
                    for await (const [name, handle] of this.opfsRoot.entries()) {
                        if (handle.kind === 'file') {
                            const file = await handle.getFile();
                            opfsSize += file.size;
                            opfsCount++;
                        }
                    }
                } catch (e) {}
            }
            return {
                memory: this.memoryCache.size,
                opfsFiles: opfsCount,
                opfsSize: (opfsSize / 1024 / 1024).toFixed(2) + ' MB',
                manifestFiles: Object.keys(this.manifest.mappings).length,
                hasLocalDirectory: !!this.localDirectory,
                hasPermission: this.hasDirectoryPermission
            };
        }
    },

    // ========== 数据存储结构 ==========
    data: {
        settings: { 
            name: '我的小说 Wiki', 
            subtitle: '',
            welcomeTitle: '欢迎来到 Wiki',
            welcomeSubtitle: '探索角色、世界观与错综复杂的关系网。',
            customFont: null,
            homeCustomTitle: '首页自定义内容'
        },
        entries: [],
        camps: [],
        chapters: [],
        homeContent: [],
        announcements: [],
        history: [],
        synopsis: [],
        currentMode: 'view',
        currentView: 'home',
        editingId: null,
        editingVersionId: null,
        viewingVersionId: null,
        currentTimeline: 'latest',
        codeCounters: { C: 0, N: 0, E: 0 },
        recycledCodes: { C: [], N: [], E: [] },  // 【新增】编号回收池（含活动E前缀）
        graphState: { scale: 1, translateX: 0, translateY: 0 },
        synopsisViewIndex: 0,
        lastSaveTime: 0,
        pendingBackup: null,
        about: null,
        previousEntryId: null,
        previousEntryName: null,
        previousEntryType: null,
        previousEntryChapter: null,
        previousVersionId: null
    },

    tempEntry: null,
    tempVersion: null,
    storageAvailable: false,
    autoBackupTimeout: null,
    editingType: null,
    _initialized: false,
    _keyboardListenersInitialized: false,  // 新增：防止键盘监听重复绑定
    _keydownHandler: null,                  // 新增：存储键盘处理器引用以便移除

    // ========== 系统初始化（修复版） ==========
    init: async function() {
        if (this._initialized) return;
        this._initialized = true;
        
        try {
            this.checkStorage();
            await this.storageManager.init();
            
            // 【桌面模式】无存档时引导新建/导入
            if (this.storageManager && this.storageManager.mode === 'desktop' && !this.storageManager.currentSave) {
                this._desktopNoSave = true;
                setTimeout(() => {
                    if (typeof this.showWelcome === 'function') this.showWelcome();
                    if (typeof this.showQuickSetup === 'function') this.showQuickSetup();
                }, 300);
            }

            // 【桌面模式】等待存档数据从文件加载完成后再渲染（否则首页/活动横幅/列表为空，需手动切换才出现）
            if (this.storageManager && this.storageManager.mode === 'desktop') {
                await this.loadDataFromDesktop();
            } else {
                this.loadData();
            }
            this.applySettings();
            setTimeout(() => {
                this.restoreAllImagesFromStorage().then(count => {
                    if (count > 0 && this.refreshAllImageReferences) {
                        this.refreshAllImageReferences();
                    }
                }).catch(e => console.error('[Init] 延迟恢复图片失败:', e));
            }, 300); // 300ms 延迟，让页面先渲染
            await this.restoreAllImagesFromStorage();
            
            if (typeof this.initTimelineSelector === 'function') {
                this.initTimelineSelector();
            } else {
                setTimeout(() => {
                    if (typeof app !== 'undefined' && typeof app.initTimelineSelector === 'function') {
                        app.initTimelineSelector();
                    }
                }, 500);
            }
            
            this.router('home');
            this.updateUI();
            this.applyFont();
            
            // 关键修复：只初始化一次键盘监听，使用标志位防止重复
            if (typeof this.initKeyboardListeners === 'function' && !this._keyboardListenersInitialized) {
                this.initKeyboardListeners();
                this._keyboardListenersInitialized = true;
            }
            
            // 【回到xx】监听浏览器返回按钮，确保回到列表页时清空记录
            window.addEventListener('popstate', (e) => {
                const state = e.state;
                if (state && state.view && ['home', 'characters', 'non-characters'].includes(state.view)) {
                    this._clearPreviousEntry();
                }
            });
            
            setInterval(() => {
                if (this.storageManager) this.storageManager.saveManifest();
            }, 30000);
            
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && this.storageManager) {
                    this.storageManager.syncImagesFromLocalDirectory().then(count => {
                        if (count > 0 && this.refreshAllImageReferences) {
                            this.refreshAllImageReferences();
                            this.showSaveToast(`检测到 ${count} 张外部更新图片`);
                        }
                    });
                }
            });

            // 【全局润色】输入时连续三个半角句点自动转为三点省略号
            // 使用 beforeinput 统一处理 INPUT、TEXTAREA 和 contenteditable
            document.addEventListener('beforeinput', (e) => {
                if (e.inputType !== 'insertText' || e.data !== '.') return;
                const target = e.target;
                if (!target) return;
                const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
                const isContentEditable = target.isContentEditable;
                if (!isTextInput && !isContentEditable) return;

                // 检查光标前是否已有两个 .
                let textBeforeCursor = '';
                if (isTextInput) {
                    const cursorPos = target.selectionStart || 0;
                    textBeforeCursor = target.value.substring(cursorPos - 2, cursorPos);
                } else {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        const node = range.startContainer;
                        if (node && node.nodeType === Node.TEXT_NODE) {
                            textBeforeCursor = node.textContent.substring(range.startOffset - 2, range.startOffset);
                        }
                    }
                }

                if (textBeforeCursor === '..') {
                    e.preventDefault();
                    if (isTextInput) {
                        const cursorPos = target.selectionStart || 0;
                        const newValue = target.value.substring(0, cursorPos - 2) + '…' + target.value.substring(cursorPos);
                        target.value = newValue;
                        target.selectionStart = target.selectionEnd = cursorPos - 1;
                    } else {
                        // contenteditable：删除前面两个 . 插入省略号
                        const sel = window.getSelection();
                        const range = sel.getRangeAt(0);
                        range.setStart(range.startContainer, range.startOffset - 2);
                        range.deleteContents();
                        const textNode = document.createTextNode('…');
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }
            });

            // 【新增】首次访问检测：显示欢迎窗口
            setTimeout(() => this._checkAndShowWelcome(), 500);

            console.log('[App] 初始化完成');
        } catch (error) {
            console.error('[App] 初始化失败:', error);
        }
    },

    // 【新增】欢迎窗口系统
    _welcomeShown: false,
    _checkAndShowWelcome: function() {
        if (this._welcomeShown) return;
        // 检测是否首次访问：无存档且无本地文件夹绑定
        const hasEntries = this.data.entries && this.data.entries.length > 0;
        const hasFolder = this.storageManager && this.storageManager._directoryHandle;
        const isFirstVisit = !hasEntries && !hasFolder;
        // 也检测 localStorage 中的标志
        let welcomeFlag = false;
        try { welcomeFlag = localStorage.getItem('novelWiki_welcomeShown') === '1'; } catch(e) {}
        if (isFirstVisit || !welcomeFlag) {
            this.showWelcome();
        }
    },
    showWelcome: function() {
        this._welcomeShown = true;
        const modal = document.getElementById('welcome-modal');
        const customEl = document.getElementById('welcome-custom-content');
        const quickSetupBtn = document.getElementById('welcome-quick-setup-btn');
        if (!modal) return;
        // 显示自定义内容
        if (customEl && this.data.settings) {
            let customHtml = '';
            if (this.data.settings.name) {
                customHtml += '<p class="font-medium text-gray-900 mb-1">本Wiki名称：' + this.escapeHtml(this.data.settings.name) + '</p>';
            }
            if (this.data.settings.globalNotice) {
                customHtml += '<p class="text-gray-600 mb-2">' + this.escapeHtml(this.data.settings.globalNotice) + '</p>';
            }
            if (this.data.settings.welcomeContent) {
                customHtml += '<div class="mt-2 pt-2 border-t border-gray-200">' + this.escapeHtml(this.data.settings.welcomeContent).replace(/\n/g, '<br>') + '</div>';
            }
            if (customHtml) {
                customEl.innerHTML = customHtml;
                customEl.classList.remove('hidden');
            }
        }
        // 快速设置按钮：仅桌面模式且无存档时显示（引导新建存档）
        if (quickSetupBtn && this.storageManager && this.storageManager.mode === 'desktop') {
            if (!this.storageManager.currentSave) quickSetupBtn.classList.remove('hidden');
        }
        modal.classList.remove('hidden');
    },
    closeWelcome: function() {
        const modal = document.getElementById('welcome-modal');
        if (modal) modal.classList.add('hidden');
        try { localStorage.setItem('novelWiki_welcomeShown', '1'); } catch(e) {}
    },
    showQuickSetup: function() {
        const welcomePage = document.getElementById('welcome-page');
        const setupPage = document.getElementById('quick-setup-page');
        if (welcomePage) welcomePage.classList.add('hidden');
        if (setupPage) setupPage.classList.remove('hidden');
    },
    closeWelcomeAndGoCharacter: function() {
        this.closeWelcome();
        this.router('characters');
        this.showEditForm('character');
    },
    // 【新增】快速设置完成回调
    onQuickSetupComplete: function() {
        const setupPage = document.getElementById('quick-setup-page');
        const donePage = document.getElementById('setup-done-page');
        if (setupPage) setupPage.classList.add('hidden');
        if (donePage) donePage.classList.remove('hidden');
    },
    // 【新增】快速设置：桌面模式新建存档；浏览器模式提示使用桌面版
    selectWikiFolder: async function() {
        if (!this.storageManager) { this.showToast('存储管理器未初始化', 'error'); return; }
        if (this.storageManager.mode === 'desktop') {
            if (typeof this.createNewSaveDialog === 'function') {
                const ok = await this.createNewSaveDialog();
                if (ok && typeof this.onQuickSetupComplete === 'function') {
                    this.onQuickSetupComplete();
                } else {
                    // 用户取消：关闭欢迎窗口，不再阻塞
                    this.closeWelcome();
                }
            }
            return;
        }
        // 浏览器演示模式：不支持多存档
        this.showToast('浏览器演示模式不支持存档管理，请使用桌面版（打包 exe 后）', 'warning', 4000);
        this._showManualCloseOption();
    },
    // 【新增】显示手动关闭按钮（当自动检测失败时）
    _showManualCloseOption: function() {
        const setupPage = document.getElementById('quick-setup-page');
        if (!setupPage) return;
        // 检查是否已有手动关闭按钮
        if (setupPage.querySelector('#manual-close-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'manual-close-btn';
        btn.className = 'w-full py-3 mt-3 border border-indigo-300 text-indigo-700 rounded-xl hover:bg-indigo-50 transition font-medium';
        btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>我已绑定文件夹';
        btn.onclick = () => { this.onQuickSetupComplete(); };
        const container = setupPage.querySelector('div');
        if (container) container.appendChild(btn);
    },

    // ========== 时间轴系统 ==========
    initTimelineSelector: function() {
        try {
            const selector = document.getElementById('timeline-selector');
            if (!selector) {
                setTimeout(() => {
                    if (typeof app !== 'undefined' && app.initTimelineSelector) {
                        app.initTimelineSelector();
                    }
                }, 300);
                return;
            }

            const currentValue = this.data.currentTimeline || 'latest';
            selector.innerHTML = '';

            const latestOpt = document.createElement('option');
            latestOpt.value = 'latest';
            latestOpt.textContent = '最新进度 (全部内容)';
            latestOpt.selected = (currentValue === 'latest');
            selector.appendChild(latestOpt);

            if (!this.data.chapters || this.data.chapters.length === 0) {
                selector.innerHTML += '<option disabled>暂无章节，请在章节管理中创建</option>';
                return;
            }

            const sortedChapters = [...this.data.chapters].sort((a, b) => (a.order || 0) - (b.order || 0));

            sortedChapters.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = `${this.formatChapterNum(ch.num)} ${ch.title || ''}`.trim();
                opt.selected = (ch.id === currentValue);
                selector.appendChild(opt);
            });

            selector.value = currentValue;
        } catch (error) {
            console.error('[Timeline] 初始化失败:', error);
        }
    },

    setTimeline: function(chapterId) {
        if (!chapterId) return;
        this.data.currentTimeline = chapterId;
        
        const selector = document.getElementById('timeline-selector');
        if (selector) selector.value = chapterId;
        
        const currentView = this.data.currentView;
        if (currentView === 'detail' && this.data.editingId) {
            const entry = this.data.entries.find(e => e.id === this.data.editingId);
            if (entry) {
                const visibleVersion = this.getVisibleVersion(entry);
                if (visibleVersion) this.data.viewingVersionId = visibleVersion.vid;
                this.router('detail', false);
            }
        } else if (['characters', 'non-characters', 'home', 'synopsis', 'graph'].includes(currentView)) {
            this.router(currentView, false);
        }
        
        this.showTimelineSwitchToast(chapterId);
        this.saveData();
    },

    showTimelineSwitchToast: function(chapterId) {
        const toast = document.getElementById('timeline-switch-toast');
        const toastText = document.getElementById('timeline-switch-text');
        if (toast && toastText) {
            let displayText = '最新进度';
            if (chapterId !== 'latest') {
                const chapter = this.data.chapters.find(c => c.id === chapterId);
                displayText = chapter ? `${this.formatChapterNum(chapter.num)} ${chapter.title || ''}`.trim() : '未知时间点';
            }
            toastText.textContent = `时间轴已切换: ${displayText}`;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }
    },

    formatChapterNum: function(num) {
        if (num === null || num === undefined) return '序章';
        if (num === 0 || num === '0') return '序章';
        if (typeof num === 'number' || !isNaN(parseFloat(num))) {
            const n = parseInt(num);
            if (n <= 0) return '序章';
            const chineseNums = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
            if (n <= 10) return `第${chineseNums[n]}章`;
            return `第${n}章`;
        }
        return String(num);
    },

    getVersionTimeStatus: function(entry, version) {
        if (!version || this.data.currentTimeline === 'latest') return 'current';
        const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
        if (!currentCh) return 'current';
        const fromCh = version.chapterFrom ? this.data.chapters.find(c => c.id === version.chapterFrom) : null;
        const toCh = version.chapterTo ? this.data.chapters.find(c => c.id === version.chapterTo) : null;
        const fromOrder = fromCh ? fromCh.order : -1;
        const toOrder = toCh ? toCh.order : Infinity;
        if (currentCh.order >= fromOrder && currentCh.order <= toOrder) return 'current';
        if (currentCh.order > toOrder) return 'past';
        return 'future';
    },

    getVisibleVersion: function(entry) {
        if (!entry || !entry.versions || entry.versions.length === 0) return null;
        
        // 【Layer 5 关键修复】检查当前时间点是否有指定的置顶版本（并行版本管理）
        // pinnedVersions 的键是区间起始章节ID，需要遍历查找当前章节所在的区间
        if (this.data.currentTimeline !== 'latest' && entry.pinnedVersions) {
            const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
            if (currentCh) {
                // 遍历所有设置了置顶的区间起始章节，找到当前章节所在的区间
                for (const [startChId, vid] of Object.entries(entry.pinnedVersions)) {
                    const startCh = this.data.chapters.find(c => c.id === startChId);
                    if (!startCh) continue;
                    // 找到该区间的结束点（下一个有置顶设置的区间起始，或章节末尾）
                    let endOrder = Infinity;
                    for (const otherStartId of Object.keys(entry.pinnedVersions)) {
                        if (otherStartId === startChId) continue;
                        const otherCh = this.data.chapters.find(c => c.id === otherStartId);
                        if (otherCh && otherCh.order > startCh.order && otherCh.order < endOrder) {
                            endOrder = otherCh.order;
                        }
                    }
                    // 当前章节是否在此区间内
                    if (currentCh.order >= startCh.order && currentCh.order < endOrder) {
                        const pinnedVersion = entry.versions.find(v => v.vid === vid);
                        if (pinnedVersion) return pinnedVersion;
                    }
                }
            }
        }
        
        if (this.data.currentTimeline === 'latest') {
            // 【修复】"全部内容"模式下也检查默认置顶版本
            if (entry.defaultPinnedVersion) {
                const pinned = entry.versions.find(v => v.vid === entry.defaultPinnedVersion);
                if (pinned) return pinned;
            }
            return entry.versions[entry.versions.length - 1];
        }
        const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
        if (!currentCh) return entry.versions[0];
        for (let i = entry.versions.length - 1; i >= 0; i--) {
            const v = entry.versions[i];
            const fromCh = v.chapterFrom ? this.data.chapters.find(c => c.id === v.chapterFrom) : null;
            const toCh = v.chapterTo ? this.data.chapters.find(c => c.id === v.chapterTo) : null;
            const fromOrder = fromCh ? fromCh.order : -1;
            const toOrder = toCh ? toCh.order : Infinity;
            if (currentCh.order >= fromOrder && currentCh.order <= toOrder) return v;
        }
        return entry.versions[0];
    },

    // ========== 路由系统 ==========
    router: function(view, pushState) {
        if (pushState === undefined) pushState = true;
        
        // 【关键修复】离开首页时停止活动窗口自动轮播，避免内存泄漏
        if (view !== 'home' && this._stopHomeBannerAutoPlay) {
            this._stopHomeBannerAutoPlay();
        }
        
        this.data.currentView = view;
        if(pushState) history.pushState({view: view}, '', '#' + view);

        const container = document.getElementById('main-container');
        if (!container) return;
        container.innerHTML = '';

        // 【准应用】非词条视图 → 显示主容器、隐藏标签容器（标签栏在有词条标签时保留）
        if (view !== 'detail' && view !== 'edit' && this.tabsSystem) {
            const tabContainer = document.getElementById('tab-container');
            const tabBarWrapper = document.getElementById('tab-bar-wrapper');
            if (tabContainer) { tabContainer.classList.add('hidden'); tabContainer.style.display = 'none'; }
            if (tabBarWrapper && this.tabsSystem.list.length === 0) tabBarWrapper.classList.add('hidden');
            container.classList.remove('hidden');
            // 有词条标签时，标签栏高亮切回"首页"标签（例如从词条内跳转到剧情梗概等主视图）
            if (this.tabsSystem.list.length > 0) {
                this.tabsSystem.activeTabId = 'home';
                this.tabsSystem.renderTabBar();
            }
        }

        // 【功能4】离开详情页时清除隐藏词条黑底白字状态
        if (view !== 'detail') {
            this.data._currentHiddenEntryId = null;
            container.classList.remove('hidden-entry-detail');
        }

        // 【回到xx】回到首页/列表页时清空记录
        if (['home', 'characters', 'non-characters'].includes(view)) {
            this._clearPreviousEntry();
        }

        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.target === view;
            btn.classList.toggle('text-indigo-600', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
        });

        const timelineBar = document.getElementById('timeline-bar');
        if (timelineBar) {
            const shouldShow = (this.data.currentMode === 'view' && 
                ['home', 'characters', 'non-characters', 'events', 'detail', 'synopsis'].includes(view)) ||
                (this.data.currentMode === 'edit' && ['edit', 'synopsis-edit'].includes(view));
            timelineBar.classList.toggle('hidden', !shouldShow);
        }

        try {
            switch(view) {
                case 'home': this.renderHome(container); break;
                case 'characters': this.renderList(container, 'character'); break;
                case 'non-characters': this.renderList(container, 'non-character'); break;
                case 'events': this.renderEvents(container); break;
                case 'graph': this.renderGraph(container); break;
                case 'settings': this.renderSettings(container); break;
                case 'timeline-settings': this.renderTimelineSettings(container); break;
                case 'detail': {
                    // 准应用模式：词条详情走标签页
                    if (this.tabsSystem && typeof this.tabsSystem.ensureEntryTab === 'function') {
                        this.tabsSystem.ensureEntryTab(this.data.editingId, this.data.viewingVersionId, false);
                    } else {
                        this.renderDetail(container);
                    }
                    break;
                }
                case 'edit': {
                    // 准应用模式：词条编辑走标签页
                    if (this.tabsSystem && typeof this.tabsSystem.ensureEntryTab === 'function') {
                        this.tabsSystem.ensureEntryTab(this.data.editingId, this.data.editingVersionId || this.data.viewingVersionId, true);
                    } else {
                        this.renderEdit(container);
                    }
                    break;
                }
                case 'announcement-edit': this.renderAnnouncementEdit(container); break;
                case 'synopsis': this.renderSynopsisView(container); break;
                case 'synopsis-edit': this.renderSynopsisEdit(container); break;
                case 'about': this.renderAbout(container); break;
                default: this.renderHome(container);
            }
        } catch (error) {
            console.error(`[Router] 渲染视图 ${view} 失败:`, error);
            container.innerHTML = '<div class="p-4 text-red-600">加载失败，请刷新重试</div>';
        }
        
        this.updateUI();
    },

    setMode: function(mode) {
        this.data.currentMode = mode;
        // 【优化】在设置页点右上角进入"查看"模式时，自动回到首页而非停留在设置页
        if (mode === 'view') {
            const view = this.data.currentView;
            if (view === 'settings' || view === 'timeline-settings') {
                this.router('home');
                return;
            }
        }
        this.router(this.data.currentView);
    },

    updateUI: function() {
        const isEdit = this.data.currentMode === 'edit';
        const viewBtn = document.getElementById('btn-mode-view');
        const editBtn = document.getElementById('btn-mode-edit');
        const settingsNav = document.getElementById('nav-settings');
        
        if (viewBtn) {
            viewBtn.className = isEdit ? 
                'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all' : 
                'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all';
        }
        if (editBtn) {
            editBtn.className = isEdit ? 
                'px-3 py-1.5 rounded-md bg-white shadow-sm text-gray-800 transition-all' : 
                'px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800 transition-all';
        }
        if (settingsNav) settingsNav.classList.toggle('hidden', !isEdit);

        setTimeout(() => {
            document.querySelectorAll('.edit-only').forEach(el => {
                el.classList.toggle('hidden', !isEdit);
            });
        }, 50);
    },

    // ========== 设置应用 ==========
    applySettings: function() {
        if (!this.data.settings) this.data.settings = {};
        const defaults = {
            name: '未命名 Wiki',
            subtitle: '',
            welcomeTitle: '欢迎来到 Wiki',
            welcomeSubtitle: '探索角色、世界观与错综复杂的关系网。',
            customFont: null,
            homeCustomTitle: '首页自定义内容'
        };
        for (let key in defaults) {
            if (this.data.settings[key] === undefined || this.data.settings[key] === null) {
                this.data.settings[key] = defaults[key];
            }
        }
        const titleEl = document.getElementById('wiki-title-display');
        const subEl = document.getElementById('wiki-subtitle-display');
        if (titleEl) titleEl.textContent = this.data.settings.name;
        if (subEl) {
            subEl.textContent = this.data.settings.subtitle;
            subEl.classList.toggle('hidden', !this.data.settings.subtitle);
        }
        // 添加角色引用样式
        if (!document.getElementById('synopsis-ref-styles')) {
            var style = document.createElement('style');
            style.id = 'synopsis-ref-styles';
            style.textContent = 
                '.synopsis-entry-ref {' +
                'display: inline-flex;' +
                'align-items: center;' +
                'gap: 4px;' +
                'padding: 2px 6px;' +
                'background-color: #e0e7ff;' +
                'color: #4338ca;' +
                'border-radius: 4px;' +
                'font-size: 0.875rem;' +
                'cursor: pointer;' +
                'margin: 0 2px;' +
                '}' +
                '.synopsis-entry-ref:hover {' +
                'background-color: #c7d2fe;' +
                '}' +
                '.synopsis-entry-ref i {' +
                'font-size: 0.75rem;' +
                '}';
            document.head.appendChild(style);
        }
        // 【新增】设定卡片紧凑布局样式
        if (!document.getElementById('setting-card-styles')) {
            const style = document.createElement('style');
            style.id = 'setting-card-styles';
            style.textContent = `
                /* 无图设定卡片：减少padding，更紧凑 */
                .setting-card-compact {
                    padding: 0.75rem;
                    min-height: 80px;
                }
                .setting-card-compact .aspect-\\[3\\/2\\] {
                    display: none;
                }
                /* Grid 布局优化：无图卡片尝试并排 */
                @media (min-width: 640px) {
                    .setting-card-compact + .setting-card-compact {
                        grid-column: span 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    },

    // ========== 数据持久化 ==========
    saveData: async function() {
        try {
            // 桌面模式：直接写存档文件夹内的 data.json / wiki-images/（文件系统存储）
            const isDesktop = this.storageManager && this.storageManager.mode === 'desktop';
            // 【关键】备份当前数据，防止保存失败后数据丢失
            const entriesBackup = JSON.parse(JSON.stringify(this.data.entries));
            const settingsBackup = JSON.parse(JSON.stringify(this.data.settings));

            // 【修复】第一步：预清理所有base64图片（从entries副本中），将其存入独立缓存
            const imageCache = {}; // { filename: base64Data }
            const exportEntries = this.data.entries.map(entry => {
                const newEntry = Object.assign({}, entry);
                newEntry.versions = entry.versions.map(v => {
                    const cleanVersion = Object.assign({}, v);
                    // 清理version.images中的所有base64
                    if (v.images) {
                        cleanVersion.images = {};
                        Object.keys(v.images).forEach(key => {
                            const val = v.images[key];
                            if (val && val.startsWith('data:image')) {
                                const ext = val.includes('image/png') ? 'png' : 'jpg';
                                const filename = entry.id + '_' + v.vid + '_' + key + '.' + ext;
                                cleanVersion.images[key] = '{{IMG:' + filename + '}}';
                                imageCache[filename] = val; // 存入独立缓存
                            } else if (val && val.startsWith('{{IMG:')) {
                                cleanVersion.images[key] = val;
                            } else if (val && val.startsWith('blob:') && this.storageManager && this.storageManager._blobToFile && this.storageManager._blobToFile.has(val)) {
                                // blob URL（预览残留）：通过反向映射还原为 {{IMG:}} 引用，防止保存后图片丢失
                                cleanVersion.images[key] = '{{IMG:' + this.storageManager._blobToFile.get(val) + '}}';
                            } else {
                                cleanVersion.images[key] = null;
                            }
                        });
                    }
                    // 清理version.image（旧格式）
                    if (cleanVersion.image && cleanVersion.image.startsWith('data:image')) {
                        const ext = cleanVersion.image.includes('image/png') ? 'png' : 'jpg';
                        const filename = entry.id + '_' + v.vid + '_legacy.' + ext;
                        imageCache[filename] = cleanVersion.image;
                        cleanVersion.image = '{{IMG:' + filename + '}}';
                    }
                    // 【关键修复】清理活动页词条图片元件中的base64图片（使用固定文件名）
                    if (cleanVersion.blocks) {
                        cleanVersion.blocks.forEach((b, bIdx) => {
                            if (b.type === 'img' && b.src) {
                                if (b.src.startsWith('data:image')) {
                                    // dataUrl → {{IMG:}} + imageCache（固定文件名）
                                    const ext = b.src.includes('image/png') ? 'png' : 'jpg';
                                    const filename = `${entry.id}_${v.vid}_block_${bIdx}.${ext}`;
                                    imageCache[filename] = b.src;
                                    b.src = '{{IMG:' + filename + '}}';
                                } else if (b.src.startsWith('{{IMG:')) {
                                    // 已是{{IMG:}}引用，尝试恢复base64到imageCache
                                    const match = b.src.match(/\{\{IMG:(.+?)\}\}/);
                                    if (match) {
                                        const filename = match[1];
                                        let dataUrl = null;
                                        if (this.storageManager && this.storageManager.memoryCache.has(filename)) {
                                            dataUrl = this.storageManager.memoryCache.get(filename);
                                        } else if (this._originalDataUrls && this._originalDataUrls[filename]) {
                                            dataUrl = this._originalDataUrls[filename];
                                        }
                                        if (dataUrl && dataUrl.startsWith('data:')) {
                                            imageCache[filename] = dataUrl;
                                        }
                                    }
                                } else if (b.src.startsWith('blob:') && this.storageManager && this.storageManager._blobToFile && this.storageManager._blobToFile.has(b.src)) {
                                    // blob URL（预览残留）：还原为 {{IMG:}} 引用
                                    b.src = '{{IMG:' + this.storageManager._blobToFile.get(b.src) + '}}';
                                }
                            }
                        });
                    }
                    return cleanVersion;
                });
                // 【关键修复】清理活动页词条头图
                if (entry.type === 'event' && entry.headerImage) {
                    if (entry.headerImage.startsWith('data:image')) {
                        // dataUrl → {{IMG:}} + imageCache
                        const ext = entry.headerImage.includes('image/png') ? 'png' : 'jpg';
                        const vid = (entry.versions[0] && entry.versions[0].vid) || 'v0';
                        const filename = `${entry.id}_${vid}_header.${ext}`;
                        imageCache[filename] = entry.headerImage;
                        newEntry.headerImage = '{{IMG:' + filename + '}}';
                    } else if (entry.headerImage.startsWith('{{IMG:')) {
                        // 已是{{IMG:}}引用，尝试从storageManager恢复base64到imageCache
                        const match = entry.headerImage.match(/\{\{IMG:(.+?)\}\}/);
                        if (match) {
                            const filename = match[1];
                            // 尝试从各个来源恢复
                            let dataUrl = null;
                            if (this.storageManager && this.storageManager.memoryCache.has(filename)) {
                                dataUrl = this.storageManager.memoryCache.get(filename);
                            } else if (this._originalDataUrls && this._originalDataUrls[filename]) {
                                dataUrl = this._originalDataUrls[filename];
                            }
                            if (dataUrl && dataUrl.startsWith('data:')) {
                                imageCache[filename] = dataUrl;
                            }
                        }
                    } else if (entry.headerImage.startsWith('blob:') && this.storageManager && this.storageManager._blobToFile && this.storageManager._blobToFile.has(entry.headerImage)) {
                        // blob URL（预览残留）：还原为 {{IMG:}} 引用
                        newEntry.headerImage = '{{IMG:' + this.storageManager._blobToFile.get(entry.headerImage) + '}}';
                    }
                }
                return newEntry;
            });

            // 【统一修复】剧情梗概图片：统一转为 {{IMG:filename}} 引用
            // 所有图片使用统一格式：synopsis_${chapterId}_cover.${ext}
            const exportSynopsis = this.data.synopsis.map(chapter => {
                const cleanChapter = Object.assign({}, chapter);
                if (cleanChapter.image) {
                    if (cleanChapter.image.startsWith('data:image')) {
                        const ext = cleanChapter.image.includes('image/png') ? 'png' : 'jpg';
                        const filename = 'synopsis_' + chapter.id + '_cover.' + ext;
                        imageCache[filename] = cleanChapter.image;
                        cleanChapter.image = '{{IMG:' + filename + '}}';
                        cleanChapter.imageFilename = filename;
                    } else if (cleanChapter.image.startsWith('{{IMG:')) {
                        const match = cleanChapter.image.match(/\{\{IMG:(.+?)\}\}/);
                        if (match) {
                            const filename = match[1];
                            let dataUrl = null;
                            if (this.storageManager && this.storageManager.memoryCache.has(filename)) {
                                dataUrl = this.storageManager.memoryCache.get(filename);
                            } else if (this._originalDataUrls && this._originalDataUrls[filename]) {
                                dataUrl = this._originalDataUrls[filename];
                            }
                            if (dataUrl && dataUrl.startsWith('data:')) {
                                imageCache[filename] = dataUrl;
                            }
                            cleanChapter.imageFilename = filename;
                        }
                    } else if (cleanChapter.image.startsWith('blob:') && this.storageManager && this.storageManager._blobToFile && this.storageManager._blobToFile.has(cleanChapter.image)) {
                        // blob URL（预览残留）：还原为 {{IMG:}} 引用
                        cleanChapter.image = '{{IMG:' + this.storageManager._blobToFile.get(cleanChapter.image) + '}}';
                        cleanChapter.imageFilename = this.storageManager._blobToFile.get(cleanChapter.image);
                    }
                }
                return cleanChapter;
            });

            // 【修复】导出标记图片单独存储
            let markImageBackup = null;
            const exportSettings = JSON.parse(JSON.stringify(this.data.settings));
            if (exportSettings.exportMark && exportSettings.exportMark.image) {
                const img = exportSettings.exportMark.image;
                if (img.startsWith('data:') || img.length > 1000) {
                    markImageBackup = img;
                    if (isDesktop) {
                        // 桌面模式：标记图片写入 wiki-images/export-mark.png，用 {{IMG:}} 引用（GitHub 版亦可显示）
                        exportSettings.exportMark.image = '{{IMG:export-mark.png}}';
                    } else {
                        exportSettings.exportMark.image = '{{MARK_IMG}}';
                    }
                }
            }

            if (isDesktop) {
                // ========== 桌面模式：直接写存档文件夹 ==========
                // 1. 补写 imageCache 中缺失的图片文件（编辑时已即时写入，此处兜底）
                for (const [filename, dataUrl] of Object.entries(imageCache)) {
                    if (dataUrl && dataUrl.startsWith('data:')) {
                        try {
                            if (!this.storageManager.memoryCache.has(filename)) {
                                await this.storageManager.saveImage(filename, dataUrl);
                            }
                        } catch (e) {}
                    }
                }
                if (markImageBackup) {
                    try { await this.storageManager.saveImage('export-mark.png', markImageBackup); } catch (e) {}
                }
                // 2. 写 data.json（{{IMG:}} 引用形式的干净数据）
                const payloadObj = {
                    settings: exportSettings,
                    entries: exportEntries,
                    camps: this.data.camps,
                    chapters: this.data.chapters,
                    homeContent: this.data.homeContent,
                    announcements: this.data.announcements,
                    codeCounters: this.data.codeCounters,
                    synopsis: exportSynopsis,
                    lastSaveTime: Date.now(),
                    version: '2.5.0-local'
                };
                await this.storageManager.saveDataFile(payloadObj);
                this.data.lastSaveTime = Date.now();
                if (this.storageManager) await this.storageManager.saveManifest();
                this.showSaveToast('数据已保存');
                return;
            }

            // 【修复】将图片缓存分片存入独立的localStorage键，避免超出配额（仅浏览器模式）
            // 清理旧格式缓存
            try { localStorage.removeItem('novelWiki_imageCache_v1'); } catch(e) {}
            try {
                // 【关键修复】分片存储时排除 synopsis 图片（data URL 太大，会导致配额溢出）
                // synopsis 图片依赖 OPFS/本地文件夹存储，渲染时通过 loadImage 按需加载
                // _originalDataUrls 保留在内存中，供后续导出 GitHub 版时使用
                // 【统一修复】所有类型的图片统一进入imageCache，不再排除任何类型
                // 角色/设定/正文/活动词条的图片全部使用 ${entryId}_${vid}_${type}.${ext} 格式
                const cacheKeys = Object.keys(imageCache);
                // 先清理可能存在的旧分片
                for (let i = 0; i < 100; i++) {
                    const oldKey = localStorage.getItem(`novelWiki_img_${i}`);
                    if (oldKey !== null) localStorage.removeItem(`novelWiki_img_${i}`);
                    else break;
                }
                // 分片存储：每个分片最多5张图片（减小单key大小）
                const CHUNK_SIZE = 5;
                let chunkIdx = 0;
                for (let i = 0; i < cacheKeys.length; i += CHUNK_SIZE) {
                    const chunk = {};
                    cacheKeys.slice(i, i + CHUNK_SIZE).forEach(key => {
                        chunk[key] = imageCache[key];
                    });
                    try {
                        localStorage.setItem(`novelWiki_img_${chunkIdx}`, JSON.stringify(chunk));
                        chunkIdx++;
                    } catch (e) {
                        console.warn(`[Save] 图片缓存分片 ${chunkIdx} 存储失败（超出配额）:`, e.message);
                        break;
                    }
                }
                // 记录总分片数
                try { localStorage.setItem('novelWiki_img_count', String(chunkIdx)); } catch(e) {}
                if (markImageBackup) {
                    localStorage.setItem('novelWiki_exportMarkImage', markImageBackup);
                }
            } catch (e) {
                console.warn('[Save] 图片缓存存储失败:', e.message);
            }

            const payload = JSON.stringify({
                settings: exportSettings,
                entries: exportEntries,
                camps: this.data.camps,
                chapters: this.data.chapters,
                homeContent: this.data.homeContent,
                announcements: this.data.announcements,
                codeCounters: this.data.codeCounters,
                synopsis: exportSynopsis,
                lastSaveTime: Date.now(),
                version: '2.5.0-local'
            });

            // 【修复】检查payload大小，超过4MB则进一步清理
            const payloadMB = payload.length / (1024 * 1024);
            if (payloadMB > 4) {
                console.warn('[Save] Payload过大:', payloadMB.toFixed(2), 'MB，尝试清理...');
                // 【回溯修复】优先清理非关键图片（词条card/avatar），保留剧情梗概图片
                // 剧情梗概图片是核心数据，不应被清理
                exportEntries.forEach(e => {
                    e.versions.forEach(v => {
                        if (v.images) Object.keys(v.images).forEach(k => v.images[k] = null);
                        v.image = null;
                    });
                });
                // 不清理 exportSynopsis 图片（剧情梗概图片是核心内容）
                const trimmedPayload = JSON.stringify({
                    settings: exportSettings,
                    entries: exportEntries,
                    camps: this.data.camps,
                    chapters: this.data.chapters,
                    homeContent: this.data.homeContent,
                    announcements: this.data.announcements,
                    codeCounters: this.data.codeCounters,
                    synopsis: exportSynopsis,
                    lastSaveTime: Date.now(),
                    version: '2.5.0-local'
                });
                console.warn('[Save] 清理后大小:', (trimmedPayload.length / (1024*1024)).toFixed(2), 'MB');
                if (this.storageAvailable) {
                    localStorage.setItem('novelWikiData_v10', trimmedPayload);
                }
            } else {
                if (this.storageAvailable) {
                    localStorage.setItem('novelWikiData_v10', payload);
                }
            }
            this.data.lastSaveTime = Date.now();
            if (this.storageManager) await this.storageManager.saveManifest();
            this.showSaveToast('数据已保存');
        } catch (e) {
            console.error('保存失败:', e);
            // 【关键修复】恢复备份数据，防止词条消失
            if (e.name === 'QuotaExceededError' || (e.message && e.message.includes('quota'))) {
                console.warn('[Save] 存储配额不足，尝试紧急清理...');
                // 立即清理所有可能的缓存
                ['novelWiki_imageCache_v1', 'novelWiki_backup_v1'].forEach(k => {
                    try { localStorage.removeItem(k); } catch(e) {}
                });
                // 再次尝试保存：只清理词条图片，保留剧情梗概图片
                try {
                    const minimalPayload = JSON.stringify({
                        settings: { name: this.data.settings.name || 'Wiki', subtitle: this.data.settings.subtitle || '' },
                        entries: this.data.entries.map(e => ({...e, versions: e.versions.map(v => {
                            const cv = {...v};
                            if (cv.images) Object.keys(cv.images).forEach(k => cv.images[k] = null);
                            cv.image = null; return cv;
                        })})),
                        camps: this.data.camps,
                        chapters: this.data.chapters,
                        // 【关键修复】保留 synopsis 图片（核心数据不应被清除）
                        synopsis: this.data.synopsis,
                        lastSaveTime: Date.now(),
                        version: '2.5.0-local-emergency'
                    });
                    localStorage.setItem('novelWikiData_v10', minimalPayload);
                    this.showToast('已紧急保存（词条图片已剥离，剧情梗概保留）', 'warning', 5000);
                } catch (e2) {
                    // 仍然溢出：连 synopsis 也不得不清理
                    try {
                        const barePayload = JSON.stringify({
                            settings: { name: this.data.settings.name || 'Wiki', subtitle: this.data.settings.subtitle || '' },
                            entries: this.data.entries.map(e => ({...e, versions: e.versions.map(v => {
                                const cv = {...v};
                                if (cv.images) Object.keys(cv.images).forEach(k => cv.images[k] = null);
                                cv.image = null; return cv;
                            })})),
                            camps: this.data.camps, chapters: this.data.chapters,
                            synopsis: this.data.synopsis.map(s => ({...s, image: null})),
                            lastSaveTime: Date.now(), version: '2.5.0-local-bare'
                        });
                        localStorage.setItem('novelWikiData_v10', barePayload);
                        this.showToast('已紧急保存（所有图片已剥离，请导出ZIP备份）', 'warning', 8000);
                    } catch (e3) {
                        this.showStorageFullWarning();
                    }
                }
                return;
            }
            this.showStorageFullWarning();
        }
    },

    showStorageFullWarning: function() {
        const warning = document.createElement('div');
        warning.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-lg shadow-2xl z-[9999] flex items-center gap-3';
        warning.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation text-xl"></i>
            <div>
                <div class="font-bold">存储空间已满！</div>
                <div class="text-xs opacity-90">建议：导出 ZIP 备份后清理数据</div>
            </div>
            <button onclick="this.parentElement.remove(); app.exportZipBackup()" class="ml-2 px-3 py-1 bg-white text-red-600 rounded text-sm font-bold">
                立即导出
            </button>
        `;
        document.body.appendChild(warning);
        setTimeout(() => warning.remove(), 8000);
    },

    loadData: function() {
        // 桌面模式：异步从当前存档文件夹读取 data.json（见 loadDataFromDesktop）
        if (this.storageManager && this.storageManager.mode === 'desktop') {
            this.loadDataFromDesktop();
            return;
        }
        let saved = null;
        if (this.storageAvailable) {
            saved = localStorage.getItem('novelWikiData_v10') || 
                    localStorage.getItem('novelWikiData_v9') || 
                    localStorage.getItem('novelWikiData_v8') || 
                    localStorage.getItem('novelWikiData_v7');
        }

        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.data = Object.assign({}, this.data, parsed, {
                    entries: parsed.entries || [],
                    settings: Object.assign({}, this.data.settings, parsed.settings || {})
                });
                if (!this.data.codeCounters) this.data.codeCounters = { C: 0, N: 0, E: 0 };
                if (this.data.codeCounters.E === undefined) this.data.codeCounters.E = 0;
                if (!this.data.announcements) this.data.announcements = [];
                if (!this.data.history) this.data.history = [];
                if (!this.data.synopsis) this.data.synopsis = [];
                if (!this.data.settings.homeCustomTitle) this.data.settings.homeCustomTitle = '首页自定义内容';
                // 【修复】恢复导出标记图片（从独立存储中读取）
                if (this.data.settings.exportMark && this.data.settings.exportMark.image === '{{MARK_IMG}}') {
                    try {
                        const savedMarkImg = localStorage.getItem('novelWiki_exportMarkImage');
                        if (savedMarkImg) this.data.settings.exportMark.image = savedMarkImg;
                        else delete this.data.settings.exportMark.image;
                    } catch (e) {}
                }

                // 【修复】从分片缓存恢复词条图片
                try {
                    const imageCache = {};
                    // 尝试读取新格式分片缓存
                    const chunkCount = localStorage.getItem('novelWiki_img_count');
                    if (chunkCount) {
                        for (let i = 0; i < parseInt(chunkCount); i++) {
                            const chunkStr = localStorage.getItem(`novelWiki_img_${i}`);
                            if (chunkStr) {
                                const chunk = JSON.parse(chunkStr);
                                Object.assign(imageCache, chunk);
                            }
                        }
                    } else {
                        // 回退：尝试读取旧格式缓存
                        const oldCache = localStorage.getItem('novelWiki_imageCache_v1');
                        if (oldCache) Object.assign(imageCache, JSON.parse(oldCache));
                    }
                    if (Object.keys(imageCache).length > 0) {
                        // 【🛡️ 图片统一恢复机制 — 保护区域开始】
                    // 所有词条类型（entries + synopsis）的图片统一通过 _restoreImgRefs 恢复
                    // 禁止按词条类型分别处理，禁止添加特殊逻辑分支
                    // 【统一修复】通用函数：在任意对象中递归替换 {{IMG:filename}} 为 base64
                        const _restoreImgRefs = (obj) => {
                            if (typeof obj === 'string' && obj.startsWith('{{IMG:')) {
                                const match = obj.match(/\{\{IMG:(.+?)\}\}/);
                                if (match && imageCache[match[1]]) return imageCache[match[1]];
                                // imageCache缺失时保留{{IMG:}}引用，由storageManager.loadImage异步加载
                                return obj;
                            } else if (Array.isArray(obj)) {
                                obj.forEach((item, i) => { obj[i] = _restoreImgRefs(item); });
                            } else if (obj && typeof obj === 'object') {
                                Object.keys(obj).forEach(key => { obj[key] = _restoreImgRefs(obj[key]); });
                            }
                            return obj;
                        };
                        // 统一恢复所有词条（entries）中的图片引用
                        this.data.entries = _restoreImgRefs(this.data.entries);
                        // 统一恢复剧情梗概中的图片引用
                        this.data.synopsis = _restoreImgRefs(this.data.synopsis);
                        // 【🛡️ 图片统一恢复机制 — 保护区域结束】
                        // 【关键修复】从 imageCache 恢复 _originalDataUrls
                        // 确保 saveData 导出时能将 {{IMG:}} 格式恢复为 data URL
                        if (!this._originalDataUrls) this._originalDataUrls = {};
                        Object.keys(imageCache).forEach(filename => {
                            const url = imageCache[filename];
                            if (url && url.startsWith('data:')) {
                                this._originalDataUrls[filename] = url;
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[Load] 图片缓存恢复失败:', e.message);
                }
            } catch (e) {
                console.error('数据加载失败:', e);
                this.seedData();
            }
        } else {
            this.seedData();
        }
        this.applySettings();
    },

    /** 桌面模式：从当前存档目录读取 data.json（{{IMG:}} 引用保留在数据中，图片按需加载） */
    loadDataFromDesktop: async function() {
        try {
            const data = await this.storageManager.loadDataFile();
            if (data && data.entries) {
                this.data = Object.assign({}, this.data, data, {
                    entries: data.entries || [],
                    settings: Object.assign({}, this.data.settings, data.settings || {})
                });
                if (!this.data.codeCounters) this.data.codeCounters = { C: 0, N: 0, E: 0 };
                if (this.data.codeCounters.E === undefined) this.data.codeCounters.E = 0;
                if (!this.data.announcements) this.data.announcements = [];
                if (!this.data.history) this.data.history = [];
                if (!this.data.synopsis) this.data.synopsis = [];
                if (!this.data.settings.homeCustomTitle) this.data.settings.homeCustomTitle = '首页自定义内容';
                if (!this.data.settings.exportMark) this.data.settings.exportMark = { enabled: false, text: '' };
                console.log('[Load] 桌面存档加载成功，词条数:', this.data.entries.length);

                // 【自愈】修复历史上因 blob 预览残留导致的 images 丢失：
                // 通过 wiki-manifest.json 中 词条id+版本id+图片类型 → 文件名 的映射，
                // 把 images 全空的版本恢复为 {{IMG:文件名}} 引用
                try {
                    const mappings = (this.storageManager && this.storageManager.manifest && this.storageManager.manifest.mappings) || {};
                    const mappingList = Object.entries(mappings).filter(([f, m]) => m && m.type === 'entry' && f && /\.(jpg|jpeg|png)$/i.test(f));
                    let healed = 0;
                    for (const entry of this.data.entries) {
                        for (const v of entry.versions || []) {
                            if (!v.images || typeof v.images !== 'object') continue;
                            const hasAny = v.images.avatar || v.images.card || v.images.cover;
                            if (hasAny) continue;
                            for (const [f, m] of mappingList) {
                                if (m.entryId !== entry.id || m.versionId !== v.vid) continue;
                                const imgType = String(m.imageType || '').replace(/\.(jpg|jpeg|png)$/, '');
                                if (['avatar', 'card', 'cover'].includes(imgType) && !v.images[imgType]) {
                                    v.images[imgType] = '{{IMG:' + f + '}}';
                                    healed++;
                                }
                            }
                        }
                    }
                    if (healed > 0) {
                        console.log('[Load] 自愈恢复图片引用:', healed, '处');
                        // 自愈后写回存档，避免每次启动重复扫描
                        try { await this.saveData(); } catch (e) {}
                    }
                } catch (e) {
                    console.warn('[Load] 图片引用自愈失败:', e);
                }
            } else {
                console.warn('[Load] 存档数据为空或无效，将使用空模板');
                this.data.entries = [];
            }
            // 【桌面模式】预载所有 {{IMG:}} 引用到内存缓存（分批异步，避免阻塞首屏）
            const refs = new Set();
            const scan = (obj) => {
                if (typeof obj === 'string' && obj.startsWith('{{IMG:')) {
                    const m = obj.match(/\{\{IMG:(.+?)\}\}/);
                    if (m) refs.add(m[1]);
                } else if (Array.isArray(obj)) {
                    obj.forEach(scan);
                } else if (obj && typeof obj === 'object') {
                    Object.values(obj).forEach(scan);
                }
            };
            scan(this.data.entries);
            scan(this.data.synopsis);
            if (this.data.settings && this.data.settings.exportMark) scan(this.data.settings.exportMark);
            if (this.data.settings && this.data.settings.theme) scan(this.data.settings.theme);
            const list = Array.from(refs);
            for (let i = 0; i < list.length; i++) {
                const filename = list[i];
                if (!this.storageManager.memoryCache.has(filename)) {
                    try { await this.storageManager.loadImage(filename); } catch (e) {}
                }
                // 每 20 张让出一次主线程
                if (i % 20 === 19) await new Promise(r => setTimeout(r, 0));
            }
            if (list.length > 0) {
                console.log('[Load] 已预载图片引用:', list.length);
                if (typeof this.refreshAllImageReferences === 'function') {
                    setTimeout(() => this.refreshAllImageReferences(), 100);
                }
            }
        } catch (e) {
            console.error('[Load] 桌面数据加载失败:', e);
            this.data.entries = [];
        }
        this.applySettings();
    },

    seedData: function() {
        this.data.camps = ['主角团', '反派组织'];
        this.data.chapters = [
            { id: 'ch-0', num: 0, title: '序章', order: 0 },
            { id: 'ch-1', num: 1, title: '第一章：觉醒', order: 1 },
            { id: 'ch-2', num: 2, title: '第二章：变身', order: 2 }
        ];
        this.data.codeCounters = { C: 0, N: 0, E: 0 };
        this.data.synopsis = [];
        this.data.entries = [];
        this.saveData();
    },

    checkStorage: function() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            this.storageAvailable = true;
        } catch (e) {
            this.storageAvailable = false;
        }
    },

    showSaveToast: function(msg) {
        if (!msg) msg = '已保存';
        const toast = document.getElementById('save-toast');
        if (toast) {
            const span = toast.querySelector('span');
            if (span) span.textContent = msg;
            toast.classList.remove('opacity-0');
            setTimeout(() => toast.classList.add('opacity-0'), 2000);
        }
    },

    // ========== 图片恢复 ==========
    restoreAllImagesFromStorage: async function() {
        if (!this.storageManager) return 0;
        // 【桌面模式】数据中保留 {{IMG:}} 引用，图片按需加载（resolveImageUrlAsync），避免全量载入内存
        if (this.storageManager.mode === 'desktop') {
            return 0;
        }
        let restoredCount = 0;
        for (const entry of this.data.entries) {
            if (!entry.versions) continue;
            for (const v of entry.versions) {
                if (!v.images) continue;
                for (const [key, val] of Object.entries(v.images)) {
                    if (val && val.startsWith('{{IMG:')) {
                        const match = val.match(/\{\{IMG:(.+?)\}\}/);
                        const filename = match ? match[1] : null;
                        if (filename) {
                            const actualUrl = await this.storageManager.loadImage(filename);
                            if (actualUrl) {
                                v.images[key] = actualUrl;
                                restoredCount++;
                            }
                        }
                    }
                }
            }
        }
        // 【关键修复】不修改 chapter.image（保持 {{IMG:filename}} 格式）
        // 只预加载到 memoryCache 供渲染使用
        if (this.data.synopsis) {
            for (const chapter of this.data.synopsis) {
                if (!chapter.image || !chapter.image.startsWith('{{IMG:')) continue;
                const match = chapter.image.match(/\{\{IMG:(.+?)\}\}/);
                const filename = match ? match[1] : null;
                if (filename) {
                    await this.storageManager.loadImage(filename);
                }
            }
        }
        return restoredCount;
    },

    refreshAllImageReferences: async function() {
        await this.restoreAllImagesFromStorage();
    },
    goBackFromDetail: function() {
        // 【回到xx】返回列表页时清空记录
        this._clearPreviousEntry();
        
        const entry = this.data.entries.find(e => e.id === this.data.editingId);
        if (!entry) {
            this.router('home');
            return;
        }
        
        // 根据条目类型返回对应列表：角色→角色页，设定→设定页，正文→剧情梗概
        if (entry.type === 'character') {
            this.router('characters');
        } else if (entry.type === 'non-character') {
            this.router('non-characters');
        } else if (entry.type === 'body') {
            this.router('synopsis');
        } else {
            this.router('home');
        }
    },
    // ========== 数据访问辅助 ==========
    openEntry: function(entryIdRaw) {
        // 【关键修复】强制类型转换并清理
        let entryId = String(entryIdRaw || '').trim();
        
        console.log('[OpenEntry] 打开条目，ID:', entryId, '原始值:', entryIdRaw);
        
        // 【关键】如果 entryId 包含 |，说明是 [[id|vid:text]] 格式被错误解析了
        // 将其转发给 openEntryWithVersion 处理
        if (entryId.includes('|')) {
            console.warn('[OpenEntry] 检测到 ID 包含 |，转发到 openEntryWithVersion');
            const parts = entryId.split('|');
            const actualEntryId = parts[0].trim();
            let versionId = '';
            if (parts[1]) {
                // 可能是 vid:text 格式，取冒号前的部分作为 versionId
                versionId = parts[1].split(':')[0].trim();
            }
            // 递归调用 openEntryWithVersion
            return this.openEntryWithVersion(actualEntryId, versionId);
        }
        
        // 先尝试匹配 id（确保两边都是字符串）
        let entry = this.data.entries.find(function(e) { 
            return String(e.id) === entryId; 
        });
        
        // 再尝试匹配 code（兼容可能传入 code 的情况）
        if (!entry) {
            entry = this.data.entries.find(function(e) { 
                return e.code === entryId; 
            });
        }
        
        if (!entry) {
            console.error('[OpenEntry] 未找到条目，查找ID:', entryId);
            this.showToast('条目不存在或已被删除', 'error');
            return;
        }
        
        // 【外源直链模式】正文词条若设置了外源直链，查看模式跳转前二次确认；编辑模式强制确认后进入编辑
        if (this._sourceLinkHas(entry)) {
            if (this.data.currentMode === 'edit') {
                this._sourceLinkConfirm(entry, { canSkip: false }, () => this._continueOpenEntry(entry, entryId));
                return;
            }
            if (this._sourceLinkSkip(entry)) { this._sourceLinkJump(entry); return; }
            this._sourceLinkConfirm(entry, { canSkip: true }, () => this._sourceLinkJump(entry));
            return;
        }
        this._continueOpenEntry(entry, entryId);
    },

    /** 打开词条的实际处理（隐藏密码检查 + 版本定位 + 渲染详情） */
    _continueOpenEntry: function(entry, entryId) {
        // 【功能4】检查隐藏目录密码（每个词条独立）
        const hiddenCfg = this.data.settings?.hiddenCategory;
        const isHidden = hiddenCfg?.entries?.includes(entry.id);
        // 记录隐藏状态供详情页渲染使用（黑底白字）
        this.data._currentHiddenEntryId = isHidden ? entry.id : null;
        if (isHidden && this.data.currentMode !== 'edit') {
            const pwCfg = hiddenCfg?.entryPasswords?.[entry.id];
            if (pwCfg && pwCfg.answers && pwCfg.answers.length > 0) {
                const pwKey = 'hidden_pw_' + entry.id;
                // 【修复】正确逻辑：alwaysRequired=true时每次都要密码；alwaysRequired=false时只有sessionStorage没ok才要
                const needPassword = pwCfg.alwaysRequired !== false || sessionStorage.getItem(pwKey) !== 'ok';
                // 额外检查：如果sessionStorage已经有ok且alwaysRequired=false，则免密
                const canSkip = pwCfg.alwaysRequired === false && sessionStorage.getItem(pwKey) === 'ok';
                if (needPassword && !canSkip) {
                    if (app.showPasswordDialog) {
                        // 获取词条名称
                        const visibleVersion = this.getVisibleVersion(entry);
                        const entryName = visibleVersion ? visibleVersion.title : entry.code;
                        // 记录来源页面以便返回
                        const returnView = this.data.currentView;
                        // 密码验证回调
                        const tryPassword = (answer) => {
                            // 【修复】空输入不通过
                            if (!answer || answer.trim() === '') {
                                app.showPasswordDialog(pwCfg.hint || '请输入密码', tryPassword, () => {
                                    this._returnFromPasswordLock(returnView, entry);
                                }, '请输入口令后再确认', entryName, entry.id);
                                return;
                            }
                            const isCorrect = pwCfg.answers.some(a => a.trim() === answer.trim());
                            if (isCorrect) {
                                sessionStorage.setItem(pwKey, 'ok');
                                // 清除密码锁定遮罩
                                this._clearPasswordLock();
                                this.data.editingId = entry.id;
                                this.data.viewingVersionId = visibleVersion ? visibleVersion.vid : (entry.versions[0] ? entry.versions[0].vid : null);
                                this.addToHistory(entry);
                                this.router('detail');
                            } else {
                                // 查找匹配的错误提醒规则
                                let errorMsg = pwCfg.defaultMessage || '不对啦！';
                                if (pwCfg.rules) {
                                    for (const rule of pwCfg.rules) {
                                        if (rule.condition === 'equals' && answer.trim() === rule.answer) { errorMsg = rule.message; break; }
                                        else if (rule.condition === 'includes' && answer.includes(rule.answer)) { errorMsg = rule.message; break; }
                                    }
                                }
                                // 显示错误并重新弹出对话框
                                app.showPasswordDialog(pwCfg.hint || '请输入密码', tryPassword, () => {
                                    this._returnFromPasswordLock(returnView, entry);
                                }, errorMsg, entryName, entry.id);
                            }
                        };
                        // 先显示密码锁定遮罩（黑底白字空白页）
                        this._showPasswordLock(entryName);
                        app.showPasswordDialog(pwCfg.hint || '请输入密码', tryPassword, () => {
                            this._returnFromPasswordLock(returnView, entry);
                        }, null, entryName, entry.id);
                        return;
                    }
                }
            }
        }
        
        this.data.editingId = entry.id;
        const visibleVersion = this.getVisibleVersion(entry);
        this.data.viewingVersionId = visibleVersion ? visibleVersion.vid : (entry.versions[0] ? entry.versions[0].vid : null);
        this.addToHistory(entry);
        this.router('detail');
    },

    // ============ 外源直链模式（正文词条跳转外部链接） ============
    /** 该词条是否启用了外源直链 */
    _sourceLinkHas: function(entry) {
        return !!(entry && entry.type === 'body' && entry.sourceLink);
    },
    /** 是否可跳过二次确认（勾选过"今后不再提醒"且未被管理员重置） */
    _sourceLinkSkip: function(entry) {
        const s = this.data.settings || {};
        const dismissed = s.sourceLinkDismiss && s.sourceLinkDismiss[entry.id];
        const reset = s.sourceLinkResetAt || 0;
        return !!(dismissed && (reset <= 0 || dismissed > reset));
    },
    /** 跳转到外源链接（本地版经系统默认浏览器；否则新窗口） */
    _sourceLinkJump: function(entry) {
        if (this.addToHistory) this.addToHistory(entry);
        const url = entry.sourceLink;
        if (window.desktopBridge && window.desktopBridge.openExternal) {
            window.desktopBridge.openExternal(url);
        } else if (/^https?:\/\//i.test(url)) {
            window.open(url, '_blank', 'noopener');
        }
        if (this.showToast) this.showToast('即将在外部打开外源链接', 'info', 2500);
    },
    /** 是否需显示红字提示（管理员重置后，未勾选"不再提醒"，前3次提示） */
    _sourceLinkNeedRedWarn: function(entry) {
        const s = this.data.settings || {};
        const dismissed = s.sourceLinkDismiss && s.sourceLinkDismiss[entry.id];
        const reset = s.sourceLinkResetAt || 0;
        if (!reset) return false;
        // 重置时间在勾选时间之后 → 失效，需红字
        if (!dismissed || reset > dismissed) {
            const key = 'slwarn_' + entry.id;
            const n = parseInt(sessionStorage.getItem(key) || '0', 10);
            if (n < 3) { sessionStorage.setItem(key, String(n + 1)); return true; }
        }
        return false;
    },
    /** 外源直链二次确认弹窗（样式参考"未来角色警告"） */
    _sourceLinkConfirm: function(entry, opts, onProceed) {
        const canSkip = opts && opts.canSkip;
        const s = this.data.settings || {};
        const dismissed = s.sourceLinkDismiss && s.sourceLinkDismiss[entry.id];
        const reset = s.sourceLinkResetAt || 0;
        const needRed = this._sourceLinkNeedRedWarn(entry);
        const linkName = entry.sourceLinkName || entry.sourceLink || '外源链接';
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4 fade-in';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <div class="text-center mb-5">
                    <div class="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fa-solid fa-arrow-up-right-from-square text-pink-600 text-2xl"></i>
                    </div>
                    <h3 class="text-xl font-bold text-gray-800 mb-2">外源链接确认</h3>
                    <p class="text-gray-600 text-sm">正在前往 <span class="font-bold text-indigo-600">${this.escapeHtml(linkName)}</span>，该词条正文存储在外部链接。</p>
                    ${needRed ? '<div class="mt-3 text-red-600 text-sm font-medium leading-snug"><i class="fa-solid fa-circle-exclamation mr-1"></i>Wiki管理员近期可能修改了外源直链的参数，需要用户进行重新确认。</div>' : ''}
                </div>
                ${canSkip ? '<label class="flex items-center gap-2 mb-4 text-sm text-gray-600"><input type="checkbox" id="sl-skip" class="rounded text-indigo-600"> 今后不再提醒</label>' : ''}
                <div class="flex gap-3">
                    <button id="sl-cancel" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium">${canSkip ? '取消' : '返回'}</button>
                    <button id="sl-confirm" class="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-lg shadow-indigo-200">${canSkip ? '前往' : '继续'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#sl-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#sl-confirm').onclick = () => {
            if (canSkip) {
                const chk = overlay.querySelector('#sl-skip');
                if (chk && chk.checked) {
                    if (!this.data.settings.sourceLinkDismiss) this.data.settings.sourceLinkDismiss = {};
                    this.data.settings.sourceLinkDismiss[entry.id] = Date.now();
                    sessionStorage.removeItem('slwarn_' + entry.id);
                    if (typeof this.saveData === 'function') this.saveData();
                }
            }
            overlay.remove();
            if (onProceed) onProceed();
        };
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    },
    /** 存档设置：重置用户外源直链二次确认（记录时间并延后5分钟） */
    resetSourceLinkConfirm: function() {
        if (!confirm('确认此时重置用户的外源直链二次确认？重置后将强制用户重新确认外源链接。')) return;
        if (!this.data.settings) this.data.settings = {};
        this.data.settings.sourceLinkResetAt = Date.now() + 5 * 60 * 1000; // 延后5分钟
        if (typeof this.saveData === 'function') this.saveData();
        if (this.showToast) this.showToast('已重置外源直链二次确认，查看模式需重新确认', 'success', 4000);
    },

    /**
     * 【功能4】显示密码锁定遮罩（黑底白字空白页）
     */
    _showPasswordLock: function(entryName) {
        this._clearPasswordLock();
        const lock = document.createElement('div');
        lock.id = 'password-lock-overlay';
        lock.className = 'fixed inset-0 bg-black z-[9998] flex flex-col items-center justify-center text-white';
        lock.innerHTML = `
            <div class="text-center">
                <div class="text-6xl mb-6"><i class="fa-solid fa-lock text-gray-600"></i></div>
                <div class="text-xl font-bold text-gray-300 mb-2">${this.escapeHtml(entryName)}</div>
                <div class="text-sm text-gray-500">该内容已被锁定</div>
            </div>
        `;
        document.body.appendChild(lock);
    },

    /**
     * 【功能4】清除密码锁定遮罩
     */
    _clearPasswordLock: function() {
        const lock = document.getElementById('password-lock-overlay');
        if (lock) lock.remove();
    },

    /**
     * 【功能4】从密码锁定返回（点击返回按钮时调用）
     */
    _returnFromPasswordLock: function(returnView, entry) {
        this._clearPasswordLock();
        this.data._currentHiddenEntryId = null;
        // 返回到之前的页面
        if (returnView && returnView !== 'detail') {
            this.router(returnView);
        } else {
            // 如果没有记录来源页，返回到对应列表
            this.router(entry?.type === 'non-character' ? 'non-characters' : 'characters');
        }
    },

    addToHistory: function(entry) {
        if (!entry) return;
        const version = this.getVisibleVersion(entry);
        const title = version ? version.title : entry.code;
        this.data.history = this.data.history.filter(h => h.id !== entry.id);
        this.data.history.unshift({ id: entry.id, title: title, code: entry.code, type: entry.type, timestamp: Date.now() });
        if (this.data.history.length > 20) this.data.history = this.data.history.slice(0, 20);
        setTimeout(() => this.saveData(), 500);
    },

    // 【新增】历史记录缩略图加载函数
    loadHistoryThumbnail: async function(entryId, containerElement) {
        const entry = this.data.entries.find(e => e.id === entryId);
        if (!entry) return;
        
        const version = this.getVisibleVersion(entry);
        if (!version) return;
        
        // 优先使用 avatar (1:1)，其次 card (3:4)
        let imgUrl = version.images ? version.images.avatar : (version.image || null);
        if (!imgUrl && version.images) imgUrl = version.images.card;
        
        // 处理引用标记 {{IMG:filename}}
        if (imgUrl && imgUrl.startsWith('{{IMG:') && this.storageManager) {
            const match = imgUrl.match(/\{\{IMG:(.+?)\}\}/);
            if (match) {
                const filename = match[1];
                // 优先从内存缓存获取
                if (this.storageManager.memoryCache && this.storageManager.memoryCache.has(filename)) {
                    imgUrl = this.storageManager.memoryCache.get(filename);
                } else {
                    // 异步加载
                    try {
                        const actualUrl = await this.storageManager.loadImage(filename);
                        if (actualUrl) imgUrl = actualUrl;
                    } catch (e) {
                        imgUrl = null;
                    }
                }
            }
        }
        
        // 验证图片URL有效性
        const hasValidImage = imgUrl && (imgUrl.startsWith('data:') || imgUrl.startsWith('blob:') || imgUrl.startsWith('http'));
        
        if (hasValidImage) {
            containerElement.innerHTML = '<img src="' + imgUrl + '" class="w-full h-full object-cover" onerror="this.style.display=\'none\'; this.parentElement.innerHTML=\'<i class=\\\'fa-solid fa-user text-gray-400\\\'></i>\';">';
        } else {
            // 保持默认图标
            containerElement.innerHTML = '<i class="fa-solid fa-user text-gray-400"></i>';
        }
    },
    // ========== Layer 2+3+4+5+6: 角色状态检测、置顶管理与并行版本处理 ==========
    
    /**
     * 【修复】检查角色是否失踪（当前可见版本后无活跃版本）
     * 修复内容：增加对 chapterTo 为 null（全时间有效）的判断，避免全时间有效角色被误判为失踪
     * 位置：约第1208-1240行（原函数位置）
     */
    checkIfMissing: function(entry) {
        if (!entry || !entry.versions || entry.versions.length === 0) return false;
        
        const currentCh = this.data.currentTimeline === 'latest' 
            ? { order: Infinity } 
            : this.data.chapters.find(c => c.id === this.data.currentTimeline);
        
        if (!currentCh || currentCh.order === Infinity) return false;
        
        const currentVersion = this.getVisibleVersion(entry);
        if (!currentVersion) return false;
        
        // 【关键修复】如果当前版本没有结束时间（全时间有效），则判定为未失踪
        if (!currentVersion.chapterTo) return false;
        
        const currentFromOrder = this.getChapterOrder(currentVersion.chapterFrom);
        
        const hasFutureVersion = entry.versions.some(v => {
            if (v.vid === currentVersion.vid) return false;
            const vFromOrder = this.getChapterOrder(v.chapterFrom);
            return vFromOrder > currentFromOrder;
        });
        
        if (hasFutureVersion) return false;
        
        const currentToOrder = this.getChapterOrder(currentVersion.chapterTo);
        if (currentToOrder === Infinity) return false;
        
        return true;
    },

    getCharacterDisplayStatus: function(entry) {
        if (!entry || entry.type !== 'character') return 'normal';
        
        const currentVersion = this.getVisibleVersion(entry);
        if (!currentVersion) return 'missing';
        
        const timeStatus = this.getVersionTimeStatus(entry, currentVersion);
        
        // Layer 2: 未来角色
        if (timeStatus === 'future') {
            return 'future';
        }
        
        // Layer 3: 检测是否失踪（当前可见版本后无接续）
        if (timeStatus === 'current' || timeStatus === 'past') {
            const isMissing = this.checkIfMissing(entry);
            if (isMissing) return 'missing';
        }
        
        // Layer 5: 检测并行版本
        const hasParallel = this.checkHasParallelVersions(entry);
        if (hasParallel) return 'parallel';
        
        return 'normal';
    },

    isCharacterPinned: function(entry) {
        if (!entry || !entry.pinned) return false;
        
        if (!entry.pinStartChapter && !entry.pinEndChapter) return true;
        
        let currentOrder;
        if (this.data.currentTimeline === 'latest') {
            currentOrder = Infinity;
        } else {
            const currentCh = this.data.chapters.find(c => c.id === this.data.currentTimeline);
            currentOrder = currentCh ? currentCh.order : -1;
        }
        
        const startOrder = entry.pinStartChapter ? this.getChapterOrder(entry.pinStartChapter) : -1;
        const endOrder = entry.pinEndChapter ? this.getChapterOrder(entry.pinEndChapter) : Infinity;
        
        return currentOrder >= startOrder && currentOrder <= endOrder;
    },

    checkHasParallelVersions: function(entry) {
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
    },

    getPinnedVersionInChapter: function(entry, chapterId) {
        if (!entry || !chapterId) return null;
        
        // 【修复】遍历 pinnedVersions 查找章节所在的区间范围
        if (entry.pinnedVersions) {
            const chapter = this.data.chapters.find(c => c.id === chapterId);
            if (chapter) {
                for (const [startChId, vid] of Object.entries(entry.pinnedVersions)) {
                    const startCh = this.data.chapters.find(c => c.id === startChId);
                    if (!startCh) continue;
                    let endOrder = Infinity;
                    for (const otherStartId of Object.keys(entry.pinnedVersions)) {
                        if (otherStartId === startChId) continue;
                        const otherCh = this.data.chapters.find(c => c.id === otherStartId);
                        if (otherCh && otherCh.order > startCh.order && otherCh.order < endOrder) {
                            endOrder = otherCh.order;
                        }
                    }
                    if (chapter.order >= startCh.order && chapter.order < endOrder) {
                        const pinnedVersion = entry.versions.find(v => v.vid === vid);
                        if (pinnedVersion) return pinnedVersion;
                    }
                }
            }
        }
        
        // 没有置顶设置，按时间范围匹配
        const chapter = this.data.chapters.find(c => c.id === chapterId);
        if (!chapter) return null;
        
        return entry.versions.find(v => {
            const fromOrder = this.getChapterOrder(v.chapterFrom);
            const toOrder = this.getChapterOrder(v.chapterTo);
            return chapter.order >= fromOrder && chapter.order <= toOrder;
        });
    },

    isInMissingInterval: function(entry) {
        return this.getCharacterDisplayStatus(entry) === 'missing';
    },

    getMissingInfo: function(entry) {
        const currentVersion = this.getVisibleVersion(entry);
        if (!currentVersion) return null;
        
        const futureVersions = entry.versions
            .filter(v => {
                const vFromOrder = this.getChapterOrder(v.chapterFrom);
                const currentFromOrder = this.getChapterOrder(currentVersion.chapterFrom);
                return vFromOrder > currentFromOrder;
            })
            .sort((a, b) => {
                const orderA = this.getChapterOrder(a.chapterFrom);
                const orderB = this.getChapterOrder(b.chapterFrom);
                return orderA - orderB;
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
    },

    showFutureConfirmDialog: function(entry, version, externalConfirmKey) {
        const confirmKey = externalConfirmKey || `${entry.id}_${version.vid}`;
        // 【修复】保存当前viewingVersionId，避免被其他逻辑覆盖
        const targetVid = version.vid;
        
        if (this.confirmedFutureEntries && this.confirmedFutureEntries.has(confirmKey)) {
            this.data.viewingVersionId = targetVid;
            this.data.editingId = entry.id;
            this.router('detail');
            return;
        }
        
        // 【修复】记住调用前的视图，用于"返回当前"
        const previousView = this.data.currentView || 'home';
        
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
            // 【修复】返回之前的有效页面，避免空白页
            const returnView = (previousView === 'detail' || previousView === 'edit') ?
                (entry.type === 'character' ? 'characters' : entry.type === 'non-character' ? 'non-characters' : 'home')
                : previousView;
            this.router(returnView);
        };
        
        overlay.querySelector('#future-confirm').onclick = () => {
            overlay.remove();
            if (!this.confirmedFutureEntries) {
                this.confirmedFutureEntries = new Set();
            }
            this.confirmedFutureEntries.add(confirmKey);
            // 【修复】保持目标版本ID，不通过openEntry重置
            this.data.viewingVersionId = targetVid;
            this.data.editingId = entry.id;
            this.router('detail');
        };
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
                const returnView = (previousView === 'detail' || previousView === 'edit') ?
                    (entry.type === 'character' ? 'characters' : entry.type === 'non-character' ? 'non-characters' : 'home')
                    : previousView;
                this.router(returnView);
            }
        };
    },

    showMissingConfirmDialog: function(entry, missingInfo) {
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
    },

    switchToVersion: function(entryId, versionId) {
        this.data.editingId = entryId;
        this.data.viewingVersionId = versionId;
        this.router('detail');
    },
    generateCode: function(type) {
        const prefixMap = { character: 'C', 'non-character': 'N', event: 'E' };
        const prefix = prefixMap[type] || 'N';
        
        // 【新增】优先使用回收池中的编号（取最小值，保持顺序）
        if (this.data.recycledCodes && this.data.recycledCodes[prefix] && this.data.recycledCodes[prefix].length > 0) {
            // sort 确保取最小值，虽然 deleteEntry 中已排序，但这里防御性排序
            this.data.recycledCodes[prefix].sort((a, b) => a - b);
            const recycledNum = this.data.recycledCodes[prefix].shift();
            console.log(`[Code] 复用回收编号: ${prefix}-${String(recycledNum).padStart(3, '0')}`);
            return prefix + '-' + String(recycledNum).padStart(3, '0');
        }
        
        // 回收池为空，生成新编号
        this.data.codeCounters[prefix]++;
        return prefix + '-' + String(this.data.codeCounters[prefix]).padStart(3, '0');
    },

    updateSetting: function(key, value) {
        this.data.settings[key] = value;
        this.saveData();
        this.applySettings();
    },

    changeFont: function(fontValue) {
        if (fontValue === 'custom') {
            document.getElementById('custom-font-upload').classList.remove('hidden');
        } else {
            document.getElementById('custom-font-upload').classList.add('hidden');
            this.data.settings.customFont = fontValue;
            this.applyFont();
            this.saveData();
        }
    },

    uploadCustomFont: function(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const fontName = 'CustomFont_' + Date.now();
            const style = document.createElement('style');
            style.textContent = `
                @font-face {
                    font-family: '${fontName}';
                    src: url('${e.target.result}');
                }
            `;
            document.head.appendChild(style);
            this.data.settings.customFont = `'${fontName}', sans-serif`;
            this.applyFont();
            this.saveData();
            alert('自定义字体已上传并应用');
        };
        reader.readAsDataURL(file);
    },

    applyFont: function() {
        const font = this.data.settings.customFont || "'Noto Sans SC', sans-serif";
        document.documentElement.style.setProperty('--custom-font', font);
        document.body.style.fontFamily = font;
    },

    addCamp: async function() {
        // 使用网页内输入弹窗（Electron 不支持 window.prompt）
        let name = null;
        if (this.showPromptDialog) {
            name = await this.showPromptDialog({ title: '添加阵营', placeholder: '输入阵营名称', confirmText: '添加' });
        } else {
            name = prompt('输入阵营名称：');
        }
        if (!name) return;
        if (this.data.camps.includes(name)) {
            alert('该阵营已存在');
            return;
        }
        this.data.camps.push(name);
        this.saveData();
        this.renderSettings(document.getElementById('main-container'));
    },

    deleteCamp: function(idx) {
        if (!confirm('确定删除此阵营？')) return;
        const campName = this.data.camps[idx];
        this.data.camps.splice(idx, 1);
        this.data.entries.forEach(entry => {
            if (entry.camp === campName) entry.camp = '';
        });
        this.saveData();
        this.renderSettings(document.getElementById('main-container'));
    },

    editAnnouncement: function(id) {
        const ann = this.data.announcements.find(a => a.id === id);
        if (!ann) return;
        this.data.currentAnnouncement = ann;
        this.router('announcement-edit');
    },

    deleteAnnouncement: function(id) {
        if (!confirm('确定删除此公告？')) return;
        this.data.announcements = this.data.announcements.filter(a => a.id !== id);
        this.saveData();
        this.renderSettings(document.getElementById('main-container'));
    },

    setActiveAnnouncement: function(id) {
        this.data.announcements.forEach(a => a.isActive = (a.id === id));
        this.saveData();
        this.renderSettings(document.getElementById('main-container'));
    },

    viewAnnouncement: function() {
        const ann = this.data.announcements.find(a => a.isActive);
        if (!ann) return;
        alert(`【${ann.title}】\n\n${ann.content.replace(/<[^>]+>/g, '')}\n\n—— ${ann.author || '匿名'} ${ann.date || ''}`);
    },

    addHomeTextBox: function() {
        // 1. 更新数据
        this.data.homeContent.push({ type: 'text', content: '' });
        const newIdx = this.data.homeContent.length - 1;
        
        // 2. 直接操作 DOM（即时同步）
        const textBoxes = document.getElementById('home-text-boxes');
        if (textBoxes) {
            const wrapper = document.createElement('div');
            wrapper.className = 'relative group home-text-item animate-[fadeIn_0.3s_ease-out]';
            wrapper.dataset.idx = newIdx;
            
            const textarea = document.createElement('textarea');
            textarea.className = 'w-full p-3 border border-gray-200 rounded-lg text-sm min-h-[100px] focus:ring-2 focus:ring-indigo-500 outline-none transition';
            textarea.placeholder = '输入文本内容...';
            textarea.value = '';
            
            // 实时保存输入内容（使用 input 而非 onchange）
            textarea.oninput = (e) => this.updateHomeText(newIdx, e.target.value);
            
            // 删除按钮（使用 data-idx 避免闭包陷阱）
            wrapper.innerHTML = `
                <button class="home-delete-btn absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition bg-white rounded shadow-sm w-6 h-6 flex items-center justify-center z-10">
                    <i class="fa-solid fa-times"></i>
                </button>
            `;
            wrapper.appendChild(textarea);
            
            // 绑定删除事件（动态获取最新索引）
            wrapper.querySelector('.home-delete-btn').onclick = (e) => {
                e.stopPropagation();
                const currentIdx = parseInt(wrapper.closest('.home-text-item').dataset.idx);
                this.removeHomeItem(currentIdx);
            };
            
            textBoxes.appendChild(wrapper);
            
            // 自动聚焦到新文本框
            setTimeout(() => textarea.focus(), 50);
        } else {
            // 回退：如果不在编辑视图，重新渲染整个页面
            this.renderHome(document.getElementById('main-container'));
        }
    },

    addHomeEntryRef: function() {
        this.showEntrySelectDialog((entry) => {
            if (!entry) return;
            
            // 处理版本选择后的回调
            const handleVersionSelect = (version) => {
                const title = version ? version.title : (this.getVisibleVersion(entry)?.title || entry.code);
                const versionId = version ? version.vid : null;
                
                // 更新数据
                this.data.homeContent.push({ 
                    type: 'entry-ref', 
                    entryId: entry.id, 
                    versionId: versionId,
                    title: title 
                });
                
                // 直接操作 DOM（即时同步）
                const textBoxes = document.getElementById('home-text-boxes');
                if (textBoxes) {
                    const newIdx = this.data.homeContent.length - 1;
                    const refElement = this.createHomeEntryRef(entry.id, versionId, title, newIdx);
                    refElement.classList.add('animate-[fadeIn_0.3s_ease-out]');
                    textBoxes.appendChild(refElement);
                } else {
                    this.renderHome(document.getElementById('main-container'));
                }
            };
            
            // 多版本词条显示版本选择弹窗
            if (entry.versions && entry.versions.length > 1) {
                this.showVersionSelectDialogForHome(entry, handleVersionSelect);
            } else {
                // 单版本直接添加
                handleVersionSelect(entry.versions[0]);
            }
        });
    },
    showVersionSelectDialogForHome: function(entry, callback) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 fade-in';
        modal.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
                <div class="p-4 border-b bg-indigo-50 rounded-t-xl flex justify-between items-center">
                    <div>
                        <h3 class="font-bold text-lg text-indigo-800">选择要引用的版本</h3>
                        <p class="text-xs text-gray-600 mt-1">词条：${entry.code} (${entry.versions.length}个版本)</p>
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
        
        // 渲染版本列表
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
    },
    createHomeEntryRef: function(entryId, versionId, title, idx) {
        const div = document.createElement('div');
        // 添加 home-entry-ref-item 类名以便识别和重新索引
        div.className = 'home-entry-ref-item bg-indigo-50 p-3 rounded border border-indigo-200 shadow-sm relative group flex items-center gap-2 cursor-pointer hover:bg-indigo-100 transition';
        div.dataset.idx = idx;
        div.dataset.entryId = entryId;
        div.dataset.versionId = versionId || '';
        
        // 版本定向指示器（悬停显示提示）
        const versionIndicator = versionId ? 
            '<i class="fa-solid fa-layer-group text-indigo-400 text-xs mr-1" title="定向引用特定版本"></i>' : '';
        
        div.innerHTML = `
            <i class="fa-solid fa-link text-indigo-500"></i>
            <span class="flex-1 text-sm text-indigo-700 font-medium truncate">${versionIndicator}${title}</span>
            <button class="home-delete-btn text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition w-6 h-6 flex items-center justify-center rounded hover:bg-white">
                <i class="fa-solid fa-times"></i>
            </button>
        `;
        
        // 删除按钮事件（动态获取当前索引，避免闭包陷阱）
        div.querySelector('.home-delete-btn').onclick = (e) => {
            e.stopPropagation();
            const currentIdx = parseInt(div.closest('.home-entry-ref-item').dataset.idx);
            this.removeHomeItem(currentIdx);
        };
        
        // 点击跳转（支持版本定向）
        div.onclick = () => {
            if (versionId) {
                this.openEntryWithVersion(entryId, versionId);
            } else {
                this.openEntry(entryId);
            }
        };
        
        return div;
    },

    showEntrySelectDialog: function(callback) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4 fade-in';
        modal.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
                <div class="p-4 border-b bg-gray-50 rounded-t-xl flex justify-between items-center">
                    <h3 class="font-bold text-lg">选择词条</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center">
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
        document.body.appendChild(modal);
        
        const list = modal.querySelector('#entry-select-list');
        const searchInput = modal.querySelector('#entry-search-input');
        
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
                item.onclick = () => { modal.remove(); callback(entry); };
                list.appendChild(item);
            });
        };
        
        renderEntries();
        searchInput.oninput = (e) => renderEntries(e.target.value);
        searchInput.focus();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    },

    updateHomeText: function(idx, value) {
        if (this.data.homeContent[idx]) this.data.homeContent[idx].content = value;
        this.saveData();
    },

    removeHomeItem: function(idx) {
        // 1. 更新数据
        this.data.homeContent.splice(idx, 1);
        
        // 2. 直接操作 DOM（带淡出动画）
        const textBoxes = document.getElementById('home-text-boxes');
        if (textBoxes && textBoxes.children[idx]) {
            const element = textBoxes.children[idx];
            
            // 添加淡出动画
            element.style.transition = 'all 0.3s ease';
            element.style.opacity = '0';
            element.style.transform = 'translateX(20px)';
            
            setTimeout(() => {
                element.remove();
                
                // 重新索引所有剩余元素（关键：确保后续删除操作索引正确）
                Array.from(textBoxes.children).forEach((child, newIdx) => {
                    child.dataset.idx = newIdx;
                    // 更新对应的数据项引用（如果未来需要）
                });
                
                // 自动保存（可选，因为 updateHomeText 已实时保存文本内容）
                this.saveData();
            }, 300);
        } else {
            // 回退：重新渲染整个页面
            this.renderHome(document.getElementById('main-container'));
        }
    },

    saveHomeContent: function() {
        // 数据已通过 updateHomeText 实时保存，这里只需确认并显示提示
        this.saveData();
        
        const status = document.getElementById('home-save-status');
        if (status) {
            status.classList.remove('opacity-0');
            setTimeout(() => status.classList.add('opacity-0'), 2000);
        }
        
        // 可选：显示 Toast 提示
        this.showSaveToast('首页内容已保存');
    },

    saveHomeCustomTitle: function(value) {
        this.data.settings.homeCustomTitle = value;
        this.saveData();
    },

        renderSettingsGroupedFallback: function(container) {
        const originalMasonry = container.querySelector('#character-masonry');
        const countBadge = container.querySelector ? container.querySelector('#list-count') : null;
        const title = container.querySelector ? container.querySelector('#list-title') : null;

        if (title) title.textContent = '设定';

        const wrapper = originalMasonry || container;
        if (originalMasonry) {
            originalMasonry.innerHTML = '';
            originalMasonry.className = 'max-w-7xl mx-auto pb-20 space-y-6';
        }

        // 【功能2】添加"管理目录"按钮（编辑模式）
        if (this.data.currentMode === 'edit') {
            const mgmtBtn = document.createElement('div');
            mgmtBtn.className = 'flex justify-end mb-4';
            mgmtBtn.innerHTML = `<button onclick="app.showSettingCategoryManager()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition shadow"><i class="fa-solid fa-folder-tree mr-1"></i>管理目录与排序</button>`;
            wrapper.appendChild(mgmtBtn);
        }

        const allSettings = this.data.entries.filter(e => e.type === 'non-character');
        if (countBadge) countBadge.textContent = allSettings.length;

        if (allSettings.length === 0) {
            if (!originalMasonry || originalMasonry.children.length === 0)
                wrapper.innerHTML = '<div class="text-center py-10 text-gray-400">暂无设定数据</div>';
            return;
        }

        // 收集所有目录
        const groups = {};
        const typeLabels = { world: '世界设定', document: '文献', art: '绘画/图片', faction: '阵营' };
        const typeIcons = { world: 'fa-globe', document: 'fa-book', art: 'fa-palette', faction: 'fa-flag' };

        allSettings.forEach(entry => {
            let t = entry.settingType || 'world';
            let key = t;
            let title = typeLabels[t] || t;
            let icon = typeIcons[t] || 'fa-folder';
            if (t === 'custom' && entry.customSettingType) {
                key = 'custom-' + entry.customSettingType;
                title = entry.customSettingType;
            }
            if (!groups[key]) groups[key] = { key, title, icon, items: [] };
            groups[key].items.push(entry);
        });

        // 【功能2】按目录排序配置排列
        const catOrder = this.data.settings?.settingConfig?.categoryOrder || [];
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            const ia = catOrder.indexOf(a);
            const ib = catOrder.indexOf(b);
            if (ia >= 0 && ib >= 0) return ia - ib;
            if (ia >= 0) return -1;
            if (ib >= 0) return 1;
            return 0;
        });

        sortedKeys.forEach(key => {
            const group = groups[key];
            if (!group || group.items.length === 0) return;

            // 【功能3】应用显示配置
            const displayCfg = this.data.settings?.settingConfig?.categoryDisplay?.[key] || {};
            const homeOrder = displayCfg.homeOrder || [];
            const homeHidden = displayCfg.homeHidden || [];

            // 排序条目：先按homeOrder排列，未排序的按默认顺序排在后面
            let sortedItems = [...group.items];
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

            // 过滤隐藏的（设定页只显示前8个非隐藏条目）
            const visibleItems = sortedItems.filter(e => !homeHidden.includes(e.id)).slice(0, 8);

            const section = document.createElement('div');
            section.className = 'setting-category-section bg-white rounded-xl shadow-sm border border-gray-200 p-4';

            section.innerHTML = `
                <div class="setting-category-header">
                    <div class="setting-category-title">
                        <i class="fa-solid ${group.icon} text-indigo-600"></i>
                        <span class="text-lg font-bold text-gray-800">${group.title}</span>
                        <span class="setting-count-badge">${group.items.length}个</span>
                    </div>
                    <button onclick="app.showSettingCategory('${key}')" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                        更多 <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="setting-group-${key.replace(/[^a-zA-Z0-9]/g, '_')}">
                </div>
            `;

            wrapper.appendChild(section);

            const grid = section.querySelector(`#setting-group-${key.replace(/[^a-zA-Z0-9]/g, '_')}`);
            visibleItems.forEach(entry => {
                let version = this.getVisibleVersion(entry);
                if (!version) version = entry.versions?.[0];
                if (!version) return;
                const card = this.createSettingCard ? this.createSettingCard(entry, version) : this.createSettingCardFallback(entry, version);
                if (card) grid.appendChild(card);
            });
        });
        
        // 【功能4】编辑模式下显示隐藏目录管理区域
        const hiddenCategoryCfg = this.data.settings?.hiddenCategory;
        const hiddenEntryIds = hiddenCategoryCfg?.entries || [];
        if (this.data.currentMode === 'edit') {
            const hiddenEntries = allSettings.filter(e => hiddenEntryIds.includes(e.id));
            const hiddenSection = document.createElement('div');
            hiddenSection.className = 'setting-category-section bg-gray-900 rounded-xl shadow-sm border border-gray-700 p-4 mt-4';
            hiddenSection.innerHTML = `
                <div class="setting-category-header" style="border-color:#374151">
                    <div class="setting-category-title">
                        <i class="fa-solid fa-eye-slash text-gray-400"></i>
                        <span class="text-lg font-bold text-gray-200">隐藏目录</span>
                        <span class="setting-count-badge bg-gray-700 text-gray-300">${hiddenEntries.length}个</span>
                    </div>
                    <button onclick="app.showHiddenCategoryManager()" class="text-xs text-gray-400 hover:text-white font-medium">
                        <i class="fa-solid fa-gear"></i> 管理
                    </button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="setting-group-hidden"></div>
            `;
            wrapper.appendChild(hiddenSection);
            const hiddenGrid = hiddenSection.querySelector('#setting-group-hidden');
            hiddenEntries.forEach(entry => {
                let version = this.getVisibleVersion(entry);
                if (!version) version = entry.versions?.[0];
                if (!version) return;
                const card = this.createSettingCard ? this.createSettingCard(entry, version) : this.createSettingCardFallback(entry, version);
                if (card) {
                    card.style.background = '#1f2937';
                    card.style.borderColor = '#374151';
                    const t = card.querySelector('h4');
                    if (t) t.style.color = '#e5e7eb';
                    hiddenGrid.appendChild(card);
                }
            });
        }
    },
    createSettingCardFallback: function(entry, version) {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:shadow-md transition hover:border-indigo-300 flex flex-col';
        div.onclick = () => this.openEntry(entry.id);
        
        let img = version.images?.card || version.images?.avatar || '';
        const hasImage = img && (img.startsWith('data:') || img.startsWith('blob:') || img.startsWith('http'));
        
        div.innerHTML = `
            <div class="aspect-[3/2] bg-gray-100 rounded-lg mb-3 overflow-hidden flex items-center justify-center shrink-0">
                ${hasImage ? `<img src="${img}" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=\\'fa-solid fa-image text-gray-300 text-2xl\\'></i>'">` :
                `<i class="fa-solid fa-image text-gray-300 text-2xl"></i>`}
            </div>
            <div class="flex items-center justify-between min-h-[24px]">
                <h4 class="font-bold text-sm text-gray-800 truncate flex-1">${version.title}</h4>
                <span class="text-[10px] text-gray-400 font-mono ml-2">${entry.code}</span>
            </div>
            <p class="text-xs text-gray-500 mt-1 line-clamp-2">${version.subtitle || ''}</p>
        `;
        
        return div;
    },

    // ========== 首页渲染（完整修复版） ==========
    renderHome: function(container) {
        const tpl = document.getElementById('tpl-home');
        if (!tpl) {
            console.error('[RenderHome] 模板不存在');
            return;
        }
        const clone = tpl.content.cloneNode(true);
        
        // 渲染备份恢复提示
        if (this.data.pendingBackup) {
            const banner = clone.getElementById('backup-restore-banner');
            const timeSpan = clone.getElementById('backup-restore-time');
            if (banner && timeSpan) {
                banner.classList.remove('hidden');
                const date = new Date(this.data.pendingBackup.timestamp);
                timeSpan.textContent = date.toLocaleString('zh-CN');
            }
        }
        
        // 渲染公告横幅
        const activeAnn = this.data.announcements.find(a => a.isActive);
        if (activeAnn) {
            const annSection = clone.getElementById('announcement-section');
            const title = clone.getElementById('announcement-title');
            const preview = clone.getElementById('announcement-preview');
            const meta = clone.getElementById('announcement-meta');
            
            if (annSection) annSection.classList.remove('hidden');
            if (title) title.textContent = activeAnn.title;
            if (preview) {
                var contentText = activeAnn.content ? activeAnn.content.replace(/<[^>]+>/g, '') : '';
                preview.textContent = contentText.substring(0, 100) + (contentText.length > 100 ? '...' : '');
            }
            if (meta) {
                meta.innerHTML = `<i class="fa-solid fa-user-pen mr-1"></i>${activeAnn.author || '匿名'} <span class="mx-2">•</span> <i class="fa-regular fa-calendar mr-1"></i>${activeAnn.date || new Date(activeAnn.createdAt).toLocaleDateString('zh-CN')}`;
            }
        }
        
        // 更新欢迎语
        const welcomeTitle = clone.getElementById('welcome-title');
        const welcomeSubtitle = clone.getElementById('welcome-subtitle');
        if (welcomeTitle) welcomeTitle.textContent = this.data.settings.welcomeTitle || '欢迎来到 Wiki';
        if (welcomeSubtitle) welcomeSubtitle.textContent = this.data.settings.welcomeSubtitle || '探索角色、世界观与错综复杂的关系网。';
        
        // 【新增】渲染首页活动窗口
        if (this.renderHomeEventBanner) {
            this.renderHomeEventBanner(clone);
        }

        // 渲染最近浏览历史
        const historySection = clone.getElementById('history-section');
        const historyList = clone.getElementById('history-list');
        if (historySection && historyList && this.data.history && this.data.history.length > 0) {
            historySection.classList.remove('hidden');
            
            // 【修复】异步加载历史记录图片
            this.data.history.slice(0, 10).forEach((h, index) => {
                const item = document.createElement('div');
                item.className = 'history-item';
                item.onclick = () => this.openEntry(h.id);
                
                // 先创建基础结构，图片异步加载
                item.innerHTML = `
                    <div class="w-10 h-10 rounded bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-bold overflow-hidden shrink-0 history-thumb" data-entry-id="${h.id}" data-index="${index}">
                        <i class="fa-solid fa-user text-gray-400"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-gray-800 truncate">${h.title}</div>
                        <div class="text-xs text-gray-400">${h.code}</div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
                `;
                historyList.appendChild(item);
                
                // 异步加载1:1头像图片
                this.loadHistoryThumbnail(h.id, item.querySelector('.history-thumb'));
            });
        }
        
        // 渲染首页自定义内容（编辑模式）
        const customArea = clone.getElementById('home-custom-area');
        const textBoxes = clone.getElementById('home-text-boxes');
        const customTitleInput = clone.getElementById('home-custom-title');
        
        if (customArea && customTitleInput) {
            customTitleInput.value = this.data.settings.homeCustomTitle || '首页自定义内容';
            if (textBoxes) {
                this.data.homeContent.forEach((item, idx) => {
                    if (item.type === 'text') {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'relative group home-text-item'; // 添加识别类名
                        wrapper.dataset.idx = idx; // 关键：设置索引
                        
                        const textarea = document.createElement('textarea');
                        textarea.className = 'w-full p-3 border border-gray-200 rounded-lg text-sm min-h-[100px] focus:ring-2 focus:ring-indigo-500 outline-none';
                        textarea.placeholder = '输入文本内容...';
                        textarea.value = item.content || '';
                        // 改为 oninput 实现实时保存
                        textarea.oninput = (e) => this.updateHomeText(idx, e.target.value);
                        
                        wrapper.innerHTML = `
                            <button class="home-delete-btn absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition bg-white rounded shadow-sm w-6 h-6 flex items-center justify-center z-10">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        `;
                        wrapper.appendChild(textarea);
                        
                        // 绑定删除事件（使用动态索引）
                        wrapper.querySelector('.home-delete-btn').onclick = (e) => {
                            e.stopPropagation();
                            const currentIdx = parseInt(wrapper.dataset.idx);
                            this.removeHomeItem(currentIdx);
                        };
                        
                        textBoxes.appendChild(wrapper);
                    } else if (item.type === 'entry-ref') {
                        // 传递 versionId 支持定向引用
                        textBoxes.appendChild(this.createHomeEntryRef(item.entryId, item.versionId, item.title, idx));
                    }
                });
            }
        }

        // 【新增】初始化首页分栏显示
        if (this.initHomeColumnControl) {
            this.initHomeColumnControl(clone);
        }
        
        container.appendChild(clone);
        
        // 【关键修复】DOM插入文档后，异步加载首页活动窗口头图
        // 必须在appendChild之后调用，否则getElementById找不到元素
        if (this.loadHomeEventBannerImages) {
            requestAnimationFrame(() => this.loadHomeEventBannerImages());
        }
    },

    // ========== 设置页面渲染（完整修复版） ==========
    renderSettings: function(container) {
        const tpl = document.getElementById('tpl-settings');
        if (!tpl) {
            console.error('[RenderSettings] 模板不存在');
            return;
        }
        const clone = tpl.content.cloneNode(true);
        
        // 基础设置
        const nameInput = clone.getElementById('setting-wiki-name');
        const subtitleInput = clone.getElementById('setting-wiki-subtitle');
        const welcomeTitleInput = clone.getElementById('setting-welcome-title');
        const welcomeSubtitleInput = clone.getElementById('setting-welcome-subtitle');
        
        if (nameInput) nameInput.value = this.data.settings.name || '';
        if (subtitleInput) subtitleInput.value = this.data.settings.subtitle || '';
        if (welcomeTitleInput) welcomeTitleInput.value = this.data.settings.welcomeTitle || '';
        if (welcomeSubtitleInput) welcomeSubtitleInput.value = this.data.settings.welcomeSubtitle || '';
        
        // 字体设置
        const fontSelect = clone.getElementById('setting-font');
        if (fontSelect) {
            fontSelect.value = this.data.settings.customFont || "'Noto Sans SC', sans-serif";
            if (this.data.settings.customFont === 'custom') {
                const customUpload = clone.getElementById('custom-font-upload');
                if (customUpload) customUpload.classList.remove('hidden');
            }
        }
        
        // 阵营管理
        const campList = clone.getElementById('camp-list');
        if (campList) {
            this.data.camps.forEach((camp, idx) => {
                const item = document.createElement('div');
                item.className = 'flex justify-between items-center p-2 bg-gray-50 rounded border border-gray-200';
                item.innerHTML = `
                    <span class="text-sm font-medium">${camp}</span>
                    <button onclick="app.deleteCamp(${idx})" class="text-gray-400 hover:text-red-500 w-6 h-6 flex items-center justify-center">
                        <i class="fa-solid fa-times text-xs"></i>
                    </button>
                `;
                campList.appendChild(item);
            });
        }
        
        // 公告管理
        const annList = clone.getElementById('announcement-list');
        if (annList) {
            this.data.announcements.forEach(ann => {
                const item = document.createElement('div');
                item.className = `flex justify-between items-center p-2 rounded border ${ann.isActive ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`;
                item.innerHTML = `
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                        ${ann.isActive ? '<span class="w-2 h-2 bg-orange-500 rounded-full"></span>' : ''}
                        <span class="text-sm truncate ${ann.isActive ? 'font-medium text-orange-800' : 'text-gray-600'}">${ann.title}</span>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="app.setActiveAnnouncement('${ann.id}')" class="text-xs px-2 py-1 ${ann.isActive ? 'bg-orange-200 text-orange-800' : 'bg-gray-200 text-gray-600'} rounded hover:opacity-80">
                            ${ann.isActive ? '当前' : '激活'}
                        </button>
                        <button onclick="app.editAnnouncement('${ann.id}')" class="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200">
                            编辑
                        </button>
                        <button onclick="app.deleteAnnouncement('${ann.id}')" class="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">
                            删除
                        </button>
                    </div>
                `;
                annList.appendChild(item);
            });
        }
        
        // 本地存储状态
        const localStatus = clone.getElementById('local-storage-status');
        const localDirName = clone.getElementById('local-dir-name');
        const localDirInfo = clone.getElementById('local-dir-info');
        const btnSelectDir = clone.getElementById('btn-select-local-dir');
        const btnForceSync = clone.getElementById('btn-force-sync');
        const localDirHint = clone.getElementById('local-dir-hint'); // 新增引用
        
        if (this.storageManager.localDirectory) {
            // 显示状态面板
            if (localStatus) localStatus.classList.remove('hidden');
            if (localDirInfo) localDirInfo.classList.remove('hidden');
            if (localDirName) localDirName.textContent = this.storageManager.localDirectory.name;
            if (btnSelectDir) {
                const statusSpan = btnSelectDir.querySelector('#local-dir-status');
                if (statusSpan) statusSpan.textContent = '更换工作文件夹';
            }
            if (btnForceSync) btnForceSync.classList.remove('hidden');
            if (localDirHint) localDirHint.textContent = '图片将实时同步到本地文件夹和浏览器缓存'; // 更新提示文本
            
            // 【关键修复】更新状态文本和指示器颜色
            const statusText = clone.getElementById('local-status-text');
            const statusIndicator = clone.getElementById('local-status-indicator');
            
            if (this.storageManager.hasDirectoryPermission) {
                // 已连接状态
                if (statusText) statusText.textContent = '已连接';
                if (statusText) statusText.classList.replace('text-gray-600', 'text-green-600');
                if (statusIndicator) {
                    statusIndicator.classList.remove('bg-gray-400', 'bg-yellow-400', 'bg-red-400');
                    statusIndicator.classList.add('bg-green-500');
                }
            } else {
                // 权限丢失状态
                if (statusText) statusText.textContent = '权限已过期（需重新绑定）';
                if (statusText) statusText.classList.replace('text-gray-600', 'text-yellow-600');
                if (statusIndicator) {
                    statusIndicator.classList.remove('bg-gray-400', 'bg-green-500');
                    statusIndicator.classList.add('bg-yellow-400');
                }
                if (btnSelectDir) {
                    const statusSpan = btnSelectDir.querySelector('#local-dir-status');
                    if (statusSpan) statusSpan.textContent = '重新授权访问';
                }
            }
            
            // 更新统计信息
            const statMemory = clone.getElementById('stat-memory');
            const statManifest = clone.getElementById('stat-manifest');
            const statLocal = clone.getElementById('stat-local');
            if (statMemory) statMemory.textContent = `${this.storageManager.memoryCache.size} 张`;
            if (statManifest) statManifest.textContent = `${Object.keys(this.storageManager.manifest.mappings).length} 张`;
            if (statLocal) statLocal.textContent = this.storageManager.hasDirectoryPermission ? '已同步' : '权限丢失';
            
        } else {
            // 未连接状态 - 确保显示正确的"未连接"状态
            if (localStatus) localStatus.classList.remove('hidden'); // 显示状态区域
            if (localDirInfo) localDirInfo.classList.add('hidden'); // 隐藏详细信息
            if (btnForceSync) btnForceSync.classList.add('hidden');
            
            // 重置为未连接状态
            const statusText = clone.getElementById('local-status-text');
            const statusIndicator = clone.getElementById('local-status-indicator');
            if (statusText) {
                statusText.textContent = '未连接';
                statusText.classList.remove('text-green-600', 'text-yellow-600');
                statusText.classList.add('text-gray-600');
            }
            if (statusIndicator) {
                statusIndicator.classList.remove('bg-green-500', 'bg-yellow-400', 'bg-red-400');
                statusIndicator.classList.add('bg-gray-400');
            }
        }
                
                // 导出标记设置加载
                const markEnabled = clone.getElementById('export-mark-enabled');
                const markText = clone.getElementById('export-mark-text');
                if (markEnabled && markText) {
                    const mark = this.data.settings?.exportMark;
                    if (mark) {
                        markEnabled.checked = mark.enabled || false;
                        markText.value = mark.text || '';
                        // 【新增】加载标记图片预览
                        if (mark.image && app._updateMarkImagePreview) {
                            setTimeout(() => app._updateMarkImagePreview(mark.image), 50);
                        }
                    }
                }

                container.appendChild(clone);
            },

    // ========== 详情与编辑渲染（简略实现） ==========
    // ==================== 辅助函数（GitHub版同步） ====================
    escapeHtml: function(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    resolveImageUrl: function(imgRef) {
        if (!imgRef) return '';
        if (imgRef.startsWith('data:')) return imgRef;
        if (imgRef.startsWith('blob:')) return imgRef;
        if (imgRef.startsWith('http')) return imgRef;
        if (imgRef.startsWith('{{IMG:')) {
            const match = imgRef.match(/\{\{IMG:(.+?)\}\}/);
            if (match && match[1]) {
                // 【桌面版】优先使用内存缓存中的实际 URL（blob/data），否则图片会因
                // GitHub 相对路径（./data/wiki-images/）在桌面版中不存在而无法显示
                try {
                    if (this.storageManager && this.storageManager.memoryCache && this.storageManager.memoryCache.has(match[1])) {
                        const cached = this.storageManager.memoryCache.get(match[1]);
                        if (cached && (cached.startsWith('blob:') || cached.startsWith('data:'))) return cached;
                    }
                } catch (e) {}
                return './data/wiki-images/' + match[1];
            }
        }
        return imgRef;
    },

    /**
     * 【关键修复】异步解析图片引用，支持从 OPFS/本地文件夹/localStorage 按需加载
     * 用于解决 {{IMG:filename}} 引用在 imageCache 恢复失败时无法显示的问题
     */
    resolveImageUrlAsync: async function(imgRef) {
        if (!imgRef) return '';
        if (imgRef.startsWith('data:')) return imgRef;
        if (imgRef.startsWith('blob:')) return imgRef;
        if (imgRef.startsWith('http')) return imgRef;
        if (imgRef.startsWith('{{IMG:')) {
            const match = imgRef.match(/\{\{IMG:(.+?)\}\}/);
            if (match && match[1] && this.storageManager) {
                try {
                    const url = await this.storageManager.loadImage(match[1]);
                    return url || '';
                } catch (e) {
                    console.warn('[resolveImageUrlAsync] 加载图片失败:', match[1], e.message);
                    return '';
                }
            }
        }
        return imgRef;
    },

    /**
     * 【关键修复】异步加载活动页词条头图到详情页
     * 支持 dataUrl 和 {{IMG:filename}} 引用从 OPFS/本地文件夹加载
     */
    /**
     * 【关键修复】异步加载活动词条内容中的图片元件
     * 扫描 contentEl 中的 img[data-img-ref] 元素，对 {{IMG:}} 引用异步加载实际图片
     */
    _loadEventBlockImages: async function(contentEl) {
        if (!contentEl || !this.storageManager) return;
        const imgs = contentEl.querySelectorAll('img[data-img-ref^="{{IMG:"]');
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
                    // 隐藏对应的错误提示
                    const failMsg = img.parentElement.querySelector('.event-img-fail-msg');
                    if (failMsg) failMsg.classList.add('hidden');
                }
            } catch (e) {
                console.warn('[_loadEventBlockImages] 加载失败:', match[1], e.message);
                img.classList.add('event-img-failed');
            }
        }
    },

    _loadEventHeaderAsync: async function(headerImgRef, title) {
        if (!headerImgRef) return;
        const imgEl = document.getElementById('event-detail-header-img');
        const container = document.getElementById('event-detail-header');
        if (!imgEl) return;
        // dataUrl 直接使用
        if (headerImgRef.startsWith('data:') || headerImgRef.startsWith('http')) {
            imgEl.src = headerImgRef;
            if (container) container.classList.remove('hidden');
            return;
        }
        // {{IMG:filename}} 异步加载
        if (headerImgRef.startsWith('{{IMG:') && this.storageManager) {
            const match = headerImgRef.match(/\{\{IMG:(.+?)\}\}/);
            if (match) {
                try {
                    const url = await this.storageManager.loadImage(match[1]);
                    if (url) {
                        imgEl.src = url;
                        imgEl.classList.remove('event-img-failed');
                        if (container) container.classList.remove('hidden');
                    } else {
                        console.warn('[_loadEventHeaderAsync] loadImage返回空:', match[1]);
                        if (container) container.classList.add('hidden');
                    }
                } catch (e) {
                    console.warn('[_loadEventHeaderAsync] 头图加载失败:', match[1], e.message);
                    if (container) container.classList.add('hidden');
                }
            }
        }
    },

    findEntry: function(idOrCode) {
        if (!idOrCode) return null;
        const cleanId = String(idOrCode).trim();
        let entry = this.data.entries.find(e => String(e.id).trim() === cleanId);
        if (!entry) {
            entry = this.data.entries.find(e => e.code === cleanId);
        }
        return entry;
    },

    parseContentText: function(text) {
        if (!text) return '';
        let html = this.escapeHtml(text);
        // 0. 【新增】外链格式 [[显示文本|url:https://...]]（必须在步骤1之前处理）
        html = html.replace(/\[\[([^\]|]+)\|url:([^\]]+)\]\]/g, (match, displayText, url) => {
            const cleanUrl = url.trim();
            const cleanText = displayText.trim();
            return '<a href="' + cleanUrl + '" class="entry-external-link" target="_blank" rel="noopener noreferrer" onclick="app.confirmExternalLink(event, \'' + cleanUrl.replace(/'/g, "\\'") + '\'); return false;"><i class="fa-solid fa-arrow-up-right-from-square text-xs mr-1"></i>' + cleanText + '</a>';
        });
        // 1. 词条链接 - 新格式 [[entryId|versionId:displayText]]
        html = html.replace(/\[\[([^\]|]+)\|([^:\]]+):([^\]]+)\]\]/g, (match, entryId, versionId, displayText) => {
            const cleanEntryId = entryId.trim();
            const cleanVersionId = versionId.trim();
            const cleanDisplayText = displayText.trim();
            const entry = this.findEntry(cleanEntryId);
            if (entry && entry.versions) {
                const version = entry.versions.find(v => v.vid === cleanVersionId);
                const actualVid = version ? version.vid : (entry.versions[0]?.vid || '');
                return `<a href="javascript:void(0)" class="entry-index-link" data-entry-id="${entry.id}" data-version-id="${actualVid}" onclick="app.openEntryWithVersion('${entry.id}', '${actualVid}'); return false;">${cleanDisplayText}</a>`;
            }
            return `<span class="text-red-400" title="词条未找到">[[${cleanDisplayText}]]</span>`;
        });
        // 2. 词条链接 - 旧格式 [[entryIdOrCode:displayText]]
        html = html.replace(/\[\[([^\]|]+):([^\]]+)\]\]/g, (match, entryIdOrCode, displayText) => {
            const cleanId = entryIdOrCode.trim();
            const cleanDisplayText = displayText.trim();
            const entry = this.findEntry(cleanId);
            if (entry && entry.versions && entry.versions.length > 0) {
                const firstVersion = entry.versions[0];
                return `<a href="javascript:void(0)" class="entry-index-link" data-entry-id="${entry.id}" data-version-id="${firstVersion.vid}" onclick="app.openEntryWithVersion('${entry.id}', '${firstVersion.vid}'); return false;">${cleanDisplayText}</a>`;
            }
            return `<span class="text-red-400" title="词条未找到">[[${cleanDisplayText}]]</span>`;
        });
        // 3. 旧格式 [[title]]
        html = html.replace(/\[\[([^\]|]+)\]\]/g, (match, title) => {
            if (match.includes('|') || match.includes(':')) return match;
            const cleanTitle = title.trim();
            const entry = this.data.entries.find(e => {
                const v = this.getVisibleVersion(e);
                return v && v.title === cleanTitle;
            });
            if (entry && entry.versions.length > 0) {
                const firstVersion = entry.versions[0];
                return `<a href="javascript:void(0)" class="entry-index-link" data-entry-id="${entry.id}" data-version-id="${firstVersion.vid}" onclick="app.openEntryWithVersion('${entry.id}', '${firstVersion.vid}'); return false;">${cleanTitle}</a>`;
            }
            return `<span class="text-gray-400">[[${cleanTitle}]]</span>`;
        });
        // 4. 角色引用 @名字[代码]
        html = html.replace(/@([^\[]+)\[([^\]]+)\]/g, (match, name, code) => {
            const cleanName = name.trim();
            const cleanCode = code.replace(/\\/g, '').trim();
            const entry = this.data.entries.find(e => e.code === cleanCode);
            if (entry) {
                return `<span class="synopsis-entry-ref" onclick="app.openEntry('${entry.id}')"><i class="fa-solid fa-user text-xs mr-1"></i>${cleanName}</span>`;
            }
            return `<span class="synopsis-entry-ref"><i class="fa-solid fa-user text-xs mr-1"></i>${cleanName}</span>`;
        });
        // 5. 剧情引用 {{synopsis:chapterId:title}}
        html = html.replace(/\{\{synopsis:([^:]+):([^}]+)\}\}/g, (match, chapterId, title) => {
            const cleanChapterId = chapterId.trim();
            const cleanTitle = title.trim();
            const chapter = this.data.synopsis.find(s => s.id === cleanChapterId);
            if (chapter) {
                return `<span class="synopsis-entry-ref" data-chapter-id="${cleanChapterId}" onmouseenter="app.handleSynopsisRefHover(this)" onmouseleave="app.handleSynopsisRefLeave(this)" onclick="app.handleSynopsisRefClick(this)"><i class="fa-solid fa-film text-xs mr-1"></i>${cleanTitle}</span>`;
            }
            return match;
        });
        // 6. Markdown 样式
        html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
        html = html.replace(/__(.+?)__/g, '<u>$1</u>');
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
        // 7. 换行符
        html = html.replace(/\n/g, '<br>');
        return html;
    },

    // ========== 外链跳转二次确认 ==========
    _pendingExternalUrl: null,

    confirmExternalLink: function(event, url) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this._pendingExternalUrl = url;
        const modal = document.getElementById('external-link-confirm-modal');
        const urlDisplay = document.getElementById('external-link-url-display');
        if (modal && urlDisplay) {
            urlDisplay.textContent = url;
            modal.classList.remove('hidden');
        }
    },

    cancelExternalLink: function() {
        this._pendingExternalUrl = null;
        const modal = document.getElementById('external-link-confirm-modal');
        if (modal) modal.classList.add('hidden');
    },

    proceedExternalLink: function() {
        const modal = document.getElementById('external-link-confirm-modal');
        if (modal) modal.classList.add('hidden');
        if (this._pendingExternalUrl) {
            window.open(this._pendingExternalUrl, '_blank', 'noopener,noreferrer');
            this._pendingExternalUrl = null;
        }
    },

    parseInlineMarkdown: function(text) {
        if (!text) return '';
        let html = this.escapeHtml(text);
        html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
        html = html.replace(/__(.+?)__/g, '<u>$1</u>');
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
        html = html.replace(/\n/g, '<br>');
        return html;
    },

    // 【辅助】从 storageManager manifest 中通过 chapterId 查找 synopsis 图片 filename
    _findSynopsisFilename: function(chapterId) {
        if (!this.storageManager || !this.storageManager.manifest || !this.storageManager.manifest.mappings) return null;
        for (const [filename, meta] of Object.entries(this.storageManager.manifest.mappings)) {
            if (meta.type === 'synopsis' && meta.chapterId === chapterId) {
                return filename;
            }
        }
        return null;
    },

    openBodyEntry: function(chapterId) {
        let bodyEntry = this.data.entries.find(e => e.type === 'body' && e.versions[0]?.chapterFrom === chapterId);
        // 没有正文词条时：编辑模式自动创建，查看模式提示
        if (!bodyEntry) {
            if (this.data.currentMode === 'edit') {
                const chapter = this.data.chapters.find(c => c.id === chapterId);
                const chNum = chapter ? chapter.num : '';
                const chTitle = chapter ? (chapter.title || `第${chNum}章`) : '';
                bodyEntry = {
                    id: 'body-' + chapterId + '-' + Date.now(),
                    type: 'body',
                    code: 'body-' + chapterId,
                    level: 1,
                    versions: [{
                        vid: 'body-v1-' + Date.now(),
                        title: chTitle || '正文',
                        subtitle: '',
                        image: '',
                        images: { card: '', avatar: '' },
                        birthday: '',
                        age: '',
                        height: '',
                        cv: '',
                        relationDesc: '',
                        characterTags: [],
                        camp: '',
                        storyArc: '',
                        relatedCharacters: [],
                        content: '',
                        indexCards: [],
                        isDraft: false,
                        chapterFrom: chapterId
                    }]
                };
                this.data.entries.push(bodyEntry);
                this.saveData();
                this.showToast('已创建正文词条，开始编辑', 'success');
            } else {
                this.showToast('该章节暂无正文词条', 'warning'); return;
            }
        }
        // 【回到xx】正文词条间跳转（上一章/下一章）清空记录；从非正文词条查看正文则记录
        if (this.data.editingId) {
            const currentEntry = this.data.entries.find(e => e.id === this.data.editingId);
            if (currentEntry && currentEntry.type === 'body') {
                this._clearPreviousEntry();
            } else if (currentEntry) {
                this._recordPreviousEntry();
            }
        }
        this.openEntry(bodyEntry.id);
    },

    navigateBodyEntry: function(direction) {
        const entry = this.data.entries.find(e => e.id === this.data.editingId);
        if (!entry || entry.type !== 'body' || !entry.versions[0]) return;
        const currentChapterId = entry.versions[0].chapterFrom;
        const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
        const currentIdx = sortedChapters.findIndex(ch => ch.id === currentChapterId);
        if (currentIdx === -1) return;
        const newIdx = currentIdx + direction;
        if (newIdx < 0 || newIdx >= sortedChapters.length) {
            this.showToast('已经是' + (direction < 0 ? '第一章' : '最后一章'), 'info');
            return;
        }
        this.openBodyEntry(sortedChapters[newIdx].id);
    },

    // 【回到xx】记录当前查看的词条作为"来源"（在跳转到新词条前调用）
    _recordPreviousEntry: function() {
        if (this.data.editingId) {
            const currentEntry = this.data.entries.find(e => e.id === this.data.editingId);
            if (currentEntry) {
                // 【关键】优先使用 viewingVersionId 获取实际查看的版本名称
                // 避免 getVisibleVersion 受 currentTimeline 影响返回不同版本
                let currentVersion = this.data.viewingVersionId
                    ? currentEntry.versions.find(v => v.vid === this.data.viewingVersionId)
                    : null;
                if (!currentVersion) currentVersion = this.getVisibleVersion(currentEntry);
                this.data.previousEntryId = this.data.editingId;
                this.data.previousEntryName = currentVersion?.title || currentEntry.code;
                this.data.previousEntryType = currentEntry.type;
                // 记录离开时查看的版本ID，确保返回时显示同一版本
                this.data.previousVersionId = this.data.viewingVersionId || currentVersion?.vid || null;
                // 记录版本首次出现章节（用于显示标注）
                const chapterFrom = currentVersion?.chapterFrom;
                if (chapterFrom) {
                    const ch = this.data.chapters.find(c => c.id === chapterFrom);
                    this.data.previousEntryChapter = ch ? this.formatChapterNum(ch.num) : null;
                } else {
                    this.data.previousEntryChapter = null;
                }
            }
        }
    },

    // 【回到xx】清空记录（回到首页/列表页时调用）
    _clearPreviousEntry: function() {
        this.data.previousEntryId = null;
        this.data.previousEntryName = null;
        this.data.previousEntryType = null;
        this.data.previousEntryChapter = null;
        this.data.previousVersionId = null;
    },

    goBackToPrevious: function() {
        if (this.data.previousEntryId) {
            const prevId = this.data.previousEntryId;
            const prevVersionId = this.data.previousVersionId;
            // 【关键】使用"回到"后清空记录，不保留链式跳转
            this._clearPreviousEntry();
            // 如果有版本ID记录，使用openEntryWithVersion打开特定版本
            if (prevVersionId) {
                this.openEntryWithVersion(prevId, prevVersionId);
            } else {
                this.openEntry(prevId);
            }
        }
    },

    // ==================== 详情页渲染（GitHub版正文词条样式同步） ====================
    renderDetail: function(container) {
        // 【关键】清空容器，防止标签页反复切换时模板累积堆叠
        if (container) container.innerHTML = '';
        const entry = this.data.entries.find(e => e.id === this.data.editingId);
        if (!entry) {
            container.innerHTML = '<div class="p-4 text-red-600">\u4f60\u8981\u627e\u7684\u4e1c\u897f\u597d\u50cf\u6d88\u5931\u60f9~\uff08\u6761\u76ee\u4e0d\u5b58\u5728\u6216\u5df2\u88ab\u5220\u9664\uff09</div>';
            return;
        }

        // 【功能4】隐藏词条：详情页黑底白字
        const hiddenCfg = this.data.settings?.hiddenCategory;
        const isHiddenEntry = hiddenCfg?.entries?.includes(entry.id);
        if (isHiddenEntry) {
            container.classList.add('hidden-entry-detail');
        } else {
            container.classList.remove('hidden-entry-detail');
        }

        // 【功能4】【关键修复】统一密码检查（覆盖所有绕过openEntry的路径：版本切换、搜索、未来词条等）
        // 在非编辑模式下，如果当前正在要求输入密码，则阻止渲染
        if (isHiddenEntry && this.data.currentMode !== 'edit') {
            const pwCfg = hiddenCfg?.entryPasswords?.[entry.id];
            if (pwCfg && pwCfg.answers && pwCfg.answers.length > 0) {
                const pwKey = 'hidden_pw_' + entry.id;
                const canSkip = pwCfg.alwaysRequired === false && sessionStorage.getItem(pwKey) === 'ok';
                // 【修复】重置可能残留的密码检查标记，避免首次进入被错误跳过
                if (this._pwCheckingEntryId && this._pwCheckingEntryId !== entry.id) {
                    this._pwCheckingEntryId = null;
                }
                if (!canSkip && this._pwCheckingEntryId !== entry.id) {
                    // 显示密码检查
                    this._pwCheckingEntryId = entry.id;
                    const visibleVersion = this.getVisibleVersion(entry);
                    const entryName = visibleVersion ? visibleVersion.title : entry.code;
                    const returnView = this.data.currentView;
                    const tryPassword = (answer) => {
                        if (!answer || answer.trim() === '') {
                            app.showPasswordDialog(pwCfg.hint || '请输入密码', tryPassword, () => {
                                this._pwCheckingEntryId = null;
                                this._returnFromPasswordLock(returnView, entry);
                            }, '请输入口令后再确认', entryName, entry.id);
                            return;
                        }
                        const isCorrect = pwCfg.answers.some(a => a.trim() === answer.trim());
                        if (isCorrect) {
                            sessionStorage.setItem(pwKey, 'ok');
                            this._pwCheckingEntryId = null;
                            this._clearPasswordLock();
                            // 直接继续渲染（不经过router循环）
                            this._renderDetailInternal(container, entry);
                        } else {
                            let errorMsg = pwCfg.defaultMessage || '不对啦！';
                            if (pwCfg.rules) {
                                for (const rule of pwCfg.rules) {
                                    if (rule.condition === 'equals' && answer.trim() === rule.answer) { errorMsg = rule.message; break; }
                                    else if (rule.condition === 'includes' && answer.includes(rule.answer)) { errorMsg = rule.message; break; }
                                }
                            }
                            app.showPasswordDialog(pwCfg.hint || '请输入密码', tryPassword, () => {
                                this._pwCheckingEntryId = null;
                                this._returnFromPasswordLock(returnView, entry);
                            }, errorMsg, entryName, entry.id);
                        }
                    };
                    this._showPasswordLock(entryName);
                    app.showPasswordDialog(pwCfg.hint || '请输入密码', tryPassword, () => {
                        this._pwCheckingEntryId = null;
                        this._returnFromPasswordLock(returnView, entry);
                    }, null, entryName, entry.id);
                    return; // 阻止渲染，密码通过后通过 _renderDetailInternal 继续
                }
            }
        } else if (!isHiddenEntry) {
            // 非隐藏词条清除密码检查标记
            this._pwCheckingEntryId = null;
        }

        // 正常渲染（无需密码或密码已通过）
        this._renderDetailInternal(container, entry);
    },

    /**
     * 【功能4】renderDetail 的内部渲染逻辑（提取出来供密码检查后调用）
     */
    _renderDetailInternal: function(container, entry) {

        // 【GitHub版同步】正文词条特殊处理
        const isBodyEntry = entry.type === 'body';
        const bodyChapter = isBodyEntry ? this.data.chapters.find(ch => ch.id === entry.versions[0]?.chapterFrom) : null;
        const bodySynopsis = isBodyEntry && bodyChapter ? this.data.synopsis.find(s => s.chapterId === bodyChapter.id || s.id === bodyChapter.id) : null;

        // 【修复】使用宽松比较避免数字/字符串类型不匹配导致找不到版本
        let version = entry.versions.find(v => String(v.vid) === String(this.data.viewingVersionId)) ||
                      this.getVisibleVersion(entry) ||
                      entry.versions[entry.versions.length - 1];
        if (!version) {
            container.innerHTML = '<div class="p-4 text-red-600">\u8be5\u6761\u76ee\u6ca1\u6709\u5185\u5bb9\u7248\u672c</div>';
            return;
        }

        // 同步更新 viewingVersionId
        this.data.viewingVersionId = version.vid;

        const tpl = document.getElementById('tpl-detail-view');
        if (!tpl) return;
        const clone = tpl.content.cloneNode(true);

        const codeEl = clone.getElementById('detail-code');
        const versionBadge = clone.getElementById('detail-version-badge');
        const versionName = clone.getElementById('detail-version-name');
        const contentEl = clone.getElementById('detail-content');

        if (codeEl) codeEl.textContent = entry.code;

        // 【GitHub版同步】正文词条重要程度标签
        if (isBodyEntry) {
            const importanceLabels = { 1: ['\u91cd\u8981\u7ae0\u8282', 'bg-orange-100 text-orange-700 border-orange-200'], 2: ['\u7279\u6b8a\u7ae0\u8282', 'bg-purple-100 text-purple-700 border-purple-200'], 3: ['\u4e00\u822c\u7ae0\u8282', 'bg-gray-100 text-gray-500 border-gray-200'] };
            const label = importanceLabels[version.level] || importanceLabels[3];
            const badge = document.createElement('span');
            badge.className = `ml-2 inline-block px-2 py-0.5 text-xs rounded-full border ${label[1]}`;
            badge.textContent = label[0];
            codeEl.parentNode.insertBefore(badge, codeEl.nextSibling);
        }

        // 【GitHub版同步】正文词条不显示版本切换
        if (versionBadge && versionName && entry.versions.length > 1 && !isBodyEntry) {
            versionBadge.classList.remove('hidden');
            const vIndex = entry.versions.findIndex(v => v.vid === version.vid);
            versionName.textContent = `\u7248\u672c ${vIndex + 1}/${entry.versions.length}`;
        }

        // 处理图片
        let cardImg = version.images?.card || version.images?.avatar || version.image;
        // 【关键】解析 {{IMG:}} 引用为可加载 URL（桌面版：内存缓存 blob/data；GitHub版：相对路径）
        if (cardImg && cardImg.startsWith('{{IMG:')) {
            cardImg = this.resolveImageUrl(cardImg);
        }
        // 【GitHub版同步】正文词条默认使用剧情梗概图片
        if (isBodyEntry && bodySynopsis && bodySynopsis.image) {
            cardImg = bodySynopsis.image;
            if (cardImg && cardImg.startsWith('{{IMG:')) {
                cardImg = this.resolveImageUrl(cardImg);
            }
        }
        // 【回溯修复】剧情梗概图片直接存储 data URL，简单可靠，直接使用
        const hasImage = cardImg && (cardImg.startsWith('data:') || cardImg.startsWith('http') || cardImg.startsWith('blob:'));

        // 【GitHub版同步】正文词条剧情梗概文本处理
        let synopsisHtmlGh = '';
        if (isBodyEntry && bodySynopsis) {
            try {
                synopsisHtmlGh = this.parseContentText(bodySynopsis.content || '\u6682\u65e0\u6982\u8981\u5185\u5bb9');
            } catch (e) {
                console.warn('[renderDetail] parseContentText \u5931\u8d25:', e);
                synopsisHtmlGh = bodySynopsis.content || '\u6682\u65e0\u6982\u8981\u5185\u5bb9';
            }
        }

        // 标题区域
        let headerHtml = `<div class="flex-1 min-w-0">
            <h1 class="text-3xl font-bold text-gray-900 mb-3 leading-tight">${this.escapeHtml(version.title)}</h1>
            ${version.subtitle && !isBodyEntry ? `<div class="text-lg italic text-gray-600 border-l-4 border-indigo-300 pl-4 leading-relaxed" style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;">${this.parseInlineMarkdown(this.escapeHtml(version.subtitle))}</div>` : ''}
            ${isBodyEntry && bodySynopsis ? `<div class="text-sm text-gray-500 border-l-4 border-gray-300 pl-4 leading-relaxed bg-gray-50/50 p-3 rounded-r-lg">
                <div class="text-xs text-gray-400 mb-1 font-medium"><i class="fa-solid fa-book-open mr-1"></i>\u5267\u60c5\u6982\u62ec</div>
                <div style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;">${synopsisHtmlGh}</div>
            </div>` : ''}
        </div>`;

        // 【GitHub版同步】正文词条图片：原比例、居中、独立一行
        const imageHtml = hasImage ? (isBodyEntry ? `<div class="w-full max-w-2xl mx-auto my-6">
            <div class="rounded-xl overflow-hidden shadow-lg bg-gray-100 border border-gray-200">
                <img src="${cardImg}" class="w-full h-auto object-contain" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\'w-full h-48 flex items-center justify-center text-gray-300\'><i class=\'fa-solid fa-image text-4xl\'></i></div>'" alt="${this.escapeHtml(version.title)}">
            </div>
        </div>` : `<div class="w-56 shrink-0">
            <div class="aspect-[3/4] rounded-xl overflow-hidden shadow-lg bg-gray-100 border border-gray-200 sticky top-24">
                <img src="${cardImg}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\'w-full h-full flex items-center justify-center text-gray-300\'><i class=\'fa-solid fa-image text-4xl\'></i></div>'" alt="${this.escapeHtml(version.title)}">
            </div>
            ${entry.level <= 2 ? `<div class="text-center mt-3"><span class="inline-block px-4 py-1.5 ${entry.level === 1 ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-blue-100 text-blue-800 border-blue-200'} border rounded-full text-sm font-bold">${entry.level === 1 ? '\u2605 \u4e3b\u89d2' : '\u91cd\u8981\u89d2\u8272'}</span></div>` : ''}
        </div>`) : '';

        // 内容渲染
        let contentBlocksHtml = '<div class="prose prose-sm max-w-none mt-6">';
        if (version.blocks && version.blocks.length > 0) {
            version.blocks.forEach(block => {
                if (block.type === 'h2') {
                    const textWithBreaks = (block.text || '').replace(/\n/g, '<br>');
                    contentBlocksHtml += `<h2 class="text-2xl font-bold text-gray-800 mt-8 mb-4 border-b pb-2 break-words">${textWithBreaks}</h2>`;
                } else if (block.type === 'h3') {
                    const textWithBreaks = (block.text || '').replace(/\n/g, '<br>');
                    contentBlocksHtml += `<h3 class="text-lg font-semibold text-gray-700 mt-6 mb-3 break-words">${textWithBreaks}</h3>`;
                } else if (block.type === 'p') {
                    let text = block.text || '';
                    text = this.parseContentText(text);
                    contentBlocksHtml += `<p class="text-gray-600 leading-relaxed mb-4" style="white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;">${text}</p>`;
                } else if (block.type === 'img') {
                    // 【新增】图片元件渲染（查看模式）
                    const imgRef = block.src || '';
                    const imgUrl = this.resolveImageUrl(imgRef);
                    const caption = block.caption || '';
                    if (imgUrl) {
                        contentBlocksHtml += `<div class="my-4 text-center"><img src="${imgUrl}" alt="${this.escapeHtml(caption)}" class="max-w-full rounded-lg shadow" style="max-height:400px;" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\'text-gray-400 py-4\'><i class=\'fa-solid fa-image text-2xl\'></i><p class=\'text-xs mt-1\'>图片加载失败</p></div>'"></div>`;
                        if (caption) {
                            contentBlocksHtml += `<div class="text-center text-xs text-gray-500 italic -mt-2 mb-4">${this.escapeHtml(caption)}</div>`;
                        }
                    }
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
                        contentBlocksHtml += '<div class="overflow-x-auto my-4"><table class="w-full border-collapse bg-white rounded-lg overflow-hidden shadow-sm" style="table-layout:fixed;">';
                        contentBlocksHtml += '<thead class="bg-gray-100"><tr>';
                        (rows[0] || []).forEach((cell, cIdx) => {
                            const cs = colspans[0] && colspans[0][cIdx] > 1 ? ' colspan="' + colspans[0][cIdx] + '"' : '';
                            contentBlocksHtml += '<th class="border border-gray-200 p-2 text-xs text-gray-700 font-semibold"' + cs + _cellViewStyle(0, cIdx) + '>' + this.parseInlineMarkdown(this.escapeHtml(cell)) + '</th>';
                        });
                        contentBlocksHtml += '</tr></thead><tbody>';
                        for (let r = 1; r < rows.length; r++) {
                            contentBlocksHtml += '<tr>';
                            (rows[r] || []).forEach((cell, cIdx) => {
                                const cs = colspans[r] && colspans[r][cIdx] > 1 ? ' colspan="' + colspans[r][cIdx] + '"' : '';
                                contentBlocksHtml += '<td class="border border-gray-200 p-2 text-sm text-gray-600"' + cs + _cellViewStyle(r, cIdx) + '>' + this.parseInlineMarkdown(this.escapeHtml(cell)) + '</td>';
                            });
                            contentBlocksHtml += '</tr>';
                        }
                        contentBlocksHtml += '</tbody></table></div>';
                    }
                }
            });
        } else {
            contentBlocksHtml += '<div class="text-gray-400 italic">暂无详细内容</div>';
        }
        contentBlocksHtml += '</div>';

        if (contentEl) {
            // 【新增】活动页词条独立渲染：头图在上 → 大标题+活动时间在下 → 内容块
            if (entry.type === 'event') {
                let eventHtml = '';
                // 1. 头图（在上）- 使用占位符，异步加载实际图片
                const headerImgRef = entry.headerImage || '';  // 声明在函数作用域顶层
                eventHtml += `<div id="event-detail-header" class="w-full rounded-xl overflow-hidden shadow-lg bg-gray-100 border border-gray-200 mb-4">
                    <img id="event-detail-header-img" src="" class="w-full object-cover" style="aspect-ratio:21/9;" alt="${this.escapeHtml(version.title)}" onerror="this.style.display='none'; this.parentElement.classList.add('hidden');">
                </div>`;
                // 2. 大标题 + 活动时间
                let dateText = '';
                const dur = entry.duration;
                if (!dur || dur.type === 'permanent') {
                    dateText = '常态上线';
                } else if (dur.type === 'period' && dur.startDate && dur.endDate) {
                    const s = new Date(dur.startDate); const e = new Date(dur.endDate);
                    const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    dateText = `${fmt(s)} ~ ${fmt(e)}`;
                }
                eventHtml += `<div class="mb-4">
                    <h1 class="text-3xl font-bold text-gray-900 leading-tight mb-2">${this.escapeHtml(version.title)}</h1>
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                        <span class="font-mono bg-gray-100 px-2 py-0.5 rounded">${entry.code}</span>
                        <span><i class="fa-regular fa-calendar mr-1"></i>${dateText}</span>
                    </div>
                </div>`;
                // 3. 内容块
                if (this.renderEventDetail) {
                    eventHtml += this.renderEventDetail(version);
                }
                contentEl.innerHTML = eventHtml;
                // 【头图/图片异步加载见下方：必须在appendChild之后调用】
            } else if (isBodyEntry) {
                // 【GitHub版同步】正文词条：图片独立居中；其他词条：标题+图片并排
                contentEl.innerHTML = `${headerHtml}${imageHtml}${contentBlocksHtml}`;
            } else {
                contentEl.innerHTML = `<div class="flex flex-col md:flex-row gap-6 mb-2">${headerHtml}${imageHtml}</div>${contentBlocksHtml}`;
            }
        }

        // 【回到xx】显示"回到来源词条"按钮（不显示当前词条自己）
        const backBtnArea = clone.getElementById('back-to-prev-btn-area');
        if (backBtnArea && this.data.previousEntryId && this.data.previousEntryName && this.data.previousEntryId !== entry.id) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition text-xs flex items-center gap-1 border border-indigo-200';
            // 添加首次出现章节标注（如有时）
            const chapterLabel = this.data.previousEntryChapter ? ` <span class="text-[10px] text-gray-400 ml-0.5">\u00b7${this.escapeHtml(this.data.previousEntryChapter)}</span>` : '';
            prevBtn.innerHTML = `<i class="fa-solid fa-reply"></i> \u56de\u5230'${this.escapeHtml(this.data.previousEntryName)}'${chapterLabel}`;
            prevBtn.onclick = () => this.goBackToPrevious();
            backBtnArea.appendChild(prevBtn);
        }

        // 【新增】活动页词条：隐藏相关角色、版本切换等不适用的区块
        const relatedSection = clone.getElementById('related-characters-section');
        const relatedList = clone.getElementById('related-characters-list');
        if (entry.type === 'event') {
            const versionHint = clone.getElementById('version-switch-hint');
            const versionBadge = clone.getElementById('detail-version-badge');
            if (relatedSection) relatedSection.classList.add('hidden');
            if (versionHint) versionHint.classList.add('hidden');
            if (versionBadge) versionBadge.classList.add('hidden');
        }
        if (relatedSection && relatedList && version.relatedCharacters?.length > 0) {
            // 【GitHub版同步】正文词条只显示角色与设定关联
            const validRelations = isBodyEntry ? version.relatedCharacters.filter(rc => {
                const relatedEntry = this.data.entries.find(e => e.id === rc.charId);
                return relatedEntry && (relatedEntry.type === 'character' || relatedEntry.type === 'non-character');
            }) : version.relatedCharacters;
            if (validRelations.length > 0) {
                relatedSection.classList.remove('hidden');
                const relatedTitle = relatedSection.querySelector('h3');
                if (relatedTitle && isBodyEntry) relatedTitle.innerHTML = '<i class="fa-solid fa-users text-indigo-500 mr-2"></i>\u76f8\u5173\u89d2\u8272\u4e0e\u8bbe\u5b9a';
                validRelations.forEach(rc => {
                    const charEntry = this.data.entries.find(e => e.id === rc.charId);
                    if (!charEntry) return;
                    const charVersion = this.getVisibleVersion(charEntry);
                    const tag = document.createElement('span');
                    tag.className = 'inline-flex items-center gap-1 px-3 py-1 bg-gray-100 hover:bg-indigo-100 rounded-full text-xs cursor-pointer transition';
                    tag.innerHTML = `<span class="font-medium">${this.escapeHtml(charVersion?.title || charEntry.code)}</span><span class="text-gray-400">\u00b7${this.escapeHtml(rc.relationName)}</span>`;
                    tag.onclick = () => this.openEntry(charEntry.id);
                    relatedList.appendChild(tag);
                });
            }
        }

        // 【GitHub版同步】正文词条章节导航
        if (isBodyEntry && bodyChapter) {
            const navDiv = document.createElement('div');
            navDiv.className = 'mt-6 flex items-center justify-between bg-gray-50 rounded-lg p-4 border border-gray-200';
            const sortedChapters = [...this.data.chapters].sort((a, b) => a.order - b.order);
            const currentIdx = sortedChapters.findIndex(ch => ch.id === bodyChapter.id);
            const prevChapter = currentIdx > 0 ? sortedChapters[currentIdx - 1] : null;
            const nextChapter = currentIdx < sortedChapters.length - 1 ? sortedChapters[currentIdx + 1] : null;
            navDiv.innerHTML = `
                <button onclick="app.navigateBodyEntry(-1)" class="flex items-center gap-2 px-4 py-2 rounded-lg transition ${prevChapter ? 'text-indigo-600 hover:bg-indigo-50' : 'text-gray-300 cursor-not-allowed'}" ${!prevChapter ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i><div class="text-left"><div class="text-xs opacity-70">\u4e0a\u4e00\u7ae0</div><div class="text-sm font-medium">${prevChapter ? this.escapeHtml(prevChapter.title || this.formatChapterNum(prevChapter.num)) : '\u65e0'}</div></div></button>
                <div class="text-center"><div class="text-xs text-gray-400">${this.escapeHtml(this.formatChapterNum(bodyChapter.num))}</div>${bodyChapter.title ? `<div class="text-sm font-bold text-gray-700">${this.escapeHtml(bodyChapter.title)}</div>` : ''}</div>
                <button onclick="app.navigateBodyEntry(1)" class="flex items-center gap-2 px-4 py-2 rounded-lg transition ${nextChapter ? 'text-indigo-600 hover:bg-indigo-50' : 'text-gray-300 cursor-not-allowed'}" ${!nextChapter ? 'disabled' : ''}><div class="text-right"><div class="text-xs opacity-70">\u4e0b\u4e00\u7ae0</div><div class="text-sm font-medium">${nextChapter ? this.escapeHtml(nextChapter.title || this.formatChapterNum(nextChapter.num)) : '\u65e0'}</div></div><i class="fa-solid fa-chevron-right"></i></button>`;
            contentEl.appendChild(navDiv);
        }

        // 版本切换提示
        const versionHint = clone.getElementById('version-switch-hint');
        const versionList = clone.getElementById('version-switch-list');
        if (versionHint && versionList && entry.versions.length > 1 && !isBodyEntry) {
            const otherVersions = entry.versions.filter(v => v.vid !== version.vid);
            if (otherVersions.length > 0) {
                versionHint.classList.remove('hidden');
                otherVersions.forEach(v => {
                    const vStatus = this.getVersionTimeStatus(entry, v);
                    const btn = document.createElement('button');
                    btn.className = `text-xs px-3 py-1 rounded-full border transition ${vStatus === 'current' ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`;
                    // 【修复】添加首次出现章节标注，便于区分同名不同版本
                    const vChapter = v.chapterFrom ? this.data.chapters.find(c => c.id === v.chapterFrom) : null;
                    const vChapterLabel = vChapter ? `\u00b7${this.formatChapterNum(vChapter.num)}` : '';
                    btn.innerHTML = `${this.escapeHtml(v.title)} ${vChapterLabel ? `<span class="text-[10px] text-gray-400 ml-0.5">${vChapterLabel}</span>` : ''} ${vStatus !== 'current' ? `<span class="text-[10px] opacity-70">(${vStatus === 'past' ? '\u8fc7\u53bb' : '\u672a\u6765'})</span>` : ''}`;
                    btn.onclick = () => {
                        if (vStatus === 'future') {
                            const vConfirmKey = `${entry.id}_${v.vid}`;
                            this.data.viewingVersionId = v.vid;
                            if (this.confirmedFutureEntries.has(vConfirmKey)) this.router('detail', false);
                            else this.showFutureConfirmDialog(entry, v, vConfirmKey);
                        } else {
                            this.data.viewingVersionId = v.vid;
                            this.router('detail', false);
                        }
                    };
                    versionList.appendChild(btn);
                });
            }
        }

        container.appendChild(clone);

        // 【关键修复】活动词条：DOM插入文档后再异步加载头图和图片元件
        // 使用entry.headerImage直接获取（避免块级const作用域问题）
        if (entry.type === 'event') {
            requestAnimationFrame(() => {
                this._loadEventHeaderAsync(entry.headerImage || '', version.title);
                const detailContentEl = document.getElementById('detail-content');
                if (detailContentEl) this._loadEventBlockImages(detailContentEl);
            });
        }
    },

    renderEdit: function(container) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400">编辑功能加载中，请确保 wiki-features-edit.js 已加载</div>';
    },

    renderAnnouncementEdit: function(container) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400">公告编辑功能加载中</div>';
    },

    renderSynopsisEdit: function(container) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400">剧情梗概编辑功能加载中，请确保 wiki-features-content.js 已加载</div>';
    },

    renderGraph: function(container) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400">关系图功能加载中，请确保 wiki-features-visual.js 已加载</div>';
    },

    // ========== 关于页面 ==========
    renderAbout: function(container) {
        const tpl = document.getElementById('tpl-about');
        if (!tpl) {
            container.innerHTML = '<div class="p-4 text-red-600">关于页面模板不存在</div>';
            return;
        }
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);

        // Load about info
        this.loadAboutInfo().then(aboutInfo => {
            const displayEl = document.getElementById('about-content-display');
            if (displayEl && aboutInfo) {
                const html = (this.markdownToHtml || app.markdownToHtml)(aboutInfo.content || '');
                const author = aboutInfo.author || '';
                const date = aboutInfo.date || '';
                let headerHtml = '';
                if (author || date) {
                    headerHtml = `<div class="flex items-center gap-3 text-xs text-gray-400 mb-4 pb-3 border-b border-gray-100">`;
                    if (author) headerHtml += `<span><i class="fa-solid fa-user mr-1"></i>${author}</span>`;
                    if (date) headerHtml += `<span><i class="fa-solid fa-calendar mr-1"></i>${date}</span>`;
                    headerHtml += `</div>`;
                }
                displayEl.innerHTML = headerHtml + html;
            }
        }).catch(() => {
            // Keep default "no about info" message
        });

        // Update statistics
        this.updateAboutStats();
    },

    updateAboutStats: function() {
        const entries = this.data.entries || [];
        const characters = entries.filter(e => e.type === 'character').length;
        const settings = entries.filter(e => e.type === 'non-character').length;
        let versions = 0;
        entries.forEach(e => { versions += (e.versions || []).length; });

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setText('about-stat-entries', entries.length);
        setText('about-stat-characters', characters);
        setText('about-stat-settings', settings);
        setText('about-stat-versions', versions);
    },

    editAboutInfo: function() {
        // Switch to edit mode
        document.getElementById('about-view-section').classList.add('hidden');
        document.getElementById('about-edit-section').classList.remove('hidden');

        // Load current data
        this.loadAboutInfo().then(info => {
            if (!info) info = {};
            document.getElementById('about-author-input').value = info.author || '';
            document.getElementById('about-date-input').value = info.date || '';
            document.getElementById('about-content-input').value = info.content || '';
        });
    },

    cancelEditAbout: function() {
        document.getElementById('about-edit-section').classList.add('hidden');
        document.getElementById('about-view-section').classList.remove('hidden');
    },

    saveAboutInfo: function() {
        const aboutInfo = {
            title: '关于信息',
            author: document.getElementById('about-author-input').value.trim(),
            date: document.getElementById('about-date-input').value.trim(),
            content: document.getElementById('about-content-input').value.trim()
        };

        // Save to OPFS
        this.saveAboutInfoToStorage(aboutInfo).then(() => {
            this.showToast('关于信息已保存', 'success');
            // Refresh the view
            const displayEl = document.getElementById('about-content-display');
            if (displayEl) {
                const html = (this.markdownToHtml || app.markdownToHtml)(aboutInfo.content || '');
                const author = aboutInfo.author || '';
                const date = aboutInfo.date || '';
                let headerHtml = '';
                if (author || date) {
                    headerHtml = `<div class="flex items-center gap-3 text-xs text-gray-400 mb-4 pb-3 border-b border-gray-100">`;
                    if (author) headerHtml += `<span><i class="fa-solid fa-user mr-1"></i>${author}</span>`;
                    if (date) headerHtml += `<span><i class="fa-solid fa-calendar mr-1"></i>${date}</span>`;
                    headerHtml += `</div>`;
                }
                displayEl.innerHTML = headerHtml + html;
            }
            this.cancelEditAbout();
        }).catch(err => {
            console.error('保存关于信息失败:', err);
            this.showToast('保存失败: ' + err.message, 'error');
        });
    },

    formatAboutText: function(command) {
        const textarea = document.getElementById('about-content-input');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);

        let replacement = selected;
        switch(command) {
            case 'bold': replacement = `**${selected || '粗体文本'}**`; break;
            case 'italic': replacement = `*${selected || '斜体文本'}*`; break;
            case 'h2': replacement = `\n## ${selected || '标题'}\n`; break;
            case 'h3': replacement = `\n### ${selected || '小标题'}\n`; break;
            case 'link': replacement = `[${selected || '链接文本'}](url)`; break;
            case 'ul': replacement = `\n- ${selected || '列表项'}\n`; break;
            case 'ol': replacement = `\n1. ${selected || '列表项'}\n`; break;
            case 'code': replacement = `\`\`\`\n${selected || '代码'}\n\`\`\``; break;
            case 'quote': replacement = `\n> ${selected || '引用文本'}\n`; break;
            case 'hr': replacement = `\n---\n`; break;
        }

        textarea.value = text.substring(0, start) + replacement + text.substring(end);
        textarea.focus();
        textarea.selectionStart = start + replacement.length;
        textarea.selectionEnd = start + replacement.length;
    },

    // About info storage methods
    aboutInfoCache: null,

    async loadAboutInfo(forceRefresh) {
        if (this.aboutInfoCache && !forceRefresh) return this.aboutInfoCache;

        try {
            // 桌面模式：从当前存档目录读取 about.json
            if (this.storageManager && this.storageManager.mode === 'desktop' && this.storageManager.currentSave) {
                const data = await this.storageManager.loadAboutInfoFile();
                if (data) {
                    this.aboutInfoCache = data;
                    console.log('[About] 从存档目录加载 about.json 成功');
                    return this.aboutInfoCache;
                }
                return null;
            }

            // 【修复】优先从本地文件夹读取（用户手动放置的about.json）
            if (this.storageManager && this.storageManager.localDirectory && this.storageManager.hasDirectoryPermission) {
                try {
                    const fileHandle = await this.storageManager.localDirectory.getFileHandle('about.json');
                    const file = await fileHandle.getFile();
                    const text = await file.text();
                    this.aboutInfoCache = JSON.parse(text);
                    console.log('[About] 从本地文件夹加载 about.json 成功');
                    return this.aboutInfoCache;
                } catch (e) {
                    // File doesn't exist locally, try OPFS
                }
            }

            // 从 OPFS 读取（通过UI编辑保存的）
            if (this.storageManager && this.storageManager.opfsRoot) {
                try {
                    const fileHandle = await this.storageManager.opfsRoot.getFileHandle('about.json');
                    const file = await fileHandle.getFile();
                    const text = await file.text();
                    this.aboutInfoCache = JSON.parse(text);
                    console.log('[About] 从OPFS加载 about.json 成功');
                    return this.aboutInfoCache;
                } catch (e) {
                    // File doesn't exist in OPFS
                }
            }
        } catch (e) {
            console.warn('[About] 加载 about.json 失败:', e);
        }

        return null;
    },

    async saveAboutInfoToStorage(aboutInfo) {
        this.aboutInfoCache = aboutInfo;
        const json = JSON.stringify(aboutInfo, null, 2);

        // 桌面模式：写入当前存档目录
        if (this.storageManager && this.storageManager.mode === 'desktop') {
            try {
                await this.storageManager.saveAboutInfoFile(aboutInfo);
            } catch (e) {
                console.warn('保存 about.json 到存档目录失败:', e);
            }
            return;
        }

        // Save to OPFS
        if (this.storageManager && this.storageManager.opfsRoot) {
            try {
                const fileHandle = await this.storageManager.opfsRoot.getFileHandle('about.json', { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(json);
                await writable.close();
            } catch (e) {
                console.warn('保存about.json到OPFS失败:', e);
            }
        }

        // Save to local folder
        if (this.storageManager && this.storageManager.localDirectory && this.storageManager.hasDirectoryPermission) {
            try {
                const fileHandle = await this.storageManager.localDirectory.getFileHandle('about.json', { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(json);
                await writable.close();
            } catch (e) {
                console.warn('保存about.json到本地文件夹失败:', e);
            }
        }
    },

    renderTimelineSettings: function(container) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400">章节管理功能加载中，请确保 wiki-features-edit.js 已加载</div>';
    },

    // ========== 剧情梗概查看（防重复绑定关键） ==========
    renderSynopsisView: function(container) {
        const tpl = document.getElementById('tpl-synopsis-view');
        if (!tpl) {
            console.error('[RenderSynopsisView] 模板不存在');
            return;
        }
        
        if (!this.data.synopsis) this.data.synopsis = [];
        if (this.data.synopsisViewIndex >= this.data.synopsis.length) this.data.synopsisViewIndex = 0;
        if (this.data.synopsisViewIndex < 0) this.data.synopsisViewIndex = 0;
        const clone = tpl.content.cloneNode(true);
        container.appendChild(clone);

        const list = document.getElementById('synopsis-view-list');

        if (!this.data.synopsis || !Array.isArray(this.data.synopsis) || this.data.synopsis.length === 0) {
            if (list) {
                list.innerHTML = `
                    <div class="text-center text-gray-400 py-20">
                        <i class="fa-solid fa-film text-4xl mb-4 opacity-50"></i>
                        <p>暂无剧情梗概</p>
                        <button onclick="app.router('synopsis-edit')" class="edit-only hidden mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                            <i class="fa-solid fa-plus mr-2"></i>添加剧情梗概
                        </button>
                    </div>
                `;
            }
            const switchBtn = document.getElementById('synopsis-switch-time-btn');
            if (switchBtn) switchBtn.classList.add('hidden');
            return;
        }

        if (this.data.synopsisViewIndex >= this.data.synopsis.length) this.data.synopsisViewIndex = 0;

        // 预加载所有图片
        const imagePromises = this.data.synopsis.map(async (chapter) => {
            if (!chapter.image) return null;
            if (chapter.image.startsWith('{{IMG:')) {
                const match = chapter.image.match(/\{\{IMG:(.+?)\}\}/);
                const filename = match ? match[1] : null;
                if (filename && this.storageManager) {
                    try {
                        const actualUrl = await this.storageManager.loadImage(filename);
                        return { chapterId: chapter.id, url: actualUrl, filename: filename };
                    } catch (e) {
                        return { chapterId: chapter.id, url: null, filename: filename };
                    }
                }
            } else if (chapter.image.startsWith('data:image') || chapter.image.startsWith('blob:')) {
                return { chapterId: chapter.id, url: chapter.image, filename: null };
            }
            return null;
        });

        Promise.all(imagePromises).then(loadedImages => {
            const imageMap = {};
            loadedImages.forEach(img => {
                // 【关键修复】只构建 imageMap，不修改 this.data.synopsis 中的原始 image 引用
                // 避免 renderSynopsisView 把 {{IMG:filename}} 覆盖为 data URL，
                // 导致 saveData 生成错误文件名，缓存清理后图片无法恢复
                if (img && img.url) {
                    imageMap[img.chapterId] = img.url;
                }
            });

            this.data.synopsis.forEach((chapter, idx) => {
                if (!chapter || typeof chapter !== 'object') return;

                const item = document.createElement('div');
                item.className = 'synopsis-view-item' + (idx === this.data.synopsisViewIndex ? ' active' : ' inactive');
                item.dataset.idx = idx;
                item.dataset.chapterId = chapter.chapterId || chapter.id || `syn-${idx}`;
                item.id = `synopsis-item-${idx}`;

                const chapterNum = chapter.num ?? 0;
                const chapterTitle = chapter.title || '未命名章节';
                const content = chapter.content || '<span class="text-gray-400 italic">暂无内容</span>';
                
                const imageUrl = imageMap[chapter.id];
                const hasValidImage = !!imageUrl;

                let imageHtml = '';
                if (hasValidImage) {
                    imageHtml = `
                        <div class="synopsis-image-wrapper relative w-full mb-4 rounded-xl overflow-hidden bg-gray-800 shadow-lg" style="min-height: 200px;">
                            <img src="${imageUrl}" 
                                 class="synopsis-view-image w-full h-full object-cover transition-all duration-500" 
                                 alt="${chapterTitle}"
                                 style="max-height: ${idx === this.data.synopsisViewIndex ? '300px' : '200px'};"
                                 onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'flex items-center justify-center h-48 text-gray-500\\'><i class=\\'fa-solid fa-image mr-2\\'></i>图片加载失败</div>';">
                        </div>
                    `;
                }

                const contentHtml = chapter.content ? this.markdownToHtml(chapter.content) : '<span class="text-gray-400 italic">暂无内容</span>';

                // 【GitHub版同步】查看正文按钮 - 始终显示，无正文词条时可创建
                const chId = chapter.chapterId || chapter.id;
                const bodyEntry = this.data.entries.find(e => e.type === 'body' && e.versions[0]?.chapterFrom === chId);
                const viewBodyBtn = bodyEntry ? `
                    <button onclick="event.stopPropagation(); app.openBodyEntry('${chId}')"
                        class="ml-2 px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-full text-xs font-medium transition flex items-center gap-1">
                        <i class="fa-solid fa-book-open"></i> 查看正文
                    </button>
                ` : `
                    <button onclick="event.stopPropagation(); app.openBodyEntry('${chId}')"
                        class="ml-2 px-3 py-1 bg-gray-100 hover:bg-indigo-100 text-gray-600 hover:text-indigo-700 rounded-full text-xs font-medium transition flex items-center gap-1">
                        <i class="fa-solid fa-pen-to-square"></i> 编辑正文
                    </button>
                `;

                item.innerHTML = `
                    <div class="synopsis-view-header flex justify-between items-center">
                        <div class="flex items-center gap-2">
                            <span class="synopsis-view-num">${this.formatChapterNum(chapterNum)}</span>
                            <span class="synopsis-view-title">${chapterTitle}</span>
                        </div>
                        ${viewBodyBtn}
                    </div>
                    ${imageHtml}
                    <div class="synopsis-view-content ${idx !== this.data.synopsisViewIndex ? 'line-clamp' : ''}">
                        ${contentHtml}
                    </div>
                `;

                item.onclick = () => this.setSynopsisActiveIndex(idx);
                list.appendChild(item);
            });

            this.scrollToSynopsisItem(this.data.synopsisViewIndex);
            this.updateSwitchTimeButton();
            
            // 关键：不再在此处调用 initKeyboardListeners，防止重复绑定
            // 键盘监听已在 app.init() 中全局初始化一次
        });
    },

    setSynopsisActiveIndex: function(idx) {
        if (!this.data.synopsis || idx < 0 || idx >= this.data.synopsis.length) return;
        this.data.synopsisViewIndex = idx;

        document.querySelectorAll('.synopsis-view-item').forEach((item, i) => {
            if (i === idx) {
                item.classList.add('active');
                item.classList.remove('inactive');
                const content = item.querySelector('.synopsis-view-content');
                if (content) {
                    content.classList.remove('line-clamp');
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
    },

    scrollToSynopsisItem: function(idx) {
        const item = document.getElementById(`synopsis-item-${idx}`);
        if (item) item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    navigateSynopsis: function(direction) {
        const newIdx = this.data.synopsisViewIndex + direction;
        if (newIdx >= 0 && newIdx < this.data.synopsis.length) {
            this.setSynopsisActiveIndex(newIdx);
        }
    },

    updateSwitchTimeButton: function() {
        const btn = document.getElementById('synopsis-switch-time-btn');
        if (!btn) return;
        if (!this.data.synopsis || !Array.isArray(this.data.synopsis) || this.data.synopsis.length === 0) {
            btn.classList.add('hidden');
            return;
        }
        const chapter = this.data.synopsis[this.data.synopsisViewIndex];
        if (!chapter) {
            btn.classList.add('hidden');
            return;
        }
        const chapterId = chapter.chapterId || chapter.id;
        if (!chapterId) {
            btn.classList.add('hidden');
            return;
        }
        const isDifferentTime = this.data.currentTimeline !== chapterId;
        btn.classList.toggle('hidden', !isDifferentTime);
        btn.onclick = () => this.switchToSynopsisTime();
    },

    switchToSynopsisTime: function() {
        const chapter = this.data.synopsis[this.data.synopsisViewIndex];
        if (!chapter) return;
        const targetChapterId = chapter.chapterId || chapter.id;
        if (!targetChapterId) {
            alert('该章节缺少时间轴关联，无法切换');
            return;
        }
        this.setTimeline(targetChapterId);
        this.updateSwitchTimeButton();
    },

    // ========== 键盘监听（防重复绑定核心实现） ==========
    initKeyboardListeners: function() {
        // 如果已经初始化，先移除旧的监听器
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler, true);
        }
        
        this._keydownHandler = (e) => {
            // 仅在剧情梗概视图生效
            if (this.data.currentView !== 'synopsis') return;
            
            // 忽略输入框内的按键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                this.navigateSynopsis(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                this.navigateSynopsis(1);
            } else if (e.key === 'Escape') {
                this.closeSynopsisPopup();
                this.closeSynopsisTooltip();
            }
        };
        
        // 使用捕获阶段确保优先级，且只绑定一次
        document.addEventListener('keydown', this._keydownHandler, true);
        console.log('[Keyboard] 剧情梗概键盘导航已初始化（仅一次）');
    },

    // 剧情引用相关占位方法
    handleSynopsisRefHover: function(element) {
        // 实现应在 wiki-features-content.js 或 wiki-features-visual.js
        console.log('[Hover] 词条引用悬停');
    },
    handleSynopsisRefLeave: function(element) {
        console.log('[Leave] 词条引用离开');
    },
    handleSynopsisRefClick: function(element) {
        console.log('[Click] 词条引用点击');
    },
    closeSynopsisPopup: function() {
        const popup = document.querySelector('.synopsis-popup');
        if (popup) popup.remove();
    },
    closeSynopsisTooltip: function() {
        const tooltip = document.querySelector('.synopsis-tooltip');
        if (tooltip) tooltip.remove();
        document.body.classList.remove('body-dimmed');
    },

    // ========== 数据导入导出 ==========
    exportData: async function() {
        var exportData = {
            entries: this.data.entries,
            chapters: this.data.chapters,
            camps: this.data.camps,
            synopsis: this.data.synopsis,
            announcements: this.data.announcements,
            homeContent: this.data.homeContent,
            codeCounters: this.data.codeCounters,
            
            // GitHub版兼容字段
            wikiTitle: this.data.settings ? (this.data.settings.name || '未命名 Wiki') : '未命名 Wiki',
            wikiSubtitle: this.data.settings ? (this.data.settings.subtitle || '') : '',
            fontFamily: this.data.settings ? (this.data.settings.customFont || "'Noto Sans SC', sans-serif") : "'Noto Sans SC', sans-serif",
            customFields: {},
            
            version: '2.5.0-local',
            exportTime: Date.now()
        };
        
        var dataStr = JSON.stringify(exportData, null, 2);

        // 桌面模式：通过保存对话框直接写文件
        if (this.storageManager && this.storageManager.mode === 'desktop' && this.storageManager.bridge) {
            const safeName = (exportData.wikiTitle || 'wiki').replace(/[^a-z0-9\u4e00-\u9fa5_-]/gi, '_');
            const saved = await this.storageManager.bridge.saveFile({
                title: '导出 JSON 数据',
                defaultName: safeName + '_数据.json',
                content: dataStr,
                filters: [{ name: 'JSON 文件', extensions: ['json'] }]
            });
            if (saved) this.showToast('JSON 已导出: ' + saved, 'success', 4000);
            else this.showToast('已取消导出', 'info');
            return;
        }

        var blob = new Blob([dataStr], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var safeName = (exportData.wikiTitle).replace(/[^a-z0-9\u4e00-\u9fa5_-]/gi, '_');
        a.download = safeName + '_数据.json';
        a.click();
        URL.revokeObjectURL(url);
    },

    // 【新增】单独导出 about.json
    exportAboutJson: async function() {
        try {
            let aboutInfo = this.aboutInfoCache;
            if (!aboutInfo) {
                aboutInfo = await this.loadAboutInfo(true);
            }
            if (!aboutInfo) {
                this.showToast('暂无关于信息可导出，请先编辑关于页面', 'warning');
                return;
            }
            const json = JSON.stringify(aboutInfo, null, 2);
            // 桌面模式：保存对话框写文件
            if (this.storageManager && this.storageManager.mode === 'desktop' && this.storageManager.bridge) {
                const safeName = (this.data.settings.name || 'wiki').replace(/[^a-z0-9\u4e00-\u9fa5_-]/gi, '_');
                const saved = await this.storageManager.bridge.saveFile({
                    title: '导出关于信息',
                    defaultName: safeName + '_about.json',
                    content: json,
                    filters: [{ name: 'JSON 文件', extensions: ['json'] }]
                });
                if (saved) this.showToast('about.json 已导出: ' + saved, 'success', 4000);
                else this.showToast('已取消导出', 'info');
                return;
            }
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = (this.data.settings.name || 'wiki').replace(/[^a-z0-9\u4e00-\u9fa5_-]/gi, '_');
            a.download = safeName + '_about.json';
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('about.json 已导出', 'success');
        } catch (e) {
            console.error('导出 about.json 失败:', e);
            this.showToast('导出失败: ' + e.message, 'error');
        }
    },

    importData: function(input) {
        var self = this;
        var file = input.files[0];
        if (!file) return;
        
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var imported = JSON.parse(e.target.result);
                
                if (!confirm('导入将覆盖当前所有数据，确定吗？')) {
                    input.value = '';
                    return;
                }
                
                // 数据映射（兼容GitHub版格式）
                self.data.entries = imported.entries || [];
                self.data.chapters = imported.chapters || [];
                self.data.camps = imported.camps || ['主角团', '反派'];
                self.data.synopsis = imported.synopsis || [];
                self.data.announcements = imported.announcements || [];
                self.data.homeContent = imported.homeContent || [];
                self.data.codeCounters = imported.codeCounters || { C: 0, N: 0 };
                
                // 设置映射（兼容GitHub版和本地版）
                if (!self.data.settings) self.data.settings = {};
                self.data.settings.name = imported.wikiTitle || imported.settings && imported.settings.name || '未命名 Wiki';
                self.data.settings.subtitle = imported.wikiSubtitle || imported.settings && imported.settings.subtitle || '';
                self.data.settings.customFont = imported.fontFamily || imported.settings && imported.settings.customFont || "'Noto Sans SC', sans-serif";
                
                self.saveData();
                self.applySettings();
                self.initTimelineSelector();
                self.router('home');
                alert('导入成功！');
                
            } catch (err) {
                alert('导入失败：' + err.message);
                console.error(err);
            }
        };
        reader.readAsText(file);
        input.value = '';
    },

    exportZipBackup: async function() {
        try {
            this.showSaveToast('正在扫描本地文件...');
            
            // 【关键修复】导出前强制重新扫描本地文件夹（确保句柄有效）
            if (this.storageManager.localImagesDir) {
                try {
                    // 尝试重新请求权限（处理权限过期）
                    if (!this.storageManager.hasDirectoryPermission && this.storageManager.localDirectory) {
                        const perm = await this.storageManager.localDirectory.requestPermission({ mode: 'readwrite' });
                        this.storageManager.hasDirectoryPermission = (perm === 'granted');
                    }
                    
                    // 强制刷新文件列表到内存缓存
                    await this.storageManager.syncImagesFromLocalDirectory();
                } catch (e) {
                    console.warn('[Export] 刷新本地文件列表失败:', e);
                }
            }
            
            this.showSaveToast('正在打包...');
            const dataJson = {
                settings: this.data.settings,
                entries: this.data.entries,
                camps: this.data.camps,
                chapters: this.data.chapters,
                homeContent: this.data.homeContent,
                announcements: this.data.announcements,
                codeCounters: this.data.codeCounters,
                synopsis: this.data.synopsis
            };
            
            // 【新增】加载并导出 about.json
            let aboutInfo = null;
            try {
                aboutInfo = await this.loadAboutInfo();
            } catch (e) {
                console.log('[Export] 无关于信息可导出');
            }
            
            const zip = await this.storageManager.createZipPackage(dataJson, aboutInfo);
            const blob = await zip.generateAsync({ type: 'blob' });

            // 桌面模式：保存对话框直接写 ZIP 文件
            if (this.storageManager && this.storageManager.mode === 'desktop' && this.storageManager.bridge) {
                const safeName = (this.data.settings.name || 'wiki').replace(/[^a-z0-9\u4e00-\u9fa5_-]/gi, '_');
                const b64 = await new Promise((resolve) => {
                    const r = new FileReader();
                    r.onload = () => resolve(String(r.result).split(',')[1] || '');
                    r.readAsDataURL(blob);
                });
                const saved = await this.storageManager.bridge.saveFile({
                    title: '导出完整数据包 (ZIP)',
                    defaultName: `${safeName}_完整数据包_${new Date().toISOString().slice(0,10)}.zip`,
                    base64: b64,
                    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
                });
                if (saved) this.showToast('数据包已导出: ' + saved, 'success', 4000);
                else this.showToast('已取消导出', 'info');
                return;
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = (this.data.settings.name || 'wiki').replace(/[^a-z0-9\u4e00-\u9fa5_-]/gi, '_');
            a.download = `${safeName}_完整数据包_${new Date().toISOString().slice(0,10)}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            this.showSaveToast('导出成功');
        } catch (err) {
            console.error('[Export] 导出失败:', err);
            alert('导出失败: ' + err.message);
        }
    },

    importZipBackup: async function(input) {
        const file = input.files[0];
        if (!file) return;
        try {
            if (!confirm('导入将覆盖当前所有数据，确定吗？')) {
                input.value = '';
                return;
            }
            this.showSaveToast('正在导入...');
            const { data, aboutInfo } = await this.storageManager.importZipPackage(file);

            // 桌面模式：导入为"新存档"并切换加载
            if (this.storageManager && this.storageManager.mode === 'desktop') {
                await this.loadDataFromDesktop();
                this.aboutInfoCache = aboutInfo || null;
                this.applySettings();
                if (typeof this.initTimelineSelector === 'function') this.initTimelineSelector();
                this.router('home');
                this.showToast(`存档已导入并切换到：「${this.storageManager.currentSave}」`, 'success', 5000);
                if (typeof this.updateSaveStatusUI === 'function') this.updateSaveStatusUI();
                input.value = '';
                return;
            }

            this.data = { ...this.data, ...data, history: [] };
            this.data.entries.forEach(entry => {
                entry.versions.forEach(v => {
                    if (v.image && !v.images) v.images = { avatar: v.image, card: v.image, cover: v.image };
                });
            });
            // 【新增】导入 about.json
            if (aboutInfo) {
                this.aboutInfoCache = aboutInfo;
                await this.saveAboutInfoToStorage(aboutInfo);
            }
            this.saveData();
            this.applySettings();
            this.initTimelineSelector();
            this.router('home');
            const stats = await this.storageManager.getStorageStats();
            alert(`导入成功！已恢复 ${stats.memory} 张图片`);
        } catch (err) {
            alert('导入失败: ' + err.message);
        } finally {
            input.value = '';
        }
    },

    reloadImagesFromLastZip: async function() {
        alert('请重新导入ZIP文件以恢复图片');
    },

    // ========== 搜索功能 ==========
    handleSearchInput: function(value) {
        const dropdown = document.getElementById('search-dropdown');
        if (!value) {
            dropdown.classList.add('hidden');
            return;
        }
        
        const results = [];
        this.data.entries.forEach(entry => {
            entry.versions.forEach(version => {
                const matchCode = entry.code.toLowerCase().includes(value.toLowerCase());
                const matchTitle = version.title && version.title.toLowerCase().includes(value.toLowerCase());
                if (matchCode || matchTitle) {
                    results.push({ entry, version, status: this.getVersionTimeStatus(entry, version) });
                }
            });
        });
        
        results.sort((a, b) => {
            const order = { current: 0, past: 1, future: 2 };
            return order[a.status] - order[b.status];
        });
        
        const displayResults = results.slice(0, 8);
        
        if (displayResults.length === 0) {
            dropdown.innerHTML = '<div class="p-3 text-gray-400 text-sm text-center">无搜索结果</div>';
            dropdown.classList.remove('hidden');
            return;
        }
        
        dropdown.innerHTML = '';
        displayResults.forEach(item => {
            const isCurrent = item.status === 'current';
            const isFuture = item.status === 'future';
            
            const div = document.createElement('div');
            div.className = `search-item p-3 cursor-pointer border-b border-gray-100 last:border-0 ${!isCurrent ? (isFuture ? 'future' : 'past') : ''}`;
            
            div.innerHTML = `
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="text-xs font-mono text-gray-400 shrink-0">${item.entry.code}</span>
                        <span class="text-sm font-medium truncate">${item.version.title}</span>
                    </div>
                    <span class="search-tag ${item.status} text-[10px] px-2 py-0.5 rounded ml-2 shrink-0">
                        ${isCurrent ? '当前' : isFuture ? '未来' : '过去'}
                    </span>
                </div>
            `;
            
            div.onclick = () => {
                if (isFuture) {
                    this.data.editingId = item.entry.id;
                    this.data.viewingVersionId = item.version.vid;
                    // 显示确认对话框逻辑应在完整版中实现
                } else {
                    this.data.editingId = item.entry.id;
                    this.data.viewingVersionId = item.version.vid;
                    this.addToHistory(item.entry);
                    this.router('detail');
                }
                dropdown.classList.add('hidden');
            };
            
            dropdown.appendChild(div);
        });
        
        dropdown.classList.remove('hidden');
    },

    hideSearchDropdown: function() {
        setTimeout(() => {
            const dropdown = document.getElementById('search-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }, 200);
    },

    showSearchDropdown: function() {},

    searchAndOpen: function(name) {
        const entry = this.data.entries.find(e => {
            const v = this.getVisibleVersion(e);
            return v && v.title === name;
        });
        if (entry) {
            this.openEntry(entry.id);
        } else {
            alert('未找到词条：' + name);
        }
    },

    showBackupRestoreDialog: function() {
        if (confirm('检测到自动备份，是否恢复数据？')) {
            // 恢复逻辑
        }
    },
    
    dismissBackupBanner: function() {
        this.data.pendingBackup = null;
        const banner = document.getElementById('backup-restore-banner');
        if (banner) banner.classList.add('hidden');
    }
};

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}
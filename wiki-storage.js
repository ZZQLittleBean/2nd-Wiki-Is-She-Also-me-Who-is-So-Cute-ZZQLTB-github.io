/**
 * Part 7-Desktop: 存储层 v3（准应用版）
 *
 * 两种模式：
 *  - desktop（默认）：应用打包为 exe 后，通过 window.desktopBridge 直接读写
 *      "数据根目录/存档名" 下的文件（data.json / wiki-images/ / wiki-manifest.json / about.json）。
 *      数据根目录默认 = 可执行文件所在文件夹/WikiData，可在设置中指定存储位置。
 *      完全不再依赖浏览器 localStorage / OPFS 存储主数据，适合庞大数据的编辑。
 *  - browser（降级）：直接浏览器打开 index.html 时的演示模式，使用 OPFS 存储图片、
 *      localStorage 存储主数据（保留旧网页本地版兼容）。
 *
 * 所有旧方法名保持兼容（saveImage / loadImage / deleteFile / manifest / zip 包 等），
 * 内部按模式分发。存档目录结构与 GitHub 版完全一致，导出的数据包可被 GitHub 版读取。
 */

(function() {
  // 依赖检查
  if (typeof app === 'undefined') {
    console.error('wiki-storage.js: app 对象未定义，请先加载 wiki-core.js');
    return;
  }

  const SAVE_DATA_VERSION = '2.5.0';

  app.storageManager = {
    // ============ 模式与状态 ============
    mode: 'browser',          // 'desktop' | 'browser'
    bridge: null,             // window.desktopBridge
    appInfo: null,            // {dataRoot, exeDir, isPackaged, ...}
    dataRoot: null,           // 数据根目录（desktop）
    saves: [],                // 存档列表 [{name, hasData, updatedAt}]
    currentSave: null,        // 当前存档名
    memoryCache: new Map(),   // filename -> dataURL/blobURL
    _blobToFile: new Map(),   // blobURL -> filename（反向映射，供保存时还原 {{IMG:}} 引用）
    manifest: { version: SAVE_DATA_VERSION, lastUpdate: 0, mappings: {} },

    // 浏览器降级模式
    opfsRoot: null,
    hasDirectoryPermission: false,
    localDirectory: null,
    localImagesDir: null,

    // ============ 初始化 ============
    async init() {
      if (window.desktopBridge) {
        this.mode = 'desktop';
        this.bridge = window.desktopBridge;
        try {
          this.appInfo = await this.bridge.getAppInfo();
          this.dataRoot = this.appInfo.dataRoot;
          console.log('[Storage] 桌面模式，数据根目录:', this.dataRoot);
        } catch (e) {
          console.warn('[Storage] 桌面桥接获取信息失败，降级浏览器模式:', e);
          this.mode = 'browser';
          this.bridge = null;
        }
      }

      if (this.mode === 'browser') {
        // 浏览器降级：OPFS 图片存储
        if ('storage' in navigator && 'getDirectory' in navigator.storage) {
          try {
            this.opfsRoot = await navigator.storage.getDirectory();
            console.log('[Storage] 浏览器演示模式，OPFS 已挂载');
          } catch (e) {
            console.warn('[Storage] OPFS 不可用:', e);
          }
        }
      }

      if (this.mode === 'desktop') {
        await this.refreshSaves();
        // 恢复上次使用的存档
        const lastSave = localStorage.getItem('glight_current_save');
        if (lastSave && this.saves.some(s => s.name === lastSave)) {
          this.currentSave = lastSave;
          await this.loadManifest();
          console.log('[Storage] 恢复存档:', lastSave);
        }
      }
      return true;
    },

    // ============ 存档管理 ============
    /** 刷新存档列表（desktop：数据根目录下含 data.json 的文件夹） */
    async refreshSaves() {
      if (this.mode !== 'desktop') return [];
      try {
        const entries = await this.bridge.list('') || [];
        const saves = [];
        for (const en of entries) {
          if (en.kind !== 'dir') continue;
          const hasData = await this.bridge.exists(this.rel(en.name, 'data.json'));
          let updatedAt = 0;
          try {
            const d = await this.bridge.list(this.rel(en.name, ''));
            const df = (d || []).find(f => f.name === 'data.json');
            if (df) updatedAt = df.mtime || 0;
          } catch (e) {}
          saves.push({ name: en.name, hasData, updatedAt });
        }
        saves.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        this.saves = saves;
        return saves;
      } catch (e) {
        console.warn('[Storage] 刷新存档列表失败:', e);
        return [];
      }
    },

    /** 当前存档目录内相对路径（desktop：存档名/rel） */
    rel(saveName, rel) {
      if (rel === undefined) {
        rel = saveName;
        saveName = this.currentSave;
      }
      if (!saveName) return rel;
      return saveName + '/' + (rel || '');
    },

    /** 新建存档（desktop：创建文件夹 + 空 data.json） */
    async createSave(name) {
      if (this.mode !== 'desktop') {
        console.warn('[Storage] 浏览器演示模式不支持多存档，请使用桌面版');
        return false;
      }
      name = String(name || '').trim();
      if (!name) return false;
      // 过滤非法字符
      name = name.replace(/[\\/:*?"<>|]/g, '_');
      const base = this.rel(name, '');
      try {
        await this.bridge.mkdir(base);
        await this.bridge.mkdir(this.rel(name, 'wiki-images'));
        const empty = {
          settings: {},
          entries: [],
          camps: [],
          chapters: [],
          homeContent: [],
          announcements: [],
          codeCounters: { C: 0, N: 0, E: 0 },
          synopsis: [],
          lastSaveTime: Date.now(),
          version: SAVE_DATA_VERSION + '-local'
        };
        await this.writeJson(this.rel(name, 'data.json'), empty);
        await this.refreshSaves();
        this.currentSave = name;
        localStorage.setItem('glight_current_save', name);
        // 重置内存缓存
        this.memoryCache.clear();
        this.manifest = { version: SAVE_DATA_VERSION, lastUpdate: Date.now(), mappings: {} };
        await this.saveManifest();
        return true;
      } catch (e) {
        console.error('[Storage] 新建存档失败:', e);
        return false;
      }
    },

    /** 切换存档 */
    async switchSave(name) {
      if (this.mode !== 'desktop') return false;
      const save = this.saves.find(s => s.name === name);
      if (!save) return false;
      this.currentSave = name;
      localStorage.setItem('glight_current_save', name);
      this.memoryCache.clear();
      await this.loadManifest();
      return true;
    },

    /** 删除存档（desktop：删除文件夹） */
    async deleteSave(name) {
      if (this.mode !== 'desktop') return false;
      if (!name || name === this.currentSave && this.saves.length <= 1) return false;
      try {
        await this.bridge.delete(this.rel(name, ''));
        if (this.currentSave === name) {
          this.currentSave = null;
          localStorage.removeItem('glight_current_save');
        }
        await this.refreshSaves();
        return true;
      } catch (e) {
        console.error('[Storage] 删除存档失败:', e);
        return false;
      }
    },

    // ============ 基础文件操作 ============
    async exists(rel) {
      if (this.mode === 'desktop') {
        try { return await this.bridge.exists(rel); } catch (e) { return false; }
      }
      return false;
    },

    async readJson(rel) {
      if (this.mode !== 'desktop') return null;
      const text = await this.bridge.readText(rel);
      if (!text) return null;
      try { return JSON.parse(text); } catch (e) { return null; }
    },

    async writeJson(rel, obj) {
      if (this.mode !== 'desktop') return false;
      try {
        return await this.bridge.writeText(rel, JSON.stringify(obj, null, 2));
      } catch (e) { return false; }
    },

    async readText(rel) {
      if (this.mode !== 'desktop') return null;
      try { return await this.bridge.readText(rel); } catch (e) { return null; }
    },

    async writeText(rel, content) {
      if (this.mode !== 'desktop') return false;
      try { return await this.bridge.writeText(rel, content); } catch (e) { return false; }
    },

    /** dataURL 提取 base64 */
    dataUrlToBase64(dataUrl) {
      if (!dataUrl) return null;
      const idx = dataUrl.indexOf(',');
      return idx >= 0 ? dataUrl.substring(idx + 1) : dataUrl;
    },

    dataUrlToBlob(dataUrl) {
      const arr = dataUrl.split(',');
      const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
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

    fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    // ============ Manifest 系统 ============
    generateManifest() {
      const manifest = {
        version: SAVE_DATA_VERSION,
        lastUpdate: Date.now(),
        mappings: {},
        appName: 'NovelWiki',
        exportTime: Date.now()
      };
      this.memoryCache.forEach((dataUrl, filename) => {
        const parts = filename.split('_');
        if (filename.startsWith('synopsis_') && parts.length >= 2) {
          manifest.mappings[filename] = {
            type: 'synopsis',
            chapterId: parts[1],
            role: parts[2] || 'cover'
          };
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
      if (this.mode === 'desktop') {
        try {
          await this.writeJson(this.rel('wiki-manifest.json'), this.manifest);
        } catch (e) {}
      } else if (this.opfsRoot) {
        try {
          const fh = await this.opfsRoot.getFileHandle('wiki-manifest.json', { create: true });
          const w = await fh.createWritable();
          await w.write(JSON.stringify(this.manifest, null, 2));
          await w.close();
        } catch (e) {}
      }
    },

    async loadManifest() {
      let data = null;
      if (this.mode === 'desktop') {
        data = await this.readJson(this.rel('wiki-manifest.json'));
      } else if (this.opfsRoot) {
        try {
          const fh = await this.opfsRoot.getFileHandle('wiki-manifest.json');
          const f = await fh.getFile();
          data = JSON.parse(await f.text());
        } catch (e) {}
      }
      if (data) this.manifest = data;
    },

    debouncedSaveManifest: (function() {
      let timeout;
      return function() {
        clearTimeout(timeout);
        timeout = setTimeout(() => { if (app.storageManager) app.storageManager.saveManifest(); }, 2000);
      };
    })(),

    // ============ 图片保存（即时写文件） ============
    async saveImage(filename, dataUrl, options = {}) {
      if (!filename || !dataUrl) return filename;
      const { entryId, versionId, type, chapterId } = options;

      // 1. 内存缓存
      this.memoryCache.set(filename, dataUrl);

      // 2. Manifest 映射
      if (filename.startsWith('synopsis_')) {
        this.manifest.mappings[filename] = {
          type: 'synopsis',
          chapterId: chapterId || filename.split('_')[1],
          timestamp: Date.now()
        };
      } else {
        this.manifest.mappings[filename] = {
          type: 'entry',
          entryId, versionId, imageType: type,
          timestamp: Date.now()
        };
      }

      // 3. 写入文件（desktop：存档目录/wiki-images；browser：OPFS）
      if (this.mode === 'desktop') {
        try {
          await this.bridge.writeBinary(this.rel('wiki-images/' + filename), this.dataUrlToBase64(dataUrl));
        } catch (e) {
          console.error('[Storage] 图片写入失败:', filename, e);
        }
      } else if (this.opfsRoot) {
        try {
          const blob = this.dataUrlToBlob(dataUrl);
          const fh = await this.opfsRoot.getFileHandle(filename, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        } catch (e) {
          console.error('[Storage] OPFS 图片写入失败:', e);
        }
      }

      // 4. 防抖更新 manifest 文件
      this.debouncedSaveManifest();
      return filename;
    },

    // ============ 图片加载（多源） ============
    async loadImage(filename) {
      if (!filename) return null;
      // 1. 内存
      if (this.memoryCache.has(filename)) return this.memoryCache.get(filename);

      // 2. desktop：读文件（转 blob URL，节省内存）
      if (this.mode === 'desktop') {
        try {
          const b64 = await this.bridge.readBinary(this.rel('wiki-images/' + filename));
          if (b64) {
            const ext = filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
            const binary = atob(b64);
            const len = binary.length;
            const u8arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) u8arr[i] = binary.charCodeAt(i);
            const blob = new Blob([u8arr], { type: ext });
            const blobUrl = URL.createObjectURL(blob);
            this.memoryCache.set(filename, blobUrl);
            this._blobToFile.set(blobUrl, filename); // 反向映射
            return blobUrl;
          }
        } catch (e) {}
        return null;
      }

      // 3. browser：OPFS
      if (this.opfsRoot) {
        try {
          const fh = await this.opfsRoot.getFileHandle(filename);
          const file = await fh.getFile();
          const blobUrl = URL.createObjectURL(file);
          this.memoryCache.set(filename, blobUrl);
          return blobUrl;
        } catch (e) {}
      }
      return null;
    },

    /** 删除图片（内存 + 文件） */
    async deleteFile(filename) {
      if (!filename) return;
      this.memoryCache.delete(filename);
      if (this.mode === 'desktop') {
        try { await this.bridge.delete(this.rel('wiki-images/' + filename)); } catch (e) {}
      } else if (this.opfsRoot) {
        try { await this.opfsRoot.removeEntry(filename); } catch (e) {}
      }
      // 清理 manifest 映射
      if (this.manifest.mappings && this.manifest.mappings[filename]) {
        delete this.manifest.mappings[filename];
        this.debouncedSaveManifest();
      }
    },

    // ============ 数据文件（data.json） ============
    /** 桌面模式：读取当前存档的 data.json */
    async loadDataFile() {
      if (this.mode !== 'desktop') return null;
      return await this.readJson(this.rel('data.json'));
    },

    /** 桌面模式：写入当前存档的 data.json（payload 为 {{IMG:}} 引用形式的干净数据） */
    async saveDataFile(payload) {
      if (this.mode !== 'desktop') return false;
      return await this.writeJson(this.rel('data.json'), payload);
    },

    /** 关于信息（about.json） */
    async loadAboutInfoFile() {
      if (this.mode !== 'desktop') return null;
      return await this.readJson(this.rel('about.json'));
    },

    async saveAboutInfoFile(info) {
      if (this.mode !== 'desktop') return false;
      return await this.writeJson(this.rel('about.json'), info);
    },

    // ============ ZIP 数据包 ============
    /** 从存档目录收集文件创建 ZIP（desktop 直接读文件） */
    async createZipPackage(dataJson, aboutInfo) {
      const zip = new JSZip();
      zip.file('data.json', JSON.stringify(dataJson, null, 2));
      zip.file('wiki-manifest.json', JSON.stringify(this.manifest, null, 2));
      if (aboutInfo) zip.file('about.json', JSON.stringify(aboutInfo, null, 2));
      const imgFolder = zip.folder('wiki-images');

      if (this.mode === 'desktop') {
        try {
          const files = await this.bridge.list(this.rel('wiki-images'));
          for (const f of files || []) {
            if (f.kind !== 'file') continue;
            if (!/\.(jpg|jpeg|png)$/i.test(f.name)) continue;
            try {
              const b64 = await this.bridge.readBinary(this.rel('wiki-images/' + f.name));
              if (b64) {
                imgFolder.file(f.name, b64, { base64: true });
              }
            } catch (e) {}
          }
        } catch (e) {
          console.warn('[Storage] 桌面模式扫描图片失败:', e);
        }
        return zip;
      }

      // 浏览器模式：收集引用 + 内存缓存 + OPFS
      const referencedFiles = new Set();
      if (dataJson.entries) {
        dataJson.entries.forEach(entry => {
          if (entry.headerImage) {
            const m = String(entry.headerImage).match(/\{\{IMG:(.+?)\}\}/);
            if (m) referencedFiles.add(m[1]);
          }
          (entry.versions || []).forEach(v => {
            if (v.images) Object.values(v.images).forEach(ref => {
              const m = ref && ref.match(/\{\{IMG:(.+?)\}\}/);
              if (m) referencedFiles.add(m[1]);
            });
            if (v.blocks) v.blocks.forEach(b => {
              if (b.type === 'img' && b.src) {
                const m = String(b.src).match(/\{\{IMG:(.+?)\}\}/);
                if (m) referencedFiles.add(m[1]);
              }
            });
          });
        });
      }
      if (dataJson.synopsis) {
        dataJson.synopsis.forEach(ch => {
          const m = ch.image && ch.image.match(/\{\{IMG:(.+?)\}\}/);
          if (m) referencedFiles.add(m[1]);
        });
      }
      const allFiles = new Set([...referencedFiles, ...this.memoryCache.keys()]);
      for (const filename of allFiles) {
        let buffer = null;
        if (this.memoryCache.has(filename)) {
          const url = this.memoryCache.get(filename);
          if (url.startsWith('data:')) {
            const bstr = this.dataUrlToBase64(url);
            try { imgFolder.file(filename, bstr, { base64: true }); buffer = 'ok'; }
            catch (e) {}
          } else if (url.startsWith('blob:')) {
            try {
              const resp = await fetch(url);
              const ab = await resp.arrayBuffer();
              imgFolder.file(filename, ab);
              buffer = 'ok';
            } catch (e) {}
          }
        }
        if (!buffer && this.opfsRoot) {
          try {
            const fh = await this.opfsRoot.getFileHandle(filename);
            const file = await fh.getFile();
            imgFolder.file(filename, await file.arrayBuffer());
          } catch (e) {}
        }
      }
      return zip;
    },

    /** 导入 ZIP（desktop：解压为"新存档"；browser：写入当前 OPFS） */
    async importZipPackage(zipFile, targetSaveName) {
      const zip = await JSZip.loadAsync(zipFile);
      const dataFile = zip.file('data.json');
      if (!dataFile) throw new Error('无效的Wiki数据包：缺少data.json');
      const dataJson = JSON.parse(await dataFile.async('string'));

      let manifest = null;
      const manifestFile = zip.file('wiki-manifest.json');
      if (manifestFile) {
        try { manifest = JSON.parse(await manifestFile.async('string')); } catch (e) {}
      }
      let aboutInfo = null;
      const aboutFile = zip.file('about.json');
      if (aboutFile) {
        try { aboutInfo = JSON.parse(await aboutFile.async('string')); } catch (e) {}
      }

      const imageFiles = Object.keys(zip.files).filter(name =>
        name.startsWith('wiki-images/') && /\.(jpg|jpeg|png)$/i.test(name)
      );

      if (this.mode === 'desktop') {
        // 导入为新存档
        let saveName = targetSaveName;
        if (!saveName) {
          const base = (zipFile && zipFile.name ? zipFile.name.replace(/\.zip$/i, '') : '导入存档') || '导入存档';
          saveName = base.replace(/[\\/:*?"<>|]/g, '_');
          let n = saveName, i = 2;
          while (this.saves.some(s => s.name === n)) { n = saveName + '_' + i; i++; }
          saveName = n;
        }
        await this.createSave(saveName);
        this.currentSave = saveName;
        await this.writeJson(this.rel('data.json'), dataJson);
        if (manifest) {
          this.manifest = manifest;
          await this.writeJson(this.rel('wiki-manifest.json'), manifest);
        }
        if (aboutInfo) {
          await this.writeJson(this.rel('about.json'), aboutInfo);
        }
        for (const imgPath of imageFiles) {
          const filename = imgPath.replace('wiki-images/', '');
          try {
            const b64 = await zip.file(imgPath).async('base64');
            await this.bridge.writeBinary(this.rel('wiki-images/' + filename), b64);
          } catch (e) {}
        }
        await this.refreshSaves();
        localStorage.setItem('glight_current_save', saveName);
        return { data: dataJson, aboutInfo: aboutInfo };
      }

      // 浏览器模式：写入 OPFS + 内存
      if (manifest) Object.assign(this.manifest.mappings, manifest.mappings || {});
      for (const imgPath of imageFiles) {
        const filename = imgPath.replace('wiki-images/', '');
        try {
          const ab = await zip.file(imgPath).async('arraybuffer');
          const blob = new Blob([ab], { type: filename.endsWith('.png') ? 'image/png' : 'image/jpeg' });
          const dataUrl = await new Promise((res) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.readAsDataURL(blob);
          });
          this.memoryCache.set(filename, dataUrl);
          if (this.opfsRoot) {
            const fh = await this.opfsRoot.getFileHandle(filename, { create: true });
            const w = await fh.createWritable();
            await w.write(ab);
            await w.close();
          }
        } catch (e) {}
      }
      await this.saveManifest();
      return { data: dataJson, aboutInfo: aboutInfo };
    },

    // ============ 启动恢复 ============
    /** 桌面模式启动时按需恢复图片（{{IMG:}} 引用保留在数据中，按需加载） */
    async restoreAllImagesFromStorage() {
      return 0; // desktop 模式下图片按需加载（resolveImageUrlAsync / refreshAllImageReferences）
    },

    // ============ 兼容旧调用（浏览器模式 / 无操作） ============
    async requestLocalDirectory() { return false; },
    async restoreDirectoryPermission() { return false; },
    async setupLocalImagesDir() {},
    async syncImagesFromLocalDirectory() { return 0; },
    async syncFromOPFS() { return 0; },
    async autoRestoreImages() { return 0; },
    checkMissingFiles() { return []; },
    getStorageStats() {
      return {
        mode: this.mode,
        memory: this.memoryCache.size,
        saves: this.saves.length,
        currentSave: this.currentSave,
        dataRoot: this.dataRoot,
        manifestFiles: Object.keys(this.manifest.mappings || {}).length,
        opfsFiles: 0,
        opfsSize: '0 MB',
        hasLocalDirectory: false,
        hasPermission: false
      };
    }
  };

  console.log('Part 7-Desktop (Storage v3) 加载完成 - 模式:', app.storageManager.mode);
})();

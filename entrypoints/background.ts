import { yuqueCreateDoc, yuqueSearchDoc, yuqueUpdateDoc } from '../lib/storage/yuque';
import { getLogger, persistError } from '../lib/logger';

const log = getLogger('background');

export default defineBackground(() => {
  // ===== 全局未捕获异常/拒绝日志（记到 storage，在设置页能看到） =====
  // 注意：必须放在 defineBackground 回调内部，否则 WXT 构建时在 Node 环境会报错
  if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
    self.addEventListener('error', (event) => {
      const msg = event.message || 'Unknown error';
      const source = `${event.filename || ''}:${event.lineno || ''}:${event.colno || ''}`;
      persistError('background', `Uncaught: ${msg}`, { source, stack: event.error?.stack || '' });
    });

    self.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const msg = reason?.message || String(reason) || 'Unknown rejection';
      persistError('background', `Unhandled rejection: ${msg}`, { stack: reason?.stack || '' });
    });
  }
  // ===== Context Menu =====
  browser.contextMenus.create({ id: 'clip-fullpage', title: '保存完整页面', contexts: ['page'] });
  browser.contextMenus.create({ id: 'clip-article', title: '提取正文', contexts: ['page'] });
  browser.contextMenus.create({ id: 'clip-selection', title: '剪藏选中区域', contexts: ['selection'] });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    await sendClip(tab.id, info.menuItemId as string);
  });

  // ===== Keyboard Shortcuts =====
  browser.commands.onCommand.addListener(async (command) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await sendClip(tab.id, command.replace('clip-', ''));
  });

  // ===== Popup Messages =====
  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === 'clip') {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { success: false, error: 'No active tab' };
      return sendClip(tab.id, msg.mode, msg.options);
    }
    // Forward progress to popup
    if (msg.type === 'clipProgress') {
      return; // Popup listens directly
    }
    if (msg.type === 'startElementPicker') {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { success: false, error: 'No active tab' };
      // Inject content script if needed, then start picker
      try {
        await browser.tabs.sendMessage(tab.id, { type: 'startElementPicker', options: msg.options });
      } catch {
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/content.js'],
        });
        await new Promise(r => setTimeout(r, 100));
        await browser.tabs.sendMessage(tab.id, { type: 'startElementPicker', options: msg.options });
      }
      return { success: true };
    }
    if (msg.type === 'getConfig') {
      const stored = await browser.storage.local.get('config');
      return stored.config || {};
    }
    if (msg.type === 'setConfig') {
      await browser.storage.local.set({ config: msg.config });
      return { success: true };
    }

    // ===== Content Script Fetch Proxy =====
    // Content scripts are restricted by page CSP, so we proxy fetches
    // through the background script which has unrestricted network access.
    if (msg.type === 'proxyFetch') {
      return handleProxyFetch(msg as any);
    }
  });

  // ===== Fetch Proxy Handler =====
  async function handleProxyFetch(msg: {
    subType: 'text' | 'dataUri';
    url: string;
    timeout: number;
  }): Promise<{ data: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), msg.timeout || 10000);

    try {
      const res = await fetch(msg.url, {
        mode: 'cors',
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) return { data: null };

      if (msg.subType === 'text') {
        return { data: await res.text() };
      }

      // dataUri: convert blob to base64 data URI
      const blob = await res.blob();
      if (blob.size > 5 * 1024 * 1024) {
        return { data: msg.url }; // Return original URL for large resources
      }
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      });
      return { data: dataUri };
    } catch (err) {
      clearTimeout(timer);
      log.warn('Proxy fetch failed', { url: msg.url, error: (err as Error).message });
      return { data: null };
    }
  }

  // ===== Send clip command to content script =====
  async function sendClip(tabId: number, mode: string, options?: Record<string, unknown>) {
    let result: any;

    try {
      result = await browser.tabs.sendMessage(tabId, { type: 'clip', mode, options });
    } catch {
      // Content script not loaded — inject it
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
      await new Promise(r => setTimeout(r, 100));
      result = await browser.tabs.sendMessage(tabId, { type: 'clip', mode, options });
    }

    if (result?.success) {
      // Read content from storage.local (bypasses sendMessage size limit)
      if (result.storageKey) {
        await retrieveAndDownload(result);
      } else if (result.content) {
        // Fallback for direct content (small clips like article/selection)
        await downloadClip(result.content, result.filename, result.format);
      }
    }

    return result;
  }

  async function retrieveAndDownload(result: { storageKey: string; filename: string; format: string; title?: string }) {
    const stored = await browser.storage.local.get([result.storageKey, `${result.storageKey}_meta`]);
    const content: string | undefined = stored[result.storageKey];

    if (!content) {
      log.warn('Clip content not found in storage (may have exceeded storage quota)', { key: result.storageKey });
      return;
    }

    try {
      await downloadClip(content, result.filename, result.format);

      // Cloud sync
      const configStored = await browser.storage.local.get('config');
      const config = configStored.config;
      if (config?.storageType && config.storageType !== 'none') {
        try {
          await syncToCloud(content, result.filename, config);
        } catch (err) {
          log.warn('Cloud sync failed', err);
        }
      }
    } finally {
      // Clean up storage
      await browser.storage.local.remove([result.storageKey, `${result.storageKey}_meta`]).catch(() => {});
    }
  }

  async function downloadClip(content: string, filename: string, format: string) {
    const mime = format === 'markdown' ? 'text/markdown' : 'text/html';
    // 使用 Blob URL 避免 data URI 的 URL 长度限制（~2MB）
    // Chrome MV3 Service Worker 支持 URL.createObjectURL
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    try {
      await browser.downloads.download({ url, filename, saveAs: false });
    } finally {
      // 延迟释放以让下载有机会启动
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }, 2000);
    }
  }

  async function syncToCloud(content: string, title: string, config: Record<string, string>) {
    switch (config.storageType) {
      case 'webdav': {
        const ext = config.defaultFormat === 'markdown' ? 'md' : 'html';
        const filename = `${title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
        const url = `${config.webdavEndpoint.replace(/\/$/, '')}/${filename}`;
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
        if (config.webdavUser && config.webdavPass) {
          headers['Authorization'] = 'Basic ' + btoa(`${config.webdavUser}:${config.webdavPass}`);
        }
        await fetch(url, { method: 'PUT', headers, body: content });
        break;
      }
      case 'yuque': {
        const token = config.yuqueToken;
        const repoId = parseInt(config.yuqueRepoId) || 0;
        if (!token || !repoId) return;

        // Check if doc with same title exists (auto-save dedup)
        const searchResult = await yuqueSearchDoc(token, repoId, title);
        if (searchResult.success && searchResult.doc) {
          // Update existing doc
          await yuqueUpdateDoc(token, repoId, searchResult.doc.id, title, content, {
            format: (config.defaultFormat as 'markdown' | 'html') || 'markdown',
          });
        } else {
          // Create new doc
          await yuqueCreateDoc(token, repoId, title, content, {
            format: (config.defaultFormat as 'markdown' | 'html') || 'markdown',
          });
        }
        break;
      }
      case 'github': {
        const ext = config.defaultFormat === 'markdown' ? 'md' : 'html';
        await fetch('https://api.github.com/gists', {
          method: 'POST',
          headers: {
            'Authorization': `token ${config.githubToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: `Clipped: ${title}`,
            public: false,
            files: { [`${title}.${ext}`]: { content } },
          }),
        });
        break;
      }
    }
  }
});

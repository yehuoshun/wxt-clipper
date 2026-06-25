import { yuqueCreateDoc, yuqueSearchDoc, yuqueUpdateDoc } from '../lib/storage/yuque';

export default defineBackground(() => {
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
        await browser.tabs.sendMessage(tab.id, { type: 'startElementPicker' });
      } catch {
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/content.js'],
        });
        await new Promise(r => setTimeout(r, 100));
        await browser.tabs.sendMessage(tab.id, { type: 'startElementPicker' });
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
  });

  // ===== Send clip command to content script =====
  async function sendClip(tabId: number, mode: string, options?: Record<string, unknown>) {
    try {
      const result = await browser.tabs.sendMessage(tabId, { type: 'clip', mode, options });
      if (result?.success && result.content) {
        await downloadClip(result);
      }
      return result;
    } catch {
      // Content script not loaded — inject it
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
      await new Promise(r => setTimeout(r, 100));
      const result = await browser.tabs.sendMessage(tabId, { type: 'clip', mode, options });
      if (result?.success && result.content) {
        await downloadClip(result);
      }
      return result;
    }
  }

  async function downloadClip(result: { content: string; filename: string; format: string }) {
    const mime = result.format === 'markdown' ? 'text/markdown' : 'text/html';
    const url = URL.createObjectURL(new Blob([result.content], { type: mime }));
    try {
      await browser.downloads.download({ url, filename: result.filename, saveAs: false });
    } finally {
      URL.revokeObjectURL(url);
    }

    // Try cloud sync if configured
    const stored = await browser.storage.local.get('config');
    const config = stored.config;
    if (!config?.storageType || config.storageType === 'none') return;

    try {
      await syncToCloud(result.content, result.filename, config);
    } catch (err) {
      console.warn('Cloud sync failed:', err);
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

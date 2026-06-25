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
      return await browser.tabs.sendMessage(tabId, { type: 'clip', mode, options });
    } catch {
      // Content script not loaded — inject it
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
      // Wait a tick then retry
      await new Promise(r => setTimeout(r, 100));
      return browser.tabs.sendMessage(tabId, { type: 'clip', mode, options });
    }
  }
});

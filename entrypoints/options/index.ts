import { yuqueGetUser, yuqueListAllRepos, openYuqueTokenPage } from '../../lib/storage/yuque';
import { getLogger, setLogLevel, getLogs, clearLogs, exportLogs } from '../../lib/logger';

const log = getLogger('options');

const stored = await browser.storage.local.get('config');
const config = stored.config || {};

// Form elements
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $input = (id: string) => document.getElementById(id) as HTMLInputElement;
const $select = (id: string) => document.getElementById(id) as HTMLSelectElement;

// Set values
if (config.defaultMode) $select('defaultMode').value = config.defaultMode;
if (config.defaultFormat) $select('defaultFormat').value = config.defaultFormat;
if (config.inlineResources !== false) $input('inlineResources').checked = true;
if (config.removeScripts !== false) $input('removeScripts').checked = true;
if (config.stripWatermarks !== false) $input('stripWatermarks').checked = true;
if (config.compressCSS !== false) $input('compressCSS').checked = true;
if (config.autoSave) $input('autoSave').checked = true;
if (config.autoSaveMode) $select('autoSaveMode').value = config.autoSaveMode;
if (config.autoSaveWhitelist) $input('autoSaveWhitelist').value = config.autoSaveWhitelist;
if (config.storageType) $select('storageType').value = config.storageType;
if (config.webdavEndpoint) $input('webdavEndpoint').value = config.webdavEndpoint;
if (config.webdavUser) $input('webdavUser').value = config.webdavUser;
if (config.webdavPass) $input('webdavPass').value = config.webdavPass;
if (config.yuqueToken) $input('yuqueToken').value = config.yuqueToken;
if (config.yuqueRepoId) $select('yuqueRepoId').value = config.yuqueRepoId;
// Load repo list if token exists
if (config.yuqueToken) fetchYuqueRepos(config.yuqueToken, config.yuqueRepoId);
if (config.githubToken) $input('githubToken').value = config.githubToken;

// Auto-save toggle
$input('autoSave').addEventListener('change', updateAutoSaveFields);
function updateAutoSaveFields() {
  const show = $input('autoSave').checked;
  $('autoSaveModeField').style.display = show ? '' : 'none';
  $('autoSaveWhitelistField').style.display = show ? '' : 'none';
}
updateAutoSaveFields();

// Storage type toggle
$select('storageType').addEventListener('change', updateStorageFields);
function updateStorageFields() {
  const type = $select('storageType').value;
  $('webdavFields').style.display = type === 'webdav' ? '' : 'none';
  $('yuqueFields').style.display = type === 'yuque' ? '' : 'none';
  $('githubFields').style.display = type === 'github' ? '' : 'none';
}
updateStorageFields();

// Save
$('saveBtn').addEventListener('click', async () => {
  const newConfig = {
    defaultMode: $select('defaultMode').value,
    defaultFormat: $select('defaultFormat').value,
    inlineResources: $input('inlineResources').checked,
    removeScripts: $input('removeScripts').checked,
    stripWatermarks: $input('stripWatermarks').checked,
    compressCSS: $input('compressCSS').checked,
    autoSave: $input('autoSave').checked,
    autoSaveMode: $select('autoSaveMode').value,
    autoSaveWhitelist: $input('autoSaveWhitelist').value,
    storageType: $select('storageType').value,
    webdavEndpoint: $input('webdavEndpoint').value,
    webdavUser: $input('webdavUser').value,
    webdavPass: $input('webdavPass').value,
    yuqueToken: $input('yuqueToken').value,
    yuqueRepoId: $select('yuqueRepoId').value,
    githubToken: $input('githubToken').value,
  };

  await browser.storage.local.set({ config: newConfig });
  showToast('✅ 设置已保存', 'success');
});

// Test connection
$('testBtn').addEventListener('click', async () => {
  const type = $select('storageType').value;
  if (type === 'none') {
    showToast('⚠️ 未选择云端存储', 'error');
    return;
  }

  showToast('⏳ 测试连接中...', 'success');

  try {
    let ok = false;
    switch (type) {
      case 'webdav': {
        const endpoint = $input('webdavEndpoint').value;
        if (!endpoint) { showToast('❌ 请输入 WebDAV 地址', 'error'); return; }
        const headers: Record<string, string> = { 'Depth': '0' };
        const user = $input('webdavUser').value;
        const pass = $input('webdavPass').value;
        if (user && pass) headers['Authorization'] = 'Basic ' + btoa(`${user}:${pass}`);
        const res = await fetch(endpoint, { method: 'PROPFIND', headers });
        ok = res.ok;
        break;
      }
      case 'yuque': {
        const token = $input('yuqueToken').value;
        if (!token) { showToast('❌ 请输入语雀 Token', 'error'); return; }
        const result = await yuqueGetUser(token);
        ok = result.success;
        break;
      }
      case 'github': {
        const token = $input('githubToken').value;
        if (!token) { showToast('❌ 请输入 GitHub Token', 'error'); return; }
        const res = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': `token ${token}` },
        });
        ok = res.ok;
        break;
      }
    }
    showToast(ok ? '✅ 连接成功' : '❌ 连接失败，请检查配置', ok ? 'success' : 'error');
  } catch {
    showToast('❌ 连接失败', 'error');
  }
});

// One-click auth button
$('yuqueAuthBtn').addEventListener('click', () => {
  openYuqueTokenPage();
  showToast('🔑 请在打开的页面中创建 Token 并粘贴到此处', 'success');
});

// Fetch repos button
$('fetchReposBtn').addEventListener('click', async () => {
  const token = $input('yuqueToken').value;
  if (!token) { showToast('❌ 请先填写 Token', 'error'); return; }
  showToast('⏳ 获取知识库列表...', 'success');
  await fetchYuqueRepos(token);
});

async function fetchYuqueRepos(token: string, selectedId?: string) {
  const select = $select('yuqueRepoId');
  select.innerHTML = '<option value="">加载中...</option>';

  const result = await yuqueListAllRepos(token, 'all');
  if (!result.success || !result.repos) {
    select.innerHTML = '<option value="">获取失败，请检查 Token</option>';
    showToast('❌ 获取知识库失败: ' + (result.error || '未知错误'), 'error');
    return;
  }

  const repos = result.repos;
  select.innerHTML = repos.length > 0
    ? repos.map(r => `<option value="${r.id}" ${String(r.id) === selectedId ? 'selected' : ''}>${r.name} (${r.items_count || 0} 篇)</option>`).join('')
    : '<option value="">未找到知识库</option>';

  showToast(`✅ 找到 ${repos.length} 个知识库`, 'success');
}

// ===== Log Viewer =====

async function renderLogs() {
  const container = $('logContainer');
  try {
    const logs = await getLogs(100);
    if (logs.length === 0) {
      container.innerHTML = '<div class="log-empty">暂无日志</div>';
      return;
    }
    container.innerHTML = logs.map(e => {
      const lvl = e.l.toUpperCase();
      const time = new Date(e.t).toLocaleTimeString('zh-CN', { hour12: false });
      const dataStr = e.data ? ` ${JSON.stringify(e.data)}` : '';
      return `<div class="log-entry"><span class="log-time">${time}</span><span class="log-level ${lvl}">${lvl}</span><span class="log-module">[${e.m}]</span>${escapeLog(e.msg)}${escapeLog(dataStr)}</div>`;
    }).join('');
    container.scrollTop = 0;
  } catch (err) {
    container.innerHTML = `<div class="log-empty">加载日志失败: ${err}</div>`;
  }
}

function escapeLog(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Restore log level from storage
async function restoreLogLevel() {
  try {
    const stored = await browser.storage.local.get('logLevel');
    if (stored.logLevel) {
      ($('logLevel') as HTMLSelectElement).value = stored.logLevel;
    }
  } catch { /* ignore */ }
}

// Log level change
$('logLevel').addEventListener('change', async () => {
  const level = ($('logLevel') as HTMLSelectElement).value as 'debug' | 'info' | 'warn' | 'error';
  await setLogLevel(level);
  showToast(`✅ 日志级别已设置为 ${level.toUpperCase()}`, 'success');
  log.info(`Log level changed to ${level}`);
});

$('refreshLogsBtn').addEventListener('click', renderLogs);
$('clearLogsBtn').addEventListener('click', async () => {
  await clearLogs();
  renderLogs();
  showToast('✅ 日志已清空', 'success');
});
$('exportLogsBtn').addEventListener('click', async () => {
  const text = await exportLogs();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `webclipper-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ 日志已导出', 'success');
});

// Initial load
restoreLogLevel();
renderLogs();

function showToast(msg: string, type: string) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2500);
}

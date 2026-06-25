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
if (config.yuqueRepoId) $input('yuqueRepoId').value = config.yuqueRepoId;
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
    yuqueRepoId: $input('yuqueRepoId').value,
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
        const res = await fetch('https://www.yuque.com/api/v2/user', {
          headers: { 'X-Auth-Token': token },
        });
        ok = res.ok;
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

function showToast(msg: string, type: string) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2500);
}

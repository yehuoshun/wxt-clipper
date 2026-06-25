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

  try {
    // Fetch user repos
    const userRes = await fetch('https://www.yuque.com/api/v2/user/repos?type=all', {
      headers: { 'X-Auth-Token': token },
    });
    const userData = await userRes.json();
    const repos: Array<{ id: number; name: string; namespace: string }> = [];

    if (userData.data) {
      repos.push(...userData.data.map((r: any) => ({
        id: r.id, name: r.name, namespace: r.namespace,
      })));
    }

    // Fetch group repos
    try {
      const groupsRes = await fetch('https://www.yuque.com/api/v2/user/groups', {
        headers: { 'X-Auth-Token': token },
      });
      const groupsData = await groupsRes.json();
      if (groupsData.data) {
        for (const g of groupsData.data) {
          try {
            const grRes = await fetch(`https://www.yuque.com/api/v2/groups/${g.login}/repos`, {
              headers: { 'X-Auth-Token': token },
            });
            const grData = await grRes.json();
            if (grData.data) {
              repos.push(...grData.data.map((r: any) => ({
                id: r.id, name: `[${g.name}] ${r.name}`, namespace: r.namespace,
              })));
            }
          } catch { /* skip failed groups */ }
        }
      }
    } catch { /* skip groups */ }

    select.innerHTML = repos.length > 0
      ? repos.map(r => `<option value="${r.id}" ${String(r.id) === selectedId ? 'selected' : ''}>${r.name}</option>`).join('')
      : '<option value="">未找到知识库</option>';

    showToast(`✅ 找到 ${repos.length} 个知识库`, 'success');
  } catch (err) {
    select.innerHTML = '<option value="">获取失败，请检查 Token</option>';
    showToast('❌ 获取知识库失败', 'error');
  }
}

function showToast(msg: string, type: string) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Load saved config
const stored = await browser.storage.local.get('config');
const config = stored.config || {};

// Set form values
const defaultMode = document.getElementById('defaultMode') as HTMLSelectElement;
const defaultFormat = document.getElementById('defaultFormat') as HTMLSelectElement;
const storageType = document.getElementById('storageType') as HTMLSelectElement;

if (config.defaultMode) defaultMode.value = config.defaultMode;
if (config.defaultFormat) defaultFormat.value = config.defaultFormat;
if (config.storageType) storageType.value = config.storageType;

// Show/hide storage fields
function updateStorageFields() {
  const type = storageType.value;
  document.getElementById('webdavFields')!.style.display = type === 'webdav' ? '' : 'none';
  document.getElementById('yuqueFields')!.style.display = type === 'yuque' ? '' : 'none';
  document.getElementById('githubFields')!.style.display = type === 'github' ? '' : 'none';
}

storageType.addEventListener('change', updateStorageFields);
updateStorageFields();

// Fill storage fields
if (config.webdavEndpoint) (document.getElementById('webdavEndpoint') as HTMLInputElement).value = config.webdavEndpoint;
if (config.webdavUser) (document.getElementById('webdavUser') as HTMLInputElement).value = config.webdavUser;
if (config.webdavPass) (document.getElementById('webdavPass') as HTMLInputElement).value = config.webdavPass;
if (config.yuqueToken) (document.getElementById('yuqueToken') as HTMLInputElement).value = config.yuqueToken;
if (config.yuqueRepoId) (document.getElementById('yuqueRepoId') as HTMLInputElement).value = config.yuqueRepoId;
if (config.githubToken) (document.getElementById('githubToken') as HTMLInputElement).value = config.githubToken;

// Save
document.getElementById('saveBtn')?.addEventListener('click', async () => {
  const newConfig = {
    defaultMode: defaultMode.value,
    defaultFormat: defaultFormat.value,
    storageType: storageType.value,
    webdavEndpoint: (document.getElementById('webdavEndpoint') as HTMLInputElement).value,
    webdavUser: (document.getElementById('webdavUser') as HTMLInputElement).value,
    webdavPass: (document.getElementById('webdavPass') as HTMLInputElement).value,
    yuqueToken: (document.getElementById('yuqueToken') as HTMLInputElement).value,
    yuqueRepoId: (document.getElementById('yuqueRepoId') as HTMLInputElement).value,
    githubToken: (document.getElementById('githubToken') as HTMLInputElement).value,
  };

  await browser.storage.local.set({ config: newConfig });
  showToast('✅ 设置已保存', 'success');
});

function showToast(msg: string, type: string) {
  const toast = document.getElementById('toast')!;
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 2000);
}

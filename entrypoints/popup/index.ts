let currentMode = 'fullpage';

// Mode selection
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.getAttribute('data-mode') || 'fullpage';
  });
});

// Clip button
document.getElementById('clipBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('clipBtn') as HTMLButtonElement;
  const status = document.getElementById('status')!;

  btn.disabled = true;
  btn.textContent = '剪藏中...';
  status.className = 'status loading';
  status.textContent = '正在处理...';
  status.classList.remove('hidden');

  try {
    const format = (document.getElementById('format') as HTMLSelectElement).value;
    const inlineResources = (document.getElementById('inlineResources') as HTMLInputElement).checked;
    const removeScripts = (document.getElementById('removeScripts') as HTMLInputElement).checked;

    const response = await browser.runtime.sendMessage({
      type: 'clip',
      mode: currentMode,
      options: { format, inlineResources, removeScripts },
    });

    if (response?.success) {
      status.className = 'status success';
      status.textContent = `✅ 已保存：${response.filename}`;
      setTimeout(() => window.close(), 1500);
    } else {
      status.className = 'status error';
      status.textContent = `❌ ${response?.error || '剪藏失败'}`;
    }
  } catch (err) {
    status.className = 'status error';
    status.textContent = `❌ ${err}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '剪藏';
  }
});

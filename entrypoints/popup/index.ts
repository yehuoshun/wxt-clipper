let currentMode = 'fullpage';

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.getAttribute('data-mode') || 'fullpage';
  });
});

// Listen for progress updates from content script
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'clipProgress') {
    updateProgress(msg.current, msg.total, msg.step);
  }
});

document.getElementById('clipBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('clipBtn') as HTMLButtonElement;
  const status = document.getElementById('status')!;
  const progress = document.getElementById('progress')!;
  const format = (document.getElementById('format') as HTMLSelectElement).value;
  const inlineResources = (document.getElementById('inlineResources') as HTMLInputElement).checked;
  const removeScripts = (document.getElementById('removeScripts') as HTMLInputElement).checked;

  if (currentMode === 'element') {
    window.close();
    await browser.runtime.sendMessage({
      type: 'startElementPicker',
      options: { format, inlineResources, removeScripts },
    });
    return;
  }

  btn.disabled = true;
  btn.textContent = '剪藏中...';
  progress.classList.remove('hidden');
  updateProgress(0, 1, '准备中...');
  status.classList.add('hidden');

  try {
    const response = await browser.runtime.sendMessage({
      type: 'clip',
      mode: currentMode,
      options: { format, inlineResources, removeScripts },
    });

    progress.classList.add('hidden');

    if (response?.success) {
      status.className = 'status success';
      status.textContent = `✅ 已保存：${response.filename}`;
      status.classList.remove('hidden');
      setTimeout(() => window.close(), 1500);
    } else {
      status.className = 'status error';
      status.textContent = `❌ ${response?.error || '剪藏失败'}`;
      status.classList.remove('hidden');
    }
  } catch (err) {
    progress.classList.add('hidden');
    status.className = 'status error';
    status.textContent = `❌ ${err}`;
    status.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '剪藏';
  }
});

function updateProgress(current: number, total: number, step: string) {
  const fill = document.querySelector('.progress-fill') as HTMLElement;
  const text = document.querySelector('.progress-text') as HTMLElement;
  if (fill) fill.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
  if (text) text.textContent = step;
}

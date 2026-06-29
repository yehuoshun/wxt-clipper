import { captureFullPage } from '../lib/capture/fullpage';
import { captureArticle } from '../lib/capture/readability';
import { captureSelection } from '../lib/capture/selection';
import { toMarkdown } from '../lib/format/markdown';
import { serializeHTML } from '../lib/format/html';
import { getLogger } from '../lib/logger';

const log = getLogger('content');

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  main() {
    let elementPickerActive = false;

    browser.runtime.onMessage.addListener(async (msg: { type: string; mode: string; options?: Record<string, unknown> }) => {
      if (msg.type === 'startElementPicker') {
        startElementPicker();
        return { success: true };
      }

      if (msg.type === 'stopElementPicker') {
        stopElementPicker();
        return { success: true };
      }

      if (msg.type !== 'clip') return;

      const { mode, options = {} } = msg;
      const format = (options.format as string) || 'html';

      try {
        let result: { title: string; html: string; url: string };

        switch (mode) {
          case 'fullpage':
            result = await captureFullPage(document, {
              ...options,
              onProgress: (c, t, s) => {
                browser.runtime.sendMessage({ type: 'clipProgress', current: c, total: t, step: s }).catch(() => {});
              },
            });
            break;
          case 'article':
            result = await captureArticle(document, options);
            break;
          case 'selection':
            result = await captureSelection(document, options);
            break;
          case 'element':
            // Element picker mode — wait for user to click
            const selector = await pickElement();
            if (!selector) return { success: false, error: 'Element selection cancelled' };
            result = await captureFullPage(document, { ...options, selector });
            break;
          default:
            return { success: false, error: `Unknown mode: ${mode}` };
        }

        const content = format === 'markdown' ? toMarkdown(result.html) : serializeHTML(result.html, result.title);
        const ext = format === 'markdown' ? 'md' : 'html';
        const filename = `${sanitizeFilename(result.title || document.title)}.${ext}`;

        // Store content in storage.local to bypass sendMessage size limit (Chrome ~64KB per message)
        // Background will read it from storage instead of from the message response
        const storageKey = `__clip_result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await browser.storage.local.set({
          [storageKey]: content,
          [`${storageKey}_meta`]: { filename, format, title: result.title, url: result.url },
        });

        return {
          success: true,
          storageKey,
          filename,
          format,
          title: result.title,
          url: result.url,
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    // ===== Element Picker =====

    let overlay: HTMLDivElement | null = null;
    let highlight: HTMLDivElement | null = null;
    let pickerResolve: ((value: string | null) => void) | null = null;

    function startElementPicker() {
      if (elementPickerActive) return;
      elementPickerActive = true;

      // Create overlay
      overlay = document.createElement('div');
      overlay.id = '__clipper_overlay';
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        z-index: 2147483647; cursor: crosshair;
        background: rgba(0,0,0,0.05);
      `;
      document.body.appendChild(overlay);

      // Create highlight
      highlight = document.createElement('div');
      highlight.id = '__clipper_highlight';
      highlight.style.cssText = `
        position: fixed; z-index: 2147483646;
        border: 2px solid #0366d6; background: rgba(3,102,214,0.1);
        pointer-events: none; transition: all 0.1s ease;
        display: none;
      `;
      document.body.appendChild(highlight);

      overlay.addEventListener('mousemove', onPickerMove);
      overlay.addEventListener('click', onPickerClick, true);
      document.addEventListener('keydown', onPickerEscape);
    }

    function stopElementPicker() {
      elementPickerActive = false;
      overlay?.remove();
      highlight?.remove();
      overlay = null;
      highlight = null;
      document.removeEventListener('keydown', onPickerEscape);

      if (pickerResolve) {
        pickerResolve(null);
        pickerResolve = null;
      }
    }

    function onPickerMove(e: MouseEvent) {
      if (!highlight) return;
      const target = e.target as HTMLElement;
      if (!target || target === overlay || target === highlight) {
        highlight.style.display = 'none';
        return;
      }

      const rect = target.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.top = rect.top + 'px';
      highlight.style.left = rect.left + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';
    }

    function onPickerClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement;
      if (!target || target === overlay || target === highlight) return;

      // Generate a unique selector
      const selector = generateSelector(target);
      stopElementPicker();

      if (pickerResolve) {
        pickerResolve(selector);
        pickerResolve = null;
      }
    }

    function onPickerEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') stopElementPicker();
    }

    function pickElement(): Promise<string | null> {
      return new Promise(resolve => {
        pickerResolve = resolve;
        startElementPicker();
      });
    }

    function generateSelector(el: HTMLElement): string {
      // Try ID first
      if (el.id) return `#${CSS.escape(el.id)}`;

      // Try unique class combination
      const classes = Array.from(el.classList).filter(c => !c.startsWith('__clipper'));
      if (classes.length > 0) {
        const classSelector = classes.map(c => `.${CSS.escape(c)}`).join('');
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      }

      // Build path
      const path: string[] = [];
      let current: HTMLElement | null = el;

      while (current && current !== document.body && current !== document.documentElement) {
        let segment = current.tagName.toLowerCase();

        if (current.id) {
          path.unshift(`#${CSS.escape(current.id)}`);
          break;
        }

        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            c => c.tagName === current!.tagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            segment += `:nth-child(${index})`;
          }
        }

        path.unshift(segment);
        current = current.parentElement;
      }

      return path.join(' > ');
    }
  },
});

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

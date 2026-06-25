import { captureFullPage } from '../lib/capture/fullpage';
import { captureArticle } from '../lib/capture/readability';
import { captureSelection } from '../lib/capture/selection';
import { toMarkdown } from '../lib/format/markdown';
import { serializeHTML } from '../lib/format/html';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  main() {
    // Listen for clip commands from background
    browser.runtime.onMessage.addListener(async (msg: { type: string; mode: string; options?: Record<string, unknown> }) => {
      if (msg.type !== 'clip') return;

      const { mode, options = {} } = msg;
      const format = (options.format as string) || 'html';

      try {
        let result: { title: string; html: string; url: string };

        switch (mode) {
          case 'fullpage':
            result = await captureFullPage(document, options);
            break;
          case 'article':
            result = await captureArticle(document, options);
            break;
          case 'selection':
            result = await captureSelection(document, options);
            break;
          default:
            return { success: false, error: `Unknown mode: ${mode}` };
        }

        const content = format === 'markdown' ? toMarkdown(result.html) : serializeHTML(result.html, result.title);
        const ext = format === 'markdown' ? 'md' : 'html';
        const filename = `${sanitizeFilename(result.title || document.title)}.${ext}`;

        return {
          success: true,
          content,
          filename,
          format,
          title: result.title,
          url: result.url,
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });
  },
});

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

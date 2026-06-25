/**
 * Selection capture — clip selected content from the page.
 * Preserves the DOM structure of the selected region.
 */

import { stripWatermarks } from './watermark';

interface SelectionOptions {
  /** Include parent heading context */
  includeContext?: boolean;
}

interface CaptureResult {
  title: string;
  html: string;
  url: string;
}

export async function captureSelection(
  doc: Document,
  options: SelectionOptions = {}
): Promise<CaptureResult> {
  const { includeContext = true } = options;

  const sel = doc.getSelection();
  if (!sel || sel.isCollapsed) {
    throw new Error('没有选中任何内容');
  }

  const range = sel.getRangeAt(0);
  const fragment = range.cloneContents();
  const container = doc.createElement('div');
  container.appendChild(fragment);

  // Get the title from context
  const title = getSelectionTitle(doc, range);

  // Build output
  let html = `<h1>${escapeHtml(title)}</h1>\n`;
  html += `<p><em>Source: <a href="${escapeHtml(doc.URL)}">${escapeHtml(doc.URL)}</a></em></p>\n`;

  if (includeContext) {
    const context = getSelectionContext(range);
    if (context) {
      html += `<blockquote>${context}</blockquote>\n`;
    }
  }

  html += `<hr>\n`;
  html += container.innerHTML;

  // Strip watermarks
  const tempDiv = doc.createElement('div');
  tempDiv.innerHTML = html;
  stripWatermarks(tempDiv);
  html = tempDiv.innerHTML;

  // Inline images in selection
  const imgDiv = doc.createElement('div');
  imgDiv.innerHTML = html;
  const imgs = imgDiv.querySelectorAll('img[src]');
  await Promise.all(
    Array.from(imgs).map(async (img) => {
      const src = img.getAttribute('src')!;
      if (src.startsWith('data:')) return;
      try {
        const dataUri = await fetchAsDataUri(src);
        if (dataUri) img.setAttribute('src', dataUri);
      } catch { /* keep original */ }
    })
  );
  html = imgDiv.innerHTML;

  return { title, html, url: doc.URL };
}

function getSelectionTitle(doc: Document, range: Range): string {
  // Try to find the nearest heading before the selection
  let node: Node | null = range.startContainer;
  while (node && node !== doc.body) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading?.textContent) return heading.textContent.trim();
    }
    // Check previous siblings
    let prev = node.previousSibling;
    while (prev) {
      if (prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as Element;
        const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
        if (heading?.textContent) return heading.textContent.trim();
        if (el.matches('h1, h2, h3, h4, h5, h6') && el.textContent) {
          return el.textContent.trim();
        }
      }
      prev = prev.previousSibling;
    }
    node = node.parentNode;
  }

  // Fallback to page title
  const h1 = doc.querySelector('h1');
  if (h1?.textContent) return h1.textContent.trim();
  return doc.title;
}

function getSelectionContext(range: Range): string {
  // Get the parent section/heading as context
  let node: Node | null = range.startContainer;
  while (node && node !== document.body) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      // Find the closest section/article container
      if (el.matches('section, article, .section, .chapter')) {
        const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
        if (heading?.textContent) {
          return `选自：${escapeHtml(heading.textContent.trim())}`;
        }
      }
    }
    node = node.parentNode;
  }
  return '';
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, c => map[c]);
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

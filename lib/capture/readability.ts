/**
 * Article capture using Mozilla Readability.
 * Extracts clean article content from web pages.
 */

import { fetchAsDataUri } from '../resource/fetcher';

interface ArticleOptions {
  keepImages?: boolean;
}

interface CaptureResult {
  title: string;
  html: string;
  url: string;
}

export async function captureArticle(
  doc: Document,
  options: ArticleOptions = {}
): Promise<CaptureResult> {
  const { keepImages = true } = options;

  // Clone the document for Readability (it mutates the DOM)
  const clone = doc.cloneNode(true) as Document;
  const url = doc.URL;

  // Use Mozilla Readability
  let article: { title: string; content: string; textContent: string } | null = null;

  try {
    // @ts-ignore — Readability is bundled
    if (typeof Readability !== 'undefined') {
      // @ts-ignore
      const reader = new Readability(clone);
      article = reader.parse();
    }
  } catch { /* fall through to lightweight */ }

  // Fallback to lightweight implementation
  if (!article) {
    article = lightweightExtract(doc);
  }

  const title = article.title || doc.title;

  // Build clean HTML with watermark
  let html = `<h1>${escapeHtml(title)}</h1>\n`;
  html += `<p><em>Source: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></em></p>\n`;
  html += `<hr>\n`;
  html += article.content;

  // Inline images
  if (keepImages) {
    const temp = doc.createElement('div');
    temp.innerHTML = html;
    const imgs = temp.querySelectorAll('img[src]');
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
    html = temp.innerHTML;
  }

  return { title, html, url };
}

// ===== Lightweight Fallback =====

function lightweightExtract(doc: Document): { title: string; content: string; textContent: string } {
  const title = getArticleTitle(doc);
  const content = getArticleContent(doc);
  const textContent = doc.body.innerText.slice(0, 10000);
  return { title, content, textContent };
}

function getArticleTitle(doc: Document): string {
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle) return ogTitle.getAttribute('content') || '';

  const h1 = doc.querySelector('h1');
  if (h1?.textContent) return h1.textContent.trim();

  return doc.title;
}

function getArticleContent(doc: Document): string {
  const selectors = [
    'article', '[role="main"]', 'main',
    '.post-content', '.article-content', '.entry-content',
    '.content', '#content', '.post-body', '.article-body',
  ];

  let container: Element | null = null;
  for (const sel of selectors) {
    container = doc.querySelector(sel);
    if (container && (container.textContent?.length || 0) > 200) break;
    container = null;
  }

  if (!container) {
    container = findLargestTextBlock(doc.body);
  }

  if (!container) {
    return `<p>${escapeHtml(doc.body.innerText.slice(0, 5000))}</p>`;
  }

  const clone = container.cloneNode(true) as HTMLElement;

  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe',
    'nav', 'header', 'footer',
    '.sidebar', '.aside', '.comments', '.comment',
    '.advertisement', '.ad', '.ads',
    '.social-share', '.share-buttons',
    '.related-posts', '.recommended',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  ];

  removeSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });

  clone.querySelectorAll('*').forEach(el => {
    const keep = ['href', 'src', 'alt', 'title'];
    const attrs = el.getAttributeNames();
    attrs.filter(a => !keep.includes(a)).forEach(a => el.removeAttribute(a));
  });

  return clone.innerHTML;
}

function findLargestTextBlock(parent: Element): Element | null {
  let best: Element | null = null;
  let bestScore = 0;

  function walk(el: Element) {
    const textLen = (el.textContent || '').length;
    const tagCount = el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, code').length;
    const score = textLen + tagCount * 50;

    if (score > bestScore && textLen > 500) {
      best = el;
      bestScore = score;
    }

    for (const child of el.children) walk(child);
  }

  walk(parent);
  return best;
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, c => map[c]);
}

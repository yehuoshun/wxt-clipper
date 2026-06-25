/**
 * Article capture using Mozilla Readability.
 * Extracts clean article content from web pages.
 */

interface ArticleOptions {
  /** Keep images inline */
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

  // We use Readability bundled in the extension
  // For now, implement a lightweight version inline
  const article = extractArticle(doc);

  const title = article.title || doc.title;
  const url = doc.URL;

  // Build clean HTML
  let html = `<h1>${escapeHtml(title)}</h1>\n`;
  html += `<p><em>来源：<a href="${escapeHtml(url)}">${escapeHtml(url)}</a></em></p>\n`;
  html += `<hr>\n`;
  html += article.content;

  // Optionally inline images
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

// ===== Lightweight Readability Implementation =====

function extractArticle(doc: Document): { title: string; content: string } {
  const title = getArticleTitle(doc);
  const content = getArticleContent(doc);
  return { title, content };
}

function getArticleTitle(doc: Document): string {
  // Try meta tags first
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle) return ogTitle.getAttribute('content') || '';

  const h1 = doc.querySelector('h1');
  if (h1?.textContent) return h1.textContent.trim();

  return doc.title;
}

function getArticleContent(doc: Document): string {
  // Try common article containers
  const selectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
    '.post-body',
    '.article-body',
  ];

  let container: Element | null = null;
  for (const sel of selectors) {
    container = doc.querySelector(sel);
    if (container && container.textContent && container.textContent.length > 200) break;
    container = null;
  }

  if (!container) {
    // Fallback: find the largest text block
    container = findLargestTextBlock(doc.body);
  }

  if (!container) {
    return `<p>${escapeHtml(doc.body.innerText.slice(0, 5000))}</p>`;
  }

  // Clone and clean
  const clone = container.cloneNode(true) as HTMLElement;

  // Remove non-content elements
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

  // Clean attributes
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

    for (const child of el.children) {
      walk(child);
    }
  }

  walk(parent);
  return best;
}

// ===== Helpers =====

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
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

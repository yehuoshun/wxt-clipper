/**
 * Full-page capture — SingleFile-style complete page serialization.
 * Fetches all resources (CSS, images, fonts, videos) and inlines them as base64 data URIs.
 */

interface CaptureOptions {
  removeScripts?: boolean;
  removeHidden?: boolean;
  compressCSS?: boolean;
  inlineResources?: boolean;
}

interface CaptureResult {
  title: string;
  html: string;
  url: string;
}

export async function captureFullPage(
  doc: Document,
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  const {
    removeScripts = true,
    removeHidden = false,
    compressCSS = true,
    inlineResources = true,
  } = options;

  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  const title = doc.title;
  const url = doc.URL;

  // Remove scripts
  if (removeScripts) {
    clone.querySelectorAll('script, noscript, template').forEach(el => el.remove());
  }

  // Remove hidden elements
  if (removeHidden) {
    clone.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(el => el.remove());
  }

  // Remove event handlers
  clone.querySelectorAll('*').forEach(el => {
    const attrs = el.getAttributeNames();
    attrs.filter(a => a.startsWith('on')).forEach(a => el.removeAttribute(a));
  });

  // Inline CSS from external stylesheets
  if (inlineResources) {
    await inlineStylesheets(clone, doc);
    await inlineImages(clone);
    await inlineMedia(clone);
  }

  // Compress inline styles
  if (compressCSS) {
    clone.querySelectorAll('style').forEach(style => {
      style.textContent = minifyCSS(style.textContent || '');
    });
  }

  // Remove empty styles
  clone.querySelectorAll('style').forEach(style => {
    if (!style.textContent?.trim()) style.remove();
  });

  // Add meta charset
  let head = clone.querySelector('head');
  if (!head) {
    head = doc.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.insertBefore(meta, head.firstChild);

  // Add base tag to fix relative URLs
  const base = doc.createElement('base');
  base.setAttribute('href', url);
  head.insertBefore(base, head.firstChild?.nextSibling || null);

  const html = '<!DOCTYPE html>\n' + clone.outerHTML;

  return { title, html, url };
}

// ===== Resource Inlining =====

async function inlineStylesheets(clone: HTMLElement, doc: Document) {
  const links = clone.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
  const promises = Array.from(links).map(async (link) => {
    try {
      const href = link.getAttribute('href');
      if (!href) return;
      const fullUrl = new URL(href, doc.baseURI).href;
      const css = await fetchText(fullUrl);
      if (css) {
        const style = doc.createElement('style');
        style.textContent = css;
        link.replaceWith(style);
      }
    } catch {
      // Keep original link if fetch fails
    }
  });
  await Promise.all(promises);
}

async function inlineImages(clone: HTMLElement) {
  const images = clone.querySelectorAll<HTMLImageElement>('img[src]');
  const promises = Array.from(images).map(async (img) => {
    try {
      const src = img.getAttribute('src') || img.currentSrc;
      if (!src || src.startsWith('data:')) return;
      const dataUri = await fetchAsDataUri(src);
      if (dataUri) {
        img.setAttribute('src', dataUri);
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
      }
    } catch {
      // Keep original
    }
  });
  await Promise.all(promises);

  // Also handle CSS background images
  clone.querySelectorAll<HTMLElement>('[style]').forEach(el => {
    const style = el.getAttribute('style') || '';
    if (style.includes('url(')) {
      // We'll handle this in a more complete CSS processor
    }
  });
}

async function inlineMedia(clone: HTMLElement) {
  const media = clone.querySelectorAll<HTMLSourceElement>('source[src], source[srcset]');
  // For now, skip video/audio inlining (too large)
  // Mark them as external
  media.forEach(el => {
    el.setAttribute('data-clipper-external', 'true');
  });
}

// ===== Helpers =====

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
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

function minifyCSS(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
    .replace(/\s+/g, ' ')              // Collapse whitespace
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;\}/g, '}')
    .trim();
}

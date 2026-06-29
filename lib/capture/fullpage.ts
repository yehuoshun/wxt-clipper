/**
 * Full-page capture engine — complete page serialization.
 *
 * Features:
 * - CSS background-image inlining (inline styles + <style> blocks)
 * - Font capture (document.fonts + @font-face)
 * - Canvas → <img> conversion
 * - Shadow DOM recursive traversal
 * - iframe recursive processing
 * - Lazy loading trigger (IntersectionObserver + scroll)
 * - Source URL watermark
 * - Element selector support (clip specific element)
 */

import { fetchAsDataUri, fetchText } from '../resource/fetcher';
import { stripWatermarks } from './watermark';
import { getLogger } from '../logger';

const log = getLogger('capture-fullpage');

interface CaptureOptions {
  removeScripts?: boolean;
  removeHidden?: boolean;
  compressCSS?: boolean;
  inlineResources?: boolean;
  selector?: string;
  maxFrameDepth?: number;
  /** Progress callback */
  onProgress?: (current: number, total: number, step: string) => void;
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
    selector,
    maxFrameDepth = 3,
    onProgress,
  } = options;

  const report = (c: number, t: number, s: string) => onProgress?.(c, t, s);

  const url = doc.URL;
  const title = doc.title;

  // Clone the document FIRST — never mutate the live document
  let source: Element;
  if (selector) {
    const el = doc.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    source = el;
  } else {
    source = doc.documentElement;
  }

  const clone = source.cloneNode(true) as HTMLElement;

  // Resolve lazy images on the CLONE (not live doc) — avoid live DOM side effects
  if (inlineResources) {
    report(1, 8, '触发懒加载内容...');
    resolveLazyImages(clone);
  }

  // Strip hidden watermarks on the CLONE (never modify live document)
  report(3, 8, '清洗隐藏水印...');
  const watermarkCount = stripWatermarks(clone);
  if (watermarkCount > 0) {
    log.info(`Stripped ${watermarkCount} watermark elements`);
  }
  const titleFromClone = selector ? getElementTitle(doc, selector) : title;

  // Process Shadow DOM
  report(2, 8, '处理 Shadow DOM...');
  processShadowDOM(doc, clone);

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

  // Inline all resources
  if (inlineResources) {
    report(4, 8, '内联样式表...');
    await inlineStylesheets(clone, doc);
    report(5, 8, '内联背景图...');
    await inlineStyleBackgrounds(clone, doc);
    await inlineImages(clone);
    report(6, 8, '内联 CSS 背景图...');
    await inlineCSSBackgroundImages(clone, doc);
    report(7, 8, '捕获字体 & Canvas...');
    await inlineFonts(clone, doc);
    await convertCanvasToImages(clone, doc);
    report(8, 8, '处理 iframe...');
    await processIframes(clone, doc, maxFrameDepth);
  }

  // Compress CSS
  if (compressCSS) {
    clone.querySelectorAll('style').forEach(style => {
      style.textContent = minifyCSS(style.textContent || '');
    });
  }

  // Remove empty styles
  clone.querySelectorAll('style').forEach(style => {
    if (!style.textContent?.trim()) style.remove();
  });

  // Extract body content + style tags (not a full document, since serializeHTML wraps it)
  let bodyHtml: string;

  if (selector) {
    // Element-specific capture: return the element's outer HTML
    bodyHtml = clone.outerHTML;
  } else {
    // Full page: extract <style> tags from head + <body> inner HTML
    const headEl = clone.querySelector('head');
    const bodyEl = clone.querySelector('body');

    bodyHtml = '';

    // Include inlined styles from the original page's head
    if (headEl) {
      headEl.querySelectorAll('style').forEach(style => {
        bodyHtml += style.outerHTML + '\n';
      });
    }

    // Include body content
    if (bodyEl) {
      bodyHtml += bodyEl.innerHTML;
    } else {
      bodyHtml += clone.innerHTML;
    }
  }

  // Source URL comment
  bodyHtml += `\n<!-- Clipped from: ${escapeHtml(url)} -->`;

  return { title: titleFromClone, html: bodyHtml, url };
}

// ===== Lazy Image Resolution (on clone — never touches live document) =====

/**
 * Resolve lazy-loaded images on the CLONED document.
 * This does NOT scroll the live page or trigger network loads.
 * It simply copies data-src → src so the clone has the actual image URLs.
 */
function resolveLazyImages(clone: HTMLElement): void {
  clone.querySelectorAll<HTMLImageElement>('img[loading="lazy"], img[data-src], img[data-original]').forEach(img => {
    const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original');
    if (dataSrc) {
      img.setAttribute('src', dataSrc);
      img.removeAttribute('loading');
    }
  });
}

// ===== Shadow DOM =====

function processShadowDOM(doc: Document, clone: HTMLElement): void {
  // Use a more robust matching strategy: match by tagName + index among same-tag siblings
  function findCorrespondingNode(liveEl: Element): Element | null {
    // Build path from live element: each entry is [tagName, indexAmongSameTag]
    interface PathEntry { tag: string; idx: number }
    const path: PathEntry[] = [];
    let current: Element | null = liveEl;
    while (current && current !== doc.documentElement) {
      const parentEl: Element | null = current.parentElement;
      if (!parentEl) break;
      const tag = current.tagName;
      const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === tag);
      const idx = siblings.indexOf(current);
      path.unshift({ tag, idx });
      current = parentEl;
    }

    // Traverse the clone using the same path
    let cloneCursor: Element = clone;

    if (clone.tagName !== doc.documentElement.tagName) {
      // Selector mode — clone is a specific element, try matching top of path
      const relevantPath = path.slice(-5);
      for (const entry of relevantPath) {
        const curChildren: Element[] = Array.from(cloneCursor.children)
          .filter((c: Element) => c.tagName === entry.tag);
        if (curChildren.length > 0) {
          const nextChild: Element = curChildren[Math.min(entry.idx, curChildren.length - 1)];
          if (nextChild) { cloneCursor = nextChild; continue; }
        }
        break;
      }
      return cloneCursor === clone ? null : cloneCursor;
    }

    // Full page mode — traverse from root
    for (const entry of path) {
      const curChildren: Element[] = Array.from(cloneCursor.children)
        .filter((c: Element) => c.tagName === entry.tag);
      if (curChildren.length > 0) {
        cloneCursor = curChildren[Math.min(entry.idx, curChildren.length - 1)];
      } else {
        return null;
      }
    }

    return cloneCursor;
  }

  const shadowHosts = doc.querySelectorAll('*');
  shadowHosts.forEach(el => {
    if (el.shadowRoot) {
      const shadowClone = findCorrespondingNode(el);
      if (shadowClone && shadowClone.tagName === el.tagName) {
        try {
          const newShadow = shadowClone.attachShadow({ mode: 'open' });
          newShadow.innerHTML = serializeShadowContent(el.shadowRoot);
        } catch {
          // Can't attach shadow — append as regular content
          const wrapper = doc.createElement('div');
          wrapper.setAttribute('data-shadow-host', 'true');
          wrapper.innerHTML = serializeShadowContent(el.shadowRoot);
          shadowClone.appendChild(wrapper);
        }
      }
    }
  });
}

function serializeShadowContent(root: ShadowRoot): string {
  let html = '';
  root.childNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      html += (node as Element).outerHTML;
    } else if (node.nodeType === Node.TEXT_NODE) {
      html += node.textContent || '';
    }
  });

  // Include adopted stylesheets
  if (root.adoptedStyleSheets?.length) {
    html = `<style>${Array.from(root.adoptedStyleSheets).map(s => {
      try { return Array.from(s.cssRules).map(r => r.cssText).join('\n'); }
      catch { return ''; }
    }).join('\n')}</style>` + html;
  }

  return html;
}

// ===== Stylesheet Inlining =====

async function inlineStylesheets(clone: HTMLElement, doc: Document): Promise<void> {
  const links = clone.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
  await Promise.all(
    Array.from(links).map(async (link) => {
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
      } catch { /* keep original */ }
    })
  );
}

// ===== Inline Style Backgrounds =====

async function inlineStyleBackgrounds(clone: HTMLElement, doc: Document): Promise<void> {
  const elements = clone.querySelectorAll<HTMLElement>('[style]');
  await Promise.all(
    Array.from(elements).map(async (el) => {
      const style = el.getAttribute('style') || '';
      if (!style.includes('url(')) return;
      const newStyle = await replaceCSSUrls(style, doc.baseURI);
      if (newStyle !== style) el.setAttribute('style', newStyle);
    })
  );
}

// ===== CSS Background Images (in <style> blocks) =====

async function inlineCSSBackgroundImages(clone: HTMLElement, doc: Document): Promise<void> {
  const styles = clone.querySelectorAll('style');
  await Promise.all(
    Array.from(styles).map(async (style) => {
      const css = style.textContent || '';
      if (!css.includes('url(')) return;
      const newCSS = await replaceCSSUrls(css, doc.baseURI);
      if (newCSS !== css) style.textContent = newCSS;
    })
  );
}

async function replaceCSSUrls(css: string, baseURI: string): Promise<string> {
  const urlRegex = /url\(["']?([^"')]+)["']?\)/g;
  const matches = [...css.matchAll(urlRegex)];

  if (matches.length === 0) return css;

  // Build a map of unique URLs -> data URIs (deduplicate fetches)
  const uniqueUrls = new Set(matches.map(m => m[1].trim()));
  const urlToDataUri = new Map<string, string | null>();

  await Promise.all(
    Array.from(uniqueUrls).map(async (rawUrl) => {
      if (rawUrl.startsWith('data:') || rawUrl.startsWith('#')) {
        urlToDataUri.set(rawUrl, null);
        return;
      }
      try {
        const fullUrl = new URL(rawUrl, baseURI).href;
        const dataUri = await fetchAsDataUri(fullUrl);
        urlToDataUri.set(rawUrl, dataUri || null);
      } catch {
        urlToDataUri.set(rawUrl, null);
      }
    })
  );

  // Single-pass replacement to handle duplicate URLs correctly
  return css.replace(urlRegex, (match, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    const dataUri = urlToDataUri.get(trimmed);
    if (dataUri) {
      return `url(${dataUri})`;
    }
    return match; // keep original
  });
}

// ===== Image Inlining =====

async function inlineImages(clone: HTMLElement): Promise<void> {
  const images = clone.querySelectorAll<HTMLImageElement>('img[src]');
  await Promise.all(
    Array.from(images).map(async (img) => {
      try {
        const src = img.getAttribute('src') || img.currentSrc;
        if (!src || src.startsWith('data:')) return;
        const dataUri = await fetchAsDataUri(src);
        if (dataUri) {
          img.setAttribute('src', dataUri);
          img.removeAttribute('srcset');
          img.removeAttribute('sizes');
        }
      } catch { /* keep original */ }
    })
  );

  // Also handle <source> elements in <picture>
  const sources = clone.querySelectorAll<HTMLSourceElement>('source[srcset]');
  sources.forEach(source => source.remove());

  // Handle <input type="image">
  const inputImages = clone.querySelectorAll<HTMLInputElement>('input[type="image"][src]');
  await Promise.all(
    Array.from(inputImages).map(async (input) => {
      try {
        const src = input.getAttribute('src')!;
        if (src.startsWith('data:')) return;
        const dataUri = await fetchAsDataUri(src);
        if (dataUri) input.setAttribute('src', dataUri);
      } catch { /* keep */ }
    })
  );
}

// ===== Font Capture =====

async function inlineFonts(clone: HTMLElement, doc: Document): Promise<void> {
  // Find @font-face rules in <style> blocks and inline the font files
  const styles = clone.querySelectorAll('style');
  await Promise.all(
    Array.from(styles).map(async (style) => {
      const css = style.textContent || '';
      if (!css.includes('@font-face')) return;

      const fontUrlRegex = /url\(["']?([^"')]+)["']?\)/g;
      const fontUrls = [...css.matchAll(fontUrlRegex)];
      if (fontUrls.length === 0) return;

      // Deduplicate URL fetches
      const uniqueUrls = new Set(fontUrls.map(m => m[1].trim()));
      const urlToDataUri = new Map<string, string | null>();

      await Promise.all(
        Array.from(uniqueUrls).map(async (fontUrl) => {
          if (fontUrl.startsWith('data:')) {
            urlToDataUri.set(fontUrl, null);
            return;
          }
          try {
            const fullUrl = new URL(fontUrl, doc.baseURI).href;
            const dataUri = await fetchAsDataUri(fullUrl);
            urlToDataUri.set(fontUrl, dataUri || null);
          } catch {
            urlToDataUri.set(fontUrl, null);
          }
        })
      );

      // Single-pass replacement
      style.textContent = css.replace(fontUrlRegex, (match, fontUrl: string) => {
        const trimmed = fontUrl.trim();
        const dataUri = urlToDataUri.get(trimmed);
        if (dataUri) return `url(${dataUri})`;
        return match;
      });
    })
  );
}

// ===== Canvas → Image =====

async function convertCanvasToImages(clone: HTMLElement, doc: Document): Promise<void> {
  const canvases = doc.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');

  canvases.forEach((canvas, i) => {
    try {
      const dataUri = canvas.toDataURL('image/png');
      const img = doc.createElement('img');
      img.setAttribute('src', dataUri);
      img.setAttribute('width', String(canvas.width));
      img.setAttribute('height', String(canvas.height));
      img.setAttribute('data-was-canvas', 'true');

      const cloneCanvas = cloneCanvases[i];
      if (cloneCanvas) {
        cloneCanvas.replaceWith(img.cloneNode(true));
      }
    } catch {
      // Tainted canvas — can't export
      const cloneCanvas = cloneCanvases[i];
      if (cloneCanvas) {
        cloneCanvas.setAttribute('data-clipper-tainted', 'true');
      }
    }
  });
}

// ===== iframe Processing =====

async function processIframes(
  clone: HTMLElement,
  doc: Document,
  maxDepth: number,
  currentDepth = 0
): Promise<void> {
  if (currentDepth >= maxDepth) return;

  const iframes = clone.querySelectorAll('iframe');
  await Promise.all(
    Array.from(iframes).map(async (iframe) => {
      try {
        const src = iframe.getAttribute('src');
        if (!src) return;

        const fullUrl = new URL(src, doc.baseURI).href;

        // Try to fetch the iframe content
        const html = await fetchText(fullUrl);
        if (!html) return;

        // Create a placeholder div with the iframe content
        const wrapper = doc.createElement('div');
        wrapper.setAttribute('data-iframe-src', fullUrl);
        wrapper.innerHTML = html;

        // Recursively process nested iframes
        const nestedIframes = wrapper.querySelectorAll('iframe');
        if (nestedIframes.length > 0) {
          await processIframes(wrapper, doc, maxDepth, currentDepth + 1);
        }

        iframe.replaceWith(wrapper);
      } catch { /* keep original iframe */ }
    })
  );
}

// ===== Element Title =====

function getElementTitle(doc: Document, selector: string): string {
  const el = doc.querySelector(selector);
  if (!el) return doc.title;

  // Try to find the nearest heading
  const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading?.textContent) return heading.textContent.trim();

  // Try id or class
  const id = el.getAttribute('id');
  if (id) return id.replace(/[-_]/g, ' ');

  return doc.title;
}

// ===== CSS Minification =====

function minifyCSS(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;\}/g, '}')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Re-export for use by other modules
// (Previously triggerLazyContent was async with scroll + network waits;
//  now it's a synchronous data-src→src pass on the clone only.)

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, c => map[c]);
}

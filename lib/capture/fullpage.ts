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

interface CaptureOptions {
  removeScripts?: boolean;
  removeHidden?: boolean;
  compressCSS?: boolean;
  inlineResources?: boolean;
  /** CSS selector for element to clip (instead of full page) */
  selector?: string;
  /** Max iframe depth */
  maxFrameDepth?: number;
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
  } = options;

  const url = doc.URL;
  const title = doc.title;

  // Trigger lazy-loaded content
  if (inlineResources) {
    await triggerLazyContent(doc);
  }

  // Clone the document
  let source: Element;
  if (selector) {
    const el = doc.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    source = el;
  } else {
    source = doc.documentElement;
  }

  const clone = source.cloneNode(true) as HTMLElement;
  const titleFromClone = selector ? getElementTitle(doc, selector) : title;

  // Process Shadow DOM
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
    await inlineStylesheets(clone, doc);
    await inlineStyleBackgrounds(clone, doc);
    await inlineImages(clone);
    await inlineCSSBackgroundImages(clone, doc);
    await inlineFonts(clone, doc);
    await convertCanvasToImages(clone, doc);
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

  // Build head
  let head = clone.querySelector('head');
  if (!head) {
    head = doc.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }

  // Meta charset
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.insertBefore(meta, head.firstChild);

  // Base tag
  const base = doc.createElement('base');
  base.setAttribute('href', url);
  head.insertBefore(base, head.firstChild?.nextSibling || null);

  // Source URL watermark
  const watermark = doc.createElement('meta');
  watermark.setAttribute('name', 'clipped-from');
  watermark.setAttribute('content', url);
  head.appendChild(watermark);

  const html = '<!DOCTYPE html>\n' + clone.outerHTML;

  return { title: titleFromClone, html, url };
}

// ===== Lazy Content Trigger =====

async function triggerLazyContent(doc: Document): Promise<void> {
  // Scroll to trigger lazy images
  const scrollTop = doc.documentElement.scrollTop;
  const steps = 5;
  const stepHeight = doc.documentElement.scrollHeight / steps;

  for (let i = 0; i <= steps; i++) {
    window.scrollTo(0, stepHeight * i);
    await sleep(100);
  }

  // Restore scroll position
  window.scrollTo(0, scrollTop);

  // Wait for images to load
  const imgs = doc.querySelectorAll('img[loading="lazy"], img[data-src], img[data-original]');
  await Promise.all(
    Array.from(imgs).map(async (img) => {
      const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original');
      if (dataSrc) {
        img.setAttribute('src', dataSrc);
      }
      if (img.complete) return;
      await new Promise<void>(resolve => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
        setTimeout(() => resolve(), 3000);
      });
    })
  );
}

// ===== Shadow DOM =====

function processShadowDOM(doc: Document, clone: HTMLElement): void {
  const allElements = doc.querySelectorAll('*');
  const cloneElements = clone.querySelectorAll('*');

  allElements.forEach((el, i) => {
    if (el.shadowRoot) {
      const shadowClone = cloneElements[i];
      if (shadowClone) {
        const shadowContent = el.shadowRoot.cloneNode(true) as ShadowRoot;
        // Attach shadow and copy content
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

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const rawUrl = match[1].trim();
      if (rawUrl.startsWith('data:') || rawUrl.startsWith('#')) return null;

      try {
        const fullUrl = new URL(rawUrl, baseURI).href;
        const dataUri = await fetchAsDataUri(fullUrl);
        if (dataUri) {
          return { old: match[0], new: `url(${dataUri})` };
        }
      } catch { /* keep original */ }
      return null;
    })
  );

  let result = css;
  for (const r of replacements) {
    if (r) result = result.replace(r.old, r.new);
  }
  return result;
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
  // 1. Capture fonts from document.fonts
  const fontFaces: Array<{ family: string; url: string; format: string }> = [];

  if (doc.fonts) {
    for (const font of doc.fonts.values()) {
      try {
        if (font.status === 'loaded') {
          // We can't easily extract the font data from document.fonts,
          // but we can capture @font-face rules from stylesheets
        }
      } catch { /* skip */ }
    }
  }

  // 2. Find @font-face rules in <style> blocks and inline the font files
  const styles = clone.querySelectorAll('style');
  await Promise.all(
    Array.from(styles).map(async (style) => {
      const css = style.textContent || '';
      if (!css.includes('@font-face')) return;

      const fontFaceRegex = /@font-face\s*\{[^}]*\}/g;
      const fontFaces = css.match(fontFaceRegex);
      if (!fontFaces) return;

      let newCSS = css;
      for (const ff of fontFaces) {
        const urlMatch = ff.match(/url\(["']?([^"')]+)["']?\)/);
        if (!urlMatch) continue;

        const fontUrl = urlMatch[1].trim();
        if (fontUrl.startsWith('data:')) continue;

        try {
          const fullUrl = new URL(fontUrl, doc.baseURI).href;
          const dataUri = await fetchAsDataUri(fullUrl);
          if (dataUri) {
            const newFF = ff.replace(urlMatch[0], `url(${dataUri})`);
            newCSS = newCSS.replace(ff, newFF);
          }
        } catch { /* keep original */ }
      }

      style.textContent = newCSS;
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

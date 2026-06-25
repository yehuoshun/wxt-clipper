/**
 * Hidden watermark detection & removal.
 *
 * Common techniques:
 * 1. CSS-hidden elements (opacity:0, visibility:hidden, display:none, off-screen)
 * 2. Zero-size elements with tracking IDs
 * 3. Invisible Unicode characters (zero-width spaces, etc.)
 * 4. Text colored same as background
 * 5. CSS pseudo-elements (::before/::after) with tracking content
 * 6. data-* tracking attributes
 * 7. User-select: none hidden overlays
 */

export function stripWatermarks(doc: Document | HTMLElement): number {
  let removed = 0;

  const root = doc instanceof Document ? doc.documentElement : doc;

  // 1. Remove CSS-hidden elements
  removed += removeHiddenElements(root);

  // 2. Remove zero-size elements
  removed += removeZeroSizeElements(root);

  // 3. Strip invisible Unicode from text nodes
  removed += stripInvisibleUnicode(root);

  // 4. Detect and remove same-color text
  removed += removeSameColorText(root);

  // 5. Strip tracking data attributes
  removed += stripTrackingAttributes(root);

  // 6. Remove hidden overlays
  removed += removeHiddenOverlays(root);

  return removed;
}

// ===== 1. CSS-Hidden Elements =====

function removeHiddenElements(root: HTMLElement): number {
  let count = 0;

  // display: none
  root.querySelectorAll<HTMLElement>('[style*="display:none"], [style*="display: none"]').forEach(el => {
    if (isWatermarkElement(el)) { el.remove(); count++; }
  });

  // visibility: hidden
  root.querySelectorAll<HTMLElement>('[style*="visibility:hidden"], [style*="visibility: hidden"]').forEach(el => {
    if (isWatermarkElement(el)) { el.remove(); count++; }
  });

  // opacity: 0
  root.querySelectorAll<HTMLElement>('[style*="opacity:0"], [style*="opacity: 0"]').forEach(el => {
    if (isWatermarkElement(el)) { el.remove(); count++; }
  });

  // Off-screen positioning
  root.querySelectorAll<HTMLElement>('[style]').forEach(el => {
    const style = el.getAttribute('style') || '';
    const computed = getComputedStyleSafely(el);
    if (!computed) return;

    // Positioned far off-screen
    const left = parseInt(computed.left) || 0;
    const top = parseInt(computed.top) || 0;
    if ((Math.abs(left) > 9999 || Math.abs(top) > 9999) && isWatermarkElement(el)) {
      el.remove(); count++;
      return;
    }

    // text-indent: -9999px (classic hidden text)
    if (computed.textIndent && parseInt(computed.textIndent) < -9000) {
      if (isWatermarkElement(el)) { el.remove(); count++; }
    }
  });

  return count;
}

// ===== 2. Zero-Size Elements =====

function removeZeroSizeElements(root: HTMLElement): number {
  let count = 0;

  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    // Skip meaningful zero-size elements (like <br>, <hr>, <meta>)
    const tag = el.tagName.toLowerCase();
    if (['br', 'hr', 'meta', 'link', 'input', 'source'].includes(tag)) return;

    const rect = el.getBoundingClientRect?.();
    if (!rect) return;

    // Zero width AND zero height
    if (rect.width === 0 && rect.height === 0) {
      // Check if it has text content (could be a hidden watermark)
      const text = (el.textContent || '').trim();
      if (text.length > 0 || el.hasAttribute('data-') || el.hasAttribute('aria-')) {
        el.remove(); count++;
      }
    }
  });

  return count;
}

// ===== 3. Invisible Unicode Characters =====

function stripInvisibleUnicode(root: HTMLElement): number {
  let count = 0;

  const invisibleChars = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064\u180E\u2028\u2029\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  textNodes.forEach(node => {
    const original = node.textContent || '';
    const cleaned = original.replace(invisibleChars, '');
    if (cleaned !== original) {
      node.textContent = cleaned;
      count++;
    }
  });

  return count;
}

// ===== 4. Same-Color Text (text matches background) =====

function removeSameColorText(root: HTMLElement): number {
  let count = 0;

  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    const text = (el.textContent || '').trim();
    if (!text || text.length < 3) return;

    const computed = getComputedStyleSafely(el);
    if (!computed) return;

    const color = normalizeColor(computed.color);
    const bg = normalizeColor(computed.backgroundColor);

    // Skip if no background or transparent
    if (!bg || bg === 'rgba(0,0,0,0)' || bg === 'transparent') return;

    // Text color matches background exactly
    if (color === bg) {
      // Check if parent has different color (this element is hiding text)
      const parent = el.parentElement;
      if (parent) {
        const parentComputed = getComputedStyleSafely(parent);
        if (parentComputed) {
          const parentColor = normalizeColor(parentComputed.color);
          if (parentColor !== color) {
            el.remove(); count++;
            return;
          }
        }
      }
    }

    // Very low contrast (text nearly invisible)
    const contrast = getContrastRatio(color, bg);
    if (contrast < 1.05 && text.length > 10) {
      el.remove(); count++;
    }
  });

  return count;
}

// ===== 5. Tracking Data Attributes =====

function stripTrackingAttributes(root: HTMLElement): number {
  let count = 0;

  const trackingPatterns = [
    /^data-track/,
    /^data-analytics/,
    /^data-ga-/,
    /^data-gtm-/,
    /^data-fingerprint/,
    /^data-watermark/,
    /^data-trace/,
    /^data-monitor/,
    /^data-stat/,
    /^data-beacon/,
    /^data-uid$/,
    /^data-user-id$/,
    /^data-session/,
    /^data-visitor/,
    /^data-pageview/,
    /^data-impression/,
    /^data-click/,
    /^data-event-/,
    /^aria-describedby$/,
    /^aria-labelledby$/,
  ];

  root.querySelectorAll('*').forEach(el => {
    const attrs = el.getAttributeNames();
    attrs.forEach(attr => {
      if (trackingPatterns.some(p => p.test(attr))) {
        el.removeAttribute(attr);
        count++;
      }
    });

    // Remove empty elements that only had tracking attributes
    if (!el.hasAttribute('id') && !el.hasAttribute('class') &&
        el.getAttributeNames().length === 0 &&
        !(el.textContent || '').trim() &&
        el.children.length === 0) {
      el.remove();
      count++;
    }
  });

  return count;
}

// ===== 6. Hidden Overlays =====

function removeHiddenOverlays(root: HTMLElement): number {
  let count = 0;

  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    const computed = getComputedStyleSafely(el);
    if (!computed) return;

    // Full-viewport overlay with pointer-events: none (common watermark pattern)
    if (
      computed.position === 'fixed' &&
      computed.top === '0px' &&
      computed.left === '0px' &&
      (computed.width === '100%' || computed.width === '100vw') &&
      (computed.height === '100%' || computed.height === '100vh') &&
      (computed.pointerEvents === 'none' || computed.opacity === '0') &&
      parseInt(computed.zIndex || '0') > 1000
    ) {
      const text = (el.textContent || '').trim();
      if (text.length > 0) {
        el.remove(); count++;
      }
    }

    // user-select: none + fixed position (watermark overlay)
    if (
      computed.userSelect === 'none' &&
      computed.position === 'fixed' &&
      (computed.pointerEvents === 'none') &&
      parseInt(computed.zIndex || '0') > 100
    ) {
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 200) {
        el.remove(); count++;
      }
    }
  });

  return count;
}

// ===== Helpers =====

function isWatermarkElement(el: HTMLElement): boolean {
  const text = (el.textContent || '').trim();

  // Has suspicious content
  if (text.length > 0) return true;

  // Has tracking-like attributes
  const attrs = el.getAttributeNames();
  if (attrs.some(a => a.startsWith('data-') || a.startsWith('aria-'))) return true;

  // Has children (could be structured watermark)
  if (el.children.length > 0) return true;

  // Empty hidden element — safe to remove
  return true;
}

function getComputedStyleSafely(el: HTMLElement): CSSStyleDeclaration | null {
  try {
    return window.getComputedStyle(el);
  } catch {
    return null;
  }
}

function normalizeColor(color: string): string {
  // Handle rgb/rgba → standard format
  if (!color) return '';

  // Create a temp element to leverage browser color parsing
  const temp = document.createElement('div');
  temp.style.color = color;
  document.body.appendChild(temp);
  const normalized = window.getComputedStyle(temp).color;
  temp.remove();
  return normalized;
}

function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = parseRGB(color1);
  const rgb2 = parseRGB(color2);
  if (!rgb1 || !rgb2) return 21; // Assume high contrast if can't parse

  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRGB(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const rsrgb = r / 255;
  const gsrgb = g / 255;
  const bsrgb = b / 255;

  const rLin = rsrgb <= 0.04045 ? rsrgb / 12.92 : Math.pow((rsrgb + 0.055) / 1.055, 2.4);
  const gLin = gsrgb <= 0.04045 ? gsrgb / 12.92 : Math.pow((gsrgb + 0.055) / 1.055, 2.4);
  const bLin = bsrgb <= 0.04045 ? bsrgb / 12.92 : Math.pow((bsrgb + 0.055) / 1.055, 2.4);

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

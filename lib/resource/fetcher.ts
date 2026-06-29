/**
 * Resource fetching utilities — fetch and inline external resources.
 * Respects rate limits with exponential backoff.
 *
 * When running in content script context, routes requests through
 * the background script (service worker) to bypass page CSP restrictions.
 */

import { getLogger } from '../logger';

const log = getLogger('fetcher');

interface FetchOptions {
  timeout?: number;
  maxRetries?: number;
  baseDelay?: number;
}

const DEFAULT_OPTIONS: FetchOptions = {
  timeout: 10000,
  maxRetries: 3,
  baseDelay: 200,
};

// Rate limiting — max concurrent requests
let activeRequests = 0;
const MAX_CONCURRENT = 4;
const queue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return;
  }
  return new Promise(resolve => {
    queue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  const next = queue.shift();
  if (next) next();
}

// ===== Background proxy detection =====
// Content scripts can't bypass page CSP for fetch(). We detect the context
// and route through the background script when needed.

let _isContentScript: boolean | null = null;

function isContentScript(): boolean {
  if (_isContentScript !== null) return _isContentScript;
  try {
    // Content scripts run in the page's context, not chrome-extension://
    // Background/options/popup pages all have chrome-extension:// protocol
    _isContentScript =
      typeof window !== 'undefined' &&
      typeof chrome !== 'undefined' &&
      chrome.runtime?.id !== undefined &&
      typeof location !== 'undefined' &&
      location.protocol !== 'chrome-extension:';
  } catch {
    _isContentScript = false;
  }
  return _isContentScript;
}

async function bgFetchText(url: string, timeout: number): Promise<string | null> {
  try {
    const result = await browser.runtime.sendMessage({
      type: 'proxyFetch',
      subType: 'text',
      url,
      timeout,
    });
    return (result as any)?.data ?? null;
  } catch (err) {
    // sendMessage fails if we're not in a content script (e.g. background self-call)
    return null;
  }
}

async function bgFetchDataUri(url: string, timeout: number): Promise<string | null> {
  try {
    const result = await browser.runtime.sendMessage({
      type: 'proxyFetch',
      subType: 'dataUri',
      url,
      timeout,
    });
    return (result as any)?.data ?? null;
  } catch (err) {
    return null;
  }
}

// ===== Captured resource cache (from content-hooks MAIN world) =====
// The content-hooks script intercepts fetch/XHR responses from the page
// and stores them as data URIs. We try to reuse them before making new requests.

let _captureListenerInitialized = false;
const _capturedCache = new Map<string, string>();

function initCaptureListener(): void {
  if (_captureListenerInitialized || typeof window === 'undefined') return;
  _captureListenerInitialized = true;

  window.addEventListener('__clipper_resource_captured', ((e: CustomEvent) => {
    const { url, dataUri } = e.detail || {};
    if (url && dataUri) {
      _capturedCache.set(url, dataUri);
    }
  }) as EventListener);
}

async function checkCapturedCache(url: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  initCaptureListener();

  // Check synchronous cache first
  const cached = _capturedCache.get(url);
  if (cached) return cached;

  // Try requesting from MAIN world via CustomEvent
  try {
    const response = await new Promise<string | null>((resolve) => {
      const handler = ((e: CustomEvent) => {
        if (e.detail?.url === url) {
          window.removeEventListener('__clipper_resource_response', handler as EventListener);
          resolve(e.detail?.dataUri || null);
        }
      }) as EventListener;

      window.addEventListener('__clipper_resource_response', handler as EventListener);
      window.dispatchEvent(new CustomEvent('__clipper_request_resource', {
        detail: { url },
      }));

      // Timeout after 500ms
      setTimeout(() => {
        window.removeEventListener('__clipper_resource_response', handler as EventListener);
        resolve(null);
      }, 500);
    });

    if (response) {
      _capturedCache.set(url, response);
      return response;
    }
  } catch {
    // ignore
  }

  return null;
}

// ===== Public API =====

export async function fetchText(url: string, options?: FetchOptions): Promise<string | null> {
  // Try background proxy first in content script context
  if (isContentScript()) {
    const result = await bgFetchText(url, options?.timeout ?? DEFAULT_OPTIONS.timeout!);
    if (result !== null) return result;
    // Fall through to direct fetch if background proxy fails
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < opts.maxRetries!; attempt++) {
    try {
      await acquireSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout);

      // Signal to content-hooks that this is a clipper-originated fetch
      try {
        if (typeof window !== 'undefined' && (window as any).__clipper_fetch_guard === false) {
          (window as any).__clipper_fetch_count = ((window as any).__clipper_fetch_count || 0) + 1;
        }
      } catch { /* ignore */ }

      const res = await fetch(url, {
        mode: 'cors',
        signal: controller.signal,
      });

      try {
        if (typeof window !== 'undefined' && (window as any).__clipper_fetch_count > 0) {
          (window as any).__clipper_fetch_count--;
        }
      } catch { /* ignore */ }

      clearTimeout(timer);
      releaseSlot();

      if (!res.ok) return null;
      return res.text();
    } catch (err) {
      try {
        if (typeof window !== 'undefined' && (window as any).__clipper_fetch_count > 0) {
          (window as any).__clipper_fetch_count--;
        }
      } catch { /* ignore */ }
      releaseSlot();
      lastError = err as Error;
      if (attempt < opts.maxRetries! - 1) {
        await sleep(opts.baseDelay! * Math.pow(2, attempt));
      }
    }
  }

  log.warn(`Failed to fetch text`, { url, error: lastError?.message });
  return null;
}

export async function fetchAsDataUri(url: string, options?: FetchOptions): Promise<string | null> {
  // Check captured resource cache first (from content-hooks MAIN world interception)
  const cached = await checkCapturedCache(url);
  if (cached) return cached;

  // Try background proxy first in content script context
  if (isContentScript()) {
    const result = await bgFetchDataUri(url, options?.timeout ?? DEFAULT_OPTIONS.timeout!);
    if (result !== null) return result;
    // Fall through to direct fetch
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < opts.maxRetries!; attempt++) {
    try {
      await acquireSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout);

      // Signal to content-hooks that this is a clipper-originated fetch
      try {
        if (typeof window !== 'undefined' && (window as any).__clipper_fetch_guard === false) {
          (window as any).__clipper_fetch_count = ((window as any).__clipper_fetch_count || 0) + 1;
        }
      } catch { /* ignore */ }

      const res = await fetch(url, {
        mode: 'cors',
        signal: controller.signal,
      });

      try {
        if (typeof window !== 'undefined' && (window as any).__clipper_fetch_count > 0) {
          (window as any).__clipper_fetch_count--;
        }
      } catch { /* ignore */ }

      clearTimeout(timer);
      releaseSlot();

      if (!res.ok) return null;

      const blob = await res.blob();
      // Skip very large resources (>5MB)
      if (blob.size > 5 * 1024 * 1024) {
        return url; // Return original URL
      }

      return blobToDataUri(blob);
    } catch (err) {
      try {
        if (typeof window !== 'undefined' && (window as any).__clipper_fetch_count > 0) {
          (window as any).__clipper_fetch_count--;
        }
      } catch { /* ignore */ }
      releaseSlot();
      lastError = err as Error;
      if (attempt < opts.maxRetries! - 1) {
        await sleep(opts.baseDelay! * Math.pow(2, attempt));
      }
    }
  }

  log.warn(`Failed to fetch resource`, { url, error: lastError?.message });
  return null;
}

export async function fetchAsBlob(url: string, options?: FetchOptions): Promise<Blob | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 0; attempt < opts.maxRetries!; attempt++) {
    try {
      await acquireSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeout);

      const res = await fetch(url, {
        mode: 'cors',
        signal: controller.signal,
      });
      clearTimeout(timer);
      releaseSlot();

      if (!res.ok) return null;
      return res.blob();
    } catch (err) {
      releaseSlot();
      if (attempt < opts.maxRetries! - 1) {
        await sleep(opts.baseDelay! * Math.pow(2, attempt));
      }
    }
  }

  return null;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

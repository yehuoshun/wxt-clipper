/**
 * MAIN world content script — hooks fetch/XHR to capture dynamically loaded resources.
 * Runs in the page's JavaScript context (not isolated).
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    // Guard: only run in browser
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;

    const capturedResources = new Map<string, { blob: Blob; type: string }>();

    // Hook fetch
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const response = await originalFetch.call(window, input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      try {
        const clone = response.clone();
        const blob = await clone.blob();
        capturedResources.set(url, { blob, type: blob.type });
      } catch { /* can't clone */ }

      return response;
    };

    // Hook XHR
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      const urlStr = typeof url === 'string' ? url : url.href;
      this.addEventListener('load', () => {
        try {
          const blob = new Blob([this.response], {
            type: this.getResponseHeader('Content-Type') || 'application/octet-stream',
          });
          capturedResources.set(urlStr, { blob, type: blob.type });
        } catch { /* ignore */ }
      });
      return originalXHROpen.call(this, method, url, async ?? true, username, password);
    };

    // Expose captured resources
    (window as any).__clipper_captured = capturedResources;
  },
});

/**
 * MAIN world content script — hooks fetch/XHR to capture dynamically loaded resources.
 * Runs in the page's JavaScript context (not isolated).
 *
 * Captured resources are communicated to the isolated-world content script
 * via DOM events, so the fetcher can reuse already-loaded resources instead
 * of fetching them again through the background proxy.
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

    const capturedResources = new Map<string, { dataUri: string }>();

    // Hook fetch
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const response = await originalFetch.call(window, input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (!response.ok) return response;

      // Only capture resources that the clipper might need (images, stylesheets, fonts)
      const contentType = response.headers.get('Content-Type') || '';
      const isRelevant =
        contentType.startsWith('image/') ||
        contentType.startsWith('text/css') ||
        contentType.includes('font') ||
        contentType.includes('javascript') ||
        url.match(/\.(png|jpg|jpeg|gif|svg|webp|css|woff2?|ttf|eot)$/i);

      if (isRelevant) {
        response.clone().blob().then(blob => {
          if (blob.size <= 5 * 1024 * 1024) {
            toDataUri(blob).then(dataUri => {
              capturedResources.set(url, { dataUri });
              dispatchResourceEvent(url, dataUri);
            }).catch(() => {});
          }
        }).catch(() => {});
      }

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
      const xhr = this;
      const originalOnLoad = xhr.onload;

      xhr.addEventListener('load', () => {
        try {
          const contentType = xhr.getResponseHeader('Content-Type') || '';
          const isRelevant =
            contentType.startsWith('image/') ||
            contentType.startsWith('text/css') ||
            contentType.includes('font') ||
            urlStr.match(/\.(png|jpg|jpeg|gif|svg|webp|css|woff2?|ttf|eot)$/i);

          if (isRelevant && xhr.response) {
            const blob = new Blob([xhr.response], {
              type: contentType || 'application/octet-stream',
            });
            if (blob.size <= 5 * 1024 * 1024) {
              toDataUri(blob).then(dataUri => {
                capturedResources.set(urlStr, { dataUri });
                dispatchResourceEvent(urlStr, dataUri);
              }).catch(() => {});
            }
          }
        } catch { /* ignore */ }
      });

      return originalXHROpen.call(this, method, url, async ?? true, username, password);
    };

    // Listen for resource requests from isolated-world content script
    window.addEventListener('__clipper_request_resource', ((e: CustomEvent) => {
      const requestUrl = e.detail?.url;
      if (!requestUrl) return;
      const captured = capturedResources.get(requestUrl);
      if (captured) {
        window.dispatchEvent(new CustomEvent('__clipper_resource_response', {
          detail: { url: requestUrl, dataUri: captured.dataUri },
        }));
      }
    }) as EventListener);

    function dispatchResourceEvent(url: string, dataUri: string) {
      window.dispatchEvent(new CustomEvent('__clipper_resource_captured', {
        detail: { url, dataUri },
      }));
    }

    function toDataUri(blob: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      });
    }
  },
});
